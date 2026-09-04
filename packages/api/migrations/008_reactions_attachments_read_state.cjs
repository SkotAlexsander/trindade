exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    create table reactions (
      message_id uuid not null references messages(id) on delete cascade,
      user_id    uuid not null references users(id) on delete cascade,
      emoji      text not null check (char_length(emoji) <= 32),
      created_at timestamptz not null default now(),
      primary key (message_id, user_id, emoji)
    )
  `);
  // `filename` é o nome original, só para exibir e baixar. A chave no storage
  // nunca usa esse nome — é aleatória.
  pgm.sql(`
    create table attachments (
      id           uuid primary key default gen_random_uuid(),
      message_id   uuid not null references messages(id) on delete cascade,
      storage_key  text not null,
      filename     text not null,
      content_type text not null,
      byte_size    bigint not null,
      width        int,
      height       int,
      blurhash     text,
      created_at   timestamptz not null default now()
    )
  `);
  pgm.sql(`
    create table read_state (
      user_id            uuid not null references users(id) on delete cascade,
      channel_id         uuid not null references channels(id) on delete cascade,
      last_read_message_id uuid references messages(id) on delete set null,
      mention_count      int not null default 0,
      muted_until        timestamptz,
      updated_at         timestamptz not null default now(),
      primary key (user_id, channel_id)
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table read_state`);
  pgm.sql(`drop table attachments`);
  pgm.sql(`drop table reactions`);
};
