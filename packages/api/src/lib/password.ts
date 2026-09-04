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

/** Comparação em tempo constante — o `verify` do argon2 já garante isso. */
export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
