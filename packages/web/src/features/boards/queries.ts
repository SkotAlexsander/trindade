import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Board } from '@trindade/shared';
import { api, upload } from '../../lib/http';
import { useQuadroAberto } from './store';

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
 * O quadro do canal, criando um se ainda não houver.
 *
 * O botão do cabeçalho abre **o** quadro, não uma lista: quase sempre há um só,
 * e obrigar a passar por uma lista de um item para chegar nele é uma parada no
 * caminho. Quem precisa de outro cria pelo menu do próprio quadro — a lista
 * continua ali, só deixou de ser a porta de entrada.
 */
export function useAbrirQuadroDoCanal(channelId: string | undefined) {
  const qc = useQueryClient();
  const abrir = useQuadroAberto((s) => s.abrir);

  return useCallback(async () => {
    if (!channelId) return;

    const existentes =
      qc.getQueryData<Board[]>(chaveDosQuadros(channelId)) ??
      (await qc.fetchQuery({
        queryKey: chaveDosQuadros(channelId),
        queryFn: () =>
          api<{ boards: Board[] }>(`/channels/${channelId}/boards`).then((r) => r.boards),
      }));

    const primeiro = (existentes ?? [])[0];
    if (primeiro) {
      abrir(primeiro.id, channelId);
      return;
    }

    const { board } = await api<{ board: Board }>(`/channels/${channelId}/boards`, {
      method: 'POST',
      body: { name: 'Quadro' },
    });
    receberQuadro(qc, board);
    abrir(board.id, channelId);
  }, [channelId, qc, abrir]);
}

/**
 * Uma imagem colada no quadro.
 *
 * O Excalidraw dá um `fileId` (hash do conteúdo) e os bytes como `dataURL`. Os
 * bytes vão por aqui — multipart, `sharp`, storage —, e o que entra no documento
 * compartilhado é a URL. Mandar a imagem pelo CRDT seria mandar megabytes de
 * base64 dentro de cada delta.
 */
export async function mandarImagemDoQuadro(
  boardId: string,
  fileId: string,
  dataURL: string,
): Promise<{ url: string; contentType: string } | null> {
  try {
    const bytes = await fetch(dataURL).then((r) => r.blob());
    const form = new FormData();
    form.append('file', bytes, `${fileId}.png`);
    const resposta = await upload<{ fileId: string; url: string; contentType: string }>(
      `/boards/${boardId}/files/${fileId}`,
      form,
    );
    return { url: resposta.url, contentType: resposta.contentType };
  } catch {
    // A imagem fica na tela de quem colou e não chega aos outros. É melhor que
    // derrubar o quadro inteiro por causa de um upload.
    return null;
  }
}

/** O caminho de volta: a URL guardada vira o `dataURL` que o Excalidraw pede. */
export async function baixarImagemDoQuadro(url: string): Promise<string | null> {
  try {
    const bytes = await fetch(url).then((r) => r.blob());
    return await new Promise<string>((resolver, rejeitar) => {
      const leitor = new FileReader();
      leitor.onload = () => resolver(String(leitor.result));
      leitor.onerror = () => rejeitar(new Error('não consegui ler a imagem'));
      leitor.readAsDataURL(bytes);
    });
  } catch {
    return null;
  }
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
