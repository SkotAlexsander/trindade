import { create } from 'zustand';

/**
 * O pedido de "mostra o quadro".
 *
 * O painel aberto é estado local do shell, e a mensagem que diz "virou tarefa"
 * está três níveis abaixo dele. Em vez de passar um callback por toda a lista
 * de mensagens, o rodapé pede aqui e o shell atende — o mesmo caminho que
 * `useThread` já usa para abrir o painel de thread.
 *
 * É um contador e não um booleano de propósito: pedir duas vezes seguidas com
 * o painel já aberto tem de continuar sendo um pedido, não um estado que não
 * mudou.
 */

interface QuadroState {
  pedido: number;
  abrir: () => void;
}

export const useQuadro = create<QuadroState>((set) => ({
  pedido: 0,
  abrir: () => set((s) => ({ pedido: s.pedido + 1 })),
}));
