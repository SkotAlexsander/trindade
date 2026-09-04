import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { inviteCodeSchema } from '@trindade/shared';
import * as invitesDb from '../db/invites.js';
import { ipKey } from '../lib/client-key.js';

/**
 * Só a prévia pública entra nesta fase — a tela de aceitar convite precisa
 * dela. Gerar, listar e revogar convite é da fase 6, junto com a gestão de
 * pessoas.
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
