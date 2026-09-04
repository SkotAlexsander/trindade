import { tocarNotas, type Nota } from '../../lib/bipe';
import { lerPreferencias } from '../../lib/preferencias';

/**
 * Os dois sons do produto inteiro.
 *
 * Dois, e não um por tipo de evento: "alguém falou com você" e "aconteceu algo
 * que te envolve". Distintos o bastante para reconhecer sem olhar — o de
 * chamado sobe e é mais alto, o de thread é uma nota só e mais grave. Uma
 * paleta maior obrigaria a aprender um vocabulário, e ninguém aprende.
 *
 * Volume respeita o mestre dos sons, sem controle próprio: dois controles de
 * volume para a mesma saída é a configuração que ninguém entende.
 * Ver design/09-notificacoes.md.
 */

const NOTAS: Record<'chamado' | 'thread', Nota[]> = {
  chamado: [
    { hz: 587.33, dura: 0.08 },
    { hz: 880.0, dura: 0.12 },
  ],
  thread: [{ hz: 392.0, dura: 0.1 }],
};

export function tocarAviso(qual: 'chamado' | 'thread'): void {
  const prefs = lerPreferencias();
  // A mesma escala dos sons de chamada: 100% aqui não compete com uma voz.
  tocarNotas(NOTAS[qual], (prefs.volumeDosSons / 100) * 0.22);
}
