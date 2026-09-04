exports.shorthands = undefined;

/**
 * O upload começa ao anexar, não ao enviar — design/04-mensagens.md, "Anexo
 * pendente". Isso significa que o arquivo existe antes da mensagem, e a
 * migration 008 declarou `message_id not null`: do jeito que estava, não havia
 * como gravar um anexo pendente.
 *
 * Junto vêm `uploader_id` e `channel_id`, que a 008 também não previu:
 *
 * - `uploader_id` é quem responde pelo arquivo enquanto ele não tem mensagem.
 *   Sem ele, qualquer pessoa poderia costurar o anexo de outra na própria
 *   mensagem só sabendo o id, e a varredura de órfãos não teria dono a quem
 *   cobrar cota.
 * - `channel_id` é onde a permissão foi verificada no momento do upload.
 *   Guardá-lo evita reverificar a permissão pelo caminho da mensagem, que
 *   ainda não existe.
 */
exports.up = (pgm) => {
  pgm.sql(`alter table attachments alter column message_id drop not null`);
  pgm.sql(`
    alter table attachments
      add column uploader_id uuid not null references users(id) on delete cascade,
      add column channel_id  uuid not null references channels(id) on delete cascade
  `);

  // A varredura procura exatamente por isto: anexo sem mensagem e velho.
  // Índice parcial porque a esmagadora maioria das linhas tem mensagem.
  pgm.sql(`
    create index attachments_orfaos on attachments (created_at)
      where message_id is null
  `);
  pgm.sql(`create index attachments_message on attachments (message_id)`);
};

exports.down = (pgm) => {
  pgm.sql(`drop index if exists attachments_message`);
  pgm.sql(`drop index if exists attachments_orfaos`);
  pgm.sql(`alter table attachments drop column channel_id, drop column uploader_id`);
  // Sem `set not null` na volta: as linhas pendentes criadas nesta versão não
  // teriam para onde ir. Desfazer só devolve a coluna nula.
  pgm.sql(`delete from attachments where message_id is null`);
  pgm.sql(`alter table attachments alter column message_id set not null`);
};
