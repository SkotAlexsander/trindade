import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Perm, can, messageContentSchema } from '@trindade/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import * as messagesDb from '../db/messages.js';
import * as channelsDb from '../db/channels.js';
import { toApiMessage, toApiMessages } from '../services/message-view.js';
import { gateway } from '../ws/index.js';

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 100;

const mensagemSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  author: z.object({
    id: z.string(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  content: z.string().nullable(),
  parentId: z.string().nullable(),
  replyToId: z.string().nullable(),
  attachments: z.array(z.unknown()),
  reactions: z.array(z.object({ emoji: z.string(), count: z.number(), me: z.boolean() })),
  pinnedAt: z.string().nullable(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  clientNonce: z.string().optional(),
});

export const messageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** O envio é por WebSocket; o HTTP cobre histórico e operações pontuais. */
  app.get(
    '/channels/:id/messages',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          before: z.string().uuid().optional(),
          after: z.string().uuid().optional(),
          around: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
        }),
        response: {
          200: z.object({ messages: z.array(mensagemSchema), hasMore: z.boolean() }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const { before, after, around, limit } = req.query;

      const { messages, hasMore } = around
        ? await messagesDb.listAround(req.params.id, around, limit)
        : await messagesDb.listMessages({
            channelId: req.params.id,
            ...(before ? { before } : {}),
            ...(after ? { after } : {}),
            limit,
          });

      const reacoes = await messagesDb.listReactions(messages.map((m) => m.id));
      return { messages: toApiMessages(messages, reacoes, me.id), hasMore };
    },
  );

  app.get(
    '/channels/:id/messages/search',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          q: z.string().min(1).max(200),
          from: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(25),
        }),
        response: {
          200: z.object({ results: z.array(mensagemSchema), total: z.number() }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const { results, total } = await messagesDb.search({
        channelId: req.params.id,
        q: req.query.q,
        ...(req.query.from ? { from: req.query.from } : {}),
        limit: req.query.limit,
      });
      const reacoes = await messagesDb.listReactions(results.map((m) => m.id));
      return { results: toApiMessages(results, reacoes, me.id), total };
    },
  );

  app.get(
    '/channels/:id/pins',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ messages: z.array(mensagemSchema) }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const linhas = await messagesDb.listPins(req.params.id);
      const reacoes = await messagesDb.listReactions(linhas.map((m) => m.id));
      return { messages: toApiMessages(linhas, reacoes, me.id) };
    },
  );

  app.get(
    '/messages/:id/thread',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({ parent: mensagemSchema, replies: z.array(mensagemSchema) }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const pai = await messagesDb.findMessageById(req.params.id);
      if (!pai) throw notFound('MESSAGE_NOT_FOUND', 'esta mensagem não existe');

      const respostas = await messagesDb.listThread(pai.id);
      const reacoes = await messagesDb.listReactions([pai.id, ...respostas.map((m) => m.id)]);
      return {
        parent: toApiMessage(pai, { meuId: me.id, reactions: reacoes.filter((r) => r.message_id === pai.id) }),
        replies: toApiMessages(respostas, reacoes, me.id),
      };
    },
  );

  app.patch(
    '/messages/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ content: messageContentSchema }),
        response: { 200: z.object({ message: mensagemSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      // Só o autor edita. Nem ADMINISTRATOR muda o que outra pessoa escreveu:
      // editar palavra alheia é diferente de moderar.
      const row = await messagesDb.updateContent(req.params.id, me.id, req.body.content);
      if (!row) throw notFound('MESSAGE_NOT_FOUND', 'esta mensagem não existe ou não é sua');

      const mensagem = toApiMessage(row, { meuId: me.id });
      gateway.broadcast({ op: 'MESSAGE_UPDATE', d: mensagem });
      return { message: mensagem };
    },
  );

  app.delete(
    '/messages/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const me = requireUser(req);
      const alvo = await messagesDb.findMessageById(req.params.id);
      if (!alvo) throw notFound('MESSAGE_NOT_FOUND', 'esta mensagem não existe');

      const propria = alvo.author_id === me.id;
      const podeApagar = propria
        ? can(me.permissions, Perm.DELETE_OWN_MESSAGE)
        : can(me.permissions, Perm.DELETE_ANY_MESSAGE);
      if (!podeApagar) throw forbidden('MISSING_PERMISSION', 'você não pode apagar esta mensagem');

      const row = await messagesDb.softDelete(alvo.id);
      if (row) {
        gateway.broadcast({
          op: 'MESSAGE_DELETE',
          d: { id: row.id, channelId: row.channel_id },
        });
      }
      return reply.code(204).send(null);
    },
  );

  for (const [metodo, fixar] of [['PUT', true], ['DELETE', false]] as const) {
    app.route({
      method: metodo,
      url: '/messages/:id/pin',
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ message: mensagemSchema }) },
      },
      preHandler: app.authenticate,
      handler: async (req) => {
        const me = requireUser(req);
        if (!can(me.permissions, Perm.PIN_MESSAGE)) {
          throw forbidden('MISSING_PERMISSION', 'você não pode fixar mensagens');
        }
        const params = req.params as { id: string };
        const row = await messagesDb.setPinned(params.id, fixar);
        if (!row) throw notFound('MESSAGE_NOT_FOUND', 'esta mensagem não existe');

        const mensagem = toApiMessage(row, { meuId: me.id });
        gateway.broadcast({ op: 'MESSAGE_UPDATE', d: mensagem });
        return { message: mensagem };
      },
    });
  }

  for (const [metodo, adicionar] of [['PUT', true], ['DELETE', false]] as const) {
    app.route({
      method: metodo,
      url: '/messages/:id/reactions/:emoji',
      schema: {
        params: z.object({ id: z.string().uuid(), emoji: z.string().min(1).max(64) }),
        response: { 204: z.null() },
      },
      preHandler: app.authenticate,
      handler: async (req, reply) => {
        const me = requireUser(req);
        const params = req.params as { id: string; emoji: string };
        // O emoji vai percent-encoded na URL.
        const emoji = decodeURIComponent(params.emoji);
        if (emoji.length > 32) throw badRequest('INVALID_EMOJI', 'emoji inválido');

        const alvo = await messagesDb.findMessageById(params.id);
        if (!alvo || alvo.deleted_at) {
          throw notFound('MESSAGE_NOT_FOUND', 'esta mensagem não existe');
        }

        const mudou = adicionar
          ? await messagesDb.addReaction(alvo.id, me.id, emoji)
          : await messagesDb.removeReaction(alvo.id, me.id, emoji);

        if (mudou) {
          gateway.broadcast({
            op: adicionar ? 'REACTION_ADD' : 'REACTION_REMOVE',
            d: { messageId: alvo.id, channelId: alvo.channel_id, userId: me.id, emoji },
          });
        }
        return reply.code(204).send(null);
      },
    });
  }

  app.put(
    '/channels/:id/read',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ messageId: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);
      const canal = await channelsDb.findChannelById(req.params.id);
      if (!canal) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');
      await messagesDb.marcarLido(me.id, canal.id, req.body.messageId);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/read-state',
    {
      schema: {
        response: {
          200: z.object({
            states: z.array(
              z.object({
                channelId: z.string(),
                lastReadMessageId: z.string().nullable(),
                mentionCount: z.number(),
                mutedUntil: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      return { states: await messagesDb.listReadState(me.id) };
    },
  );
};
