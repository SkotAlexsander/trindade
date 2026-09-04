import type { ApiError } from '@trindade/shared';

/**
 * Cliente HTTP. O access token vive em memória do JavaScript e nunca em
 * `localStorage` — ver docs/04-seguranca.md. A fase 2 injeta o token aqui.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;

  constructor(status: number, body: ApiError) {
    super(body.error);
    this.name = 'HttpError';
    this.status = status;
    this.code = body.code;
    this.field = body.field;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new HttpError(res.status, body ?? { error: 'falha na requisição', code: 'NETWORK' });
  }

  return (await res.json()) as T;
}
