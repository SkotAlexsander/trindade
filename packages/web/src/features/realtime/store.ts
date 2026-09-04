import { create } from 'zustand';
import { TYPING_TTL_MS, type UserStatus } from '@trindade/shared';
import type { EstadoWs } from '../../lib/ws';

/**
 * Estado que vem do gateway e não pertence ao cache de requisição.
 *
 * Presença e digitação são efêmeras: nascem e morrem no socket, ninguém as
 * busca por HTTP e revalidá-las não faz sentido. Por isso não passam pelo
 * TanStack Query. Ver docs/02-arquitetura.md.
 */

/** A faixa de desconexão só aparece depois disto. Ver design/02-shell-principal.md. */
export const ATRASO_DA_FAIXA_MS = 2_000;

interface ConexaoState {
  estado: EstadoWs;
  /** Verdadeiro só depois de 2s fora do ar — quedas de um segundo não avisam. */
  mostrarFaixa: boolean;
  setEstado: (estado: EstadoWs) => void;
  setMostrarFaixa: (mostrar: boolean) => void;
}

export const useConexao = create<ConexaoState>((set) => ({
  estado: 'ocioso',
  mostrarFaixa: false,
  setEstado: (estado) => set({ estado }),
  setMostrarFaixa: (mostrarFaixa) => set({ mostrarFaixa }),
}));

export interface Presenca {
  status: UserStatus;
  customStatus: string | null;
}

interface PresencaState {
  porUsuario: Record<string, Presenca>;
  definir: (userId: string, presenca: Presenca) => void;
  substituir: (todas: Record<string, Presenca>) => void;
  /** Socket caiu: ninguém está "online" só porque estava antes. */
  limpar: () => void;
}

export const usePresenca = create<PresencaState>((set) => ({
  porUsuario: {},
  definir: (userId, presenca) =>
    set((s) => ({ porUsuario: { ...s.porUsuario, [userId]: presenca } })),
  substituir: (porUsuario) => set({ porUsuario }),
  limpar: () => set({ porUsuario: {} }),
}));

interface DigitandoState {
  /** `channelId` → `userId` → instante em que o evento chegou. */
  porCanal: Record<string, Record<string, number>>;
  marcar: (channelId: string, userId: string) => void;
  esquecer: (channelId: string, userId: string) => void;
}

export const useDigitando = create<DigitandoState>((set) => ({
  porCanal: {},
  marcar: (channelId, userId) =>
    set((s) => ({
      porCanal: {
        ...s.porCanal,
        [channelId]: { ...s.porCanal[channelId], [userId]: Date.now() },
      },
    })),
  esquecer: (channelId, userId) =>
    set((s) => {
      const canal = s.porCanal[channelId];
      if (!canal || !(userId in canal)) return s;
      const { [userId]: _, ...resto } = canal;
      return { porCanal: { ...s.porCanal, [channelId]: resto } };
    }),
}));

/**
 * Quem ainda conta como digitando neste instante.
 *
 * Não existe `TYPING_STOP` no protocolo: quem recebe guarda o instante e
 * esquece sozinho depois do TTL. Um evento a menos, e nenhum estado preso
 * quando alguém fecha a aba no meio de uma frase.
 */
export function digitandoAgora(
  porCanal: Record<string, Record<string, number>>,
  channelId: string,
  agora = Date.now(),
): string[] {
  const canal = porCanal[channelId];
  if (!canal) return [];
  return Object.entries(canal)
    .filter(([, quando]) => agora - quando < TYPING_TTL_MS)
    .map(([userId]) => userId);
}
