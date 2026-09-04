import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as ptBr from '@zxcvbn-ts/language-pt-br';

/**
 * Medidor de senha por zxcvbn, não por contagem de caracteres.
 *
 * `Senha123!` passa em qualquer regra de complexidade e é péssima;
 * `cavalo bateria grampo` é excelente e reprovaria. Ver design/06-autenticacao.md.
 */
const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...ptBr.dictionary },
  graphs: common.adjacencyGraphs,
  translations: ptBr.translations,
});

export type Strength = 0 | 1 | 2 | 3 | 4;

/** Sem porcentagem, sem pontuação numérica. */
const LABELS: Record<Strength, string> = {
  0: 'fraca',
  1: 'fraca',
  2: 'razoável',
  3: 'boa',
  4: 'forte',
};

export interface PasswordScore {
  score: Strength;
  label: string;
  /** Quantos dos quatro segmentos acendem. */
  filled: number;
}

export function scorePassword(password: string, userInputs: string[] = []): PasswordScore | null {
  if (!password) return null;
  const score = zxcvbn.check(password, userInputs).score as Strength;
  return { score, label: LABELS[score], filled: Math.max(1, score) };
}
