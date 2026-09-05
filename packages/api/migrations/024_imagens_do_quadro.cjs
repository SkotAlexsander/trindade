exports.shorthands = undefined;

/*
 * As imagens coladas dentro de um quadro.
 *
 * O Excalidraw guarda a imagem na cena como um `fileId` e os bytes num dicionário
 * à parte — que **não** viaja pelo CRDT: mandar megabytes de base64 por dentro de
 * cada delta acabaria com o quadro em duas fotos. Então os bytes vão pelo mesmo
 * caminho de todo upload (multipart, `sharp`, storage) e o que trafega é esta
 * linha: qual `fileId` corresponde a qual arquivo nosso.
 *
 * Tabela própria, e não `attachments`: a varredura de anexos órfãos apaga
 * anexo sem mensagem depois de uma hora, e uma imagem de quadro nunca tem
 * mensagem — ela seria varrida no meio da reunião.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table board_files (
      board_id     uuid not null references boards(id) on delete cascade,
      -- O id vem do Excalidraw (hash do conteúdo). É dele a chave, porque é
      -- por ele que a cena procura a imagem.
      file_id      text not null check (char_length(file_id) between 1 and 64),
      storage_key  text not null,
      content_type text not null,
      byte_size    integer not null,
      created_by   uuid references users(id) on delete set null,
      created_at   timestamptz not null default now(),
      primary key (board_id, file_id)
    )
  `);

  // Quem serve o arquivo chega pela chave, não pelo quadro.
  pgm.sql(`create unique index board_files_chave on board_files (storage_key)`);
};

exports.down = (pgm) => {
  pgm.sql(`drop table board_files`);
};
