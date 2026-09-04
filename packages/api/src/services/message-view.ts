import type { Message, Reaction } from '@trindade/shared';
import { agregarReacoes } from '@trindade/shared';
import type { MessageRow, ReactionRow } from '../db/messages.js';

/**
 * Converte linhas do banco no formato do contrato.
 *
 * Mensagem apagada vem com `content: null` e `deletedAt` preenchido — a UI
 * mostra o espaço reservado sem perder a numeração. Nunca devolva o conteúdo
 * de uma mensagem apagada. Ver docs/05-contrato-api.md.
 */
export function toApiMessage(
  row: MessageRow,
  opcoes: {
    reactions?: ReactionRow[];
    meuId: string;
    threadReplies?: number;
  },
): Message {
  const apagada = row.deleted_at !== null;
  const reacoes: Reaction[] = apagada
    ? []
    : agregarReacoes(
        (opcoes.reactions ?? []).map((r) => ({ emoji: r.emoji, userId: r.user_id })),
        opcoes.meuId,
      );

  const mensagem: Message = {
    id: row.id,
    channelId: row.channel_id,
    author: {
      id: row.author_id,
      username: row.author_username,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_key ? `/api/files/${row.author_avatar_key}` : null,
    },
    content: apagada ? null : row.content,
    parentId: row.parent_id,
    replyToId: row.reply_to_id,
    attachments: [],
    reactions: reacoes,
    pinnedAt: row.pinned_at ? row.pinned_at.toISOString() : null,
    editedAt: row.edited_at ? row.edited_at.toISOString() : null,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };

  if (row.client_nonce) mensagem.clientNonce = row.client_nonce;
  return mensagem;
}

/** Monta várias de uma vez, agrupando as reações por mensagem. */
export function toApiMessages(
  rows: readonly MessageRow[],
  reactions: readonly ReactionRow[],
  meuId: string,
): Message[] {
  const porMensagem = new Map<string, ReactionRow[]>();
  for (const r of reactions) {
    const lista = porMensagem.get(r.message_id) ?? [];
    lista.push(r);
    porMensagem.set(r.message_id, lista);
  }
  return rows.map((row) =>
    toApiMessage(row, { reactions: porMensagem.get(row.id) ?? [], meuId }),
  );
}
