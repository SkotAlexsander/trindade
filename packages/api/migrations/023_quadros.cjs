exports.shorthands = undefined;

/*
 * O quadro branco. Vários por canal — diferente das notas, que são uma só.
 *
 * `ydoc` é o estado de verdade, o mesmo CRDT das notas: duas pessoas desenhando
 * ao mesmo tempo convergem sem ninguém perder traço. Não há cópia em JSON ao
 * lado dele; um quadro não entra na busca, e manter duas verdades para o mesmo
 * desenho é como elas divergem.
 *
 * `updated_by` não estava no design (que previa só `created_by`): a lista mostra
 * "Ana · há 2 h", e quem interessa ali é quem mexeu por último, não quem criou o
 * quadro há três meses.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table boards (
      id            uuid primary key default gen_random_uuid(),
      channel_id    uuid not null references channels(id) on delete cascade,
      name          text not null check (char_length(name) between 1 and 48),
      ydoc          bytea,
      thumbnail_key text,
      created_by    uuid references users(id) on delete set null,
      created_at    timestamptz not null default now(),
      updated_by    uuid references users(id) on delete set null,
      updated_at    timestamptz not null default now(),
      archived_at   timestamptz
    )
  `);

  // Índice parcial: a lista do painel só pede os que não foram arquivados, e o
  // quadro arquivado existe apenas para não perder o desenho.
  pgm.sql(`
    create index boards_channel on boards (channel_id, updated_at desc)
     where archived_at is null
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table boards`);
};
