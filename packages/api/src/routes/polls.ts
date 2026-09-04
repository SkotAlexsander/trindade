import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { OPCOES_MAX, OPCOES_MIN, Perm, can } from '@trindade/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import { userKey } from '../lib/client-key.js';
import * as pollsDb from '../db/polls.js';
import * as messagesDb from '../db/messages.js';
import * as channelsDb from '../db/channels.js';
import { toApiPoll } from '../services/poll-view.js';
import { toApiMessage } from '../services/message-view.js';
import { anunciarEnquete } from '../services/enquete.js';
import { gateway } from '../ws/index.js';
import * as usersDb from '../db/users.js';
import * as notas from '../services/notas.js';
import { config } from '../config.js';

/**
 * Enquetes.
 *
 * A enquete é uma mensagem: criar uma escreve no canal com `kind = 'poll'` e
 * pendura a pergunta nela. Quem lê o canal vê a enquete no lugar onde ela
 * apareceu, e ela entra na busca e no histórico como qualquer outra coisa.
 *
 * Ver design/08-projeto.md.
 */

const opcaoSchema = z.object({
  id: z.string(),
  label: z.string(),
  count: z.number(),
  voters: z.array(z.string()),
});

const pollSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  channelId: z.string(),
  question: z.string(),
  multiple: z.boolean(),
  anonymous: z.boolean(),
  closesAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdBy: z.string(),
  options: z.array(opcaoSchema),
  myVotes: z.array(z.string()),
  voterCount: z.number(),
});

export const pollRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/channels/:id/polls',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ polls: z.array(pollSchema) }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const enquetes = await pollsDb.listarDoCanal(req.params.id);
      return { polls: enquetes.map((e) => toApiPoll(e, me.id)) };
    },
  );

  /**
   * Criar é escrever no canal — por isso `SEND_MESSAGE` e não uma permissão
   * própria. Uma enquete é uma pergunta feita em voz alta.
   */
  app.post(
    '/channels/:id/polls',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          question: z.string().trim().min(1).max(200),
          // Duas a seis: uma pergunta com sete alternativas é um problema de
          // escopo, não de enquete.
          options: z.array(z.string().trim().min(1).max(80)).min(OPCOES_MIN).max(OPCOES_MAX),
          multiple: z.boolean().default(false),
          anonymous: z.boolean().default(false),
          closesAt: z.string().datetime().nullish(),
          clientNonce: z.string().uuid(),
        }),
        response: { 200: z.object({ poll: pollSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.SEND_MESSAGE)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode escrever neste canal');
      }

      const canal = await channelsDb.findChannelById(req.params.id);
      if (!canal || canal.archived_at) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');

      // Opções repetidas viram uma barra que ninguém sabe qual é qual.
      const limpas = req.body.options.map((o) => o.trim());
      if (new Set(limpas).size !== limpas.length) {
        throw badRequest('POLL_DUPLICATE_OPTION', 'duas opções iguais na mesma enquete');
      }

      const { row, novo } = await messagesDb.createMessage({
        channelId: canal.id,
        authorId: me.id,
        // A pergunta também no `content`: é o que faz a busca achar a enquete
        // e a citação mostrar algo em vez de uma linha vazia.
        content: req.body.question,
        kind: 'poll',
        clientNonce: req.body.clientNonce,
        replyToId: null,
        parentId: null,
      });

      // O mesmo nonce chegando duas vezes é a rede repetindo, não uma enquete
      // nova. A que já existe é a resposta certa — e sem esta checagem a
      // segunda tentativa esbarraria no `unique` de `message_id` com um 500.
      if (!novo) {
        const anterior = await pollsDb.porMensagem(row.id);
        const jaExiste = anterior ? await pollsDb.completa(anterior.id) : null;
        if (jaExiste) return { poll: toApiPoll(jaExiste, me.id) };
      }

      const enquete = await pollsDb.criar({
        messageId: row.id,
        channelId: canal.id,
        question: req.body.question,
        multiple: req.body.multiple,
        anonymous: req.body.anonymous,
        closesAt: req.body.closesAt ? new Date(req.body.closesAt) : null,
        createdBy: me.id,
        opcoes: limpas,
      });

      // A mensagem primeiro: é ela que abre espaço na conversa. A enquete
      // chega em seguida e preenche esse espaço.
      for (const outro of gateway.online()) {
        gateway.sendToUser(outro, {
          op: 'MESSAGE_CREATE',
          d: toApiMessage(row, { meuId: outro, attachments: [] }),
        });
      }
      await anunciarEnquete(enquete.poll.id);

      return { poll: toApiPoll(enquete, me.id) };
    },
  );

  /**
   * Votar de novo substitui o voto inteiro — inclusive por uma lista vazia,
   * que é como se tira o voto. "Desfazer" separado não existe.
   */
  app.put(
    '/polls/:id/vote',
    {
      config: { rateLimit: { max: 300, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ optionIds: z.array(z.string().uuid()).max(OPCOES_MAX) }),
        response: { 200: z.object({ poll: pollSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.SEND_MESSAGE)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode votar neste canal');
      }

      const enquete = await pollsDb.porId(req.params.id);
      if (!enquete) throw notFound('POLL_NOT_FOUND', 'esta enquete não existe');

      // Fechada não recebe voto. A checagem é do servidor porque a interface
      // some com os botões, e sumir com o botão não é controle de acesso.
      // O prazo vale na hora, e não quando o worker passar: o voto que chega
      // um minuto depois do fim é um voto depois do fim.
      const vencida = enquete.closes_at !== null && enquete.closes_at.getTime() <= Date.now();
      if (enquete.closed_at || vencida) {
        throw badRequest('POLL_CLOSED', 'esta enquete está encerrada');
      }
      if (!enquete.multiple && req.body.optionIds.length > 1) {
        throw badRequest('POLL_SINGLE_CHOICE', 'esta enquete aceita uma opção só');
      }
      if (!(await pollsDb.opcoesValidas(enquete.id, req.body.optionIds))) {
        throw badRequest('POLL_BAD_OPTION', 'opção que não é desta enquete');
      }

      await pollsDb.votar({ pollId: enquete.id, userId: me.id, optionIds: req.body.optionIds });
      await anunciarEnquete(enquete.id);

      const completa = await pollsDb.completa(enquete.id);
      if (!completa) throw notFound('POLL_NOT_FOUND', 'esta enquete não existe');
      return { poll: toApiPoll(completa, me.id) };
    },
  );

  /**
   * "Adicionar o resultado às notas".
   *
   * O mesmo gesto das outras duas ferramentas: decisão tomada vira registro
   * sem esforço. Só depois de encerrada — o resultado de uma enquete aberta
   * ainda vai mudar, e nota que muda sozinha não é registro.
   */
  app.post(
    '/polls/:id/para-notas',
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

      const completa = await pollsDb.completa(req.params.id);
      if (!completa) throw notFound('POLL_NOT_FOUND', 'esta enquete não existe');
      if (!completa.poll.closed_at) {
        throw badRequest('POLL_OPEN', 'a enquete ainda está aberta');
      }

      const autor = await usersDb.findUserById(completa.poll.created_by);
      const canal = await channelsDb.findChannelById(completa.poll.channel_id);

      await notas.citarMensagem({
        channelId: completa.poll.channel_id,
        userId: me.id,
        texto: resumoDoResultado(completa),
        autor: autor?.display_name ?? 'Alguém',
        link: `${config.WEB_ORIGIN}/c/${canal?.slug ?? ''}?m=${completa.poll.message_id}`,
        log: app.log,
      });

      return { ok: true };
    },
  );

  /** Fechar é só de quem criou: a pergunta é dela. */
  app.post(
    '/polls/:id/close',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ poll: pollSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const enquete = await pollsDb.porId(req.params.id);
      if (!enquete) throw notFound('POLL_NOT_FOUND', 'esta enquete não existe');
      if (enquete.created_by !== me.id) {
        throw forbidden('MISSING_PERMISSION', 'só quem criou a enquete pode encerrá-la');
      }

      await pollsDb.fechar(enquete.id);
      await anunciarEnquete(enquete.id);

      const completa = await pollsDb.completa(enquete.id);
      if (!completa) throw notFound('POLL_NOT_FOUND', 'esta enquete não existe');
      return { poll: toApiPoll(completa, me.id) };
    },
  );
};

/**
 * "Janela de deploy?" e a linha de cada opção, da mais votada para a menos.
 *
 * Sem porcentagem: com cinco pessoas o número absoluto é o que se lê, e
 * "60%" de cinco é uma precisão inventada.
 */
function resumoDoResultado(completa: pollsDb.EnqueteCompleta): string {
  const { poll, options, votes } = completa;
  const linhas = options
    .map((o) => ({ label: o.label, count: votes.filter((v) => v.option_id === o.id).length }))
    .sort((a, b) => b.count - a.count)
    .map((o) => `${o.label} — ${o.count === 1 ? '1 voto' : `${o.count} votos`}`);

  return [poll.question, ...linhas].join('\n');
}
