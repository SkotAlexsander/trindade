import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Attachment, Message } from '@trindade/shared';
import { useAuth } from '../auth/store';
import { enviar as enviarPeloSocket } from '../../lib/ws';
import {
  descartarOtimista,
  inserirOtimista,
  inserirOtimistaNaThread,
  marcarLocal,
  type MensagemLocal,
} from './queries';

/**
 * Envio otimista.
 *
 * A mensagem aparece na lista antes de existir no banco. O `clientNonce` é o
 * que costura as duas pontas: o servidor devolve o mesmo valor, o cliente
 * encontra a linha otimista e a substitui **no lugar**, sem animar nada.
 *
 * Ver design/04-mensagens.md, "Estados da mensagem".
 */

/** Depois disso sem confirmação, a mensagem admite que falhou. */
const PACIENCIA_MS = 12_000;

const relogios = new Map<string, ReturnType<typeof setTimeout>>();

/** Chamado quando o servidor confirma: cancela o relógio da falha. */
export function confirmarNonce(nonce: string): void {
  const timer = relogios.get(nonce);
  if (timer) clearTimeout(timer);
  relogios.delete(nonce);
}

function novoNonce(): string {
  return crypto.randomUUID();
}

export interface Rascunho {
  channelId: string;
  content: string;
  replyToId?: string | null;
  parentId?: string | null;
  /**
   * Os anexos **já subidos**. O upload terminou antes de a pessoa apertar
   * Enter — ver `useAnexos.ts` — então aqui eles são só ids a costurar, e a
   * linha otimista já pode desenhá-los.
   */
  anexos?: readonly Attachment[];
}

export function useEnviarMensagem() {
  const qc = useQueryClient();
  const eu = useAuth((s) => s.user);

  const enviar = useCallback(
    (rascunho: Rascunho, nonceExistente?: string): string | null => {
      if (!eu) return null;

      const clientNonce = nonceExistente ?? novoNonce();

      if (!nonceExistente) {
        const otimista: MensagemLocal = {
          // Id provisório. Some quando a versão real chega; até lá serve só de
          // chave de React, e por isso carrega o nonce — se fosse aleatório a
          // cada render, a linha remontaria sozinha.
          id: `local:${clientNonce}`,
          channelId: rascunho.channelId,
          kind: 'text',
          author: {
            id: eu.id,
            username: eu.username,
            displayName: eu.displayName,
            avatarUrl: eu.avatarUrl,
          },
          content: rascunho.content,
          parentId: rascunho.parentId ?? null,
          replyToId: rascunho.replyToId ?? null,
          threadCount: 0,
          threadLastReplyAt: null,
          attachments: [...(rascunho.anexos ?? [])],
          reactions: [],
          pinnedAt: null,
          // Ninguém guarda o que acabou de escrever.
          saved: false,
          editedAt: null,
          deletedAt: null,
          createdAt: new Date().toISOString(),
          clientNonce,
          local: 'enviando',
        } satisfies MensagemLocal & Message;

        // Resposta de thread vive na thread, não na lista do canal — o
        // histórico do canal filtra `parent_id is null`.
        if (rascunho.parentId) inserirOtimistaNaThread(qc, otimista);
        else inserirOtimista(qc, otimista);
      }

      const saiu = enviarPeloSocket({
        op: 'MESSAGE_CREATE',
        d: {
          channelId: rascunho.channelId,
          content: rascunho.content,
          clientNonce,
          ...(rascunho.anexos?.length
            ? { attachmentIds: rascunho.anexos.map((a) => a.id) }
            : {}),
          ...(rascunho.replyToId ? { replyToId: rascunho.replyToId } : {}),
          ...(rascunho.parentId ? { parentId: rascunho.parentId } : {}),
        },
      });

      // Enfileirada não é falha: a fila esvazia sozinha quando o socket volta,
      // e oferecer "tentar de novo" para algo que já vai sair é convidar à
      // duplicata.
      marcarLocal(qc, rascunho.channelId, clientNonce, saiu ? 'enviando' : 'na-fila');

      confirmarNonce(clientNonce);
      if (saiu) {
        relogios.set(
          clientNonce,
          setTimeout(() => {
            relogios.delete(clientNonce);
            marcarLocal(qc, rascunho.channelId, clientNonce, 'falhou');
          }, PACIENCIA_MS),
        );
      }

      return clientNonce;
    },
    [eu, qc],
  );

  const tentarDeNovo = useCallback(
    (mensagem: MensagemLocal) => {
      if (!mensagem.clientNonce) return;
      if (!mensagem.content && mensagem.attachments.length === 0) return;
      enviar(
        {
          channelId: mensagem.channelId,
          content: mensagem.content ?? '',
          // Os anexos continuam pendentes no servidor: a mensagem é que não
          // chegou. Reenviar sem eles publicaria a legenda sem a foto.
          anexos: mensagem.attachments,
          replyToId: mensagem.replyToId,
          parentId: mensagem.parentId,
        },
        mensagem.clientNonce,
      );
    },
    [enviar],
  );

  const descartar = useCallback(
    (mensagem: MensagemLocal) => {
      if (!mensagem.clientNonce) return;
      confirmarNonce(mensagem.clientNonce);
      descartarOtimista(qc, mensagem.channelId, mensagem.clientNonce);
    },
    [qc],
  );

  return { enviar, tentarDeNovo, descartar };
}
