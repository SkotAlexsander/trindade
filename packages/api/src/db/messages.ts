import { sql } from './index.js';

export interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  parent_id: string | null;
  reply_to_id: string | null;
  content: string;
  client_nonce: string | null;
  pinned_at: Date | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  author_username: string;
  author_display_name: string;
  author_avatar_key: string | null;
}

export interface ReactionRow {
  message_id: string;
  user_id: string;
  emoji: string;
}

const COLUNAS = sql`
  m.id, m.channel_id, m.author_id, m.parent_id, m.reply_to_id, m.content,
  m.client_nonce, m.pinned_at, m.edited_at, m.deleted_at, m.created_at,
  u.username as author_username, u.display_name as author_display_name,
  u.avatar_key as author_avatar_key
`;

const DE = sql`from messages m join users u on u.id = m.author_id`;

export async function findMessageById(id: string): Promise<MessageRow | null> {
  const rows = await sql<MessageRow[]>`select ${COLUNAS} ${DE} where m.id = ${id}`;
  return rows[0] ?? null;
}

/**
 * Histórico paginado por **id**, nunca por offset.
 *
 * Mensagem nova muda os índices, e paginação por deslocamento duplica ou pula
 * linhas exatamente quando a conversa está ativa. Ver docs/05-contrato-api.md.
 */
export async function listMessages(input: {
  channelId: string;
  before?: string;
  after?: string;
  limit: number;
}): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  const limite = input.limit + 1;

  let linhas: MessageRow[];
  if (input.after) {
    linhas = await sql<MessageRow[]>`
      select ${COLUNAS} ${DE}
      where m.channel_id = ${input.channelId}
        and m.parent_id is null
        and m.created_at > (select created_at from messages where id = ${input.after})
      order by m.created_at asc
      limit ${limite}
    `;
    const hasMore = linhas.length > input.limit;
    return { messages: linhas.slice(0, input.limit), hasMore };
  }

  // Sem cursor, ou com `before`: pega os mais recentes e devolve em ordem
  // crescente, que é a ordem em que a lista renderiza.
  linhas = input.before
    ? await sql<MessageRow[]>`
        select ${COLUNAS} ${DE}
        where m.channel_id = ${input.channelId}
          and m.parent_id is null
          and m.created_at < (select created_at from messages where id = ${input.before})
        order by m.created_at desc
        limit ${limite}
      `
    : await sql<MessageRow[]>`
        select ${COLUNAS} ${DE}
        where m.channel_id = ${input.channelId} and m.parent_id is null
        order by m.created_at desc
        limit ${limite}
      `;

  const hasMore = linhas.length > input.limit;
  return { messages: linhas.slice(0, input.limit).reverse(), hasMore };
}

/** Metade antes e metade depois: usado ao pular de um resultado de busca. */
export async function listAround(
  channelId: string,
  around: string,
  limit: number,
): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  const metade = Math.floor(limit / 2);
  const antes = await sql<MessageRow[]>`
    select ${COLUNAS} ${DE}
    where m.channel_id = ${channelId} and m.parent_id is null
      and m.created_at <= (select created_at from messages where id = ${around})
    order by m.created_at desc
    limit ${metade + 1}
  `;
  const depois = await sql<MessageRow[]>`
    select ${COLUNAS} ${DE}
    where m.channel_id = ${channelId} and m.parent_id is null
      and m.created_at > (select created_at from messages where id = ${around})
    order by m.created_at asc
    limit ${metade}
  `;
  return { messages: [...antes.reverse(), ...depois], hasMore: antes.length > metade };
}

export async function listThread(parentId: string): Promise<MessageRow[]> {
  return sql<MessageRow[]>`
    select ${COLUNAS} ${DE}
    where m.parent_id = ${parentId}
    order by m.created_at asc
  `;
}

export async function listPins(channelId: string): Promise<MessageRow[]> {
  return sql<MessageRow[]>`
    select ${COLUNAS} ${DE}
    where m.channel_id = ${channelId} and m.pinned_at is not null and m.deleted_at is null
    order by m.pinned_at desc
  `;
}

export async function countThreadReplies(ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const linhas = await sql<{ parent_id: string; total: string }[]>`
    select parent_id, count(*)::text as total from messages
    where parent_id in ${sql(ids as string[])} and deleted_at is null
    group by parent_id
  `;
  return new Map(linhas.map((l) => [l.parent_id, Number(l.total)]));
}

export async function listReactions(ids: readonly string[]): Promise<ReactionRow[]> {
  if (ids.length === 0) return [];
  return sql<ReactionRow[]>`
    select message_id, user_id, emoji from reactions
    where message_id in ${sql(ids as string[])}
    order by created_at asc
  `;
}

/**
 * Insere, ou devolve a que já existe com o mesmo nonce.
 *
 * `on conflict do nothing` no índice único `(author_id, client_nonce)`: quando
 * a rede oscila e o cliente reenvia, a segunda tentativa não cria linha nova e
 * a resposta é a mensagem original. É a barreira final contra duplicata.
 */
export async function createMessage(input: {
  channelId: string;
  authorId: string;
  content: string;
  clientNonce: string;
  replyToId: string | null;
  parentId: string | null;
}): Promise<{ row: MessageRow; novo: boolean }> {
  const inseridos = await sql<{ id: string }[]>`
    insert into messages (channel_id, author_id, content, client_nonce, reply_to_id, parent_id)
    values (${input.channelId}, ${input.authorId}, ${input.content},
            ${input.clientNonce}, ${input.replyToId}, ${input.parentId})
    on conflict (author_id, client_nonce) where client_nonce is not null do nothing
    returning id
  `;

  if (inseridos[0]) {
    const row = await findMessageById(inseridos[0].id);
    if (!row) throw new Error('mensagem inserida sumiu');
    return { row, novo: true };
  }

  const existentes = await sql<MessageRow[]>`
    select ${COLUNAS} ${DE}
    where m.author_id = ${input.authorId} and m.client_nonce = ${input.clientNonce}
  `;
  const row = existentes[0];
  if (!row) throw new Error('conflito de nonce sem linha correspondente');
  return { row, novo: false };
}

export async function updateContent(
  id: string,
  authorId: string,
  content: string,
): Promise<MessageRow | null> {
  const linhas = await sql<{ id: string }[]>`
    update messages set content = ${content}, edited_at = now()
    where id = ${id} and author_id = ${authorId} and deleted_at is null
    returning id
  `;
  return linhas[0] ? findMessageById(id) : null;
}

/** Soft delete: preserva a numeração e permite ao autor ver o que apagou. */
export async function softDelete(id: string): Promise<MessageRow | null> {
  const linhas = await sql<{ id: string }[]>`
    update messages set deleted_at = now() where id = ${id} and deleted_at is null
    returning id
  `;
  return linhas[0] ? findMessageById(id) : null;
}

export async function setPinned(id: string, fixar: boolean): Promise<MessageRow | null> {
  const linhas = await sql<{ id: string }[]>`
    update messages set pinned_at = ${fixar ? sql`now()` : null}
    where id = ${id} and deleted_at is null
    returning id
  `;
  return linhas[0] ? findMessageById(id) : null;
}

export async function addReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<boolean> {
  const linhas = await sql<{ emoji: string }[]>`
    insert into reactions (message_id, user_id, emoji)
    values (${messageId}, ${userId}, ${emoji})
    on conflict do nothing
    returning emoji
  `;
  return linhas.length > 0;
}

export async function removeReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<boolean> {
  const linhas = await sql<{ emoji: string }[]>`
    delete from reactions
    where message_id = ${messageId} and user_id = ${userId} and emoji = ${emoji}
    returning emoji
  `;
  return linhas.length > 0;
}

/**
 * Busca com `websearch_to_tsquery`, que aceita aspas e `-termo` sem quebrar
 * quando alguém digita pontuação. O `search_vector` é coluna gerada com
 * `to_tsvector('portuguese', …)`, então acento e stemming saem de graça:
 * "migração" e "migracao" encontram a mesma linha.
 */
export async function search(input: {
  channelId: string;
  q: string;
  from?: string;
  limit: number;
}): Promise<{ results: MessageRow[]; total: number }> {
  const consulta = sql`websearch_to_tsquery('pt_unaccent', ${input.q})`;
  const filtroAutor = input.from ? sql`and m.author_id = ${input.from}` : sql``;

  const results = await sql<MessageRow[]>`
    select ${COLUNAS} ${DE}
    where m.channel_id = ${input.channelId}
      and m.deleted_at is null
      and m.search_vector @@ ${consulta}
      ${filtroAutor}
    order by ts_rank_cd(m.search_vector, ${consulta}) desc, m.created_at desc
    limit ${input.limit}
  `;

  const totais = await sql<{ total: string }[]>`
    select count(*)::text as total from messages m
    where m.channel_id = ${input.channelId}
      and m.deleted_at is null
      and m.search_vector @@ ${consulta}
      ${input.from ? sql`and m.author_id = ${input.from}` : sql``}
  `;

  return { results, total: Number(totais[0]?.total ?? '0') };
}

/** Ids das pessoas mencionadas por `@usuario` no texto. */
export async function resolveMentions(content: string): Promise<string[]> {
  const nomes = [...content.matchAll(/@([a-z0-9_]{3,24})/g)].map((m) => m[1]).filter(Boolean);
  if (nomes.length === 0) return [];
  const linhas = await sql<{ id: string }[]>`
    select id from users where username in ${sql([...new Set(nomes)] as string[])}
  `;
  return linhas.map((l) => l.id);
}

// --- estado de leitura ------------------------------------------------------

export interface ReadStateRow {
  channelId: string;
  lastReadMessageId: string | null;
  mentionCount: number;
  mutedUntil: string | null;
}

/**
 * Marca até onde a pessoa leu e zera as menções do canal.
 *
 * Zerar aqui, e não numa rota separada, é o que mantém o contador honesto: ler
 * o canal é exatamente o ato que resolve a menção.
 */
export async function marcarLido(
  userId: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  await sql`
    insert into read_state (user_id, channel_id, last_read_message_id, mention_count, updated_at)
    values (${userId}, ${channelId}, ${messageId}, 0, now())
    on conflict (user_id, channel_id) do update
      set last_read_message_id = ${messageId}, mention_count = 0, updated_at = now()
  `;
}

export async function listReadState(userId: string): Promise<ReadStateRow[]> {
  const linhas = await sql<
    {
      channel_id: string;
      last_read_message_id: string | null;
      mention_count: number;
      muted_until: Date | null;
    }[]
  >`
    select channel_id, last_read_message_id, mention_count, muted_until
    from read_state where user_id = ${userId}
  `;
  return linhas.map((l) => ({
    channelId: l.channel_id,
    lastReadMessageId: l.last_read_message_id,
    mentionCount: l.mention_count,
    mutedUntil: l.muted_until ? l.muted_until.toISOString() : null,
  }));
}

/** Conta quantas mensagens há depois da última lida, por canal. */
export async function contarNaoLidas(userId: string): Promise<Map<string, number>> {
  const linhas = await sql<{ channel_id: string; total: string }[]>`
    select c.id as channel_id, count(m.id)::text as total
    from channels c
    left join read_state rs on rs.channel_id = c.id and rs.user_id = ${userId}
    left join messages m on m.channel_id = c.id
      and m.deleted_at is null
      and m.parent_id is null
      and m.author_id <> ${userId}
      and (
        rs.last_read_message_id is null
        or m.created_at > (select created_at from messages where id = rs.last_read_message_id)
      )
    where c.archived_at is null
    group by c.id
  `;
  return new Map(linhas.map((l) => [l.channel_id, Number(l.total)]));
}

/** Soma uma menção para cada pessoa citada, exceto quem escreveu. */
export async function somarMencoes(
  channelId: string,
  userIds: readonly string[],
  autorId: string,
): Promise<void> {
  const alvos = userIds.filter((id) => id !== autorId);
  if (alvos.length === 0) return;
  for (const id of alvos) {
    await sql`
      insert into read_state (user_id, channel_id, mention_count, updated_at)
      values (${id}, ${channelId}, 1, now())
      on conflict (user_id, channel_id) do update
        set mention_count = read_state.mention_count + 1, updated_at = now()
    `;
  }
}

// --- guardadas -------------------------------------------------------------
//
// "Guardar" é o favorito pessoal, e não tem nada a ver com fixar. Fixar é do
// canal e mora numa coluna de `messages`; guardar é de quem guardou e mora
// numa tabela de ligação. Ver design/04-mensagens.md, "Fixar e guardar".

/** Idempotente: guardar o que já está guardado não é erro nem mudança. */
export async function guardar(userId: string, messageId: string): Promise<boolean> {
  const linhas = await sql<{ message_id: string }[]>`
    insert into saved_messages (user_id, message_id)
    values (${userId}, ${messageId})
    on conflict do nothing
    returning message_id
  `;
  return linhas.length > 0;
}

export async function desguardar(userId: string, messageId: string): Promise<boolean> {
  const linhas = await sql<{ message_id: string }[]>`
    delete from saved_messages
    where user_id = ${userId} and message_id = ${messageId}
    returning message_id
  `;
  return linhas.length > 0;
}

/** Quais destas mensagens **você** guardou. Nunca quem mais guardou. */
export async function quaisGuardadas(
  userId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const linhas = await sql<{ message_id: string }[]>`
    select message_id from saved_messages
    where user_id = ${userId} and message_id in ${sql(ids as string[])}
  `;
  return new Set(linhas.map((l) => l.message_id));
}

export interface SavedRow extends MessageRow {
  saved_at: Date;
  channel_slug: string;
  channel_name: string;
  channel_kind: string;
}

/**
 * A lista pessoal, atravessando canais.
 *
 * Ordenada por **quando você guardou**, não por quando a mensagem foi escrita:
 * guardar hoje uma frase de março a coloca no topo, que é onde você vai
 * procurá-la. O cursor `before` é o `message_id` da última linha da página.
 *
 * Apagada não aparece — o `on delete cascade` já a tirou da tabela. Guardar é
 * um ponteiro, não uma cópia.
 */
export async function listarGuardadas(input: {
  userId: string;
  before?: string;
  limit: number;
}): Promise<{ rows: SavedRow[]; hasMore: boolean }> {
  const limite = input.limit + 1;
  const colunas = sql`
    ${COLUNAS}, s.created_at as saved_at,
    c.slug as channel_slug, c.name as channel_name, c.kind as channel_kind
  `;

  const linhas = input.before
    ? await sql<SavedRow[]>`
        select ${colunas}
        from saved_messages s
        join messages m on m.id = s.message_id
        join users u on u.id = m.author_id
        join channels c on c.id = m.channel_id
        where s.user_id = ${input.userId} and m.deleted_at is null
          and s.created_at < (
            select created_at from saved_messages
            where user_id = ${input.userId} and message_id = ${input.before}
          )
        order by s.created_at desc
        limit ${limite}
      `
    : await sql<SavedRow[]>`
        select ${colunas}
        from saved_messages s
        join messages m on m.id = s.message_id
        join users u on u.id = m.author_id
        join channels c on c.id = m.channel_id
        where s.user_id = ${input.userId} and m.deleted_at is null
        order by s.created_at desc
        limit ${limite}
      `;

  return { rows: linhas.slice(0, input.limit), hasMore: linhas.length > input.limit };
}
