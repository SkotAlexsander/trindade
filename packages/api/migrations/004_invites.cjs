exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    create table invites (
      code        text primary key check (char_length(code) between 8 and 32),
      created_by  uuid not null references users(id),
      used_by     uuid references users(id),
      used_at     timestamptz,
      expires_at  timestamptz not null,
      note        text,
      created_at  timestamptz not null default now()
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table invites`);
};
