import { describe, expect, it } from 'vitest';
import type { Poll } from '@trindade/shared';
import { comMeuVoto, prazoDaEnquete } from '../src/features/polls/queries';

/**
 * O voto otimista.
 *
 * Clicar numa opção move a barra na hora, antes de o servidor responder. A
 * conta que faz isso é a que pode mentir: se ela errar, a tela mostra um
 * resultado que o servidor vai desmentir um segundo depois.
 */

function enquete(parcial: Partial<Poll> = {}): Poll {
  return {
    id: 'p1',
    messageId: 'm1',
    channelId: 'c1',
    question: 'Janela de deploy?',
    multiple: false,
    anonymous: false,
    closesAt: null,
    closedAt: null,
    createdBy: 'u1',
    options: [
      { id: 'a', label: 'Terça', count: 0, voters: [] },
      { id: 'b', label: 'Quinta', count: 0, voters: [] },
    ],
    myVotes: [],
    voterCount: 0,
    ...parcial,
  };
}

describe('comMeuVoto', () => {
  it('primeiro voto conta a opção e conta a pessoa', () => {
    const depois = comMeuVoto(enquete(), ['a']);
    expect(depois.options[0]?.count).toBe(1);
    expect(depois.voterCount).toBe(1);
    expect(depois.myVotes).toEqual(['a']);
  });

  it('trocar de opção move o voto sem mexer na contagem de pessoas', () => {
    const antes = enquete({
      options: [
        { id: 'a', label: 'Terça', count: 1, voters: [] },
        { id: 'b', label: 'Quinta', count: 0, voters: [] },
      ],
      myVotes: ['a'],
      voterCount: 1,
    });

    const depois = comMeuVoto(antes, ['b']);
    expect(depois.options[0]?.count).toBe(0);
    expect(depois.options[1]?.count).toBe(1);
    // Continua sendo uma pessoa: quem troca de opinião não vira duas.
    expect(depois.voterCount).toBe(1);
  });

  it('lista vazia tira o voto e tira a pessoa da contagem', () => {
    const antes = enquete({
      options: [
        { id: 'a', label: 'Terça', count: 1, voters: [] },
        { id: 'b', label: 'Quinta', count: 0, voters: [] },
      ],
      myVotes: ['a'],
      voterCount: 1,
    });

    const depois = comMeuVoto(antes, []);
    expect(depois.options[0]?.count).toBe(0);
    expect(depois.voterCount).toBe(0);
    expect(depois.myVotes).toEqual([]);
  });

  it('no múltiplo, marcar duas opções continua sendo uma pessoa', () => {
    const depois = comMeuVoto(enquete({ multiple: true }), ['a', 'b']);
    expect(depois.options[0]?.count).toBe(1);
    expect(depois.options[1]?.count).toBe(1);
    expect(depois.voterCount).toBe(1);
  });

  it('não conta duas vezes quem já votava numa das opções', () => {
    const antes = enquete({
      multiple: true,
      options: [
        { id: 'a', label: 'Terça', count: 1, voters: [] },
        { id: 'b', label: 'Quinta', count: 0, voters: [] },
      ],
      myVotes: ['a'],
      voterCount: 1,
    });

    const depois = comMeuVoto(antes, ['a', 'b']);
    expect(depois.options[0]?.count).toBe(1);
    expect(depois.options[1]?.count).toBe(1);
    expect(depois.voterCount).toBe(1);
  });
});

describe('prazoDaEnquete', () => {
  const agora = Date.parse('2026-09-04T12:00:00Z');
  const daqui = (ms: number) => new Date(agora + ms).toISOString();

  it('sem prazo não diz nada', () => {
    expect(prazoDaEnquete(enquete(), agora)).toBeNull();
  });

  it('fechada é encerrada, tenha prazo ou não', () => {
    expect(prazoDaEnquete(enquete({ closedAt: daqui(0) }), agora)).toBe('encerrada');
  });

  /* O prazo vencido conta como encerrada antes de o worker passar: entre o
     fim e a próxima faxina, a tela não pode convidar para votar. */
  it('prazo vencido é encerrada mesmo com closedAt nulo', () => {
    expect(prazoDaEnquete(enquete({ closesAt: daqui(-60_000) }), agora)).toBe('encerrada');
  });

  it('conta em horas no mesmo dia e em dias depois disso', () => {
    expect(prazoDaEnquete(enquete({ closesAt: daqui(3 * 3_600_000) }), agora)).toBe('fecha em 3 h');
    expect(prazoDaEnquete(enquete({ closesAt: daqui(26 * 3_600_000) }), agora)).toBe('fecha amanhã');
    expect(prazoDaEnquete(enquete({ closesAt: daqui(72 * 3_600_000) }), agora)).toBe(
      'fecha em 3 dias',
    );
  });
});
