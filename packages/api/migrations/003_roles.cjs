exports.shorthands = undefined;

// Bits 0–4 (SEND_MESSAGE, DELETE_OWN_MESSAGE, DELETE_ANY_MESSAGE, PIN_MESSAGE,
// ATTACH_FILE) = 31, mais bits 8–10 (CREATE_INVITE, CONNECT_VOICE,
// SHARE_SCREEN) = 1792. Total 1823. Ver docs/03-modelo-de-dados.md.
const MEMBER_PERMISSIONS = '1823';
// ADMINISTRATOR = bit 62.
const ADMIN_PERMISSIONS = '4611686018427387904';

exports.up = (pgm) => {
  pgm.sql(`
    create table roles (
      id          uuid primary key default gen_random_uuid(),
      name        text not null check (char_length(name) between 1 and 24),
      color       text check (color ~ '^#[0-9a-f]{6}$'),
      position    int not null default 0,
      permissions bigint not null default 0,
      is_default  boolean not null default false,
      created_at  timestamptz not null default now()
    )
  `);
  pgm.sql(`
    create unique index roles_one_default
      on roles (is_default) where is_default
  `);
  pgm.sql(`
    create table user_roles (
      user_id uuid not null references users(id) on delete cascade,
      role_id uuid not null references roles(id) on delete cascade,
      granted_by uuid references users(id),
      granted_at timestamptz not null default now(),
      primary key (user_id, role_id)
    )
  `);

  pgm.sql(`
    insert into roles (name, position, permissions, is_default)
    values ('Membro', 0, ${MEMBER_PERMISSIONS}, true)
  `);
  pgm.sql(`
    insert into roles (name, position, permissions, is_default)
    values ('Admin', 100, ${ADMIN_PERMISSIONS}, false)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table user_roles`);
  pgm.sql(`drop table roles`);
};
