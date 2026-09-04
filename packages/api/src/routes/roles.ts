import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  Perm,
  TODAS_AS_PERMISSOES,
  abrange,
  can,
  hexColorSchema,
  permissionsSchema,
  roleSchema,
} from '@trindade/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import { alcanceDe, exigirAlcanceSobreCargo } from '../lib/hierarquia.js';
import * as rolesDb from '../db/roles.js';
import { toApiRole } from '../services/user-view.js';
import { avisarPessoa } from '../services/aviso-de-cargo.js';

const nomeDoCargo = z.string().min(1).max(24);

/**
 * Nenhum bit fora dos que existem.
 *
 * Sem esta checagem, um cliente poderia gravar um bit da faixa reservada
 * (14 a 61) e, no dia em que essa faixa virasse uma permissão nova, o cargo
 * teria ganhado a permissão sozinho. Ver `perms.ts`.
 */
function permissoesValidas(bruto: string): bigint {
  let valor: bigint;
  try {
    valor = BigInt(bruto);
  } catch {
    throw badRequest('INVALID_PERMISSIONS', 'permissões inválidas');
  }
  if (valor < 0n || (valor & ~TODAS_AS_PERMISSOES) !== 0n) {
    throw badRequest('INVALID_PERMISSIONS', 'há bits de permissão que não existem');
  }
  return valor;
}

export const roleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /**
   * Listar é liberado a qualquer pessoa autenticada, e de propósito: o chip de
   * cargo no cartão de perfil precisa do nome e da cor de todo mundo. Nada
   * aqui é segredo — o segredo seria poder **mudar**.
   */
  app.get(
    '/roles',
    { schema: { response: { 200: z.object({ roles: z.array(roleSchema) }) } } },
    async () => ({ roles: (await rolesDb.listRoles()).map(toApiRole) }),
  );

  function exigirGestao(permissoes: bigint): void {
    if (!can(permissoes, Perm.MANAGE_ROLES)) {
      throw forbidden('MISSING_PERMISSION', 'você não pode gerenciar cargos');
    }
  }

  app.post(
    '/roles',
    {
      schema: {
        body: z.object({
          name: nomeDoCargo,
          color: hexColorSchema.nullish(),
          permissions: permissionsSchema.default('0'),
        }),
        response: { 201: z.object({ role: roleSchema }) },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);
      exigirGestao(me.permissions);

      const permissoes = permissoesValidas(req.body.permissions);
      // Não se cria um cargo com permissão que você mesmo não tem: seria dar a
      // volta na hierarquia criando o cargo e vestindo-o em seguida.
      if (!abrange(me.permissions, permissoes)) {
        throw forbidden(
          'HIERARCHY_VIOLATION',
          'você não pode dar a um cargo permissões que você mesmo não tem',
        );
      }

      // Nasce logo abaixo de quem criou. Nascer no topo daria a qualquer
      // gestor de cargos um caminho de uma linha até o poder máximo.
      const meu = await alcanceDe(me);
      const existentes = await rolesDb.listRoles();
      const teto = Number.isFinite(meu) ? meu : (existentes[0]?.position ?? 0) + 1;
      const posicao = Math.max(0, teto - 1);

      const row = await rolesDb.createRole({
        name: req.body.name,
        color: req.body.color ?? null,
        permissions: permissoes,
        position: posicao,
      });
      return reply.code(201).send({ role: toApiRole(row) });
    },
  );

  app.patch(
    '/roles/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: nomeDoCargo.optional(),
          color: hexColorSchema.nullish(),
          permissions: permissionsSchema.optional(),
        }),
        response: { 200: z.object({ role: roleSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      exigirGestao(me.permissions);

      const atual = await rolesDb.findRoleById(req.params.id);
      if (!atual) throw notFound('ROLE_NOT_FOUND', 'este cargo não existe');
      await exigirAlcanceSobreCargo(me, [atual]);

      const permissoes =
        req.body.permissions !== undefined ? permissoesValidas(req.body.permissions) : undefined;
      if (permissoes !== undefined && !abrange(me.permissions, permissoes)) {
        throw forbidden(
          'HIERARCHY_VIOLATION',
          'você não pode dar a um cargo permissões que você mesmo não tem',
        );
      }

      const row = await rolesDb.updateRole(req.params.id, {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.color !== undefined ? { color: req.body.color ?? null } : {}),
        ...(permissoes !== undefined ? { permissions: permissoes } : {}),
      });
      if (!row) throw notFound('ROLE_NOT_FOUND', 'este cargo não existe');

      // Quem tem o cargo passa a poder mais, ou menos, agora — não daqui a um
      // minuto. `USER_UPDATE` leva a cor e o nome novos para todo mundo.
      await avisarQuemTem(row.id);
      return { role: toApiRole(row) };
    },
  );

  /**
   * A ordem da lista **é** a hierarquia, então reordenar é uma operação de
   * permissão, não de aparência. Vai numa chamada só: mandar uma posição por
   * vez deixaria a lista passar por estados intermediários em que dois cargos
   * empatam, e é a comparação de posições que autoriza quem mexe em quem.
   */
  app.put(
    '/roles/order',
    {
      schema: {
        body: z.object({ roleIds: z.array(z.string().uuid()).min(1).max(50) }),
        response: { 200: z.object({ roles: z.array(roleSchema) }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      exigirGestao(me.permissions);

      const todos = await rolesDb.listRoles();
      if (req.body.roleIds.length !== todos.length) {
        throw badRequest('INCOMPLETE_ORDER', 'mande a lista inteira, na ordem final');
      }
      const conhecidos = new Set(todos.map((r) => r.id));
      if (req.body.roleIds.some((id) => !conhecidos.has(id))) {
        throw badRequest('ROLE_NOT_FOUND', 'algum desses cargos não existe');
      }

      const meu = await alcanceDe(me);
      // Nem a posição de onde saiu, nem a posição para onde vai: arrastar um
      // cargo abaixo do seu para cima do seu é a mesma promoção proibida,
      // escrita de outro jeito.
      const total = req.body.roleIds.length;
      for (const [i, id] of req.body.roleIds.entries()) {
        const antes = todos.find((r) => r.id === id);
        const depois = total - i;
        if ((antes && antes.position >= meu) || depois >= meu) {
          throw forbidden(
            'HIERARCHY_VIOLATION',
            'você não pode mexer em cargo no seu nível ou acima',
          );
        }
      }

      return { roles: (await rolesDb.reordenar(req.body.roleIds)).map(toApiRole) };
    },
  );

  app.delete(
    '/roles/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const me = requireUser(req);
      exigirGestao(me.permissions);

      const atual = await rolesDb.findRoleById(req.params.id);
      if (!atual) throw notFound('ROLE_NOT_FOUND', 'este cargo não existe');
      if (atual.is_default) {
        throw badRequest('DEFAULT_ROLE', 'o cargo padrão não pode ser apagado');
      }
      await exigirAlcanceSobreCargo(me, [atual]);

      const afetados = await rolesDb.quemTem(atual.id);
      const removido = await rolesDb.deleteRole(atual.id);
      if (!removido) throw notFound('ROLE_NOT_FOUND', 'este cargo não existe');

      // O `on delete cascade` já tirou o cargo de quem o tinha; falta contar
      // isso a essas pessoas antes que elas cliquem em algo que já não podem.
      for (const userId of afetados) await avisarPessoa(userId);
      return reply.code(204).send(null);
    },
  );
};

async function avisarQuemTem(roleId: string): Promise<void> {
  for (const userId of await rolesDb.quemTem(roleId)) await avisarPessoa(userId);
}
