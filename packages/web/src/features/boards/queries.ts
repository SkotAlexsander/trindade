import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Board } from '@trindade/shared';
import { api, upload } from '../../lib/http';

/**
 * Os quadros de um canal.
 *
 * Aqui só trafega o **cartão**: nome, miniatura, quem mexeu por último. O
 * desenho é o CRDT que chega pelo WebSocket, e nunca passa por esta camada —
 * misturar os dois faria a lista invalidar a cada traço. Ver design/11-quadro.md.
 */

export const chaveDosQuadros = (channelId: string) => ['boards', channelId] as const;

export function useQuadros(channelId: string | undefined) {
  return useQuery({
    queryKey: chaveDosQuadros(channelId ?? ''),
    enabled: Boolean(channelId),
    queryFn: () => api<{ boards: Board[] }>(`/channels/${channelId}/boards`).then((r) => r.boards),
    staleTime: 30_000,
  });
}

/** Chega pelo gateway: nasceu, mudou de nome, ganhou miniatura ou foi arquivado. */
export function receberQuadro(qc: QueryClient, board: Board, removido = false): void {
  qc.setQueryData<Board[]>(chaveDosQuadros(board.channelId), (atuais) => {
    const sem = (atuais ?? []).filter((q) => q.id !== board.id);
    if (removido) return sem;
    // Ordenado pelo que mexeu por último: é o que a lista promete mostrar.
    return [board, ...sem].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export function useCriarQuadro(channelId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      api<{ board: Board }>(`/channels/${channelId}/boards`, { method: 'POST', body: { name } }),
    onSuccess: ({ board }) => receberQuadro(qc, board),
  });
}

export function useRenomearQuadro() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: { id: string; name: string }) =>
      api<{ board: Board }>(`/boards/${entrada.id}`, {
        method: 'PATCH',
        body: { name: entrada.name },
      }),
    onSuccess: ({ board }) => receberQuadro(qc, board),
  });
}

export function useArquivarQuadro(channelId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api(`/boards/${id}/archive`, { method: 'POST' }),
    onSuccess: (_r, id) => {
      qc.setQueryData<Board[]>(chaveDosQuadros(channelId), (atuais) =>
        (atuais ?? []).filter((q) => q.id !== id),
      );
    },
  });
}

/**
 * A miniatura, gerada no navegador ao fechar o quadro.
 *
 * Não é `useMutation`: quem chama é o desmonte do quadro em tela cheia, que
 * pode estar acontecendo porque a rota mudou — e um hook que já não está
 * montado não entrega resultado nenhum. O erro é engolido de propósito: a
 * miniatura é enfeite da lista, e falhar nela não pode parecer um desenho
 * perdido.
 */
export async function mandarMiniatura(boardId: string, png: Blob): Promise<Board | null> {
  const form = new FormData();
  form.append('file', png, 'quadro.png');
  try {
    const { board } = await upload<{ board: Board }>(`/boards/${boardId}/thumbnail`, form);
    return board;
  } catch {
    return null;
  }
}
