import type { Poll } from '@trindade/shared';
import type { EnqueteCompleta } from '../db/polls.js';

/**
 * A enquete como ela sai na API.
 *
 * **O anonimato mora aqui, e só aqui.** Numa enquete anônima, `voters` sai
 * vazio para todo mundo — inclusive para quem criou a enquete. Esconder os
 * nomes na interface e mandá-los na resposta seria prometer segredo e entregar
 * um `F12`. Ver design/08-projeto.md.
 */
export function toApiPoll(entrada: EnqueteCompleta, meuId: string): Poll {
  const { poll, options, votes } = entrada;

  return {
    id: poll.id,
    messageId: poll.message_id,
    channelId: poll.channel_id,
    question: poll.question,
    multiple: poll.multiple,
    anonymous: poll.anonymous,
    closesAt: poll.closes_at?.toISOString() ?? null,
    closedAt: poll.closed_at?.toISOString() ?? null,
    createdBy: poll.created_by,
    options: options.map((o) => {
      const desta = votes.filter((v) => v.option_id === o.id);
      return {
        id: o.id,
        label: o.label,
        count: desta.length,
        voters: poll.anonymous ? [] : desta.map((v) => v.user_id),
      };
    }),
    myVotes: votes.filter((v) => v.user_id === meuId).map((v) => v.option_id),
    // Pessoas, não votos: no múltiplo alguém marca três opções e continua
    // sendo uma pessoa. "4 de 5 votaram" tem de bater com o elenco.
    voterCount: new Set(votes.map((v) => v.user_id)).size,
  };
}
