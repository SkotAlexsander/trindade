exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    create table users (
      id             uuid primary key default gen_random_uuid(),
      username       citext unique not null
                     check (username ~ '^[a-z0-9_]{3,24}$'),
      display_name   text not null check (char_length(display_name) between 1 and 32),
      password_hash  text not null,
      avatar_key     text,
      bio            text check (char_length(bio) <= 280),
      accent_color   text check (accent_color ~ '^#[0-9a-f]{6}$'),
      totp_secret    text,
      totp_enabled_at timestamptz,
      status         text not null default 'offline'
                     check (status in ('online','idle','busy','invisible','offline')),
      custom_status  text check (char_length(custom_status) <= 64),
      disabled_at    timestamptz,
      created_at     timestamptz not null default now(),
      updated_at     timestamptz not null default now()
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table users`);
};
