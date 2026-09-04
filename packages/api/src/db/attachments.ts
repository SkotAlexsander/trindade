import { sql } from './index.js';

/**
 * Anexos.
 *
 * O arquivo existe antes da mensagem: o upload começa ao anexar, não ao
 * enviar (design/04-mensagens.md). Entre um e outro a linha fica **pendente**
 * — `message_id` nulo — e é responsabilidade de quem subiu, não do canal.
 */

export interface AttachmentRow {
  id: string;
  message_id: string | null;
  uploader_id: string;
  channel_id: string;
  storage_key: string;
  filename: string;
  content_type: string;
  byte_size: string | number;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  sort_order: number;
  created_at: Date;
}

const COLUNAS = sql`
  id, message_id, uploader_id, channel_id, storage_key, filename,
  content_type, byte_size, width, height, blurhash, sort_order, created_at
`;

export async function criarPendente(entrada: {
  uploaderId: string;
  channelId: string;
  storageKey: string;
  filename: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  blurhash: string | null;
}): Promise<AttachmentRow> {
  const linhas = await sql<AttachmentRow[]>`
    insert into attachments
      (uploader_id, channel_id, storage_key, filename, content_type,
       byte_size, width, height, blurhash)
    values
      (${entrada.uploaderId}, ${entrada.channelId}, ${entrada.storageKey},
       ${entrada.filename}, ${entrada.contentType}, ${entrada.byteSize},
       ${entrada.width}, ${entrada.height}, ${entrada.blurhash})
    returning ${COLUNAS}
  `;
  const row = linhas[0];
  if (!row) throw new Error('anexo inserido sumiu');
  return row;
}

export async function findById(id: string): Promise<AttachmentRow | null> {
  const linhas = await sql<AttachmentRow[]>`select ${COLUNAS} from attachments where id = ${id}`;
  return linhas[0] ?? null;
}

export async function findByStorageKey(chave: string): Promise<AttachmentRow | null> {
  const linhas = await sql<AttachmentRow[]>`
    select ${COLUNAS} from attachments where storage_key = ${chave}
  `;
  return linhas[0] ?? null;
}

/**
 * Costura os anexos pendentes na mensagem recém-criada.
 *
 * As três condições do `where` são a autorização inteira, e nenhuma delas é
 * dispensável: **sua** (`uploader_id`), **deste canal** (`channel_id`) e
 * **ainda solta** (`message_id is null`). Sem a primeira, saber o id de um
 * anexo alheio bastaria para pendurá-lo na própria mensagem; sem a terceira,
 * o mesmo arquivo poderia ser costurado em duas mensagens e a primeira delas
 * perderia o anexo ao ser apagada.
 *
 * O que não casar é silenciosamente ignorado — a mensagem vale mais que o
 * anexo, e ela já está no banco quando isto roda.
 */
export async function costurar(
  messageId: string,
  ids: readonly string[],
  uploaderId: string,
  channelId: string,
): Promise<AttachmentRow[]> {
  if (ids.length === 0) return [];
  // `with ordinality` traz o índice de cada id no array, e é dele que sai a
  // ordem em que a pessoa escolheu os arquivos — o `created_at` diria a ordem
  // em que os uploads terminaram, que é outra coisa.
  const linhas = await sql<AttachmentRow[]>`
    update attachments a
       set message_id = ${messageId}, sort_order = escolha.ord
      from unnest(${sql.array(ids as string[])}::uuid[]) with ordinality as escolha(id, ord)
     where a.id = escolha.id
       and a.uploader_id = ${uploaderId}
       and a.channel_id = ${channelId}
       and a.message_id is null
    returning ${sql`a.id, a.message_id, a.uploader_id, a.channel_id, a.storage_key,
                    a.filename, a.content_type, a.byte_size, a.width, a.height,
                    a.blurhash, a.sort_order, a.created_at`}
  `;
  // `returning` não promete ordem nenhuma, e esta é justamente a linha em que
  // a ordem passa a existir.
  return linhas.sort((a, b) => a.sort_order - b.sort_order);
}

export async function listarDeMensagens(ids: readonly string[]): Promise<AttachmentRow[]> {
  if (ids.length === 0) return [];
  return sql<AttachmentRow[]>`
    select ${COLUNAS} from attachments
     where message_id = any(${sql.array(ids as string[])}::uuid[])
     order by sort_order, created_at, id
  `;
}

/** Quantos arquivos esta pessoa tem soltos agora. Segura o upload em massa. */
export async function contarPendentes(uploaderId: string): Promise<number> {
  const linhas = await sql<{ n: string }[]>`
    select count(*)::text as n from attachments
     where uploader_id = ${uploaderId} and message_id is null
  `;
  return Number(linhas[0]?.n ?? 0);
}

/**
 * Anexo sem mensagem e velho: alguém anexou e desistiu de enviar.
 *
 * Devolve as linhas em vez de apagá-las direto porque o objeto no storage
 * também precisa sair, e a chave só existe aqui.
 */
export async function orfaos(idadeEmMinutos: number, limite = 200): Promise<AttachmentRow[]> {
  return sql<AttachmentRow[]>`
    select ${COLUNAS} from attachments
     where message_id is null
       and created_at < now() - make_interval(mins => ${idadeEmMinutos})
     order by created_at
     limit ${limite}
  `;
}

export async function apagarPorIds(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const linhas = await sql<{ id: string }[]>`
    delete from attachments where id = any(${sql.array(ids as string[])}::uuid[])
    returning id
  `;
  return linhas.length;
}
