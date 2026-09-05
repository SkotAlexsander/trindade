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

export interface QuadroAberto {
  boardId: string;
  channelId: string;
  /**
   * Uma imagem para colar assim que o quadro abrir.
   *
   * É o "abrir no quadro" de uma imagem da conversa: o quadro nasce vazio e a
   * imagem entra pelo mesmo caminho de qualquer outra — colada. Construir o
   * elemento à mão seria reimplementar o que o Excalidraw já faz certo.
   */
  imagemInicial?: { url: string; nome: string };
}

interface QuadroAbertoState {
  aberto: QuadroAberto | null;
  /**
   * Pedido de "mostre os outros quadros".
   *
   * Um contador, e não um booleano: pedir duas vezes com o painel já aberto
   * continua sendo um pedido. O mesmo caminho do quadro de tarefas.
   */
  pedidoDeLista: number;
  abrir: (boardId: string, channelId: string, imagemInicial?: QuadroAberto['imagemInicial']) => void;
  fechar: () => void;
  verLista: () => void;
}

export const useQuadroAberto = create<QuadroAbertoState>((set) => ({
  aberto: null,
  pedidoDeLista: 0,
  abrir: (boardId, channelId, imagemInicial) =>
    set({ aberto: { boardId, channelId, ...(imagemInicial ? { imagemInicial } : {}) } }),
  fechar: () => set({ aberto: null }),
  // Sair da tela cheia junto: a lista está atrás dela.
  verLista: () => set((s) => ({ aberto: null, pedidoDeLista: s.pedidoDeLista + 1 })),
}));
