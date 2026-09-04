exports.shorthands = undefined;

// O modelo de dados não previu onde guardar os códigos de recuperação, mas
// docs/04-seguranca.md exige 10 códigos de uso único hasheados com Argon2id.
// Migration aplicada não se edita — cria-se a próxima. Ver docs/03-modelo-de-dados.md.
//
// Consequência de numeração: 011 passa a ser esta tabela. As migrations
// nomeadas nos prompts das fases seguintes andam um: `polls` vira 012,
// `conversations` 013 e `boards` 014.
exports.up = (pgm) => {
  pgm.sql(`
    create table recovery_codes (
      id         uuid primary key default gen_random_uuid(),
      user_id    uuid not null references users(id) on delete cascade,
      code_hash  text not null,
      used_at    timestamptz,
      created_at timestamptz not null default now()
    )
  `);
  pgm.sql(`
    create index recovery_codes_available
      on recovery_codes (user_id) where used_at is null
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table recovery_codes`);
};
