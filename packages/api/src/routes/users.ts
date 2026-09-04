import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { userSchema, roleSchema } from '@trindade/shared';
import { notFound } from '../lib/errors.js';
import * as usersDb from '../db/users.js';
import { toApiRole, toApiUser } from '../services/user-view.js';

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/users',
    { schema: { response: { 200: z.object({ users: z.array(userSchema) }) } } },
    async () => {
      // Os cinco, sempre completo, sem paginação: o elenco é fixo e a lista
      // inteira cabe numa resposta. Ver docs/05-contrato-api.md.
      const linhas = await usersDb.listUsers();
      return { users: linhas.map(({ user, roles }) => toApiUser(user, roles)) };
    },
  );

  app.get(
    '/users/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ user: userSchema, roles: z.array(roleSchema) }) },
      },
    },
    async (req) => {
      const row = await usersDb.findUserById(req.params.id);
      if (!row) throw notFound('USER_NOT_FOUND', 'esta pessoa não existe');
      const roles = await usersDb.findRolesOfUser(row.id);
      return { user: toApiUser(row, roles), roles: roles.map(toApiRole) };
    },
  );
};
