import { create } from 'zustand';
import type { Message } from '@trindade/shared';

/**
 * Estado da conversa que não é dado do servidor: a quem você está
 * respondendo, o que está piscando depois de um pulo, e qual mensagem tem o
 * foco na lista.
 *
 * Fora do TanStack Query de propósito — nada disso se busca nem se revalida.
 */

interface ComposerState {
  respondendoA: Message | null;
  editando: Message | null;
  responder: (mensagem: Message | null) => void;
  editar: (mensagem: Message | null) => void;
  limpar: () => void;
}

/**
 * Responder e editar vivem aqui, e não dentro do compositor, porque três
 * lugares os disparam: a barra de ações da mensagem, o teclado na lista e o
 * próprio compositor com `↑`.
 *
 * São mutuamente exclusivos de propósito: editar uma mensagem antiga enquanto
 * responde a outra produziria um compositor com dois contextos e nenhum jeito
 * de saber para onde o texto vai.
 */
export const useComposer = create<ComposerState>((set) => ({
  respondendoA: null,
  editando: null,
  responder: (respondendoA) => set({ respondendoA, editando: null }),
  editar: (editando) => set({ editando, respondendoA: null }),
  limpar: () => set({ respondendoA: null, editando: null }),
}));

/** Quanto tempo a mensagem alvo de um pulo fica acesa. */
export const DURACAO_DO_PISCA_MS = 800;

interface DestaqueState {
  id: string | null;
  /** Pedido de rolagem: quem estiver mostrando a lista atende e limpa. */
  pular: (messageId: string) => void;
  limpar: () => void;
}

export const useDestaque = create<DestaqueState>((set) => ({
  id: null,
  pular: (id) => set({ id }),
  limpar: () => set({ id: null }),
}));

interface ThreadState {
  /** Mensagem-mãe da thread aberta no painel, ou `null`. */
  parentId: string | null;
  abrir: (parentId: string) => void;
  fechar: () => void;
}

export const useThread = create<ThreadState>((set) => ({
  parentId: null,
  abrir: (parentId) => set({ parentId }),
  fechar: () => set({ parentId: null }),
}));

interface BuscaState {
  termo: string;
  setTermo: (termo: string) => void;
}

export const useBusca = create<BuscaState>((set) => ({
  termo: '',
  setTermo: (termo) => set({ termo }),
}));

interface FocoState {
  /** Mensagem com o foco itinerante na lista. `null` = o foco está fora. */
  id: string | null;
  focar: (id: string | null) => void;
}

export const useFoco = create<FocoState>((set) => ({
  id: null,
  focar: (id) => set({ id }),
}));
