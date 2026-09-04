exports.shorthands = undefined;

/**
 * Anexo em conversa privada.
 *
 * A 014 deu a `attachments` um `channel_id not null` porque, na época, todo
 * anexo nascia num canal — ele é onde a permissão foi verificada no momento do
 * upload, e o upload começa **antes** de a mensagem existir. Com conversas
 * privadas o mesmo papel passa a ser de `conversation_id`, e a coluna ganha o
 * mesmo `check` de alvo único que `messages` já tem.
 *
 * Sem isto, mandar uma captura de tela numa direta seria impossível — e uma
 * conversa privada em que não dá para mandar uma imagem não é a mesma coisa
 * que um canal, que é o que design/10-conversas-privadas.md promete.
 */

exports.up = (pgm) => {
  pgm.sql(`
    alter table attachments
      add column conversation_id uuid references conversations(id) on delete cascade,
      alter column channel_id drop not null,
      add constraint attachments_um_alvo
        check ((channel_id is null) <> (conversation_id is null));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    delete from attachments where channel_id is null;
    alter table attachments
      drop constraint if exists attachments_um_alvo,
      drop column if exists conversation_id,
      alter column channel_id set not null;
  `);
};
