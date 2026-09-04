import type { ApiError } from '@trindade/shared';

/**
 * Cliente HTTP.
 *
 * O access token vive **numa variável deste módulo** e some quando a aba
 * fecha. Nunca em localStorage, nunca em sessionStorage, nunca em cookie
 * legível: um XSS que consiga ler qualquer um dos três leva a sessão junto.
 * Ver docs/04-seguranca.md.
 */
let accessToken: string | null = null;

/** Chamado quando a sessão morre de vez e o app precisa voltar para /entrar. */
type SessionLostHandler = (reason: 'expired' | 'reuse') => void;
let onSessionLost: SessionLostHandler = () => {};

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionLostHandler(handler: SessionLostHandler): void {
  onSessionLost = handler;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;
  /** Segundos até poder tentar de novo, quando o servidor manda `Retry-After`. */
  readonly retryAfter: number | undefined;

  constructor(status: number, body: ApiError, retryAfter?: number) {
    super(body.error);
    this.name = 'HttpError';
    this.status = status;
    this.code = body.code;
    this.field = body.field;
    this.retryAfter = retryAfter;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Rotas públicas não tentam renovar a sessão ao receber 401. */
  auth?: boolean;
  signal?: AbortSignal;
}

/**
 * Um refresh de cada vez.
 *
 * Cinco requisições que expiram juntas disparariam cinco refreshes; como cada
 * um rotaciona o token, quatro chegariam com um token já revogado e o servidor
 * — corretamente — trataria isso como roubo e derrubaria a sessão. Por isso a
 * promessa é compartilhada: quem chega no meio espera a mesma.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        accessToken = null;
        onSessionLost(body?.code === 'TOKEN_REUSE' ? 'reuse' : 'expired');
        return null;
      }

      const body = (await res.json()) as { access: string };
      accessToken = body.access;
      return body.access;
    } catch {
      accessToken = null;
      onSessionLost('expired');
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

async function toError(res: Response): Promise<HttpError> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  const retryAfterHeader = res.headers.get('retry-after');
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  return new HttpError(
    res.status,
    body ?? { error: 'sem conexão com o servidor', code: 'NETWORK' },
    Number.isFinite(retryAfter) ? retryAfter : undefined,
  );
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const useAuth = options.auth !== false;

  let res: Response;
  try {
    res = await send(path, options, useAuth ? accessToken : null);
  } catch {
    throw new HttpError(0, { error: 'sem conexão com o servidor', code: 'NETWORK' });
  }

  // Uma tentativa de renovação, e só uma: se o refresh também der 401, insistir
  // só produziria um laço.
  if (res.status === 401 && useAuth) {
    const renewed = await refreshAccessToken();
    if (renewed) {
      try {
        res = await send(path, options, renewed);
      } catch {
        throw new HttpError(0, { error: 'sem conexão com o servidor', code: 'NETWORK' });
      }
    }
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Tentativa de retomar a sessão no primeiro carregamento da página. */
export async function tryRestoreSession(): Promise<string | null> {
  return refreshAccessToken();
}
