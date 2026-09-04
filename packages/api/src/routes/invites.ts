import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Perm, can, inviteCodeSchema } from '@trindade/shared';
import { forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import * as invitesDb from '../db/invites.js';
import { ipKey, userKey } from '../lib/client-key.js';
import { config } from '../config.js';

/** Sete dias, o que o diálogo promete em texto claro. */
const HORAS_PADRAO = 168;

/**
 * O código.
 *
 * 16 bytes em base64url: 128 bits de aleatoriedade num texto de 22
 * caracteres. Não é para ser bonito de ditar — é um link que se copia, e a
 * prévia pública responde a qualquer código com 200, então adivinhar precisa
 * ser impossível e não só difícil.
 */
function novoCodigo(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * A prévia é pública; o resto exige sessão.
 *
 * As duas coisas moram no mesmo arquivo mas em plugins separados, porque um
 * `addHook('preHandler', …)` só alcança as rotas registradas depois dele — e
 * proteção que depende da ordem das linhas é proteção que um dia se perde.
 */
export const inviteRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/invites/:code/preview',
    {
      config: {
        rateLimit: { max: 20, timeWindow: '15 minutes', keyGenerator: (req) => `inv:${ipKey(req)}` },
      },
      schema: {
        params: z.object({ code: inviteCodeSchema }),
        response: {
          200: z.union([
            z.object({
              valid: z.literal(true),
              serverName: z.string(),
              invitedBy: z.string(),
            }),
            z.object({ valid: z.literal(false) }),
          ]),
        },
      },
    },
    async (req) => {
      const preview = await invitesDb.previewInvite(req.params.code);

      // Inválido devolve 200 com `valid: false`, não 404: um 404 confirmaria
      // que o código não existe e facilitaria enumerar. Ver docs/05-contrato-api.md.
      if (!preview || preview.used || preview.expired) return { valid: false as const };

      // Mostra apenas quem convidou. Nunca quantas pessoas existem, quais
      // canais ou quais nomes — um código vazado não entrega o mapa do lugar.
      return { valid: true as const, serverName: 'Trindade', invitedBy: preview.invitedBy };
    },
  );
};

const conviteSchema = z.object({
  code: z.string(),
  url: z.string(),
  note: z.string().nullable(),
  createdBy: z.string(),
  usedBy: z.string().nullable(),
  usedAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

function paraApi(row: invitesDb.InviteComAutor) {
  return {
    code: row.code,
    url: `${config.WEB_ORIGIN}/convite/${row.code}`,
    note: row.note,
    createdBy: row.created_by_name,
    usedBy: row.used_by_name,
    usedAt: row.used_at ? row.used_at.toISOString() : null,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export const inviteAdminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/invites',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        body: z.object({
          note: z.string().max(120).nullish(),
          expiresInHours: z.coerce.number().int().min(1).max(720).default(HORAS_PADRAO),
        }),
        response: {
          201: z.object({ code: z.string(), url: z.string(), expiresAt: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.CREATE_INVITE)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode convidar pessoas');
      }

      const expiresAt = new Date(Date.now() + req.body.expiresInHours * 3600_000);
      const row = await invitesDb.createInvite({
        code: novoCodigo(),
        createdBy: me.id,
        expiresAt,
        note: req.body.note ?? null,
      });

      return reply.code(201).send({
        code: row.code,
        url: `${config.WEB_ORIGIN}/convite/${row.code}`,
        expiresAt: row.expires_at.toISOString(),
      });
    },
  );

  app.get(
    '/invites',
    { schema: { response: { 200: z.object({ invites: z.array(conviteSchema) }) } } },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.CREATE_INVITE)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode ver os convites');
      }
      return { invites: (await invitesDb.listInvites()).map(paraApi) };
    },
  );

  app.delete(
    '/invites/:code',
    {
      schema: { params: z.object({ code: inviteCodeSchema }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.CREATE_INVITE)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode revogar convites');
      }
      // Convite já usado não se revoga: ele virou uma conta, e apagar o
      // registro só apagaria a memória de quem convidou quem.
      const revogado = await invitesDb.revokeInvite(req.params.code);
      if (!revogado) throw notFound('INVITE_NOT_FOUND', 'esse convite não existe ou já foi usado');
      return reply.code(204).send(null);
    },
  );
};
