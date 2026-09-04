import { sql } from './index.js';

/**
 * Conversas privadas.
 *
 * Com cinco pessoas existem exatamente dez pares possíveis e um punhado de
 * grupos. Isso permite um desenho que não escala e não precisa: nada aqui
 * pagina, nada aqui indexa por texto, e a lista inteira de alguém cabe numa
 * consulta. Ver design/10-conversas-privadas.md.
 */

export interface ConversationRow {
  id: string;
  kind: 'direct' | 'group';
  name: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface MemberRow {
  conversation_id: string;
  user_id: string;
  joined_at: Date;
  left_at: Date | null;
  hidden_at: Date | null;
}

const CAMPOS = sql`id, kind, name, created_by, created_at`;

export async function porId(id: string): Promise<ConversationRow | null> {
  const linhas = await sql<ConversationRow[]>`select ${CAMPOS} from conversations where id = ${id}`;
  return linhas[0] ?? null;
}

export async function membros(conversationId: string): Promise<MemberRow[]> {
  return sql<MemberRow[]>`
    select conversation_id, user_id, joined_at, left_at, hidden_at
      from conversation_members
     where conversation_id = ${conversationId}
     order by joined_at
  `;
}

/**
 * A checagem de acesso do produto inteiro para conversa privada.
 *
 * **`ADMINISTRATOR` não passa por aqui.** É a única exceção ao bitfield, e é
 * deliberada: privado significa privado. Quem administra o servidor administra
 * canais, cargos e pessoas — não lê a conversa dos outros. Ver
 * design/10-conversas-privadas.md.
 */
export async function ehMembro(conversationId: string, userId: string): Promise<boolean> {
  const linhas = await sql<{ user_id: string }[]>`
    select user_id from conversation_members
     where conversation_id = ${conversationId} and user_id = ${userId} and left_at is null
  `;
  return linhas.length > 0;
}

/**
 * A direta entre duas pessoas, criando se não existir.
 *
 * A unicidade do par não é uma restrição do banco: seria um índice sobre uma
 * agregação de duas linhas de `conversation_members`. Fica na aplicação, com
 * transação e `for update` nas duas linhas de `users` — travar as pessoas, e
 * não a tabela de conversas, é o que faz duas abas abrindo a mesma direta ao
 * mesmo tempo criarem uma só. Sem o lock, as duas transações procuram, as duas
 * não acham, e as duas criam.
 *
 * O par é ordenado antes de travar para não haver deadlock quando as duas
 * pontas abrem uma a conversa da outra ao mesmo tempo.
 */
export async function acharOuCriarDireta(a: string, b: string): Promise<ConversationRow> {
  const [primeiro, segundo] = [a, b].sort();

  return sql.begin(async (tx) => {
    await tx`select id from users where id in (${primeiro as string}, ${segundo as string}) order by id for update`;

    const existentes = await tx<ConversationRow[]>`
      select c.id, c.kind, c.name, c.created_by, c.created_at
        from conversations c
       where c.kind = 'direct'
         and (select count(*) from conversation_members m where m.conversation_id = c.id) = 2
         and exists (select 1 from conversation_members m
                      where m.conversation_id = c.id and m.user_id = ${a})
         and exists (select 1 from conversation_members m
                      where m.conversation_id = c.id and m.user_id = ${b})
       limit 1
    `;
    const achada = existentes[0];
    if (achada) return achada;

    const criadas = await tx<ConversationRow[]>`
      insert into conversations (kind, created_by)
      values ('direct', ${a})
      returning id, kind, name, created_by, created_at
    `;
    const nova = criadas[0];
    if (!nova) throw new Error('a conversa não nasceu');

    for (const userId of [a, b]) {
      await tx`
        insert into conversation_members (conversation_id, user_id)
        values (${nova.id}, ${userId})
      `;
    }
    return nova;
  }) as Promise<ConversationRow>;
}

/** Um grupo novo. A direta que o originou continua intacta. */
export async function criarGrupo(entrada: {
  createdBy: string;
  userIds: readonly string[];
  name: string | null;
}): Promise<ConversationRow> {
  const todos = [...new Set([entrada.createdBy, ...entrada.userIds])];

  return sql.begin(async (tx) => {
    const criadas = await tx<ConversationRow[]>`
      insert into conversations (kind, name, created_by)
      values ('group', ${entrada.name}, ${entrada.createdBy})
      returning id, kind, name, created_by, created_at
    `;
    const nova = criadas[0];
    if (!nova) throw new Error('o grupo não nasceu');

    for (const userId of todos) {
      await tx`
        insert into conversation_members (conversation_id, user_id)
        values (${nova.id}, ${userId})
      `;
    }
    return nova;
  }) as Promise<ConversationRow>;
}

export interface ConversaDaLista extends ConversationRow {
  /** Todos os membros que não saíram, inclusive você. */
  membros: string[];
  ultima_mensagem_em: Date | null;
  ultimo_texto: string | null;
  ultimo_autor: string | null;
  nao_lidas: number;
  mencoes: number;
  muted_until: Date | null;
  hidden_at: Date | null;
}

/**
 * As conversas de alguém, com o que a lista precisa desenhar.
 *
 * Uma consulta com agregações e não um `n+1`: a lista inteira tem uma dúzia de
 * linhas, e ainda assim buscar a última mensagem de cada uma numa segunda
 * volta seria uma dúzia de idas ao banco a cada abertura do produto.
 *
 * Conversa sem mensagem nenhuma sai na lista com `ultima_mensagem_em` nulo — é
 * quem chama que decide escondê-la, porque a mesma consulta serve para abrir
 * uma direta recém-criada.
 */
export async function listarDoUsuario(userId: string): Promise<ConversaDaLista[]> {
  return sql<ConversaDaLista[]>`
    select
      c.id, c.kind, c.name, c.created_by, c.created_at,
      meu.hidden_at,
      array(
        select m2.user_id from conversation_members m2
         where m2.conversation_id = c.id and m2.left_at is null
         order by m2.joined_at
      ) as membros,
      ult.created_at as ultima_mensagem_em,
      ult.content    as ultimo_texto,
      ult.author_id  as ultimo_autor,
      coalesce((
        select count(*) from messages m3
         where m3.conversation_id = c.id
           and m3.deleted_at is null
           and m3.parent_id is null
           and (rs.last_read_message_id is null or m3.created_at > (
                 select m4.created_at from messages m4 where m4.id = rs.last_read_message_id
               ))
      ), 0)::int as nao_lidas,
      coalesce(rs.mention_count, 0) as mencoes,
      rs.muted_until
    from conversations c
    join conversation_members meu
      on meu.conversation_id = c.id and meu.user_id = ${userId} and meu.left_at is null
    left join read_state rs
      on rs.conversation_id = c.id and rs.user_id = ${userId}
    left join lateral (
      select m.created_at, m.content, m.author_id
        from messages m
       where m.conversation_id = c.id and m.deleted_at is null and m.parent_id is null
       order by m.created_at desc
       limit 1
    ) ult on true
    order by coalesce(ult.created_at, c.created_at) desc
  `;
}

/** Sair de um grupo. Direta não se abandona — ela é o par, e o par existe. */
export async function sair(conversationId: string, userId: string): Promise<boolean> {
  const linhas = await sql<{ user_id: string }[]>`
    update conversation_members set left_at = now()
     where conversation_id = ${conversationId} and user_id = ${userId} and left_at is null
     returning user_id
  `;
  return linhas.length > 0;
}

/** Esconder da lista; a conversa volta sozinha na próxima mensagem. */
export async function esconder(
  conversationId: string,
  userId: string,
  escondida: boolean,
): Promise<void> {
  await sql`
    update conversation_members set hidden_at = ${escondida ? sql`now()` : null}
     where conversation_id = ${conversationId} and user_id = ${userId}
  `;
}

/** Mensagem nova desfaz o esconder de todo mundo: a conversa voltou a existir. */
export async function revelar(conversationId: string): Promise<void> {
  await sql`
    update conversation_members set hidden_at = null
     where conversation_id = ${conversationId} and hidden_at is not null
  `;
}

export async function renomear(
  conversationId: string,
  name: string | null,
): Promise<ConversationRow | null> {
  const linhas = await sql<ConversationRow[]>`
    update conversations set name = ${name}
     where id = ${conversationId} and kind = 'group'
     returning ${CAMPOS}
  `;
  return linhas[0] ?? null;
}
