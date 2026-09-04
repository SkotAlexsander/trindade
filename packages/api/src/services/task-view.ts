import type { Task } from '@trindade/shared';
import type { TaskRow } from '../db/tasks.js';

/** A linha do banco vira o que a API promete. Ver docs/05-contrato-api.md. */
export function toApiTask(row: TaskRow): Task {
  return {
    id: row.id,
    channelId: row.channel_id,
    title: row.title,
    body: row.body,
    columnKey: row.column_key as Task['columnKey'],
    position: row.position,
    assigneeId: row.assignee_id,
    dueAt: row.due_at?.toISOString() ?? null,
    sourceMessageId: row.source_message_id,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}
