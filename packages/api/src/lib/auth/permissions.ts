import { Perm, can, combinePermissions } from '@trindade/shared';
import { forbidden } from '../errors.js';

export { Perm, can, combinePermissions };

export interface RoleLike {
  id: string;
  position: number;
  permissions: string;
}

/** O `OR` de todos os cargos. Ver docs/03-modelo-de-dados.md. */
export function effectivePermissions(roles: readonly RoleLike[]): bigint {
  return combinePermissions(roles);
}

/** Zero se a pessoa não tem cargo nenhum. */
export function highestPosition(roles: readonly RoleLike[]): number {
  return roles.reduce((max, role) => (role.position > max ? role.position : max), 0);
}

export function requirePermission(perms: bigint, need: bigint, message: string): void {
  if (!can(perms, need)) throw forbidden('MISSING_PERMISSION', message);
}

/**
 * Regra 1 de hierarquia: ninguém atribui, edita ou apaga cargo de `position`
 * maior ou igual ao seu maior cargo.
 *
 * Sem ela, `MANAGE_ROLES` é equivalente a `ADMINISTRATOR`: bastam dois cliques
 * para se dar o cargo de administrador. Ver docs/04-seguranca.md.
 *
 * `ADMINISTRATOR` não isenta desta checagem — se isentasse, a regra não teria
 * efeito nenhum sobre quem já é administrador, que é justamente quem pode
 * causar mais estrago se a conta for tomada.
 */
export function assertCanManageRole(actorRoles: readonly RoleLike[], targetPosition: number): void {
  if (targetPosition >= highestPosition(actorRoles)) {
    throw forbidden('HIERARCHY_VIOLATION', 'você não pode mexer num cargo igual ou acima do seu');
  }
}

/** Regra 2: ninguém desativa alguém cujo maior cargo seja maior ou igual ao seu. */
export function assertCanManageUser(
  actorRoles: readonly RoleLike[],
  targetRoles: readonly RoleLike[],
): void {
  if (highestPosition(targetRoles) >= highestPosition(actorRoles)) {
    throw forbidden('HIERARCHY_VIOLATION', 'você não pode mexer em alguém igual ou acima de você');
  }
}
