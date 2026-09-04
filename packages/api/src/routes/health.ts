import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { healthResponseSchema } from '@trindade/shared';
import { pingDatabase } from '../db/health.js';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    async () => {
      const db = await pingDatabase();
      return { ok: true, db };
    },
  );
};
