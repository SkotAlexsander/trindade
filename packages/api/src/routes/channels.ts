import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { channelSchema, channelSlugSchema, channelKindSchema, Perm } from '@trindade/shared';
import { conflict, notFound } from '../lib/errors.js';
import { requirePermission } from '../lib/auth/permissions.js';
import { requireUser } from '../plugins/auth.js';
import * as channelsDb from '../db/channels.js';
import { toApiChannel } from '../services/channel-view.js';

const listaResposta = z.object({ channels: z.array(channelSchema) });

export const channelRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/channels',
    { schema: { response: { 200: listaResposta } } },
    async () => {
      // Não há ACL por canal: com cinco pessoas, todo mundo vê todo canal.
      // Ver docs/03-modelo-de-dados.md.
      const rows = await channelsDb.listChannels();
      return { channels: rows.map(toApiChannel) };
    },
  );

  app.post(
    '/channels',
    {
      schema: {
        body: z.object({
          name: z.string().min(1).max(32),
          slug: channelSlugSchema,
          kind: channelKindSchema.default('text'),
          topic: z.string().max(200).nullable().default(null),
          category: z.string().max(32).nullable().default(null),
        }),
        response: { 201: z.object({ channel: channelSchema }) },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);
      requirePermission(me.permissions, Perm.MANAGE_CHANNEL, 'você não pode criar canais');

      if (await channelsDb.slugTaken(req.body.slug)) {
        throw conflict('SLUG_TAKEN', 'já existe um canal com esse endereço');
      }

      const row = await channelsDb.createChannel({ ...req.body, createdBy: me.id });
      return reply.code(201).send({ channel: toApiChannel(row) });
    },
  );

  app.patch(
    '/channels/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(1).max(32).optional(),
          topic: z.string().max(200).nullable().optional(),
          category: z.string().max(32).nullable().optional(),
        }),
        response: { 200: z.object({ channel: channelSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      requirePermission(me.permissions, Perm.MANAGE_CHANNEL, 'você não pode editar canais');

      const row = await channelsDb.updateChannel(req.params.id, req.body);
      if (!row) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');
      return { channel: toApiChannel(row) };
    },
  );

  // `reorder` vem antes de `:id/...` de propósito: registrada depois, a rota
  // com parâmetro capturaria "reorder" como se fosse um id.
  app.patch(
    '/channels/reorder',
    {
      schema: {
        body: z.object({
          order: z.array(
            z.object({
              id: z.string().uuid(),
              position: z.number().int().min(0),
              category: z.string().max(32).nullable(),
            }),
          ),
        }),
        response: { 200: listaResposta },
      },
    },
    async (req) => {
      const me = requireUser(req);
      requirePermission(me.permissions, Perm.MANAGE_CHANNEL, 'você não pode reordenar canais');

      await channelsDb.reorderChannels(req.body.order);
      const rows = await channelsDb.listChannels();
      return { channels: rows.map(toApiChannel) };
    },
  );

  for (const [caminho, arquivar] of [
    ['/channels/:id/archive', true],
    ['/channels/:id/unarchive', false],
  ] as const) {
    app.post(
      caminho,
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          response: { 200: z.object({ channel: channelSchema }) },
        },
      },
      async (req) => {
        const me = requireUser(req);
        requirePermission(me.permissions, Perm.MANAGE_CHANNEL, 'você não pode arquivar canais');

        const row = await channelsDb.setArchived(req.params.id, arquivar);
        if (!row) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');
        return { channel: toApiChannel(row) };
      },
    );
  }
};
