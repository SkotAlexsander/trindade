exports.shorthands = undefined;

// Não há tabela de permissão por canal: com cinco pessoas, todo mundo vê todo
// canal. Ver docs/03-modelo-de-dados.md.
exports.up = (pgm) => {
  pgm.sql(`
    create table channels (
      id          uuid primary key default gen_random_uuid(),
      slug        text unique not null check (slug ~ '^[a-z0-9-]{1,32}$'),
      name        text not null,
      topic       text check (char_length(topic) <= 200),
      kind        text not null default 'text' check (kind in ('text','voice')),
      position    int not null default 0,
      category    text,
      archived_at timestamptz,
      created_by  uuid references users(id),
      created_at  timestamptz not null default now()
    )
  `);
  pgm.sql(`
    insert into channels (slug, name, position) values ('geral', 'geral', 0)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table channels`);
};
