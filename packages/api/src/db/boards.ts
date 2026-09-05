import { sql } from './index.js';

/**
 * Os quadros brancos de cada canal.
 *
 * Vários por canal, ao contrário da nota: um canal de produto tem "Fluxo de
 * onboarding" e "Arquitetura v2" ao mesmo tempo. O conteúdo é o `ydoc`, o mesmo
 * CRDT das notas — aqui não há cópia achatada ao lado dele, porque um desenho
 * não entra na busca e duas verdades para o mesmo quadro divergiriam.
 * Ver design/11-quadro.md.
 */

export interface BoardRow {
  id: string;
  channel_id: string;
  name: string;
  thumbnail_key: string | null;
  created_by: string | null;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
  archived_at: Date | null;
}

/* O `ydoc` fica **fora** desta lista: são dezenas de KB por quadro, e a lista
   do painel mostra nome e miniatura. Quem quer o desenho pede `estado`. */
const CAMPOS = sql`
  id, channel_id, name, thumbnail_key, created_by, created_at,
  updated_by, updated_at, archived_at
`;

export async function listar(channelId: string): Promise<BoardRow[]> {
  return sql<BoardRow[]>`
    select ${CAMPOS} from boards
     where channel_id = ${channelId} and archived_at is null
     order by updated_at desc
  `;
}

export async function porId(id: string): Promise<BoardRow | null> {
  const linhas = await sql<BoardRow[]>`select ${CAMPOS} from boards where id = ${id}`;
  return linhas[0] ?? null;
}

/** O desenho. Separado do cartão porque quase ninguém precisa dos dois juntos. */
export async function estado(id: string): Promise<Buffer | null> {
  const linhas = await sql<{ ydoc: Buffer | null }[]>`select ydoc from boards where id = ${id}`;
  return linhas[0]?.ydoc ?? null;
}

/** Quem serve o arquivo pergunta por aqui: a chave é de uma miniatura nossa? */
export async function porChaveDeMiniatura(chave: string): Promise<BoardRow | null> {
  const linhas = await sql<BoardRow[]>`
    select ${CAMPOS} from boards where thumbnail_key = ${chave}
  `;
  return linhas[0] ?? null;
}

export async function criar(entrada: {
  channelId: string;
  name: string;
  createdBy: string;
}): Promise<BoardRow> {
  const linhas = await sql<BoardRow[]>`
    insert into boards (channel_id, name, created_by, updated_by)
    values (${entrada.channelId}, ${entrada.name}, ${entrada.createdBy}, ${entrada.createdBy})
    returning ${CAMPOS}
  `;
  const novo = linhas[0];
  if (!novo) throw new Error('o quadro não nasceu');
  return novo;
}

export async function renomear(id: string, name: string): Promise<BoardRow | null> {
  const linhas = await sql<BoardRow[]>`
    update boards set name = ${name} where id = ${id} returning ${CAMPOS}
  `;
  return linhas[0] ?? null;
}

/**
 * Arquivar, e não apagar.
 *
 * Um quadro é o desenho de uma conversa que aconteceu; sumir com ele por um
 * clique errado não tem volta. Some da lista e continua no banco.
 */
export async function arquivar(id: string): Promise<BoardRow | null> {
  const linhas = await sql<BoardRow[]>`
    update boards set archived_at = now() where id = ${id} returning ${CAMPOS}
  `;
  return linhas[0] ?? null;
}

/**
 * Grava o desenho.
 *
 * `updated_at` só anda quando o desenho muda — renomear não faz o quadro pular
 * para o topo da lista, porque a lista está ordenada por "onde a coisa está
 * acontecendo", e trocar o nome não é acontecer nada.
 */
export async function gravarEstado(
  id: string,
  ydoc: Buffer,
  updatedBy: string | null,
): Promise<void> {
  await sql`
    update boards
       set ydoc = ${ydoc}, updated_by = ${updatedBy}, updated_at = now()
     where id = ${id}
  `;
}

/** Devolve a chave anterior, para o arquivo velho sair depois do banco trocar. */
export async function trocarMiniatura(
  id: string,
  chave: string | null,
): Promise<{ board: BoardRow; anterior: string | null } | null> {
  const linhas = await sql<(BoardRow & { anterior: string | null })[]>`
    update boards
       set thumbnail_key = ${chave}
      from (select thumbnail_key as anterior from boards where id = ${id}) as antes
     where boards.id = ${id}
    returning ${CAMPOS}, antes.anterior
  `;
  const linha = linhas[0];
  if (!linha) return null;
  const { anterior, ...board } = linha;
  return { board, anterior };
}
