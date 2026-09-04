import { lerPreferencias } from '../../lib/preferencias';

/**
 * Os sons da chamada.
 *
 * Sintetizados, não gravados: são cinco notas curtas, e um arquivo de áudio
 * para cada uma seria mais bytes e mais uma coisa a versionar. Também resolve
 * de graça o volume mestre — é um `GainNode`, não um `<audio>` por som.
 *
 * Subindo para entrar, descendo para sair. A direção é o que permite saber o
 * que aconteceu sem olhar para a tela, e é por isso que os dois não podem ser
 * o mesmo bipe. Ver design/13-dispositivos-e-audio.md.
 */

export type Som = 'entrar' | 'sair' | 'mudo' | 'aberto' | 'alguemEntrou' | 'alguemSaiu';

/** Frequências em hertz e durações em segundos. */
const NOTAS: Record<Som, { hz: number; dura: number }[]> = {
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

let contexto: AudioContext | null = null;

function pegarContexto(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  contexto ??= new AudioContext();
  // Criado fora de um gesto, nasce suspenso. Retomar é barato e silencioso.
  if (contexto.state === 'suspended') void contexto.resume();
  return contexto;
}

/**
 * Toca, respeitando as preferências.
 *
 * `forcar` é para o botão de ouvir de cada som nas configurações: uma lista de
 * sons sem prévia é uma lista de nomes.
 */
export function tocar(som: Som, forcar = false): void {
  const prefs = lerPreferencias();
  if (!forcar && !prefs.sons[CHAVE[som]]) return;

  const ctx = pegarContexto();
  if (!ctx) return;

  // O som de entrada bom é bem mais baixo que uma voz, então a escala do
  // volume mestre já nasce dividida — 100% aqui não compete com a chamada.
  const volume = (prefs.volumeDosSons / 100) * 0.22;
  if (volume <= 0) return;

  let quando = ctx.currentTime + 0.01;
  for (const nota of NOTAS[som]) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    // Seno, e com rampa nas duas pontas: onda quadrada e corte seco estalam
    // pelo mesmo motivo que o portão do microfone estala sem rampa.
    osc.type = 'sine';
    osc.frequency.value = nota.hz;

    env.gain.setValueAtTime(0, quando);
    env.gain.linearRampToValueAtTime(volume, quando + 0.012);
    env.gain.setValueAtTime(volume, quando + nota.dura - 0.02);
    env.gain.linearRampToValueAtTime(0, quando + nota.dura);

    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(quando);
    osc.stop(quando + nota.dura + 0.01);
    quando += nota.dura;
  }
}
