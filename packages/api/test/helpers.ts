import { randomUUID, generateKeyPairSync, randomBytes } from 'node:crypto';

// As chaves precisam existir **antes** de `config.ts` ser importado, e ele é
// importado por tudo. Geramos um par efêmero por execução: cada suíte assina
// com chave própria e nenhum segredo de desenvolvimento vaza para os testes.
if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
}
process.env.TOTP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

const { buildApp } = await import('../src/app.js');
const { sql } = await import('../src/db/index.js');
const { hashPassword } = await import('../src/lib/auth/password.js');
const { resetBackoff } = await import('../src/lib/auth/backoff.js');

export { sql };
export type TestApp = Awaited<ReturnType<typeof buildApp>>;

export async function startApp(): Promise<TestApp> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * Zera o estado entre casos. `restart identity cascade` também reseta as
 * sequências, para que ids não vazem de um teste para o outro.
 */
export async function resetDatabase(): Promise<void> {
  await sql`
    truncate table
      recovery_codes, refresh_tokens, user_roles, invites,
      audit_log, tasks, notes, read_state, attachments, reactions,
      saved_messages, messages,
      users
    restart identity cascade
  `;
  resetBackoff();
}

export const SENHA_BOA = 'cavalo-bateria-grampo-9';

export async function createUser(input: {
  username: string;
  password?: string;
  roleName?: string;
  displayName?: string;
}): Promise<{ id: string; username: string }> {
  const hash = await hashPassword(input.password ?? SENHA_BOA);
  const rows = await sql<{ id: string; username: string }[]>`
    insert into users (username, display_name, password_hash)
    values (${input.username}, ${input.displayName ?? input.username}, ${hash})
    returning id, username
  `;
  const user = rows[0];
  if (!user) throw new Error('não criou usuário de teste');

  const roleName = input.roleName ?? 'Membro';
  const roles = await sql<{ id: string }[]>`select id from roles where name = ${roleName}`;
  const role = roles[0];
  if (!role) throw new Error(`cargo ${roleName} não existe`);
  await sql`insert into user_roles (user_id, role_id) values (${user.id}, ${role.id})`;

  return user;
}

export async function createInvite(input: {
  createdBy: string;
  code?: string;
  expiresInHours?: number;
}): Promise<string> {
  const code = input.code ?? randomUUID().replace(/-/g, '').slice(0, 16);
  const expires = new Date(Date.now() + (input.expiresInHours ?? 24) * 3600_000);
  await sql`
    insert into invites (code, created_by, expires_at)
    values (${code}, ${input.createdBy}, ${expires})
  `;
  return code;
}

/**
 * Cada teste fala com a API por um endereço diferente.
 *
 * O rate limit guarda contagem em memória por chave, e a chave deriva do IP.
 * Sem isso, o quarto registro de um arquivo bate no limite de 3/hora e o teste
 * seguinte falha por um motivo que não tem nada a ver com o que ele testa.
 * Desligar o rate limit nos testes esconderia justamente o que queremos provar.
 */
let clientCounter = 0;

export function createClient(app: TestApp) {
  clientCounter += 1;
  const remoteAddress = `10.${(clientCounter >> 16) & 255}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`;
  return {
    remoteAddress,
    inject: (opts: Parameters<TestApp['inject']>[0]) =>
      app.inject({ ...(opts as object), remoteAddress } as Parameters<TestApp['inject']>[0]),
  };
}

export type TestClient = ReturnType<typeof createClient>;

/** Extrai o valor do cookie `rt` de um `set-cookie` da resposta. */
export function refreshCookieFrom(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const match = /(?:^|;\s*)rt=([^;]*)/.exec(entry);
    if (match?.[1]) return match[1];
  }
  throw new Error('resposta não trouxe o cookie rt');
}
