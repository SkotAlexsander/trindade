/**
 * O sintetizador de bipes.
 *
 * Notas curtas geradas na hora, não gravadas: são poucas, e um arquivo de áudio
 * para cada uma seria mais bytes e mais uma coisa a versionar. Um `AudioContext`
 * para o produto inteiro — a chamada e as notificações tocam pelo mesmo.
 *
 * Ficou aqui, e não dentro de `features/voice`, quando as notificações
 * passaram a precisar dele: duas cópias do mesmo envelope divergiriam no
 * primeiro ajuste, e o estalo de quem esquecesse a rampa voltaria só num
 * lugar. Ver design/13-dispositivos-e-audio.md.
 */

export interface Nota {
  /** Frequência em hertz. */
  hz: number;
  /** Duração em segundos. */
  dura: number;
}

let contexto: AudioContext | null = null;

function pegarContexto(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  contexto ??= new AudioContext();
  // Criado fora de um gesto, nasce suspenso. Retomar é barato e silencioso.
  if (contexto.state === 'suspended') void contexto.resume();
  return contexto;
}

/**
 * Toca as notas em sequência, no volume dado (0 a 1).
 *
 * Seno, e com rampa nas duas pontas: onda quadrada e corte seco estalam pelo
 * mesmo motivo que o portão do microfone estala sem rampa.
 */
export function tocarNotas(notas: readonly Nota[], volume: number): void {
  if (volume <= 0) return;
  const ctx = pegarContexto();
  if (!ctx) return;

  let quando = ctx.currentTime + 0.01;
  for (const nota of notas) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
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
