import { sql } from './index.js';

/**
 * O quadro de tarefas de cada canal.
 *
 * A posição é `double precision` de propósito: soltar uma tarefa entre duas
 * outras grava a **média das vizinhas**, uma linha atualizada, sem reindexar a
 * coluna. Com índices inteiros, mover o primeiro cartão reescreveria todos —
 * e num quadro colaborativo isso é uma corrida entre duas pessoas arrastando ao
 * mesmo tempo. Ver design/08-projeto.md.
 */

export interface TaskRow {
  id: string;
  channel_id: string;
  title: string;
  body: string | null;
  column_key: string;
  position: number;
  assignee_id: string | null;
  due_at: Date | null;
  source_message_id: string | null;
  created_by: string;
  created_at: Date;
  completed_at: Date | null;
}

const CAMPOS = sql`
  id, channel_id, title, body, column_key, position, assignee_id, due_at,
  source_message_id, created_by, created_at, completed_at
`;

export async function listar(channelId: string): Promise<TaskRow[]> {
  return sql<TaskRow[]>`
    select ${CAMPOS} from tasks
     where channel_id = ${channelId}
     order by column_key, position
  `;
}

export async function porId(id: string): Promise<TaskRow | null> {
  const linhas = await sql<TaskRow[]>`select ${CAMPOS} from tasks where id = ${id}`;
  return linhas[0] ?? null;
}

/**
 * O fim da coluna.
 *
 * Tarefa nova entra embaixo: o topo é onde está o que já foi combinado, e
 * empurrar isso para baixo a cada criação embaralha a leitura de quem chega.
 */
async function proximaPosicao(channelId: string, columnKey: string): Promise<number> {
  const linhas = await sql<{ fim: number | null }[]>`
    select max(position) as fim from tasks
     where channel_id = ${channelId} and column_key = ${columnKey}
  `;
  return (linhas[0]?.fim ?? 0) + 1000;
}

export async function criar(entrada: {
  channelId: string;
  title: string;
  body: string | null;
  columnKey: string;
  assigneeId: string | null;
  dueAt: Date | null;
  sourceMessageId: string | null;
  createdBy: string;
}): Promise<TaskRow> {
  const position = await proximaPosicao(entrada.channelId, entrada.columnKey);

  const linhas = await sql<TaskRow[]>`
    insert into tasks
      (channel_id, title, body, column_key, position, assignee_id, due_at,
       source_message_id, created_by)
    values
      (${entrada.channelId}, ${entrada.title}, ${entrada.body}, ${entrada.columnKey},
       ${position}, ${entrada.assigneeId}, ${entrada.dueAt}, ${entrada.sourceMessageId},
       ${entrada.createdBy})
    returning ${CAMPOS}
  `;

  const nova = linhas[0];
  if (!nova) throw new Error('a tarefa não nasceu');
  return nova;
}

export interface Mudanca {
  title?: string;
  body?: string | null;
  columnKey?: string;
  position?: number;
  assigneeId?: string | null;
  dueAt?: Date | null;
  /** `true` conclui, `false` desfaz. Ausente não mexe. */
  concluida?: boolean;
}

/**
 * Uma alteração, campo a campo.
 *
 * `completed_at` acompanha a coluna: mover para "Feito" conclui, tirar de lá
 * desfaz. Sem isso, o cartão sairia de "Feito" continuando marcado como
 * concluído — e a lista do que o grupo fez mentiria.
 */
export async function alterar(id: string, m: Mudanca): Promise<TaskRow | null> {
  const concluir =
    m.concluida === undefined && m.columnKey === undefined
      ? undefined
      : (m.concluida ?? (m.columnKey === 'done'));

  const linhas = await sql<TaskRow[]>`
    update tasks set
      title = coalesce(${m.title ?? null}, title),
      body = ${m.body === undefined ? sql`body` : m.body},
      column_key = coalesce(${m.columnKey ?? null}, column_key),
      position = coalesce(${m.position ?? null}, position),
      assignee_id = ${m.assigneeId === undefined ? sql`assignee_id` : m.assigneeId},
      due_at = ${m.dueAt === undefined ? sql`due_at` : m.dueAt},
      completed_at = ${
        concluir === undefined ? sql`completed_at` : concluir ? sql`coalesce(completed_at, now())` : null
      }
    where id = ${id}
    returning ${CAMPOS}
  `;
  return linhas[0] ?? null;
}

export async function apagar(id: string): Promise<boolean> {
  const linhas = await sql<{ id: string }[]>`delete from tasks where id = ${id} returning id`;
  return linhas.length > 0;
}

/** As tarefas com dono que vencem hoje — o lembrete das 9h. */
export async function vencendoHoje(): Promise<TaskRow[]> {
  return sql<TaskRow[]>`
    select ${CAMPOS} from tasks
     where completed_at is null
       and assignee_id is not null
       and due_at::date = current_date
     order by due_at
  `;
}
