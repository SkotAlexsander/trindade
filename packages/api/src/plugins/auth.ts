import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../lib/auth/tokens.js';
import { effectivePermissions } from '../lib/auth/permissions.js';
import { findRolesOfUser, findUserById, type RoleRow, type UserRow } from '../db/users.js';
import { unauthorized } from '../lib/errors.js';

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
  row: UserRow;
  roles: RoleRow[];
  permissions: bigint;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
  interface FastifyInstance {
    /** `preHandler` das rotas que exigem sessão. */
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}

/**
 * Lê o `Authorization: Bearer`, valida a assinatura e carrega cargos e
 * permissões **do banco** a cada requisição.
 *
 * As permissões não vão dentro do JWT de propósito: elas mudam quando alguém
 * troca um cargo, e um token de 15 minutos carregaria permissão velha por até
 * 15 minutos. Ver docs/04-seguranca.md.
 */
export const authPlugin = fp(function authPluginRegister(app: FastifyInstance) {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('NOT_AUTHENTICATED', 'faça login para continuar');
    }

    const claims = await verifyAccessToken(header.slice('Bearer '.length).trim());
    const row = await findUserById(claims.sub);
    if (!row) throw unauthorized('NOT_AUTHENTICATED', 'faça login para continuar');
    if (row.disabled_at) throw unauthorized('ACCOUNT_DISABLED', 'esta conta foi desativada');

    const roles = await findRolesOfUser(row.id);
    req.user = {
      id: row.id,
      sessionId: claims.sid,
      row,
      roles,
      permissions: effectivePermissions(roles),
    };
  });
});

/** Estreita o tipo dentro do handler sem espalhar `!` pelas rotas. */
export function requireUser(req: FastifyRequest): AuthenticatedUser {
  if (!req.user) throw unauthorized('NOT_AUTHENTICATED', 'faça login para continuar');
  return req.user;
}
