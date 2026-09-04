import { sql } from './index.js';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
}

export async function anyUserExists(): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`select exists (select 1 from users) as exists`;
  return rows[0]?.exists ?? false;
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
      returning id, username, display_name
    `;
    const user = inserted[0];
    if (!user) throw new Error('insert de usuário não devolveu linha');

    const roles = await tx<{ id: string }[]>`
      select id from roles where name = ${input.roleName}
    `;
    const role = roles[0];
    if (!role) throw new Error(`cargo ${input.roleName} não existe — rode as migrations`);

    await tx`
      insert into user_roles (user_id, role_id) values (${user.id}, ${role.id})
    `;
    return user;
  });
}
