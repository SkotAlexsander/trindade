import type { Board } from '@trindade/shared';
import type { BoardRow } from '../db/boards.js';

/**
 * A linha do banco vira o cartão da lista.
 *
 * A miniatura sai como URL de arquivo, do mesmo jeito que o avatar: a chave tem
 * 32 bytes aleatórios e é ela o controle de acesso — um `<img src>` não tem
 * como mandar o access token, que vive só na memória do JavaScript.
 * Ver docs/04-seguranca.md, "Servir".
 */
export function toApiBoard(row: BoardRow): Board {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    thumbnailUrl: row.thumbnail_key ? `/api/files/${row.thumbnail_key}` : null,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}
