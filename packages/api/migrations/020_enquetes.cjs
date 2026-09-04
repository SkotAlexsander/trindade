exports.shorthands = undefined;

/**
 * Enquetes.
 *
 * A enquete **é** uma mensagem — `messages.kind = 'poll'`, coluna que a 018 já
 * criou. Não existe uma tabela paralela de "itens especiais" do canal: assim a
 * pergunta entra na busca, no histórico e nas fixadas como qualquer outra coisa
 * que aconteceu ali, e o `on delete cascade` a partir de `messages` é o que
 * apaga tudo junto quando a mensagem some.
 *
 * `content` da mensagem guarda a pergunta. É duplicação de propósito: é o que
 * faz a busca achar a enquete e a prévia da citação mostrar algo.
 *
 * Ver design/08-projeto.md e prompts/fase-09-projeto-notificacoes.md.
 */

exports.up = (pgm) => {
  pgm.sql(`
    create table polls (
      id          uuid primary key default gen_random_uuid(),
      message_id  uuid not null unique references messages(id) on delete cascade,
      channel_id  uuid not null references channels(id) on delete cascade,
      question    text not null check (char_length(question) between 1 and 200),
      -- Escolhidos ao criar e imutáveis depois: mudar "anônima" com votos
      -- dentro revelaria o que foi prometido em segredo.
      multiple    boolean not null default false,
      anonymous   boolean not null default false,
      closes_at   timestamptz,
      closed_at   timestamptz,
      created_by  uuid not null references users(id),
      created_at  timestamptz not null default now()
    );

    create index polls_canal on polls (channel_id, created_at desc);
    -- O worker que fecha por prazo pergunta só isto.
    create index polls_prazo on polls (closes_at) where closed_at is null and closes_at is not null;

    create table poll_options (
      id       uuid primary key default gen_random_uuid(),
      poll_id  uuid not null references polls(id) on delete cascade,
      label    text not null check (char_length(label) between 1 and 80),
      position int not null
    );

    create index poll_options_da_enquete on poll_options (poll_id, position);

    create table poll_votes (
      poll_id    uuid not null references polls(id) on delete cascade,
      option_id  uuid not null references poll_options(id) on delete cascade,
      user_id    uuid not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (poll_id, option_id, user_id)
    );

    create index poll_votes_da_enquete on poll_votes (poll_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists poll_votes;
    drop table if exists poll_options;
    drop table if exists polls;
  `);
};
