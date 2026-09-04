import type { Channel } from '@trindade/shared';
import type { ChannelRow } from '../db/channels.js';

/** Datas sempre ISO 8601 em UTC. Ver docs/05-contrato-api.md. */
export function toApiChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    kind: row.kind,
    position: row.position,
    category: row.category,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
