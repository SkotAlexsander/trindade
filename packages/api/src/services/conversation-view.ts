import type { Conversation } from '@trindade/shared';
import type { ConversaDaLista, ConversationRow } from '../db/conversations.js';

/**
 * A conversa como ela sai na API.
 *
 * `members` traz só quem não saiu. Quem saiu continua no histórico dos outros
 * — a lista de membros diz quem está lá agora, não quem já esteve.
 */
export function toApiConversation(linha: ConversaDaLista): Conversation {
  return {
    id: linha.id,
    kind: linha.kind,
    name: linha.name,
    members: linha.membros,
    createdBy: linha.created_by,
    createdAt: linha.created_at.toISOString(),
    lastMessageAt: linha.ultima_mensagem_em?.toISOString() ?? null,
    lastMessage: linha.ultimo_texto,
    lastAuthorId: linha.ultimo_autor,
    unreadCount: linha.nao_lidas,
    mentionCount: linha.mencoes,
    mutedUntil: linha.muted_until?.toISOString() ?? null,
    hidden: linha.hidden_at !== null,
  };
}

/**
 * A conversa recém-criada, sem passar pela consulta da lista.
 *
 * Uma direta que acabou de nascer não tem mensagem, não tem não lidas e não
 * está escondida: montar isso à mão é honesto e evita uma segunda ida ao banco
 * logo depois do `insert`.
 */
export function novaConversa(linha: ConversationRow, membros: readonly string[]): Conversation {
  return {
    id: linha.id,
    kind: linha.kind,
    name: linha.name,
    members: [...membros],
    createdBy: linha.created_by,
    createdAt: linha.created_at.toISOString(),
    lastMessageAt: null,
    lastMessage: null,
    lastAuthorId: null,
    unreadCount: 0,
    mentionCount: 0,
    mutedUntil: null,
    hidden: false,
  };
}
