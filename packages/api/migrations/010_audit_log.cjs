exports.shorthands = undefined;

// Registre só o que tem consequência. Não registre leitura nem navegação.
// Retenção de 180 dias, apagado por tarefa periódica. Sem coluna de IP.
exports.up = (pgm) => {
  pgm.sql(`
    create table audit_log (
      id         bigserial primary key,
      actor_id   uuid references users(id),
      action     text not null,
      target_type text,
      target_id  uuid,
      metadata   jsonb,
      created_at timestamptz not null default now()
    )
  `);
  pgm.sql(`create index audit_recent on audit_log (created_at desc)`);
};

exports.down = (pgm) => {
  pgm.sql(`drop table audit_log`);
};
