import { create } from 'zustand';
import type { Presentation } from '@trindade/shared';

/**
 * Quem está apresentando qual quadro, agora.
 *
 * Fora do cache de requisição, como a presença e a voz: não é dado que se pede
 * ao servidor, é estado que chega pelo socket e some quando a pessoa sai. O
 * `READY` traz a lista inteira — quem entra no meio de uma apresentação vê a
 * linha na hora. Ver design/11-quadro.md.
 */

interface ApresentacoesState {
  porQuadro: Record<string, Presentation>;
  substituir: (lista: Presentation[]) => void;
  aplicar: (presentation: Presentation, ativo: boolean) => void;
}

export const useApresentacoes = create<ApresentacoesState>((set) => ({
  porQuadro: {},
  substituir: (lista) =>
    set({ porQuadro: Object.fromEntries(lista.map((p) => [p.boardId, p])) }),
  aplicar: (presentation, ativo) =>
    set((s) => {
      const proximo = { ...s.porQuadro };
      if (ativo) proximo[presentation.boardId] = presentation;
      else delete proximo[presentation.boardId];
      return { porQuadro: proximo };
    }),
}));

/** A apresentação que está acontecendo num canal, se houver. */
export function apresentacaoNoCanal(
  porQuadro: Record<string, Presentation>,
  channelId: string,
): Presentation | undefined {
  return Object.values(porQuadro).find((p) => p.channelId === channelId);
}
