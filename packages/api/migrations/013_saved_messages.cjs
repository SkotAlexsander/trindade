exports.shorthands = undefined;

// Favoritar mensagem — "guardar" na interface. Não estava no pacote; pedido do
// dono do projeto em 4 de setembro de 2026. Ver design/04-mensagens.md.
//
// Tabela de ligação e não uma coluna em `messages`, porque guardar é de quem
// guardou: cada pessoa tem a sua lista e ninguém vê a dos outros. Fixar é o
// oposto — é do canal, e por isso `messages.pinned_at` é coluna da mensagem.
//
// Consequência de numeração: as migrations nomeadas nas fases 9 e 10 andam
// três. `polls` vira 014, `conversations` 015 e `boards` 016.
exports.up = (pgm) => {
  pgm.sql(`
    create table saved_messages (
      user_id    uuid not null references users(id) on delete cascade,
      message_id uuid not null references messages(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (user_id, message_id)
    )
  `);

  // O painel lista por ordem de quando **você guardou**, não de quando a
  // mensagem foi escrita: guardar uma frase antiga hoje a coloca no topo,
  // que é onde você espera encontrá-la.
  pgm.sql(`
    create index saved_messages_recentes
      on saved_messages (user_id, created_at desc)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table saved_messages`);
};
