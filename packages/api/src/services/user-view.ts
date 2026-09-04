import type { Role, User } from '@trindade/shared';
import type { RoleRow, UserRow } from '../db/users.js';

/**
 * Converte linha do banco no formato do contrato. Ponto único: se cada rota
 * montasse o objeto à mão, uma delas acabaria devolvendo `password_hash`.
 */
export function toApiRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    position: row.position,
    permissions: row.permissions,
  };
}

export function toApiUser(row: UserRow, roles: readonly RoleRow[]): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_key ? `/api/files/${row.avatar_key}` : null,
    avatarBlurhash: row.avatar_blurhash,
    bio: row.bio,
    accentColor: row.accent_color,
    status: row.status,
    customStatus: row.custom_status,
    roles: roles.map(toApiRole),
    disabled: row.disabled_at !== null,
    createdAt: row.created_at.toISOString(),
  };
}
