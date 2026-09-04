import type { Attachment } from '@trindade/shared';
import type { AttachmentRow } from '../db/attachments.js';

/**
 * A linha do banco no formato do contrato.
 *
 * `byte_size` é `bigint` no Postgres e chega como texto pelo driver; mandá-lo
 * adiante sem converter faria o cliente somar strings ao mostrar "2,4 MB".
 */
export function toApiAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    // A chave é aleatória e é ela que vai na URL — o nome enviado por quem
    // subiu nunca vira caminho. Ver docs/04-seguranca.md, "Servir".
    url: `/api/files/${row.storage_key}`,
  };
}

export function agruparAnexos(rows: readonly AttachmentRow[]): Map<string, Attachment[]> {
  const porMensagem = new Map<string, Attachment[]>();
  for (const row of rows) {
    if (!row.message_id) continue;
    const lista = porMensagem.get(row.message_id) ?? [];
    lista.push(toApiAttachment(row));
    porMensagem.set(row.message_id, lista);
  }
  return porMensagem;
}
