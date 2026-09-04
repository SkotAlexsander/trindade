exports.shorthands = undefined;

// `parent_id` é thread; `reply_to_id` é citação no mesmo nível. São coisas
// diferentes. `search_vector` é coluna gerada — sem trigger para esquecer.
exports.up = (pgm) => {
  pgm.sql(`
    create table messages (
      id            uuid primary key default gen_random_uuid(),
      channel_id    uuid not null references channels(id) on delete cascade,
      author_id     uuid not null references users(id),
      parent_id     uuid references messages(id) on delete set null,
      reply_to_id   uuid references messages(id) on delete set null,
      content       text not null check (char_length(content) <= 4000),
      client_nonce  uuid,
      pinned_at     timestamptz,
      edited_at     timestamptz,
      deleted_at    timestamptz,
      created_at    timestamptz not null default now(),
      search_vector tsvector generated always as
                    (to_tsvector('portuguese', content)) stored
    )
  `);
  pgm.sql(`
    create index messages_channel_time
      on messages (channel_id, created_at desc) where deleted_at is null
  `);
  pgm.sql(`
    create index messages_thread
      on messages (parent_id, created_at) where parent_id is not null
  `);
  pgm.sql(`create index messages_search on messages using gin (search_vector)`);
  pgm.sql(`
    create unique index messages_nonce
      on messages (author_id, client_nonce) where client_nonce is not null
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table messages`);
};
