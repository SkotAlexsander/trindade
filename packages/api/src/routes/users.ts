import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CLOSE, Perm, can, userSchema, roleSchema } from '@trindade/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import { exigirAlcanceSobreCargo, exigirAlcanceSobrePessoa } from '../lib/hierarquia.js';
import { effectivePermissions } from '../lib/auth/permissions.js';
import * as usersDb from '../db/users.js';
import * as rolesDb from '../db/roles.js';
import { toApiRole, toApiUser } from '../services/user-view.js';
import { gateway } from '../ws/index.js';

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

  /**
   * Substitui o conjunto inteiro de cargos.
   *
   * Duas checagens de hierarquia, e nenhuma das duas é opcional: **sobre a
   * pessoa**, para ninguém rebaixar quem está acima; e **sobre cada cargo
   * pedido**, para ninguém se promover. Sem a segunda, `MANAGE_ROLES` seria
   * `ADMINISTRATOR` com passos extras.
   */
  app.patch(
    '/users/:id/roles',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ roleIds: z.array(z.string().uuid()).max(20) }),
        response: { 200: z.object({ user: userSchema, roles: z.array(roleSchema) }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_ROLES)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode gerenciar cargos');
      }

      const alvo = await usersDb.findUserById(req.params.id);
      if (!alvo) throw notFound('USER_NOT_FOUND', 'esta pessoa não existe');

      await exigirAlcanceSobrePessoa(me, alvo.id);

      const pedidos = await rolesDb.findRolesByIds(req.body.roleIds);
      if (pedidos.length !== req.body.roleIds.length) {
        throw badRequest('ROLE_NOT_FOUND', 'algum desses cargos não existe');
      }
      await exigirAlcanceSobreCargo(me, pedidos);

      const novos = await usersDb.setRolesOfUser(alvo.id, req.body.roleIds, me.id);
      const usuario = toApiUser(alvo, novos);
      gateway.broadcast({ op: 'USER_UPDATE', d: usuario });
      // A pessoa afetada recebe a permissão nova sem recarregar, e o
      // `conn.permissions` do socket dela é atualizado junto — é ele que
      // autoriza cada evento que chega por ali. A revalidação de 60s faria
      // isso sozinha; um minuto com a permissão antiga valendo é tempo demais.
      gateway.avisarPermissoes(alvo.id, effectivePermissions(novos));
      return { user: usuario, roles: novos.map(toApiRole) };
    },
  );

  for (const [caminho, desativar] of [['disable', true], ['enable', false]] as const) {
    app.post(
      `/users/:id/${caminho}`,
      {
        schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
      },
      async (req, reply) => {
        const me = requireUser(req);
        if (!can(me.permissions, Perm.MANAGE_MEMBERS)) {
          throw forbidden('MISSING_PERMISSION', 'você não pode gerenciar pessoas');
        }
        const params = req.params as { id: string };
        const alvo = await usersDb.findUserById(params.id);
        if (!alvo) throw notFound('USER_NOT_FOUND', 'esta pessoa não existe');

        await exigirAlcanceSobrePessoa(me, alvo.id);

        const linha = await usersDb.setDisabled(alvo.id, desativar);
        if (!linha) throw notFound('USER_NOT_FOUND', 'esta pessoa não existe');

        const roles = await usersDb.findRolesOfUser(alvo.id);
        gateway.broadcast({ op: 'USER_UPDATE', d: toApiUser(linha, roles) });

        // Desativar não pode esperar a revalidação de 60s: enquanto o socket
        // está de pé, a pessoa continua lendo tudo o que passa.
        if (desativar) gateway.derrubar(alvo.id, CLOSE.ACCOUNT_DISABLED, 'ACCOUNT_DISABLED');

        return reply.code(204).send(null);
      },
    );
  }
};
