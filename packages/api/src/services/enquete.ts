import * as pollsDb from '../db/polls.js';
import { toApiPoll } from './poll-view.js';
import { gateway } from '../ws/index.js';

/**
 * A enquete conversando com o canal.
 *
 * Um `POLL_UPDATE` **por pessoa**, e não um broadcast só. `myVotes` é do lado
 * de quem recebe, e numa enquete aberta a lista de quem votou também depende de
 * quem pergunta — numa anônima ela nem sai. Montar o payload uma vez e mandar
 * para todos entregaria a cada um o voto de outra pessoa marcado como o seu.
 *
 * São cinco pessoas: montar cinco payloads é barato, e é o preço de o
 * anonimato ser uma regra do servidor e não um jeito de desenhar.
 */
export async function anunciarEnquete(pollId: string): Promise<void> {
  const completa = await pollsDb.completa(pollId);
  if (!completa) return;

  for (const userId of gateway.online()) {
    gateway.sendToUser(userId, { op: 'POLL_UPDATE', d: { poll: toApiPoll(completa, userId) } });
  }
}

/**
 * Fecha as que passaram do prazo.
 *
 * Roda junto da faxina, de hora em hora — e a precisão de hora não é frouxidão
 * porque **a rota de voto já recusa** depois do prazo, tenha o worker passado
 * ou não. Este laço é o que faz a tela dizer "encerrada" para quem está com ela
 * aberta; a regra em si não depende dele.
 */
export async function fecharVencidas(): Promise<number> {
  const vencidas = await pollsDb.vencidas();
  for (const enquete of vencidas) {
    await pollsDb.fechar(enquete.id);
    await anunciarEnquete(enquete.id);
  }
  return vencidas.length;
}
