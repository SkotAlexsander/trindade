exports.shorthands = undefined;

/**
 * `messages.kind` e o índice do lembrete de prazo.
 *
 * O pacote previa a coluna `kind` junto com as enquetes, e ela chega antes por
 * um motivo: concluir uma tarefa manda uma linha no canal — "Bruno concluiu
 * *Revisar a migração*" — e essa linha é uma mensagem de sistema. Sem `kind`,
 * ela seria indistinguível de alguém escrevendo isso à mão.
 *
 * Mensagem de sistema fica **no fluxo**, e não numa tabela paralela de "itens
 * especiais": é assim que o grupo fica sabendo sem abrir o quadro, e é assim
 * que ela aparece na busca e no histórico como qualquer outra coisa que
 * aconteceu ali.
 *
 * Ver design/08-projeto.md e prompts/fase-09-projeto-notificacoes.md.
 */

exports.up = (pgm) => {
  pgm.sql(`
    alter table messages
      add column kind text not null default 'text'
        check (kind in ('text', 'system', 'poll'))
  `);

  // O lembrete diário procura o que vence hoje e ainda não foi concluído. Sem
  // este índice, é varredura da tabela inteira todo dia às 9h.
  pgm.sql(`
    create index tasks_prazo on tasks (assignee_id, due_at)
      where completed_at is null
  `);
};

exports.down = (pgm) => {
  pgm.sql('drop index if exists tasks_prazo');
  pgm.sql('alter table messages drop column kind');
};
