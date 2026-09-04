import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as messagesDb from '../db/messages.js';
import * as usersDb from '../db/users.js';
import type { TaskRow } from '../db/tasks.js';
import { toApiTask } from './task-view.js';
import { toApiMessage } from './message-view.js';
import { gateway } from '../ws/index.js';

/**
 * O quadro conversando com o canal.
 *
 * Duas coisas moram aqui porque as duas atravessam a fronteira entre a tarefa e
 * a conversa: o aviso de que uma tarefa mudou, e a linha de sistema quando
 * alguém conclui.
 */

/** Toda mudança vira um `TASK_UPDATE` para todo mundo. */
export function anunciarTarefa(linha: TaskRow, removida = false): void {
  gateway.broadcast({
    op: 'TASK_UPDATE',
    d: removida ? { task: toApiTask(linha), removida: true } : { task: toApiTask(linha) },
  });
}

/**
 * "Bruno concluiu *Revisar a migração*".
 *
 * Uma linha no canal, como mensagem de sistema. É como o grupo fica sabendo sem
 * abrir o quadro — e, sendo mensagem, ela entra na busca e no histórico como
 * qualquer outra coisa que aconteceu ali.
 *
 * Falhar aqui não desfaz a conclusão: a tarefa está concluída de qualquer
 * forma, e derrubar o `PATCH` por causa do aviso seria trocar o que importa
 * pelo que acompanha.
 */
export async function concluirNoCanal(
  tarefa: TaskRow,
  userId: string,
  app: FastifyInstance,
): Promise<void> {
  try {
    const quem = await usersDb.findUserById(userId);
    const nome = quem?.display_name ?? 'Alguém';

    const { row } = await messagesDb.createMessage({
      channelId: tarefa.channel_id,
      authorId: userId,
      content: `${nome} concluiu **${tarefa.title}**`,
      kind: 'system',
      // A linha de sistema nasce uma vez e não é reenviada por ninguém: o
      // nonce de deduplicação não tem o que fazer aqui.
      clientNonce: randomUUID(),
      replyToId: null,
      parentId: null,
    });

    for (const outro of gateway.online()) {
      gateway.sendToUser(outro, {
        op: 'MESSAGE_CREATE',
        d: toApiMessage(row, { meuId: outro, attachments: [] }),
      });
    }
  } catch (err) {
    app.log.error({ err, tarefa: tarefa.id }, 'não consegui anunciar a conclusão no canal');
  }
}
