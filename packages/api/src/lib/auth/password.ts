import argon2 from 'argon2';

/** Parâmetros de docs/04-seguranca.md. Argon2id, nunca bcrypt. */
export const HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTS);
}

/** O `verify` do argon2 já compara em tempo constante. */
export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password).catch(() => false);
}

/**
 * Hash de um valor descartável, com o mesmo custo do real.
 *
 * No login com usuário inexistente não há hash para verificar. Se a rota
 * respondesse de imediato, o tempo de resposta entregaria quais usuários
 * existem — e com elenco fixo de cinco pessoas isso é meio caminho andado para
 * quem quer forçar bruta. Ver docs/04-seguranca.md.
 */
export async function burnPasswordTime(): Promise<void> {
  await argon2.hash('senha-inexistente-para-gastar-tempo', HASH_OPTS);
}
