/**
 * Backoff progressivo no login: 1s, 2s, 4s, 8s a cada falha consecutiva.
 *
 * Bloquear a conta seria mais simples e seria um erro: vira vetor de negação
 * de serviço contra um membro legítimo — basta errar a senha dele de
 * propósito. O atraso encarece a força bruta sem tirar o acesso de ninguém.
 * Ver docs/04-seguranca.md.
 */
const STEPS_MS = [0, 1000, 2000, 4000, 8000];
const MAX_STEP = STEPS_MS.length - 1;
const FORGET_AFTER_MS = 15 * 60 * 1000;

interface Entry {
  failures: number;
  last: number;
}

const entries = new Map<string, Entry>();

function prune(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.last > FORGET_AFTER_MS) entries.delete(key);
  }
}

export function delayFor(key: string, now: number = Date.now()): number {
  prune(now);
  const entry = entries.get(key);
  if (!entry) return 0;
  return STEPS_MS[Math.min(entry.failures, MAX_STEP)] ?? 0;
}

export function recordFailure(key: string, now: number = Date.now()): void {
  const entry = entries.get(key);
  entries.set(key, { failures: (entry?.failures ?? 0) + 1, last: now });
}

export function clearFailures(key: string): void {
  entries.delete(key);
}

export function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Só para os testes: zera o estado entre casos. */
export function resetBackoff(): void {
  entries.clear();
}
