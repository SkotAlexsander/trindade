import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Perm, can, messageContentSchema } from '@trindade/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import * as messagesDb from '../db/messages.js';
import * as channelsDb from '../db/channels.js';
import * as attachmentsDb from '../db/attachments.js';
import { toApiMessage, toApiMessages } from '../services/message-view.js';
import { agruparAnexos } from '../services/attachment-view.js';
import { gateway } from '../ws/index.js';
import * as usersDb from '../db/users.js';
import * as notas from '../services/notas.js';
import { userKey } from '../lib/client-key.js';
import { config } from '../config.js';

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 100;

const mensagemSchema = z.object({
  id: z.string(),
  /* Um dos dois vem preenchido. A mesma mensagem serve canal e conversa
     privada — ver design/10-conversas-privadas.md. */
  channelId: z.string().nullable(),
  conversationId: z.string().nullable(),
  author: z.object({
    id: z.string(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  content: z.string().nullable(),
  /* Precisa estar aqui: o schema de resposta é filtro, e um campo ausente dele
     some da resposta sem erro nenhum. Foi o que fez a linha de sistema chegar
     pelo socket e sumir ao recarregar a página. */
  kind: z.enum(['text', 'system', 'poll']),
  parentId: z.string().nullable(),
  replyToId: z.string().nullable(),
  attachments: z.array(
    z.object({
      id: z.string(),
      filename: z.string(),
      contentType: z.string(),
      byteSize: z.number(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      blurhash: z.string().nullable(),
      url: z.string(),
    }),
  ),
  reactions: z.array(z.object({ emoji: z.string(), count: z.number(), me: z.boolean() })),
  threadCount: z.number(),
  threadLastReplyAt: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  saved: z.boolean(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  clientNonce: z.string().optional(),
});

export const messageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /**
   * "Adicionar às notas".
   *
   * O gesto central das ferramentas de projeto: uma decisão tomada na conversa
   * vira registro em um clique, sem copiar e colar. Vai como citação, com o
   * nome de quem disse e o link de volta — sem a origem, a nota vira uma cópia
   * sem procedência, e daí ninguém confia nela.
   */
  app.post(
    '/messages/:id/para-notas',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_NOTES)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode editar as notas');
      }

      const mensagem = await messagesDb.findMessageById(req.params.id);
      if (!mensagem || mensagem.deleted_at) {
        throw notFound('MESSAGE_NOT_FOUND', 'esta mensagem não existe');
      }

      // Nota é do canal: mensagem de conversa privada não tem para onde ir, e
      // levá-la para a nota de um canal seria vazar o privado no público.
      if (!mensagem.channel_id) {
        throw badRequest('MESSAGE_NOT_IN_CHANNEL', 'conversa privada não tem notas');
      }

      const autor = await usersDb.findUserById(mensagem.author_id);
      const canal = await channelsDb.findChannelById(mensagem.channel_id);

      await notas.citarMensagem({
        channelId: mensagem.channel_id,
        userId: me.id,
        texto: mensagem.content ?? '',
        autor: autor?.display_name ?? 'Alguém',
        link: `${config.WEB_ORIGIN}/c/${canal?.slug ?? ''}?m=${mensagem.id}`,
        log: app.log,
      });

      return { ok: true };
    },
  );

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
        ? await messagesDb.listAround({ channelId: req.params.id }, around, limit)
        : await messagesDb.listMessages({
            channelId: req.params.id,
            ...(before ? { before } : {}),
            ...(after ? { after } : {}),
            limit,
          });

      const ids = messages.map((m) => m.id);
      const [reacoes, guardadas, threads, anexos] = await Promise.all([
        messagesDb.listReactions(ids),
        messagesDb.quaisGuardadas(me.id, ids),
        messagesDb.countThreadReplies(ids),
        attachmentsDb.listarDeMensagens(ids),
      ]);
      return {
        messages: toApiMessages(messages, reacoes, me.id, guardadas, threads, agruparAnexos(anexos)),
        hasMore,
      };
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
      const ids = results.map((m) => m.id);
      const [reacoes, guardadas, anexos] = await Promise.all([
        messagesDb.listReactions(ids),
        messagesDb.quaisGuardadas(me.id, ids),
        attachmentsDb.listarDeMensagens(ids),
      ]);
      return {
        results: toApiMessages(results, reacoes, me.id, guardadas, new Map(), agruparAnexos(anexos)),
        total,
      };
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
      const ids = linhas.map((m) => m.id);
      const [reacoes, guardadas, anexos] = await Promise.all([
        messagesDb.listReactions(ids),
        messagesDb.quaisGuardadas(me.id, ids),
        attachmentsDb.listarDeMensagens(ids),
      ]);
      return {
        messages: toApiMessages(linhas, reacoes, me.id, guardadas, new Map(), agruparAnexos(anexos)),
      };
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
      const ids = [pai.id, ...respostas.map((m) => m.id)];
      const [reacoes, guardadas, anexos] = await Promise.all([
        messagesDb.listReactions(ids),
        messagesDb.quaisGuardadas(me.id, ids),
        attachmentsDb.listarDeMensagens(ids),
      ]);
      const porMensagem = agruparAnexos(anexos);
      const resumo = await messagesDb.countThreadReplies([pai.id]);
      const doPai = resumo.get(pai.id);

      return {
        parent: toApiMessage(pai, {
          meuId: me.id,
          reactions: reacoes.filter((r) => r.message_id === pai.id),
          saved: guardadas.has(pai.id),
          attachments: porMensagem.get(pai.id) ?? [],
          ...(doPai ? { thread: doPai } : {}),
        }),
        replies: toApiMessages(respostas, reacoes, me.id, guardadas, new Map(), porMensagem),
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
          d: { id: row.id, channelId: row.channel_id, conversationId: row.conversation_id },
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
            d: {
              messageId: alvo.id,
              channelId: alvo.channel_id ?? alvo.conversation_id ?? '',
              userId: me.id,
              emoji,
            },
          });
        }
        return reply.code(204).send(null);
      },
    });
  }

  // --- guardadas -----------------------------------------------------------
  //
  // Sem permissão e sem broadcast, e as duas ausências são a especificação:
  // guardar não muda nada para ninguém, e a lista não sai da conta de quem
  // guardou. Ver design/04-mensagens.md, "Fixar e guardar".
  for (const [metodo, guardar] of [['PUT', true], ['DELETE', false]] as const) {
    app.route({
      method: metodo,
      url: '/messages/:id/save',
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
      preHandler: app.authenticate,
      handler: async (req, reply) => {
        const me = requireUser(req);
        const params = req.params as { id: string };

        const alvo = await messagesDb.findMessageById(params.id);
        if (!alvo || alvo.deleted_at) {
          throw notFound('MESSAGE_NOT_FOUND', 'esta mensagem não existe');
        }

        // Idempotente nos dois sentidos: guardar o que já está guardado e
        // desguardar o que não está devolvem 204 igual. Quem clica duas vezes
        // por engano não merece um erro.
        if (guardar) await messagesDb.guardar(me.id, alvo.id);
        else await messagesDb.desguardar(me.id, alvo.id);

        return reply.code(204).send(null);
      },
    });
  }

  app.get(
    '/saved',
    {
      schema: {
        querystring: z.object({
          before: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
        }),
        response: {
          200: z.object({
            messages: z.array(
              mensagemSchema.extend({
                /* Nulo quando a mensagem veio de uma conversa privada: ela
                   continua na sua lista, mas não tem canal para nomear. */
                channel: z
                  .object({ id: z.string(), slug: z.string(), name: z.string() })
                  .nullable(),
                savedAt: z.string(),
              }),
            ),
            hasMore: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const { rows, hasMore } = await messagesDb.listarGuardadas({
        userId: me.id,
        ...(req.query.before ? { before: req.query.before } : {}),
        limit: req.query.limit,
      });

      const reacoes = await messagesDb.listReactions(rows.map((r) => r.id));
      const anexos = agruparAnexos(await attachmentsDb.listarDeMensagens(rows.map((r) => r.id)));
      const porMensagem = new Map<string, typeof reacoes>();
      for (const r of reacoes) {
        porMensagem.set(r.message_id, [...(porMensagem.get(r.message_id) ?? []), r]);
      }

      return {
        messages: rows.map((row) => ({
          // `saved: true` sem consultar: se está nesta lista, você guardou.
          ...toApiMessage(row, {
            meuId: me.id,
            reactions: porMensagem.get(row.id) ?? [],
            saved: true,
            attachments: anexos.get(row.id) ?? [],
          }),
          // O canal de origem em cada linha. Sem ele a lista é um amontoado de
          // frases sem lugar, e metade do valor de guardar se perde.
          channel:
            row.channel_id && row.channel_slug && row.channel_name
              ? { id: row.channel_id, slug: row.channel_slug, name: row.channel_name }
              : null,
          savedAt: row.saved_at.toISOString(),
        })),
        hasMore,
      };
    },
  );

  app.put(
    '/channels/:id/read',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        /* Sem `messageId` quer dizer "tudo o que existe agora". É o que o menu
           do canal manda: quem clica em "marcar como lido" de fora do canal
           não tem o id de mensagem nenhuma, e fazer o cliente buscar a última
           só para devolvê-la seria uma volta a mais para o servidor descobrir
           o que ele já sabe. */
        body: z.object({ messageId: z.string().uuid().optional() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);
      const canal = await channelsDb.findChannelById(req.params.id);
      if (!canal) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');
      const ate =
        req.body.messageId ?? (await messagesDb.ultimaMensagemDo({ channelId: canal.id }));
      const { mutedUntil } = await messagesDb.marcarLido(me.id, { channelId: canal.id }, ate);

      // Só para as suas outras abas: ler num lugar tem de apagar o negrito no
      // outro, e isso não é da conta de mais ninguém. O silêncio vai junto
      // porque ler um canal silenciado não pode dessilenciá-lo.
      gateway.sendToUser(me.id, {
        op: 'READ_STATE_UPDATE',
        d: {
          channelId: canal.id,
          conversationId: null,
          lastReadMessageId: ate,
          unreadCount: 0,
          mentionCount: 0,
          mutedUntil,
        },
      });
      return reply.code(204).send(null);
    },
  );

  /**
   * Silenciar um canal.
   *
   * Por pessoa e com prazo: "1 hora", "8 horas" e "até eu ligar" viram uma
   * data ou `null`. É uma preferência de conta e não de máquina — quem calou
   * `#bugs` no notebook quer `#bugs` calado no celular também —, e por isso
   * mora no servidor e volta no `READ_STATE_UPDATE`.
   */
  app.route({
    method: ['PUT', 'DELETE'],
    url: '/channels/:id/mute',
    schema: {
      params: z.object({ id: z.string().uuid() }),
      // `nullish` e não `optional`: um DELETE sem corpo chega como `null`, e
      // `optional` só aceita `undefined` — foi um 400 no teste de reativar.
      body: z.object({ until: z.string().datetime().nullish() }).nullish(),
      response: { 204: z.null() },
    },
    handler: async (req, reply) => {
      const me = requireUser(req);
      const canal = await channelsDb.findChannelById(req.params.id);
      if (!canal) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');

      const corpo = req.body as { until?: string | null } | null | undefined;
      const ate = req.method === 'DELETE' || !corpo?.until ? null : new Date(corpo.until);
      await messagesDb.silenciar(me.id, { channelId: canal.id }, ate);

      const estados = await messagesDb.listReadState(me.id);
      const atual = estados.find((e) => e.channelId === canal.id);
      if (atual) gateway.sendToUser(me.id, { op: 'READ_STATE_UPDATE', d: atual });

      return reply.code(204).send(null);
    },
  });

  app.get(
    '/read-state',
    {
      schema: {
        response: {
          200: z.object({
            states: z.array(
              z.object({
                channelId: z.string().nullable(),
                conversationId: z.string().nullable(),
                lastReadMessageId: z.string().nullable(),
                unreadCount: z.number(),
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
