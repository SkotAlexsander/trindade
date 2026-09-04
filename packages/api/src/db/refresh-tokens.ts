import { sql } from './index.js';

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  user_agent: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

/** Não há coluna de IP aqui. De propósito — ver docs/04-seguranca.md. */
export async function insertRefreshToken(input: {
  userId: string;
  familyId: string;
  tokenHash: string;
  userAgent: string | null;
  expiresAt: Date;
}): Promise<RefreshTokenRow> {
  const rows = await sql<RefreshTokenRow[]>`
    insert into refresh_tokens (user_id, family_id, token_hash, user_agent, expires_at)
    values (${input.userId}, ${input.familyId}, ${input.tokenHash},
            ${input.userAgent}, ${input.expiresAt})
    returning *
  `;
  const row = rows[0];
  if (!row) throw new Error('insert de refresh token não devolveu linha');
  return row;
}

export async function findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
  const rows = await sql<RefreshTokenRow[]>`
    select * from refresh_tokens where token_hash = ${tokenHash}
  `;
  return rows[0] ?? null;
}

/**
 * Rotação: revoga o antigo e cria o novo na mesma família, numa transação.
 *
 * A revogação é condicional (`where revoked_at is null`): se duas requisições
 * chegarem com o mesmo token ao mesmo tempo, só uma consegue revogar e só ela
 * emite o token novo. A outra não recebe linha e cai na detecção de reuso, em
 * vez de as duas emitirem tokens válidos na mesma família.
 */
export async function rotate(input: {
  oldId: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  userAgent: string | null;
  expiresAt: Date;
}): Promise<RefreshTokenRow | null> {
  return sql.begin(async (tx) => {
    const revoked = await tx<{ id: string }[]>`
      update refresh_tokens set revoked_at = now()
      where id = ${input.oldId} and revoked_at is null
      returning id
    `;
    if (revoked.length === 0) return null;

    const rows = await tx<RefreshTokenRow[]>`
      insert into refresh_tokens (user_id, family_id, token_hash, user_agent, expires_at)
      values (${input.userId}, ${input.familyId}, ${input.tokenHash},
              ${input.userAgent}, ${input.expiresAt})
      returning *
    `;
    return rows[0] ?? null;
  });
}

/**
 * Um token já revogado reapareceu: alguém tem uma cópia. Derruba a família
 * inteira e força login em todos os dispositivos daquela sessão.
 */
export async function revokeFamily(familyId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update refresh_tokens set revoked_at = now()
    where family_id = ${familyId} and revoked_at is null
    returning id
  `;
  return rows.length;
}

export async function revokeAllOfUser(userId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update refresh_tokens set revoked_at = now()
    where user_id = ${userId} and revoked_at is null
    returning id
  `;
  return rows.length;
}

/** Usada na troca de senha: mantém a sessão atual, derruba as outras. */
export async function revokeAllExceptFamily(userId: string, familyId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update refresh_tokens set revoked_at = now()
    where user_id = ${userId} and family_id <> ${familyId} and revoked_at is null
    returning id
  `;
  return rows.length;
}

export interface SessionRow {
  id: string;
  family_id: string;
  user_agent: string | null;
  created_at: Date;
}

/** Uma linha por família viva — a família é a sessão. Sem IP, de propósito. */
export async function listSessions(userId: string): Promise<SessionRow[]> {
  return sql<SessionRow[]>`
    select distinct on (family_id) id, family_id, user_agent, created_at
    from refresh_tokens
    where user_id = ${userId} and revoked_at is null and expires_at > now()
    order by family_id, created_at asc
  `;
}

export async function findFamilyOfSession(userId: string, sessionId: string): Promise<string | null> {
  const rows = await sql<{ family_id: string }[]>`
    select family_id from refresh_tokens where id = ${sessionId} and user_id = ${userId}
  `;
  return rows[0]?.family_id ?? null;
}
