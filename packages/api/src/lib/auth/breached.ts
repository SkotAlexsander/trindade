import { createHash } from 'node:crypto';

/**
 * Verificação de senha vazada por k-anonymity no Have I Been Pwned: manda os
 * 5 primeiros caracteres do SHA-1 e compara o resto localmente. A senha nunca
 * sai daqui. Ver docs/04-seguranca.md.
 */
const API = 'https://api.pwnedpasswords.com/range';
const TIMEOUT_MS = 2000;

export async function isPasswordBreached(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`${API}/${prefix}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return false;

    const body = await res.text();
    for (const line of body.split('\n')) {
      const [hashSuffix, countRaw] = line.trim().split(':');
      if (hashSuffix !== suffix) continue;
      // Com `Add-Padding` a resposta traz linhas falsas com contagem zero.
      return Number(countRaw ?? '0') > 0;
    }
    return false;
  } catch {
    // Indisponibilidade de terceiro não bloqueia cadastro. Deixa passar.
    return false;
  }
}
