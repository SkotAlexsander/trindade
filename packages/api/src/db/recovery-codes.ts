import { sql } from './index.js';

export interface RecoveryCodeRow {
  id: string;
  code_hash: string;
}

/** Substitui o conjunto inteiro: ativar 2FA de novo invalida os códigos velhos. */
export async function replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`delete from recovery_codes where user_id = ${userId}`;
    for (const hash of hashes) {
      await tx`insert into recovery_codes (user_id, code_hash) values (${userId}, ${hash})`;
    }
  });
}

export async function listAvailable(userId: string): Promise<RecoveryCodeRow[]> {
  return sql<RecoveryCodeRow[]>`
    select id, code_hash from recovery_codes where user_id = ${userId} and used_at is null
  `;
}

export async function countAvailable(userId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from recovery_codes
    where user_id = ${userId} and used_at is null
  `;
  return Number(rows[0]?.count ?? '0');
}

/**
 * Marca como usado só se ainda não estava. O `returning` vazio significa que
 * outra requisição chegou primeiro — é o que garante o uso único mesmo com
 * duas tentativas simultâneas.
 */
export async function consume(id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update recovery_codes set used_at = now()
    where id = ${id} and used_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function deleteAll(userId: string): Promise<void> {
  await sql`delete from recovery_codes where user_id = ${userId}`;
}
