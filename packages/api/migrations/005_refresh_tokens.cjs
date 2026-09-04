exports.shorthands = undefined;

// Não há coluna de IP aqui. De propósito — ver docs/04-seguranca.md.
exports.up = (pgm) => {
  pgm.sql(`
    create table refresh_tokens (
      id          uuid primary key default gen_random_uuid(),
      user_id     uuid not null references users(id) on delete cascade,
      family_id   uuid not null,
      token_hash  text not null unique,
      user_agent  text,
      expires_at  timestamptz not null,
      revoked_at  timestamptz,
      created_at  timestamptz not null default now()
    )
  `);
  pgm.sql(`
    create index refresh_family on refresh_tokens (family_id) where revoked_at is null
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table refresh_tokens`);
};
