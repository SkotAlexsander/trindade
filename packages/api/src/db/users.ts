import { sql } from './index.js';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_key: string | null;
  bio: string | null;
  accent_color: string | null;
  status: 'online' | 'idle' | 'busy' | 'invisible' | 'offline';
  custom_status: string | null;
  disabled_at: Date | null;
  totp_secret: string | null;
  totp_enabled_at: Date | null;
  password_hash: string;
  created_at: Date;
}

export interface RoleRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: string;
  is_default: boolean;
}

const USER_COLUMNS = sql`
  id, username, display_name, avatar_key, bio, accent_color, status,
  custom_status, disabled_at, totp_secret, totp_enabled_at, password_hash, created_at
`;

export async function anyUserExists(): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`select exists (select 1 from users) as exists`;
  return rows[0]?.exists ?? false;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
    select ${USER_COLUMNS} from users where username = ${username}
  `;
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`select ${USER_COLUMNS} from users where id = ${id}`;
  return rows[0] ?? null;
}

export async function usernameTaken(username: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select exists (select 1 from users where username = ${username}) as exists
  `;
  return rows[0]?.exists ?? false;
}

/** `permissions` volta como string: bigint não sobrevive ao JSON. */
export async function findRolesOfUser(userId: string): Promise<RoleRow[]> {
  return sql<RoleRow[]>`
    select r.id, r.name, r.color, r.position, r.permissions::text as permissions, r.is_default
    from roles r
    join user_roles ur on ur.role_id = r.id
    where ur.user_id = ${userId}
    order by r.position desc
  `;
}

/**
 * Todo mundo, com os cargos de cada um, em duas consultas.
 *
 * Um `join` só devolveria uma linha por par pessoa-cargo e obrigaria a
 * remontar em memória; com cinco pessoas, duas consultas simples são mais
 * claras e igualmente rápidas.
 */
export async function listUsers(): Promise<Array<{ user: UserRow; roles: RoleRow[] }>> {
  const users = await sql<UserRow[]>`
    select ${USER_COLUMNS} from users order by display_name
  `;
  const vinculos = await sql<Array<RoleRow & { user_id: string }>>`
    select ur.user_id, r.id, r.name, r.color, r.position,
           r.permissions::text as permissions, r.is_default
    from roles r join user_roles ur on ur.role_id = r.id
    order by r.position desc
  `;

  const porUsuario = new Map<string, RoleRow[]>();
  for (const vinculo of vinculos) {
    const lista = porUsuario.get(vinculo.user_id) ?? [];
    lista.push(vinculo);
    porUsuario.set(vinculo.user_id, lista);
  }

  return users.map((user) => ({ user, roles: porUsuario.get(user.id) ?? [] }));
}

export async function findDefaultRole(): Promise<RoleRow | null> {
  const rows = await sql<RoleRow[]>`
    select id, name, color, position, permissions::text as permissions, is_default
    from roles where is_default limit 1
  `;
  return rows[0] ?? null;
}

/**
 * Registro e consumo do convite numa transação só: sem ela, duas requisições
 * simultâneas com o mesmo código criariam duas contas.
 */
export async function createUserFromInvite(input: {
  code: string;
  username: string;
  displayName: string;
  passwordHash: string;
}): Promise<{ user: UserRow; roles: RoleRow[] } | { error: 'INVITE_USED' | 'USERNAME_TAKEN' }> {
  return sql.begin(async (tx) => {
    // `for update` segura a linha do convite até o fim da transação.
    const invites = await tx<{ code: string; used_by: string | null; expires_at: Date }[]>`
      select code, used_by, expires_at from invites where code = ${input.code} for update
    `;
    const invite = invites[0];
    if (!invite || invite.used_by) return { error: 'INVITE_USED' as const };

    const taken = await tx<{ exists: boolean }[]>`
      select exists (select 1 from users where username = ${input.username}) as exists
    `;
    if (taken[0]?.exists) return { error: 'USERNAME_TAKEN' as const };

    const inserted = await tx<UserRow[]>`
      insert into users (username, display_name, password_hash)
      values (${input.username}, ${input.displayName}, ${input.passwordHash})
      returning ${USER_COLUMNS}
    `;
    const user = inserted[0];
    if (!user) throw new Error('insert de usuário não devolveu linha');

    const defaults = await tx<RoleRow[]>`
      select id, name, color, position, permissions::text as permissions, is_default
      from roles where is_default limit 1
    `;
    const role = defaults[0];
    if (!role) throw new Error('não existe cargo padrão — rode as migrations');

    await tx`insert into user_roles (user_id, role_id) values (${user.id}, ${role.id})`;
    await tx`
      update invites set used_by = ${user.id}, used_at = now() where code = ${input.code}
    `;

    return { user, roles: [role] };
  });
}

export async function createUserWithRole(input: {
  username: string;
  displayName: string;
  passwordHash: string;
  roleName: string;
}): Promise<UserRow> {
  return sql.begin(async (tx) => {
    const inserted = await tx<UserRow[]>`
      insert into users (username, display_name, password_hash)
      values (${input.username}, ${input.displayName}, ${input.passwordHash})
      returning ${USER_COLUMNS}
    `;
    const user = inserted[0];
    if (!user) throw new Error('insert de usuário não devolveu linha');

    const roles = await tx<{ id: string }[]>`select id from roles where name = ${input.roleName}`;
    const role = roles[0];
    if (!role) throw new Error(`cargo ${input.roleName} não existe — rode as migrations`);

    await tx`insert into user_roles (user_id, role_id) values (${user.id}, ${role.id})`;
    return user;
  });
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await sql`
    update users set password_hash = ${passwordHash}, updated_at = now() where id = ${userId}
  `;
}

export async function setTotpSecret(userId: string, encrypted: string | null): Promise<void> {
  await sql`
    update users set totp_secret = ${encrypted}, updated_at = now() where id = ${userId}
  `;
}

export async function enableTotp(userId: string): Promise<void> {
  await sql`
    update users set totp_enabled_at = now(), updated_at = now() where id = ${userId}
  `;
}

export async function disableTotp(userId: string): Promise<void> {
  await sql`
    update users
    set totp_secret = null, totp_enabled_at = null, updated_at = now()
    where id = ${userId}
  `;
}
