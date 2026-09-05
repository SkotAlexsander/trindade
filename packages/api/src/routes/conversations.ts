import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import { userKey } from '../lib/client-key.js';
import * as conversationsDb from '../db/conversations.js';
import * as messagesDb from '../db/messages.js';
import * as usersDb from '../db/users.js';
import * as attachmentsDb from '../db/attachments.js';
import { toApiMessages } from '../services/message-view.js';
import { agruparAnexos } from '../services/attachment-view.js';
import { novaConversa, toApiConversation } from '../services/conversation-view.js';
import { gateway } from '../ws/index.js';
import { Perm, can } from '@trindade/shared';
import { config } from '../config.js';
import {
  credenciaisTurn,
  garantirSalaDaConversa,
  salaDaConversa,
  tokenDeVoz,
  vozConfigurada,
} from '../services/voz.js';

/**
 * Conversas privadas.
 *
 * **A checagem de acesso é ser membro, e `ADMINISTRATOR` não passa.** É a
 * única exceção ao bitfield no produto inteiro, e é deliberada: quem
 * administra o servidor administra canais, cargos e pessoas — não lê a
 * conversa dos outros. Ver design/10-conversas-privadas.md.
 *
 * As mensagens são as mesmas de canal, na mesma tabela e com o mesmo formato:
 * histórico, busca, reações, anexos e threads entram por aqui reaproveitando o
 * que já existe.
 */

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 100;
/** Cinco pessoas: um grupo tem no máximo as outras quatro. */
const MAXIMO_DE_MEMBROS = 4;

const conversaSchema = z.object({
  id: z.string(),
  kind: z.enum(['direct', 'group']),
  name: z.string().nullable(),
  members: z.array(z.string()),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  lastMessageAt: z.string().nullable(),
  lastMessage: z.string().nullable(),
  lastAuthorId: z.string().nullable(),
  unreadCount: z.number(),
  mentionCount: z.number(),
  mutedUntil: z.string().nullable(),
  hidden: z.boolean(),
});

const mensagemSchema = z.object({
  id: z.string(),
  channelId: z.string().nullable(),
  conversationId: z.string().nullable(),
  author: z.object({
    id: z.string(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  content: z.string().nullable(),
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

export const conversationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /**
   * O portão de todas as rotas daqui.
   *
   * Uma função e não um `preHandler` porque nem toda rota tem `:id` — e porque
   * ficar explícita em cada uma é o que faz esquecer uma delas dar erro de
   * compilação em vez de vazamento.
   */
  async function exigirMembro(conversationId: string, userId: string) {
    const conversa = await conversationsDb.porId(conversationId);
    if (!conversa) throw notFound('CONVERSATION_NOT_FOUND', 'esta conversa não existe');
    if (!(await conversationsDb.ehMembro(conversationId, userId))) {
      // 403 e não 404: quem tem o id não descobre nada com a diferença, e
      // mentir sobre a existência complicaria o cliente sem ganho real.
      throw forbidden('NOT_A_MEMBER', 'esta conversa não é sua');
    }
    return conversa;
  }

  app.get(
    '/conversations',
    { schema: { response: { 200: z.object({ conversations: z.array(conversaSchema) }) } } },
    async (req) => {
      const me = requireUser(req);
      const linhas = await conversationsDb.listarDoUsuario(me.id);
      return { conversations: linhas.map(toApiConversation) };
    },
  );

  /**
   * A direta com alguém. Idempotente por natureza: chamar duas vezes devolve a
   * mesma conversa, inclusive em duas abas ao mesmo tempo.
   */
  app.post(
    '/conversations/direct',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        body: z.object({ userId: z.string().uuid() }),
        response: { 200: z.object({ conversation: conversaSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (req.body.userId === me.id) {
        throw badRequest('SELF_CONVERSATION', 'não dá para conversar sozinho');
      }

      const outro = await usersDb.findUserById(req.body.userId);
      if (!outro || outro.disabled_at) throw notFound('USER_NOT_FOUND', 'esta pessoa não existe');

      const conversa = await conversationsDb.acharOuCriarDireta(me.id, outro.id);
      const membros = (await conversationsDb.membros(conversa.id))
        .filter((m) => !m.left_at)
        .map((m) => m.user_id);

      /* Uma carga **por pessoa**, e não uma montada à mão para os dois.
         "Abrir a direta" quase sempre reabre uma que já existe, com histórico,
         não lidas e silêncio próprios de cada lado — mandar uma conversa em
         branco para os dois apagaria a última mensagem da lista de quem já a
         tinha, e ela sumiria da barra lateral até o próximo recarregamento. */
      let minha = novaConversa(conversa, membros);
      for (const membro of membros) {
        const carga = await paraMembro(conversa.id, membro, membros);
        if (membro === me.id) minha = carga;
        gateway.sendToUser(membro, { op: 'CONVERSATION_UPDATE', d: { conversation: carga } });
      }
      return { conversation: minha };
    },
  );

  app.post(
    '/conversations/group',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        body: z.object({
          userIds: z.array(z.string().uuid()).min(2).max(MAXIMO_DE_MEMBROS),
          name: z.string().trim().max(48).nullish(),
        }),
        response: { 200: z.object({ conversation: conversaSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const outros = [...new Set(req.body.userIds)].filter((id) => id !== me.id);
      // Duas pessoas é uma direta, e a direta já existe. Um grupo de dois seria
      // uma segunda conversa entre as mesmas duas pessoas.
      if (outros.length < 2) throw badRequest('GROUP_TOO_SMALL', 'um grupo tem três ou mais');

      const conversa = await conversationsDb.criarGrupo({
        createdBy: me.id,
        userIds: outros,
        name: req.body.name?.trim() || null,
      });

      // Grupo nasce vazio de verdade: aqui a carga montada à mão é a verdade.
      const membros = [me.id, ...outros];
      const carga = novaConversa(conversa, membros);
      for (const membro of membros) {
        gateway.sendToUser(membro, { op: 'CONVERSATION_UPDATE', d: { conversation: carga } });
      }
      return { conversation: carga };
    },
  );

  app.patch(
    '/conversations/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ name: z.string().trim().max(48).nullish() }),
        response: { 200: z.object({ conversation: conversaSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const conversa = await exigirMembro(req.params.id, me.id);
      // Direta não tem nome: ela é as duas pessoas, e o nome delas já está ali.
      if (conversa.kind !== 'group') throw badRequest('NOT_A_GROUP', 'direta não tem nome');

      await conversationsDb.renomear(conversa.id, req.body.name?.trim() || null);
      return { conversation: await recarregar(conversa.id, me.id) };
    },
  );

  /** Sair de um grupo. O histórico continua para os outros. */
  app.post(
    '/conversations/:id/leave',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const conversa = await exigirMembro(req.params.id, me.id);
      if (conversa.kind !== 'group') throw badRequest('NOT_A_GROUP', 'direta não se abandona');

      await conversationsDb.sair(conversa.id, me.id);

      const quem = await usersDb.findUserById(me.id);
      const restantes = (await conversationsDb.membros(conversa.id)).filter((m) => !m.left_at);

      // Uma linha de sistema na conversa: quem ficou precisa saber por que a
      // pessoa parou de responder.
      try {
        const { row } = await messagesDb.createMessage({
          conversationId: conversa.id,
          authorId: me.id,
          content: `${quem?.display_name ?? 'Alguém'} saiu da conversa`,
          kind: 'system',
          clientNonce: crypto.randomUUID(),
          replyToId: null,
          parentId: null,
        });
        for (const membro of restantes) {
          gateway.sendToUser(membro.user_id, {
            op: 'MESSAGE_CREATE',
            d: {
              ...toApiMessages([row], [], membro.user_id, new Set(), new Map(), new Map())[0]!,
              clientNonce: undefined,
            },
          });
        }
      } catch (err) {
        app.log.error({ err, conversa: conversa.id }, 'não consegui anunciar a saída');
      }

      return { ok: true };
    },
  );

  for (const [rota, escondida] of [
    ['hide', true],
    ['unhide', false],
  ] as const) {
    app.post(
      `/conversations/:id/${rota}`,
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          response: { 200: z.object({ ok: z.boolean() }) },
        },
      },
      async (req) => {
        const me = requireUser(req);
        await exigirMembro(req.params.id, me.id);
        // Esconder não apaga nada: a conversa volta na próxima mensagem, e é
        // por isso que não existe "apagar conversa".
        await conversationsDb.esconder(req.params.id, me.id, escondida);
        return { ok: true };
      },
    );
  }

  app.get(
    '/conversations/:id/messages',
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
      await exigirMembro(req.params.id, me.id);
      const { before, after, around, limit } = req.query;

      const { messages, hasMore } = around
        ? await messagesDb.listAround({ conversationId: req.params.id }, around, limit)
        : await messagesDb.listMessages({
            conversationId: req.params.id,
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
        messages: toApiMessages(
          messages,
          reacoes,
          me.id,
          guardadas,
          threads,
          agruparAnexos(anexos),
        ),
        hasMore,
      };
    },
  );

  /** Busca **dentro da conversa**. Não existe busca que atravesse o privado. */
  app.get(
    '/conversations/:id/messages/search',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          q: z.string().min(1).max(200),
          from: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(25),
        }),
        response: { 200: z.object({ results: z.array(mensagemSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      await exigirMembro(req.params.id, me.id);

      const { results, total } = await messagesDb.search({
        conversationId: req.params.id,
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
        results: toApiMessages(
          results,
          reacoes,
          me.id,
          guardadas,
          new Map(),
          agruparAnexos(anexos),
        ),
        total,
      };
    },
  );

  app.put(
    '/conversations/:id/read',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        /* Sem `messageId` é "tudo o que existe agora" — a mesma regra do canal,
           em `routes/messages.ts`. As duas rotas andam juntas: a lista de
           conversas e a de canais dão o mesmo gesto. */
        body: z.object({ messageId: z.string().uuid().optional() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);
      await exigirMembro(req.params.id, me.id);

      const ate =
        req.body.messageId ??
        (await messagesDb.ultimaMensagemDo({ conversationId: req.params.id }));
      const { mutedUntil } = await messagesDb.marcarLido(
        me.id,
        { conversationId: req.params.id },
        ate,
      );
      gateway.sendToUser(me.id, {
        op: 'READ_STATE_UPDATE',
        d: {
          channelId: null,
          conversationId: req.params.id,
          lastReadMessageId: ate,
          unreadCount: 0,
          mentionCount: 0,
          mutedUntil,
        },
      });
      return reply.code(204).send(null);
    },
  );

  app.route({
    method: ['PUT', 'DELETE'],
    url: '/conversations/:id/mute',
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ until: z.string().datetime().nullish() }).nullish(),
      response: { 204: z.null() },
    },
    handler: async (req, reply) => {
      const me = requireUser(req);
      await exigirMembro(req.params.id, me.id);

      const corpo = req.body as { until?: string | null } | null | undefined;
      const ate = req.method === 'DELETE' || !corpo?.until ? null : new Date(corpo.until);
      await messagesDb.silenciar(me.id, { conversationId: req.params.id }, ate);

      gateway.sendToUser(me.id, {
        op: 'CONVERSATION_UPDATE',
        d: { conversation: await recarregar(req.params.id, me.id) },
      });
      return reply.code(204).send(null);
    },
  });

  /**
   * A chamada da conversa.
   *
   * Mesma infraestrutura da fase 7, sala `conversation:{id}` — e ela **não
   * aparece na lista de canais de voz**: é privada como a conversa. O que a
   * torna privada não é o nome da sala, é esta rota: sem ser membro não sai
   * token, e sem token o SFU não deixa entrar.
   */
  app.post(
    '/conversations/:id/voice/token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            token: z.string(),
            wsUrl: z.string(),
            room: z.string(),
            iceServers: z.array(
              z.object({
                urls: z.array(z.string()),
                username: z.string().optional(),
                credential: z.string().optional(),
              }),
            ),
            canShareScreen: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      await exigirMembro(req.params.id, me.id);

      if (!can(me.permissions, Perm.CONNECT_VOICE)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode entrar em chamadas');
      }
      if (!vozConfigurada()) {
        throw badRequest('VOICE_OFF', 'a chamada não está configurada neste servidor');
      }

      try {
        await garantirSalaDaConversa(req.params.id);
      } catch (err) {
        req.log.error({ err }, 'não consegui criar a sala da conversa no LiveKit');
        throw badRequest('VOICE_OFF', 'a chamada não está disponível agora');
      }

      return {
        token: await tokenDeVoz({
          userId: me.id,
          displayName: me.row.display_name,
          conversationId: req.params.id,
          permissions: me.permissions,
        }),
        wsUrl: config.LIVEKIT_URL as string,
        room: salaDaConversa(req.params.id),
        iceServers: credenciaisTurn(me.id),
        canShareScreen: can(me.permissions, Perm.SHARE_SCREEN),
      };
    },
  );

  /**
   * A conversa como esta pessoa a vê — com o histórico e os contadores dela.
   *
   * Cai para a carga em branco se a lista ainda não a enxerga: pode acontecer
   * na direta recém-criada, e nesse caso "em branco" é exatamente a verdade.
   */
  async function paraMembro(conversationId: string, userId: string, membros: readonly string[]) {
    const lista = await conversationsDb.listarDoUsuario(userId);
    const achada = lista.find((c) => c.id === conversationId);
    if (achada) return toApiConversation(achada);

    const linha = await conversationsDb.porId(conversationId);
    if (!linha) throw notFound('CONVERSATION_NOT_FOUND', 'esta conversa não existe');
    return novaConversa(linha, membros);
  }

  /** A conversa como ela está agora, do ponto de vista de quem perguntou. */
  async function recarregar(conversationId: string, userId: string) {
    const lista = await conversationsDb.listarDoUsuario(userId);
    const achada = lista.find((c) => c.id === conversationId);
    if (!achada) throw notFound('CONVERSATION_NOT_FOUND', 'esta conversa não existe');
    return toApiConversation(achada);
  }
};
