// Bitfield de 64 bits. Ver docs/03-modelo-de-dados.md.
// Os bits 14 a 61 ficam livres de propósito: renumerar bitfield depois que
// existe dado é migration com risco real.

export const Perm = {
  SEND_MESSAGE: 1n << 0n,
  DELETE_OWN_MESSAGE: 1n << 1n,
  DELETE_ANY_MESSAGE: 1n << 2n,
  PIN_MESSAGE: 1n << 3n,
  ATTACH_FILE: 1n << 4n,
  MANAGE_CHANNEL: 1n << 5n,
  MANAGE_ROLES: 1n << 6n,
  MANAGE_MEMBERS: 1n << 7n,
  CREATE_INVITE: 1n << 8n,
  CONNECT_VOICE: 1n << 9n,
  SHARE_SCREEN: 1n << 10n,
  MUTE_OTHERS: 1n << 11n,
  MANAGE_NOTES: 1n << 12n,
  MANAGE_TASKS: 1n << 13n,
  ADMINISTRATOR: 1n << 62n,
} as const;

export type PermName = keyof typeof Perm;

/** Permissões do cargo `Membro` do seed: bits 0–4 e 8–10. */
export const DEFAULT_MEMBER_PERMISSIONS =
  Perm.SEND_MESSAGE |
  Perm.DELETE_OWN_MESSAGE |
  Perm.DELETE_ANY_MESSAGE |
  Perm.PIN_MESSAGE |
  Perm.ATTACH_FILE |
  Perm.CREATE_INVITE |
  Perm.CONNECT_VOICE |
  Perm.SHARE_SCREEN;

/**
 * `ADMINISTRATOR` ignora todas as checagens. Esta função é a única forma de
 * perguntar por permissão — no servidor. No cliente ela só decide o que exibir.
 */
export function can(perms: bigint, need: bigint): boolean {
  return (perms & Perm.ADMINISTRATOR) !== 0n || (perms & need) !== 0n;
}

/** O `OR` de todos os cargos da pessoa. */
export function combinePermissions(roles: readonly { permissions: string }[]): bigint {
  return roles.reduce((acc, role) => acc | BigInt(role.permissions), 0n);
}
