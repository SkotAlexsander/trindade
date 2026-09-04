import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { healthResponseSchema } from '@trindade/shared';
import { pingDatabase } from '../db/health.js';
import { pingStorage, storageConfigurado } from '../lib/storage.js';

/**
 * Saúde de verdade: toca banco e storage.
 *
 * Um health check que só responde 200 mede se o Node está vivo, e o Node vive
 * muito bem com o banco fora do ar. Quando alguma dependência falha, a resposta
 * é **503** — é isso que faz um balanceador ou um alerta reagirem.
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (_req, reply) => {
      const [db, storage] = await Promise.all([
        pingDatabase(),
        storageConfigurado() ? pingStorage() : Promise.resolve(null),
      ]);

      // Storage não configurado não derruba a saúde: servidor sem anexos é uma
      // escolha legítima. Configurado e fora do ar, sim.
      const ok = db && storage !== false;
      return reply.code(ok ? 200 : 503).send({ ok, db, storage });
    },
  );
};
