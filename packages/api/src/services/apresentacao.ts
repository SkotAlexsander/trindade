import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Presentation } from '@trindade/shared';
import { config } from '../config.js';
import * as boardsDb from '../db/boards.js';
import * as channelsDb from '../db/channels.js';
import * as messagesDb from '../db/messages.js';
import * as usersDb from '../db/users.js';
import { toApiMessage } from './message-view.js';
import { gateway } from '../ws/index.js';

/**
 * Quem está apresentando qual quadro.
 *
 * Em memória, como o estado de voz e pela mesma razão: é presença, não
 * registro. Reiniciar a API encerra as apresentações — e isso é o certo, porque
 * quem conduzia perdeu a conexão junto.
 *
 * O que **fica** é a linha no canal: "Ana está apresentando *Fluxo*". Ela é uma
 * mensagem de sistema como a da tarefa concluída, e é assim que quem não estava
 * na hora descobre que aconteceu. Ver design/11-quadro.md.
 */

const porQuadro = new Map<string, Presentation>();

export function apresentacoes(): Presentation[] {
  return [...porQuadro.values()];
}

export function apresentacaoDoQuadro(boardId: string): Presentation | undefined {
  return porQuadro.get(boardId);
}

export function limparApresentacoes(): void {
  porQuadro.clear();
}

/**
 * Começa a apresentar.
 *
 * Uma por quadro: quem chega depois recebe `ocupado` e vê quem está conduzindo.
 * Duas pessoas conduzindo o mesmo quadro é a mesma coisa que ninguém conduzir —
 * cada espectador seguiria uma viewport diferente.
 */
export async function comecar(entrada: {
  boardId: string;
  userId: string;
  log: FastifyBaseLogger;
}): Promise<{ ok: true; presentation: Presentation } | { ok: false; motivo: string }> {
  const atual = porQuadro.get(entrada.boardId);
  if (atual && atual.userId !== entrada.userId) {
    return { ok: false, motivo: 'ALREADY_PRESENTING' };
  }
  if (atual) return { ok: true, presentation: atual };

  const quadro = await boardsDb.porId(entrada.boardId);
  if (!quadro || quadro.archived_at) return { ok: false, motivo: 'BOARD_NOT_FOUND' };

  const presentation: Presentation = {
    boardId: quadro.id,
    channelId: quadro.channel_id,
    boardName: quadro.name,
    userId: entrada.userId,
    startedAt: new Date().toISOString(),
  };
  porQuadro.set(quadro.id, presentation);
  gateway.broadcast({ op: 'PRESENTATION_UPDATE', d: { presentation, ativo: true } });

  await anunciar(presentation, 'comecou', entrada.log);
  return { ok: true, presentation };
}

/**
 * Encerra.
 *
 * Só quem está apresentando encerra a própria apresentação — e a queda da
 * conexão encerra também, por `esquecerApresentador`. Sem isso, uma aba fechada
 * deixaria o quadro travado como "Ana apresentando" para sempre.
 */
export async function terminar(
  boardId: string,
  userId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const atual = porQuadro.get(boardId);
  if (!atual || atual.userId !== userId) return;

  porQuadro.delete(boardId);
  gateway.broadcast({ op: 'PRESENTATION_UPDATE', d: { presentation: atual, ativo: false } });
  await anunciar(atual, 'terminou', log);
}

/** Alguém caiu do gateway: se estava apresentando, a apresentação acaba. */
export async function esquecerApresentador(
  userId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  for (const [boardId, atual] of porQuadro) {
    if (atual.userId === userId) await terminar(boardId, userId, log);
  }
}

/**
 * A linha no canal.
 *
 * Falhar aqui não desfaz a apresentação: ela está acontecendo de qualquer
 * forma, e derrubá-la por causa do aviso seria trocar o que importa pelo que
 * acompanha. É a mesma decisão da conclusão de tarefa.
 */
async function anunciar(
  presentation: Presentation,
  o_que: 'comecou' | 'terminou',
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const quem = await usersDb.findUserById(presentation.userId);
    const nome = quem?.display_name ?? 'Alguém';

    /* O nome do quadro é um link de verdade: quem lê a linha depois quer
       **entrar**, e um texto em negrito obrigaria a abrir o painel e procurar.
       `?quadro=` é lido pelo shell, que abre o quadro sobre a conversa. */
    const canal = await channelsDb.findChannelById(presentation.channelId);
    const link = canal
      ? `${config.WEB_ORIGIN}/c/${canal.slug}?quadro=${presentation.boardId}`
      : null;
    const alvo = link ? `[${presentation.boardName}](${link})` : `**${presentation.boardName}**`;

    const texto =
      o_que === 'comecou'
        ? `◉ ${nome} está apresentando ${alvo}`
        : `${nome} encerrou a apresentação de ${alvo}`;

    const { row } = await messagesDb.createMessage({
      channelId: presentation.channelId,
      authorId: presentation.userId,
      content: texto,
      kind: 'system',
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
    log.error({ err, boardId: presentation.boardId }, 'não consegui anunciar a apresentação');
  }
}
