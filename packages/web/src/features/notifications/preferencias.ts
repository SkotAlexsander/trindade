import type { Armazem } from '../../lib/preferencias';

/**
 * Preferências de notificação.
 *
 * Chave própria (`trindade:notificacoes`) e não um pedaço de `trindade:midia`:
 * são assuntos diferentes com ciclos de vida diferentes, e misturar os dois
 * faria um `sanear` só ter de conhecer as duas metades. O que se repete aqui é
 * a **disciplina**, não o código: nada é copiado em bloco, campo desconhecido
 * não entra, e valor fora de faixa vira o padrão.
 *
 * São preferências de máquina, como as de mídia — quem trabalha de madrugada
 * numa máquina e de dia noutra quer horários diferentes de não perturbe.
 *
 * Ver design/09-notificacoes.md.
 */

export interface PreferenciasDeAviso {
  /** Som em menção, resposta e tarefa atribuída. */
  somDeChamado: boolean;
  /** Som mais discreto nas threads que você participa. */
  somDeThread: boolean;
  /** Notificação da área de trabalho. A permissão do navegador é outra coisa. */
  desktop: boolean;
  /** Não perturbe agendado: um horário, todos os dias. */
  naoPerturbe: boolean;
  /** "22:00". Vazio conta como desligado. */
  naoPerturbeDe: string;
  naoPerturbeAte: string;
}

export const CHAVE = 'trindade:notificacoes';

/**
 * Os padrões.
 *
 * Tudo ligado menos o não perturbe agendado: quem instala o produto quer ser
 * avisado, e quem não quer desliga. O contrário — chegar mudo — ensina que o
 * produto não avisa, e aí ninguém volta nas configurações.
 */
export const PADRAO: PreferenciasDeAviso = {
  somDeChamado: true,
  somDeThread: true,
  desktop: true,
  naoPerturbe: false,
  naoPerturbeDe: '22:00',
  naoPerturbeAte: '08:00',
};

function booleano(valor: unknown, padrao: boolean): boolean {
  return typeof valor === 'boolean' ? valor : padrao;
}

/** "HH:MM" de 00:00 a 23:59, ou o padrão. Nada de `new Date` para validar. */
function hora(valor: unknown, padrao: string): string {
  if (typeof valor !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) return padrao;
  return valor;
}

export function sanear(bruto: unknown): PreferenciasDeAviso {
  if (typeof bruto !== 'object' || bruto === null) return { ...PADRAO };
  const b = bruto as Record<string, unknown>;

  return {
    somDeChamado: booleano(b.somDeChamado, PADRAO.somDeChamado),
    somDeThread: booleano(b.somDeThread, PADRAO.somDeThread),
    desktop: booleano(b.desktop, PADRAO.desktop),
    naoPerturbe: booleano(b.naoPerturbe, PADRAO.naoPerturbe),
    naoPerturbeDe: hora(b.naoPerturbeDe, PADRAO.naoPerturbeDe),
    naoPerturbeAte: hora(b.naoPerturbeAte, PADRAO.naoPerturbeAte),
  };
}

const armazemDoNavegador: Armazem = {
  ler(chave) {
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

let cache: PreferenciasDeAviso | null = null;
const ouvintes = new Set<(p: PreferenciasDeAviso) => void>();

export function definirArmazem(novo: Armazem): void {
  armazem = novo;
  cache = null;
  ouvintes.forEach((ouvir) => ouvir(lerAvisos()));
}

export function lerAvisos(): PreferenciasDeAviso {
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

export function salvarAvisos(mudanca: Partial<PreferenciasDeAviso>): PreferenciasDeAviso {
  const proximo = sanear({ ...lerAvisos(), ...mudanca });
  cache = proximo;
  armazem.gravar(CHAVE, JSON.stringify(proximo));
  ouvintes.forEach((ouvir) => ouvir(proximo));
  return proximo;
}

export function ouvirAvisos(ouvir: (p: PreferenciasDeAviso) => void): () => void {
  ouvintes.add(ouvir);
  return () => {
    ouvintes.delete(ouvir);
  };
}

/** Só para o teste: esquece o que foi lido. */
export function esquecerCache(): void {
  cache = null;
}

/**
 * Estamos dentro do horário de não perturbe?
 *
 * Atravessar a meia-noite é o caso normal — "das 22h às 8h" —, e é por isso que
 * a comparação inverte quando o fim é menor que o começo. Tratar isso como
 * intervalo simples deixaria a madrugada, que é justamente o que se quer calar,
 * de fora.
 */
export function dentroDoNaoPerturbe(p: PreferenciasDeAviso, agora = new Date()): boolean {
  if (!p.naoPerturbe) return false;

  const minutos = agora.getHours() * 60 + agora.getMinutes();
  const de = emMinutos(p.naoPerturbeDe);
  const ate = emMinutos(p.naoPerturbeAte);
  if (de === ate) return false;

  return de < ate ? minutos >= de && minutos < ate : minutos >= de || minutos < ate;
}

function emMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}
