import { create } from 'zustand';
import type { VoiceState } from '@trindade/shared';
import type { Participante } from './sala';

/**
 * Quem está em qual chamada, e como está a minha.
 *
 * Duas coisas diferentes num arquivo só porque a interface as usa sempre
 * juntas: a barra precisa saber quem mais está dentro, e a lista de canais
 * precisa saber se sou eu que estou lá.
 *
 * Nada disto passa pelo TanStack Query. É estado de socket: nasce e morre com
 * a conexão, ninguém busca por HTTP e revalidar não significa nada.
 */

export type FaseDaChamada =
  | 'fora'
  | 'conectando'
  | 'conectado'
  /** O LiveKit está refazendo a conexão sozinho; os controles esperam. */
  | 'reconectando'
  | 'falhou';

export type Qualidade = 'boa' | 'media' | 'ruim' | 'desconhecida';

interface VozState {
  /** `userId` → estado, incluindo o meu. Vem do gateway. */
  estados: Record<string, VoiceState>;
  substituirEstados: (lista: VoiceState[]) => void;
  aplicarEstado: (estado: VoiceState) => void;

  fase: FaseDaChamada;
  /** O canal da chamada em andamento, ou o da tentativa que falhou. */
  channelId: string | null;
  erro: string | null;
  muted: boolean;
  deafened: boolean;
  qualidade: Qualidade;
  /** Identidades de quem está falando agora, pelo `ActiveSpeakersChanged`. */
  falando: ReadonlySet<string>;
  /** O navegador barrou o áudio até haver um clique na página. */
  audioBloqueado: boolean;
  /** A grade sobreposta à conversa. Fechá-la não sai da chamada. */
  grade: boolean;
  camera: boolean;
  participantes: Participante[];

  definir: (mudanca: Partial<Omit<VozState, 'definir'>>) => void;
  esquecerChamada: () => void;
}

const SEM_CHAMADA = {
  fase: 'fora' as FaseDaChamada,
  channelId: null,
  erro: null,
  muted: false,
  deafened: false,
  qualidade: 'desconhecida' as Qualidade,
  falando: new Set<string>() as ReadonlySet<string>,
  audioBloqueado: false,
  grade: false,
  camera: false,
  participantes: [] as Participante[],
};

export const useVoz = create<VozState>((set) => ({
  estados: {},
  ...SEM_CHAMADA,

  substituirEstados: (lista) =>
    set({ estados: Object.fromEntries(lista.map((e) => [e.userId, e])) }),

  aplicarEstado: (estado) =>
    set((s) => {
      // Sair chega como `connected: false` e não como evento próprio; quem
      // recebe tira da lista em vez de guardar um estado desligado.
      if (!estado.connected) {
        if (!(estado.userId in s.estados)) return s;
        const { [estado.userId]: _fora, ...resto } = s.estados;
        return { estados: resto };
      }
      return { estados: { ...s.estados, [estado.userId]: estado } };
    }),

  definir: (mudanca) => set(mudanca as Partial<VozState>),
  esquecerChamada: () => set(SEM_CHAMADA),
}));

/** Quem está dentro de um canal, na ordem em que entrou. */
export function naChamada(
  estados: Record<string, VoiceState>,
  channelId: string,
): VoiceState[] {
  return Object.values(estados).filter((e) => e.channelId === channelId);
}
