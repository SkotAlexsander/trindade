import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Chave de origem para o rate limit.
 *
 * O rate limit precisa de alguma noção de "quem", mas guardar IP em claro
 * contraria o modelo de privacidade do projeto. Usamos HMAC do IP com um sal
 * que troca todo dia: dentro do dia dá para contar tentativas, e depois o
 * valor não serve para reconstruir nada. Ver docs/04-seguranca.md.
 *
 * O sal vive só na memória do processo. Reiniciar a API zera as contagens —
 * aceitável, e melhor do que persistir material que reidentifica.
 */
let salt = randomBytes(32);
let saltDay = currentDay();

function currentDay(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function activeSalt(): Buffer {
  const today = currentDay();
  if (today !== saltDay) {
    salt = randomBytes(32);
    saltDay = today;
  }
  return salt;
}

export function hashIp(ip: string): string {
  return createHmac('sha256', activeSalt()).update(ip).digest('base64url').slice(0, 22);
}

export function ipKey(req: FastifyRequest): string {
  return hashIp(req.ip);
}

/** Chave por usuário, com o IP como desempate quando não há sessão. */
export function userKey(req: FastifyRequest): string {
  return req.user ? `u:${req.user.id}` : `ip:${ipKey(req)}`;
}

/** Login e registro são anônimos: a chave combina o usuário tentado e o IP. */
export function attemptedUsernameKey(req: FastifyRequest, username: string | undefined): string {
  return `${username ?? '-'}:${ipKey(req)}`;
}
