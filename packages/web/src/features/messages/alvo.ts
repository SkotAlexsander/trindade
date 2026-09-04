import type { Message } from '@trindade/shared';

/**
 * Onde a conversa acontece: um canal ou uma conversa privada.
 *
 * O produto trata as duas como a mesma coisa em quase tudo — histórico,
 * rolagem, reações, anexos, threads, busca —, e o que muda é o caminho da API
 * e o campo que a mensagem carrega. Um tipo só, atravessando a camada de
 * mensagens, é o que evita duplicar a lista, o compositor e o cache.
 *
 * Ver design/10-conversas-privadas.md.
 */

export type Alvo = { tipo: 'canal'; id: string } | { tipo: 'conversa'; id: string };

export const canal = (id: string): Alvo => ({ tipo: 'canal', id });
export const conversa = (id: string): Alvo => ({ tipo: 'conversa', id });

/** `/channels/:id` ou `/conversations/:id` — o prefixo de toda rota do alvo. */
export function caminhoDo(alvo: Alvo): string {
  return alvo.tipo === 'canal' ? `/channels/${alvo.id}` : `/conversations/${alvo.id}`;
}

/** O corpo que o WebSocket espera: exatamente um dos dois campos. */
export function alvoNoEvento(alvo: Alvo): { channelId: string } | { conversationId: string } {
  return alvo.tipo === 'canal' ? { channelId: alvo.id } : { conversationId: alvo.id };
}

/** De qual alvo esta mensagem é. O servidor garante que só um vem preenchido. */
export function alvoDaMensagem(m: Pick<Message, 'channelId' | 'conversationId'>): Alvo {
  return m.conversationId ? conversa(m.conversationId) : canal(m.channelId ?? '');
}

/**
 * O id do alvo, que é a chave do cache.
 *
 * Canal e conversa são uuid e nunca colidem, então um mapa só — de leitura, de
 * histórico, de quem está digitando — serve para os dois. É isso que faz o
 * contador do título e o "não lido" valerem para conversa sem uma segunda
 * implementação.
 */
export function idDoAlvo(m: Pick<Message, 'channelId' | 'conversationId'>): string {
  return m.conversationId ?? m.channelId ?? '';
}
