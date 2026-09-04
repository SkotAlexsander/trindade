import { sql } from './index.js';

export interface ChannelRow {
  id: string;
  slug: string;
  name: string;
  topic: string | null;
  kind: 'text' | 'voice';
  position: number;
  category: string | null;
  archived_at: Date | null;
  created_by: string | null;
  created_at: Date;
}

const COLUNAS = sql`
  id, slug, name, topic, kind, position, category, archived_at, created_by, created_at
`;

/** Sem paginação: com cinco pessoas a lista inteira cabe numa resposta. */
export async function listChannels(incluirArquivados = false): Promise<ChannelRow[]> {
  return sql<ChannelRow[]>`
    select ${COLUNAS} from channels
    ${incluirArquivados ? sql`` : sql`where archived_at is null`}
    order by category nulls first, position, name
  `;
}

export async function findChannelById(id: string): Promise<ChannelRow | null> {
  const rows = await sql<ChannelRow[]>`select ${COLUNAS} from channels where id = ${id}`;
  return rows[0] ?? null;
}

export async function findChannelBySlug(slug: string): Promise<ChannelRow | null> {
  const rows = await sql<ChannelRow[]>`select ${COLUNAS} from channels where slug = ${slug}`;
  return rows[0] ?? null;
}

export async function createChannel(input: {
  slug: string;
  name: string;
  kind: 'text' | 'voice';
  topic: string | null;
  category: string | null;
  createdBy: string;
}): Promise<ChannelRow> {
  return sql.begin(async (tx) => {
    // Entra no fim da própria categoria. Calcular aqui, e não no cliente,
    // evita duas criações simultâneas nascerem com a mesma posição.
    const ultimas = await tx<{ proxima: number }[]>`
      select coalesce(max(position), -1) + 1 as proxima
      from channels
      where category is not distinct from ${input.category}
    `;
    const rows = await tx<ChannelRow[]>`
      insert into channels (slug, name, kind, topic, category, position, created_by)
      values (${input.slug}, ${input.name}, ${input.kind}, ${input.topic},
              ${input.category}, ${ultimas[0]?.proxima ?? 0}, ${input.createdBy})
      returning ${COLUNAS}
    `;
    const row = rows[0];
    if (!row) throw new Error('insert de canal não devolveu linha');
    return row;
  });
}

export async function updateChannel(
  id: string,
  campos: { name?: string; topic?: string | null; category?: string | null },
): Promise<ChannelRow | null> {
  const rows = await sql<ChannelRow[]>`
    update channels set
      name = ${campos.name ?? sql`name`},
      topic = ${campos.topic === undefined ? sql`topic` : campos.topic},
      category = ${campos.category === undefined ? sql`category` : campos.category}
    where id = ${id}
    returning ${COLUNAS}
  `;
  return rows[0] ?? null;
}

/**
 * Arquivar, nunca excluir: um canal com histórico não deve sumir por um
 * clique. Ver design/03-menu-e-navegacao.md.
 */
export async function setArchived(id: string, arquivado: boolean): Promise<ChannelRow | null> {
  const rows = await sql<ChannelRow[]>`
    update channels set archived_at = ${arquivado ? sql`now()` : null}
    where id = ${id}
    returning ${COLUNAS}
  `;
  return rows[0] ?? null;
}

/** Reordenação inteira numa transação: nunca meia lista aplicada. */
export async function reorderChannels(
  ordem: Array<{ id: string; position: number; category: string | null }>,
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const item of ordem) {
      await tx`
        update channels set position = ${item.position}, category = ${item.category}
        where id = ${item.id}
      `;
    }
  });
}

export async function slugTaken(slug: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select exists (select 1 from channels where slug = ${slug}) as exists
  `;
  return rows[0]?.exists ?? false;
}
