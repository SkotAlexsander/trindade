import { sql } from './index.js';

/**
 * Enquetes.
 *
 * Três tabelas e nenhuma contagem materializada: com cinco pessoas, contar os
 * votos na hora é uma varredura de dezenas de linhas. Guardar o total numa
 * coluna seria um segundo lugar onde a verdade mora, e o dia em que os dois
 * discordarem é o dia em que ninguém confia no resultado.
 *
 * Ver design/08-projeto.md.
 */

export interface PollRow {
  id: string;
  message_id: string;
  channel_id: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  closes_at: Date | null;
  closed_at: Date | null;
  created_by: string;
  created_at: Date;
}

export interface OptionRow {
  id: string;
  poll_id: string;
  label: string;
  position: number;
}

export interface VoteRow {
  poll_id: string;
  option_id: string;
  user_id: string;
}

/** Uma enquete com o que a interface precisa para desenhá-la. */
export interface EnqueteCompleta {
  poll: PollRow;
  options: OptionRow[];
  votes: VoteRow[];
}

const CAMPOS = sql`
  id, message_id, channel_id, question, multiple, anonymous,
  closes_at, closed_at, created_by, created_at
`;

export async function porId(id: string): Promise<PollRow | null> {
  const linhas = await sql<PollRow[]>`select ${CAMPOS} from polls where id = ${id}`;
  return linhas[0] ?? null;
}

/**
 * As enquetes de um canal, com opções e votos.
 *
 * Três consultas e não uma com dois `join`: juntar opções e votos na mesma
 * linha multiplica as linhas uma pela outra, e desfazer isso no código custa
 * mais do que as duas idas a mais ao banco.
 */
export async function listarDoCanal(channelId: string): Promise<EnqueteCompleta[]> {
  const polls = await sql<PollRow[]>`
    select ${CAMPOS} from polls where channel_id = ${channelId} order by created_at
  `;
  if (polls.length === 0) return [];

  const ids = polls.map((p) => p.id);
  const options = await sql<OptionRow[]>`
    select id, poll_id, label, position from poll_options
     where poll_id in ${sql(ids)}
     order by poll_id, position
  `;
  const votes = await sql<VoteRow[]>`
    select poll_id, option_id, user_id from poll_votes where poll_id in ${sql(ids)}
  `;

  return polls.map((poll) => ({
    poll,
    options: options.filter((o) => o.poll_id === poll.id),
    votes: votes.filter((v) => v.poll_id === poll.id),
  }));
}

export async function porMensagem(messageId: string): Promise<PollRow | null> {
  const linhas = await sql<PollRow[]>`select ${CAMPOS} from polls where message_id = ${messageId}`;
  return linhas[0] ?? null;
}

export async function completa(id: string): Promise<EnqueteCompleta | null> {
  const poll = await porId(id);
  if (!poll) return null;

  const options = await sql<OptionRow[]>`
    select id, poll_id, label, position from poll_options
     where poll_id = ${id} order by position
  `;
  const votes = await sql<VoteRow[]>`
    select poll_id, option_id, user_id from poll_votes where poll_id = ${id}
  `;
  return { poll, options, votes };
}

/**
 * A enquete e as opções nascem juntas ou não nascem.
 *
 * Sem a transação, uma falha no meio deixaria uma pergunta sem alternativa
 * nenhuma pendurada numa mensagem — e não há como votar nisso nem como
 * consertar pela interface.
 */
export async function criar(entrada: {
  messageId: string;
  channelId: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  closesAt: Date | null;
  createdBy: string;
  opcoes: readonly string[];
}): Promise<EnqueteCompleta> {
  return sql.begin(async (tx) => {
    const linhas = await tx<PollRow[]>`
      insert into polls
        (message_id, channel_id, question, multiple, anonymous, closes_at, created_by)
      values
        (${entrada.messageId}, ${entrada.channelId}, ${entrada.question}, ${entrada.multiple},
         ${entrada.anonymous}, ${entrada.closesAt}, ${entrada.createdBy})
      returning id, message_id, channel_id, question, multiple, anonymous,
                closes_at, closed_at, created_by, created_at
    `;
    const poll = linhas[0];
    if (!poll) throw new Error('a enquete não nasceu');

    // Uma a uma, e não um `insert` em lote: são no máximo seis, a ordem sai
    // garantida sem reordenar depois, e o helper de lote do postgres.js dentro
    // de uma transação briga com os tipos por um ganho que aqui não existe.
    const options: OptionRow[] = [];
    for (const [i, label] of entrada.opcoes.entries()) {
      const linha = await tx<OptionRow[]>`
        insert into poll_options (poll_id, label, position)
        values (${poll.id}, ${label}, ${i})
        returning id, poll_id, label, position
      `;
      const opcao = linha[0];
      if (!opcao) throw new Error('a opção não nasceu');
      options.push(opcao);
    }

    return { poll, options, votes: [] };
  }) as Promise<EnqueteCompleta>;
}

/**
 * Votar substitui o voto anterior inteiro.
 *
 * Apagar e inserir na mesma transação, e não "acrescentar": no voto único isso
 * é o que faz trocar de opção funcionar, e no múltiplo é o que faz desmarcar
 * uma alternativa funcionar. "Desfazer" separado não existe — votar de novo é
 * o desfazer.
 */
export async function votar(entrada: {
  pollId: string;
  userId: string;
  optionIds: readonly string[];
}): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`delete from poll_votes where poll_id = ${entrada.pollId} and user_id = ${entrada.userId}`;
    if (entrada.optionIds.length === 0) return;

    for (const optionId of entrada.optionIds) {
      await tx`
        insert into poll_votes (poll_id, option_id, user_id)
        values (${entrada.pollId}, ${optionId}, ${entrada.userId})
      `;
    }
  });
}

/** As opções que pertencem mesmo a esta enquete — o voto não atravessa urnas. */
export async function opcoesValidas(
  pollId: string,
  optionIds: readonly string[],
): Promise<boolean> {
  if (optionIds.length === 0) return true;
  const linhas = await sql<{ id: string }[]>`
    select id from poll_options where poll_id = ${pollId} and id in ${sql(optionIds as string[])}
  `;
  return linhas.length === new Set(optionIds).size;
}

/** Fecha, e devolve `null` se já estava fechada — fechar duas vezes não é erro. */
export async function fechar(id: string): Promise<PollRow | null> {
  const linhas = await sql<PollRow[]>`
    update polls set closed_at = now()
     where id = ${id} and closed_at is null
     returning ${CAMPOS}
  `;
  return linhas[0] ?? null;
}

/** As que passaram do prazo e ninguém fechou — o worker de fechamento. */
export async function vencidas(): Promise<PollRow[]> {
  return sql<PollRow[]>`
    select ${CAMPOS} from polls
     where closed_at is null and closes_at is not null and closes_at <= now()
  `;
}
