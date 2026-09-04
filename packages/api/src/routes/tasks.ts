import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { COLUNAS, Perm, can } from '@trindade/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import { userKey } from '../lib/client-key.js';
import * as tasksDb from '../db/tasks.js';
import * as channelsDb from '../db/channels.js';
import { toApiTask } from '../services/task-view.js';
import { anunciarTarefa, concluirNoCanal } from '../services/quadro.js';

/**
 * O quadro de tarefas.
 *
 * Três colunas fixas e nenhum campo além de título, dono e prazo: cada campo a
 * mais é uma decisão que alguém precisa tomar ao criar, e a fricção mata o uso.
 * Ver design/08-projeto.md.
 */

const colunaSchema = z.enum(COLUNAS);

const taskSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  columnKey: colunaSchema,
  position: z.number(),
  assigneeId: z.string().nullable(),
  dueAt: z.string().nullable(),
  sourceMessageId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const taskRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/channels/:id/tasks',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ tasks: z.array(taskSchema) }) },
      },
    },
    async (req) => {
      requireUser(req);
      const linhas = await tasksDb.listar(req.params.id);
      return { tasks: linhas.map(toApiTask) };
    },
  );

  app.post(
    '/channels/:id/tasks',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          title: z.string().trim().min(1).max(200),
          body: z.string().max(4000).nullish(),
          columnKey: colunaSchema.default('todo'),
          assigneeId: z.string().uuid().nullish(),
          dueAt: z.string().datetime().nullish(),
          sourceMessageId: z.string().uuid().nullish(),
        }),
        response: { 200: z.object({ task: taskSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_TASKS)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode mexer nas tarefas');
      }

      const canal = await channelsDb.findChannelById(req.params.id);
      if (!canal || canal.archived_at) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');

      const linha = await tasksDb.criar({
        channelId: canal.id,
        title: req.body.title,
        body: req.body.body ?? null,
        columnKey: req.body.columnKey,
        assigneeId: req.body.assigneeId ?? null,
        dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
        sourceMessageId: req.body.sourceMessageId ?? null,
        createdBy: me.id,
      });

      anunciarTarefa(linha);
      return { task: toApiTask(linha) };
    },
  );

  /**
   * Mover é `PATCH` com `columnKey` e `position`, e a posição é a média das
   * vizinhas — calculada no cliente, que é quem sabe entre quais cartões a
   * tarefa foi solta.
   */
  app.patch(
    '/tasks/:id',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          title: z.string().trim().min(1).max(200).optional(),
          body: z.string().max(4000).nullish(),
          columnKey: colunaSchema.optional(),
          position: z.number().finite().optional(),
          assigneeId: z.string().uuid().nullish(),
          dueAt: z.string().datetime().nullish(),
          concluida: z.boolean().optional(),
        }),
        response: { 200: z.object({ task: taskSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_TASKS)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode mexer nas tarefas');
      }

      const antes = await tasksDb.porId(req.params.id);
      if (!antes) throw notFound('TASK_NOT_FOUND', 'esta tarefa não existe');

      const mudanca: tasksDb.Mudanca = {};
      if (req.body.title !== undefined) mudanca.title = req.body.title;
      if (req.body.body !== undefined) mudanca.body = req.body.body ?? null;
      if (req.body.columnKey !== undefined) mudanca.columnKey = req.body.columnKey;
      if (req.body.position !== undefined) mudanca.position = req.body.position;
      if (req.body.assigneeId !== undefined) mudanca.assigneeId = req.body.assigneeId ?? null;
      if (req.body.dueAt !== undefined) {
        mudanca.dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
      }
      if (req.body.concluida !== undefined) mudanca.concluida = req.body.concluida;

      const depois = await tasksDb.alterar(req.params.id, mudanca);
      if (!depois) throw badRequest('TASK_NOT_UPDATED', 'não consegui alterar esta tarefa');

      anunciarTarefa(depois);

      /* A linha no canal sai só na **transição** para concluída. Sem essa
         checagem, arrastar um cartão dentro da coluna "Feito" anunciaria a
         mesma conclusão de novo, e o canal viraria eco do quadro. */
      if (!antes.completed_at && depois.completed_at) {
        await concluirNoCanal(depois, me.id, app);
      }

      return { task: toApiTask(depois) };
    },
  );

  app.delete(
    '/tasks/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_TASKS)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode mexer nas tarefas');
      }

      const tarefa = await tasksDb.porId(req.params.id);
      if (!tarefa) throw notFound('TASK_NOT_FOUND', 'esta tarefa não existe');

      // Concluída não se apaga: é o registro do que o grupo fez. O que se apaga
      // é o que nunca aconteceu.
      if (tarefa.completed_at) {
        throw badRequest('TASK_DONE', 'tarefa concluída fica no histórico');
      }

      await tasksDb.apagar(req.params.id);
      anunciarTarefa(tarefa, true);
      return { ok: true };
    },
  );
};
