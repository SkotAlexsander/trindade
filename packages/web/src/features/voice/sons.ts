import { tocarNotas, type Nota } from '../../lib/bipe';
import { lerPreferencias } from '../../lib/preferencias';

/**
 * Os sons da chamada.
 *
 * Sintetizados, não gravados — o sintetizador vive em `lib/bipe.ts`, que as
 * notificações também usam. Aqui ficam só as notas e a regra de quando tocar.
 *
 * Subindo para entrar, descendo para sair. A direção é o que permite saber o
 * que aconteceu sem olhar para a tela, e é por isso que os dois não podem ser
 * o mesmo bipe. Ver design/13-dispositivos-e-audio.md.
 */

export type Som = 'entrar' | 'sair' | 'mudo' | 'aberto' | 'alguemEntrou' | 'alguemSaiu';

/** Frequências em hertz e durações em segundos. */
const NOTAS: Record<Som, Nota[]> = {
  entrar: [
    { hz: 523.25, dura: 0.09 },
    { hz: 783.99, dura: 0.13 },
  ],
  sair: [
    { hz: 659.25, dura: 0.09 },
    { hz: 392.0, dura: 0.15 },
  ],
  mudo: [
    { hz: 440, dura: 0.05 },
    { hz: 349.23, dura: 0.07 },
  ],
  aberto: [
    { hz: 349.23, dura: 0.05 },
    { hz: 440, dura: 0.07 },
  ],
  alguemEntrou: [{ hz: 587.33, dura: 0.08 }],
  alguemSaiu: [{ hz: 440, dura: 0.08 }],
};

/** Qual preferência liga cada som. `entrar`/`sair` também valem para o mudo. */
const CHAVE: Record<Som, 'entrada' | 'saida' | 'microfone' | 'alguemEntrou' | 'alguemSaiu'> = {
  entrar: 'entrada',
  sair: 'saida',
  mudo: 'microfone',
  aberto: 'microfone',
  alguemEntrou: 'alguemEntrou',
  alguemSaiu: 'alguemSaiu',
};

/**
 * Toca, respeitando as preferências.
 *
 * `forcar` é para o botão de ouvir de cada som nas configurações: uma lista de
 * sons sem prévia é uma lista de nomes.
 */
export function tocar(som: Som, forcar = false): void {
  const prefs = lerPreferencias();
  if (!forcar && !prefs.sons[CHAVE[som]]) return;

  // O som de entrada bom é bem mais baixo que uma voz, então a escala do
  // volume mestre já nasce dividida — 100% aqui não compete com a chamada.
  tocarNotas(NOTAS[som], (prefs.volumeDosSons / 100) * 0.22);
}
