import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { ReadStateEntry } from '@trindade/shared';
import { api } from '../../lib/http';

/**
 * Estado de leitura: o que está por ler, e quantas menções esperam por você.
 *
 * O servidor conta uma vez, no READY, porque só ele conhece o histórico
 * inteiro — o cliente carrega cinquenta linhas e não saberia que há trezentas
 * atrás. Daí em diante quem soma é o cliente, a cada evento que chega, e o
 * servidor volta a ser a verdade na próxima conexão.
 */

export interface Leitura {
  unreadCount: number;
  mentionCount: number;
  lastReadMessageId: string | null;
  mutedUntil: string | null;
}

const ZERO: Leitura = {
  unreadCount: 0,
  mentionCount: 0,
  lastReadMessageId: null,
  mutedUntil: null,
};

interface LeituraState {
  porCanal: Record<string, Leitura>;
  substituir: (estados: readonly ReadStateEntry[]) => void;
  somar: (channelId: string, mencionouVoce: boolean) => void;
  zerar: (channelId: string, lastReadMessageId: string | null) => void;
}

export const useLeitura = create<LeituraState>((set) => ({
  porCanal: {},

  substituir: (estados) =>
    set({
      porCanal: Object.fromEntries(
        estados.map((e) => [
          e.channelId,
          {
            unreadCount: e.unreadCount,
            mentionCount: e.mentionCount,
            lastReadMessageId: e.lastReadMessageId,
            mutedUntil: e.mutedUntil,
          },
        ]),
      ),
    }),

  somar: (channelId, mencionouVoce) =>
    set((s) => {
      const atual = s.porCanal[channelId] ?? ZERO;
      return {
        porCanal: {
          ...s.porCanal,
          [channelId]: {
            ...atual,
            unreadCount: atual.unreadCount + 1,
            mentionCount: atual.mentionCount + (mencionouVoce ? 1 : 0),
          },
        },
      };
    }),

  zerar: (channelId, lastReadMessageId) =>
    set((s) => ({
      porCanal: {
        ...s.porCanal,
        [channelId]: { ...ZERO, lastReadMessageId },
      },
    })),
}));

export function leituraDoCanal(
  porCanal: Record<string, Leitura>,
  channelId: string,
): Leitura {
  return porCanal[channelId] ?? ZERO;
}

/** Só conta como lido se a janela estiver à vista. */
function janelaVisivel(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Espera antes de dizer ao servidor que leu. */
const ESPERA_MS = 800;

/**
 * Marca o canal como lido enquanto ele está aberto e a janela à vista.
 *
 * A janela **tem** de estar visível: uma aba esquecida aberta num canal
 * marcaria tudo como lido sem ninguém ter lido nada, e o não lido deixaria de
 * significar qualquer coisa.
 *
 * O atraso evita uma requisição por mensagem numa conversa rápida — só o
 * último id importa, e ele é o que sai.
 */
export function useMarcarLido(channelId: string | undefined, ultimaId: string | null): void {
  const zerar = useLeitura((s) => s.zerar);
  const enviado = useRef<string | null>(null);

  const marcar = useCallback(() => {
    if (!channelId || !ultimaId || !janelaVisivel()) return;
    if (enviado.current === ultimaId) return;
    enviado.current = ultimaId;

    zerar(channelId, ultimaId);
    void api(`/channels/${channelId}/read`, {
      method: 'PUT',
      body: { messageId: ultimaId },
      // Falhar aqui não merece aviso: o READY seguinte reconstrói a verdade.
    }).catch(() => {});
  }, [channelId, ultimaId, zerar]);

  useEffect(() => {
    const id = setTimeout(marcar, ESPERA_MS);
    return () => clearTimeout(id);
  }, [marcar]);

  // Voltar para a aba conta como ler o que chegou enquanto ela estava atrás.
  useEffect(() => {
    function aoVoltar(): void {
      if (janelaVisivel()) marcar();
    }
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [marcar]);
}
