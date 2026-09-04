exports.shorthands = undefined;

/**
 * Conversas privadas: direta entre duas pessoas, grupo de três ou quatro.
 *
 * As mensagens usam a **mesma tabela `messages`**, com `conversation_id` no
 * lugar de `channel_id` e um `check` garantindo que exatamente uma das duas
 * esteja preenchida. É isso que reaproveita busca, reações, anexos, threads e
 * o gateway inteiro sem duplicar nada — uma segunda tabela de mensagens seria
 * uma segunda implementação de tudo o que já existe.
 *
 * `read_state` acompanha pelo mesmo caminho: não lidas, menções e silêncio
 * valem para conversa exatamente como valem para canal.
 *
 * Ver design/10-conversas-privadas.md.
 */

exports.up = (pgm) => {
  pgm.sql(`
    create table conversations (
      id         uuid primary key default gen_random_uuid(),
      kind       text not null check (kind in ('direct','group')),
      name       text check (char_length(name) <= 48),
      created_by uuid references users(id),
      created_at timestamptz not null default now()
    );

    create table conversation_members (
      conversation_id uuid not null references conversations(id) on delete cascade,
      user_id         uuid not null references users(id) on delete cascade,
      joined_at       timestamptz not null default now(),
      -- Sair é uma data, não uma remoção: quem sai deixa de receber, e o
      -- histórico dela continua para os outros.
      left_at         timestamptz,
      -- Esconder da lista não apaga nada; a conversa volta na próxima mensagem.
      hidden_at       timestamptz,
      primary key (conversation_id, user_id)
    );

    create index conversation_members_da_pessoa
      on conversation_members (user_id) where left_at is null;
  `);

  pgm.sql(`
    alter table messages
      add column conversation_id uuid references conversations(id) on delete cascade,
      alter column channel_id drop not null,
      add constraint messages_um_alvo
        check ((channel_id is null) <> (conversation_id is null));

    create index messages_conversa_tempo
      on messages (conversation_id, created_at desc) where deleted_at is null;
  `);

  /*
   * A chave primária de `read_state` era `(user_id, channel_id)`, e chave
   * primária não aceita coluna nula. Ela vira dois índices únicos parciais —
   * um por alvo —, que é o que `on conflict` precisa para continuar
   * funcionando nos dois casos.
   */
  // Em comandos separados e nesta ordem: enquanto `channel_id` fizer parte da
  // chave primária, o Postgres recusa tirar o `not null` dela — e num `alter
  // table` só, as duas coisas acontecem na mesma fase.
  pgm.sql(`
    alter table read_state drop constraint read_state_pkey;

    alter table read_state
      add column conversation_id uuid references conversations(id) on delete cascade,
      alter column channel_id drop not null,
      add constraint read_state_um_alvo
        check ((channel_id is null) <> (conversation_id is null));

    create unique index read_state_do_canal
      on read_state (user_id, channel_id) where channel_id is not null;

    create unique index read_state_da_conversa
      on read_state (user_id, conversation_id) where conversation_id is not null;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop index if exists read_state_da_conversa;
    drop index if exists read_state_do_canal;
    alter table read_state
      drop constraint if exists read_state_um_alvo,
      drop column if exists conversation_id;
    delete from read_state where channel_id is null;
    alter table read_state
      alter column channel_id set not null,
      add primary key (user_id, channel_id);

    delete from messages where channel_id is null;
    alter table messages
      drop constraint if exists messages_um_alvo,
      drop column if exists conversation_id,
      alter column channel_id set not null;

    drop table if exists conversation_members;
    drop table if exists conversations;
  `);
};
