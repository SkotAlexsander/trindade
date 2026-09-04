exports.shorthands = undefined;

// `position` é double precision de propósito: arrastar entre duas tarefas vira
// a média das vizinhas, uma linha atualizada em vez de reindexar a coluna.
exports.up = (pgm) => {
  pgm.sql(`
    create table notes (
      channel_id uuid primary key references channels(id) on delete cascade,
      content    text not null default '',
      ydoc       bytea,
      updated_by uuid references users(id),
      updated_at timestamptz not null default now()
    )
  `);
  pgm.sql(`
    create table tasks (
      id          uuid primary key default gen_random_uuid(),
      channel_id  uuid not null references channels(id) on delete cascade,
      title       text not null check (char_length(title) between 1 and 200),
      body        text,
      column_key  text not null default 'todo',
      position    double precision not null,
      assignee_id uuid references users(id) on delete set null,
      due_at      timestamptz,
      source_message_id uuid references messages(id) on delete set null,
      created_by  uuid not null references users(id),
      created_at  timestamptz not null default now(),
      completed_at timestamptz
    )
  `);
  pgm.sql(`create index tasks_board on tasks (channel_id, column_key, position)`);
};

exports.down = (pgm) => {
  pgm.sql(`drop table tasks`);
  pgm.sql(`drop table notes`);
};
