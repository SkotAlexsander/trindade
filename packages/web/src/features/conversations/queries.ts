import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Conversation, Message, User } from '@trindade/shared';
import { api } from '../../lib/http';

/**
 * As suas conversas privadas.
 *
 * Uma consulta só, sem paginação: com cinco pessoas existem dez pares e um
 * punhado de grupos, e a lista inteira cabe numa resposta. Ver
 * design/10-conversas-privadas.md.
 */

export const CHAVE = ['conversations'] as const;

export function useConversas() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: () =>
      api<{ conversations: Conversation[] }>('/conversations').then((r) => r.conversations),
    staleTime: 30_000,
  });
}

/** Chega pelo gateway: nasceu, mudou de nome, silenciou. */
export function receberConversa(qc: QueryClient, conversa: Conversation): void {
  qc.setQueryData<Conversation[]>(CHAVE, (atuais) => [
    conversa,
    ...(atuais ?? []).filter((c) => c.id !== conversa.id),
  ]);
}

/**
 * A conversa acabou de receber uma mensagem.
 *
 * É o que faz uma direta recém-criada **aparecer** na lista: ela nasce sem
 * `lastMessageAt` e fica invisível de propósito, e é a primeira mensagem que a
 * traz para a barra lateral. Vem do gateway, sem ir ao servidor de novo — o
 * evento já traz tudo o que a linha da lista mostra.
 */
export function mensagemNaConversa(qc: QueryClient, mensagem: Message): void {
  if (!mensagem.conversationId) return;

  qc.setQueryData<Conversation[]>(CHAVE, (atuais) =>
    (atuais ?? []).map((c) =>
      c.id === mensagem.conversationId
        ? {
            ...c,
            lastMessageAt: mensagem.createdAt,
            lastMessage: mensagem.content,
            lastAuthorId: mensagem.author.id,
            // Escondida volta sozinha: o servidor faz o mesmo do lado dele.
            hidden: false,
          }
        : c,
    ),
  );
}

/**
 * Abrir a direta com alguém.
 *
 * Idempotente: chamar duas vezes devolve a mesma conversa. Quem clica em
 * "Mandar mensagem" duas vezes não cria duas.
 */
export function useAbrirDireta() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      api<{ conversation: Conversation }>('/conversations/direct', {
        method: 'POST',
        body: { userId },
      }),
    onSuccess: ({ conversation }) => receberConversa(qc, conversation),
  });
}

export function useCriarGrupo() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: { userIds: string[]; name?: string | null }) =>
      api<{ conversation: Conversation }>('/conversations/group', {
        method: 'POST',
        body: entrada,
      }),
    onSuccess: ({ conversation }) => receberConversa(qc, conversation),
  });
}

export function useRenomearConversa() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: { id: string; name: string | null }) =>
      api<{ conversation: Conversation }>(`/conversations/${entrada.id}`, {
        method: 'PATCH',
        body: { name: entrada.name },
      }),
    onSuccess: ({ conversation }) => receberConversa(qc, conversation),
  });
}

export function useSairDaConversa() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api(`/conversations/${id}/leave`, { method: 'POST' }),
    onSuccess: (_r, id) => {
      qc.setQueryData<Conversation[]>(CHAVE, (atuais) => (atuais ?? []).filter((c) => c.id !== id));
    },
  });
}

export function useEsconderConversa() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: { id: string; escondida: boolean }) =>
      api(`/conversations/${entrada.id}/${entrada.escondida ? 'hide' : 'unhide'}`, {
        method: 'POST',
      }),
    onSuccess: (_r, { id, escondida }) => {
      qc.setQueryData<Conversation[]>(CHAVE, (atuais) =>
        (atuais ?? []).map((c) => (c.id === id ? { ...c, hidden: escondida } : c)),
      );
    },
  });
}

/**
 * O nome de uma conversa na tela.
 *
 * Direta é o primeiro nome da outra pessoa; grupo é o nome dado, ou os
 * primeiros nomes de quem está lá. Ninguém batiza um grupo de três pessoas, e
 * "Ana, Carla" diz mais que "Grupo sem nome".
 */
export function nomeDaConversa(
  conversa: Conversation,
  pessoas: readonly User[],
  meuId: string,
): string {
  if (conversa.name) return conversa.name;

  const outros = conversa.members
    .filter((id) => id !== meuId)
    .map((id) => pessoas.find((p) => p.id === id))
    .filter((p): p is User => Boolean(p));

  if (outros.length === 0) return 'Conversa';
  if (conversa.kind === 'direct') return outros[0]?.displayName ?? 'Conversa';
  return outros.map((p) => p.displayName.split(' ')[0]).join(', ');
}

/** As conversas que a lista mostra: com mensagem e não escondidas. */
export function visiveis(conversas: readonly Conversation[]): Conversation[] {
  // Uma direta sem nada nunca ocupa espaço na lista — ela existe no banco e
  // continua invisível até alguém dizer alguma coisa.
  return conversas.filter((c) => c.lastMessageAt !== null && !c.hidden);
}
