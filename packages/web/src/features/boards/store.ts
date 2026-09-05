import { create } from 'zustand';

/**
 * Qual quadro está aberto em tela cheia.
 *
 * Mora numa store e não no estado do painel porque o quadro **não é** o painel:
 * ele cobre a conversa inteira, é montado pelo shell, e quem manda abrir é um
 * cartão que vive três níveis abaixo. O mesmo caminho que o pedido do quadro de
 * tarefas já usava. Ver design/11-quadro.md.
 *
 * O canal vai junto do quadro: a lista é por canal, e é nela que a tela cheia
 * acha o nome e a miniatura sem pedir nada ao servidor de novo.
 */

interface QuadroAbertoState {
  aberto: { boardId: string; channelId: string } | null;
  abrir: (boardId: string, channelId: string) => void;
  fechar: () => void;
}

export const useQuadroAberto = create<QuadroAbertoState>((set) => ({
  aberto: null,
  abrir: (boardId, channelId) => set({ aberto: { boardId, channelId } }),
  fechar: () => set({ aberto: null }),
}));
