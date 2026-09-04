/**
 * Os presets de transmissão de tela.
 *
 * Nomeados por finalidade, com os números ao lado: quem escolhe sabe o que vai
 * mostrar, não quantos megabits precisa. Ver design/12-compartilhamento-de-tela.md.
 */

export type IdDePreset = 'texto' | 'padrao' | 'fluido' | 'nitido' | 'nitidoFluido' | 'fonte';

export interface Preset {
  id: IdDePreset;
  nome: string;
  /** Os números, para quem quiser conferir. */
  detalhe: string;
  para: string;
  largura: number;
  altura: number;
  fps: number;
  /** Alvo em bits por segundo. */
  bitrate: number;
  /**
   * `detail` mantém a resolução e sacrifica quadros — texto continua legível
   * mesmo travando. `motion` faz o contrário. É a diferença entre uma tela de
   * código que fica borrada e uma que apenas atualiza mais devagar; quem usa
   * nunca vê o termo, ele vem embutido na escolha.
   */
  dica: 'detail' | 'motion';
}

export const PRESETS: Preset[] = [
  {
    id: 'texto',
    nome: 'Texto e código',
    detalhe: '1080p · 15 fps',
    para: 'editor, terminal, documento',
    largura: 1920,
    altura: 1080,
    fps: 15,
    bitrate: 2_500_000,
    dica: 'detail',
  },
  {
    id: 'padrao',
    nome: 'Padrão',
    detalhe: '1080p · 30 fps',
    para: 'navegação, slides, interface',
    largura: 1920,
    altura: 1080,
    fps: 30,
    bitrate: 5_000_000,
    dica: 'detail',
  },
  {
    id: 'fluido',
    nome: 'Fluido',
    detalhe: '1080p · 60 fps',
    para: 'animação, protótipo interativo',
    largura: 1920,
    altura: 1080,
    fps: 60,
    bitrate: 8_000_000,
    dica: 'motion',
  },
  {
    id: 'nitido',
    nome: 'Nítido',
    detalhe: '1440p · 30 fps',
    para: 'design, telas grandes',
    largura: 2560,
    altura: 1440,
    fps: 30,
    bitrate: 9_000_000,
    dica: 'detail',
  },
  {
    id: 'nitidoFluido',
    nome: 'Nítido e fluido',
    detalhe: '1440p · 60 fps',
    para: 'jogo, vídeo, demonstração',
    largura: 2560,
    altura: 1440,
    fps: 60,
    bitrate: 14_000_000,
    dica: 'motion',
  },
  {
    id: 'fonte',
    nome: 'Fonte',
    detalhe: 'até 4K · 30 fps',
    para: 'quando a tela é 4K e importa',
    largura: 3840,
    altura: 2160,
    fps: 30,
    bitrate: 22_000_000,
    dica: 'detail',
  },
];

/** O padrão da primeira vez. Depois, o último usado. */
export const PRESET_PADRAO: IdDePreset = 'padrao';

export function presetPorId(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? (PRESETS[1] as Preset);
}

export interface Camada {
  largura: number;
  altura: number;
  fps: number;
  bitrate: number;
}

/**
 * Três camadas: a escolhida, uma intermediária e 360p.
 *
 * É o que faz a alta resolução ser viável para todos ao mesmo tempo — quem
 * está numa janelinha recebe 360p, quem está em tela cheia recebe a alta, e
 * ninguém trava por causa do outro. O servidor escolhe por espectador, sem que
 * quem transmite saiba.
 */
export function camadasDe(preset: Preset): Camada[] {
  const baixa: Camada = { largura: 640, altura: 360, fps: 15, bitrate: 300_000 };
  const meia: Camada = {
    largura: Math.round(preset.largura / 2 / 2) * 2,
    altura: Math.round(preset.altura / 2 / 2) * 2,
    // A camada do meio não precisa dos 60 quadros do preset alto: ela existe
    // para quem já está com a banda apertada.
    fps: Math.min(preset.fps, 30),
    bitrate: Math.round(preset.bitrate / 3),
  };
  return [baixa, meia];
}

/**
 * O maior preset que a medição de upload sustenta.
 *
 * Vira a linha "Sua conexão suporta até". Os presets acima continuam
 * escolhíveis, com um aviso ao lado: a pessoa pode tentar, o produto só não
 * finge que vai funcionar.
 */
export function suportadoPor(bitsPorSegundo: number | null): Preset | null {
  if (!bitsPorSegundo || bitsPorSegundo <= 0) return null;
  // 20% de folga: a medição é do instante, e uma transmissão que usa cada bit
  // disponível é uma transmissão que engasga.
  const cabe = bitsPorSegundo * 0.8;
  const possiveis = PRESETS.filter((p) => p.bitrate <= cabe);
  return possiveis[possiveis.length - 1] ?? null;
}

export function acimaDoSuportado(preset: Preset, suportado: Preset | null): boolean {
  if (!suportado) return false;
  return preset.bitrate > suportado.bitrate;
}

export type MotivoDeLimitacao = 'none' | 'cpu' | 'bandwidth' | 'other';

/**
 * A rede está segurando a transmissão?
 *
 * Quem responde é o **codificador**, pelo `qualityLimitationReason`, e não uma
 * comparação com o alvo do preset. Bitrate baixo não é sintoma: uma tela de
 * documento parado codifica em 200 kbps com alvo de 2,5 Mbps porque não há o
 * que enviar, e a primeira versão desta função acusava "rede limitando" nesse
 * caso — dizendo que algo está errado justamente quando tudo está certo.
 */
export function redeLimitando(motivo: MotivoDeLimitacao): boolean {
  return motivo === 'bandwidth';
}

export function emMbps(bitsPorSegundo: number): string {
  return `${(bitsPorSegundo / 1_000_000).toFixed(1).replace('.', ',')} Mbps`;
}
