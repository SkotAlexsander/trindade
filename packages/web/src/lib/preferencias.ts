/**
 * Preferências de mídia: microfone, alto-falante, câmera, ganho, gate, sons.
 *
 * Guardadas em `localStorage` sob `trindade:midia`. São preferências **de
 * máquina, não de conta**: o microfone bom fica no computador de casa, não na
 * pessoa. Sincronizar isto pelo servidor produziria a chamada em que o notebook
 * tenta usar a interface de áudio da mesa. Ver design/13-dispositivos-e-audio.md.
 *
 * **Credencial nenhuma passa por aqui.** A regra do CLAUDE.md continua inteira:
 * o token de acesso vive só na memória do JavaScript. O que este módulo grava é
 * o que se perde sem prejuízo se alguém limpar os dados do site.
 *
 * O acesso é sempre por aqui, nunca `localStorage` solto no componente: na
 * fase 8 o Tauri troca o armazenamento, e o ponto de troca tem que ser um só.
 */

export interface DispositivoSalvo {
  deviceId: string;
  label: string;
  groupId: string;
}

export type PerfilDeEntrada = 'isolamento' | 'estudio' | 'personalizado';

export interface ConstraintsPersonalizadas {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  voiceIsolation: boolean;
}

export type QualidadeDeCamera = '360p' | '720p' | '1080p';

export interface Sons {
  entrada: boolean;
  saida: boolean;
  alguemEntrou: boolean;
  alguemSaiu: boolean;
  microfone: boolean;
}

export interface PreferenciasDeMidia {
  microfone: DispositivoSalvo | null;
  altofalante: DispositivoSalvo | null;
  camera: DispositivoSalvo | null;
  /** 0 a 200. Acima de 150 avisamos que distorce, mas deixamos. */
  volumeEntrada: number;
  /** 0 a 100. Multiplica o volume por pessoa da grade. */
  volumeSaida: number;
  perfil: PerfilDeEntrada;
  personalizado: ConstraintsPersonalizadas;
  /** Piso de ruído móvel; desligado, vale `limiarDbfs`. */
  gateAutomatico: boolean;
  limiarDbfs: number;
  apertarParaFalar: boolean;
  /** `KeyboardEvent.code`, que não muda com o layout do teclado. */
  teclaDeFalar: string | null;
  atrasoAoSoltarMs: number;
  qualidadeDaCamera: QualidadeDeCamera;
  /** Só a prévia. A trilha publicada nunca é espelhada. */
  espelharPrevia: boolean;
  sons: Sons;
  volumeDosSons: number;
  /**
   * O último preset de transmissão usado. O produto não adivinha o conteúdo;
   * ele lembra o que a pessoa escolheu.
   */
  presetDeTela: string;
  audioDaTela: boolean;
  /**
   * O que fica na tela durante uma chamada: só a conversa, só as pessoas, ou
   * as duas coisas lado a lado.
   */
  modoDaSala: 'mensagens' | 'ambos' | 'chamada';
  /** Largura da faixa de conversa ao lado da chamada, em pixels. */
  larguraDaConversa: number;
}

export const CHAVE = 'trindade:midia';

/**
 * Os padrões.
 *
 * `alguemEntrou` e `alguemSaiu` nascem desligados de propósito: com cinco
 * pessoas entrando e saindo o dia inteiro, ligados viram ruído que se aprende a
 * ignorar — e aí os outros três também são ignorados.
 */
export const PADRAO: PreferenciasDeMidia = {
  microfone: null,
  altofalante: null,
  camera: null,
  volumeEntrada: 100,
  volumeSaida: 100,
  perfil: 'isolamento',
  personalizado: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    voiceIsolation: true,
  },
  gateAutomatico: true,
  limiarDbfs: -45,
  apertarParaFalar: false,
  teclaDeFalar: null,
  atrasoAoSoltarMs: 200,
  qualidadeDaCamera: '720p',
  espelharPrevia: true,
  sons: {
    entrada: true,
    saida: true,
    alguemEntrou: false,
    alguemSaiu: false,
    microfone: true,
  },
  volumeDosSons: 70,
  presetDeTela: 'padrao',
  audioDaTela: false,
  modoDaSala: 'ambos',
  larguraDaConversa: 380,
};

/** O piso do medidor. Abaixo disto é silêncio digital, não sinal fraco. */
export const DBFS_MINIMO = -100;

function numero(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return padrao;
  return Math.min(maximo, Math.max(minimo, valor));
}

function booleano(valor: unknown, padrao: boolean): boolean {
  return typeof valor === 'boolean' ? valor : padrao;
}

function dispositivo(valor: unknown): DispositivoSalvo | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const bruto = valor as Record<string, unknown>;
  if (typeof bruto.deviceId !== 'string') return null;
  return {
    deviceId: bruto.deviceId,
    label: typeof bruto.label === 'string' ? bruto.label : '',
    groupId: typeof bruto.groupId === 'string' ? bruto.groupId : '',
  };
}

/**
 * Reconstrói as preferências campo a campo a partir do que estava gravado.
 *
 * Nada é copiado em bloco. O conteúdo do `localStorage` é editável por quem
 * senta na máquina e sobrevive a versões nossas: um `volumeEntrada: "muito"`
 * ou um campo que só existia em janeiro não pode virar estado da aplicação. O
 * efeito colateral útil é que **campo desconhecido não entra** — se um dia
 * alguém escrever um token aqui por engano, ele não volta na leitura seguinte.
 */
export function sanear(bruto: unknown): PreferenciasDeMidia {
  if (typeof bruto !== 'object' || bruto === null) return { ...PADRAO };
  const b = bruto as Record<string, unknown>;
  const p = (b.personalizado ?? {}) as Record<string, unknown>;
  const s = (b.sons ?? {}) as Record<string, unknown>;

  const perfil = b.perfil;
  const qualidade = b.qualidadeDaCamera;

  return {
    microfone: dispositivo(b.microfone),
    altofalante: dispositivo(b.altofalante),
    camera: dispositivo(b.camera),
    volumeEntrada: numero(b.volumeEntrada, 0, 200, PADRAO.volumeEntrada),
    volumeSaida: numero(b.volumeSaida, 0, 100, PADRAO.volumeSaida),
    perfil:
      perfil === 'isolamento' || perfil === 'estudio' || perfil === 'personalizado'
        ? perfil
        : PADRAO.perfil,
    personalizado: {
      echoCancellation: booleano(p.echoCancellation, PADRAO.personalizado.echoCancellation),
      noiseSuppression: booleano(p.noiseSuppression, PADRAO.personalizado.noiseSuppression),
      autoGainControl: booleano(p.autoGainControl, PADRAO.personalizado.autoGainControl),
      voiceIsolation: booleano(p.voiceIsolation, PADRAO.personalizado.voiceIsolation),
    },
    gateAutomatico: booleano(b.gateAutomatico, PADRAO.gateAutomatico),
    limiarDbfs: numero(b.limiarDbfs, DBFS_MINIMO, 0, PADRAO.limiarDbfs),
    apertarParaFalar: booleano(b.apertarParaFalar, PADRAO.apertarParaFalar),
    teclaDeFalar: typeof b.teclaDeFalar === 'string' ? b.teclaDeFalar : null,
    atrasoAoSoltarMs: numero(b.atrasoAoSoltarMs, 0, 2000, PADRAO.atrasoAoSoltarMs),
    qualidadeDaCamera:
      qualidade === '360p' || qualidade === '720p' || qualidade === '1080p'
        ? qualidade
        : PADRAO.qualidadeDaCamera,
    espelharPrevia: booleano(b.espelharPrevia, PADRAO.espelharPrevia),
    sons: {
      entrada: booleano(s.entrada, PADRAO.sons.entrada),
      saida: booleano(s.saida, PADRAO.sons.saida),
      alguemEntrou: booleano(s.alguemEntrou, PADRAO.sons.alguemEntrou),
      alguemSaiu: booleano(s.alguemSaiu, PADRAO.sons.alguemSaiu),
      microfone: booleano(s.microfone, PADRAO.sons.microfone),
    },
    volumeDosSons: numero(b.volumeDosSons, 0, 100, PADRAO.volumeDosSons),
    presetDeTela: typeof b.presetDeTela === 'string' ? b.presetDeTela : PADRAO.presetDeTela,
    audioDaTela: booleano(b.audioDaTela, PADRAO.audioDaTela),
    modoDaSala:
      b.modoDaSala === 'mensagens' || b.modoDaSala === 'ambos' || b.modoDaSala === 'chamada'
        ? b.modoDaSala
        : PADRAO.modoDaSala,
    larguraDaConversa: numero(b.larguraDaConversa, 260, 760, PADRAO.larguraDaConversa),
  };
}

/**
 * O armazenamento por trás. Uma interface de duas linhas porque na fase 8 o
 * Tauri põe outra coisa aqui, e porque assim o teste não precisa de navegador.
 */
export interface Armazem {
  ler(chave: string): string | null;
  gravar(chave: string, valor: string): void;
}

const armazemDoNavegador: Armazem = {
  ler(chave) {
    // Safari em janela privada lança ao tocar em `localStorage`. Preferência
    // que não pôde ser lida é preferência padrão, não erro de aplicação.
    try {
      return window.localStorage.getItem(chave);
    } catch {
      return null;
    }
  },
  gravar(chave, valor) {
    try {
      window.localStorage.setItem(chave, valor);
    } catch {
      /* sem espaço ou sem permissão: a sessão continua, sem lembrar. */
    }
  },
};

let armazem: Armazem =
  typeof window === 'undefined' ? { ler: () => null, gravar: () => {} } : armazemDoNavegador;

let cache: PreferenciasDeMidia | null = null;
const ouvintes = new Set<(p: PreferenciasDeMidia) => void>();

export function definirArmazem(novo: Armazem): void {
  armazem = novo;
  cache = null;
  ouvintes.forEach((ouvir) => ouvir(lerPreferencias()));
}

export function lerPreferencias(): PreferenciasDeMidia {
  if (cache) return cache;
  const cru = armazem.ler(CHAVE);
  if (!cru) {
    cache = { ...PADRAO };
    return cache;
  }
  try {
    cache = sanear(JSON.parse(cru));
  } catch {
    cache = { ...PADRAO };
  }
  return cache;
}

/** Grava um pedaço e avisa quem estiver ouvindo. */
export function salvarPreferencias(mudanca: Partial<PreferenciasDeMidia>): PreferenciasDeMidia {
  const proximo = sanear({ ...lerPreferencias(), ...mudanca });
  cache = proximo;
  armazem.gravar(CHAVE, JSON.stringify(proximo));
  ouvintes.forEach((ouvir) => ouvir(proximo));
  return proximo;
}

export function ouvirPreferencias(ouvir: (p: PreferenciasDeMidia) => void): () => void {
  ouvintes.add(ouvir);
  return () => {
    ouvintes.delete(ouvir);
  };
}

/** Só para o teste: esquece o que foi lido. */
export function esquecerCache(): void {
  cache = null;
}
