import { describe, expect, it } from 'vitest';
import { montarSecoes, rotuloDoDia } from '../src/features/messages/linhas';
import type { MensagemLocal } from '../src/features/messages/queries';

/**
 * As cinco condições de agrupamento e o divisor de dia.
 *
 * As datas destes casos são construídas com `new Date(ano, mes, dia, hora)` —
 * **hora local**, de propósito. `mesmaSequencia` compara o dia do calendário
 * de quem lê, e escrever os casos em UTC já produziu uma vez um teste que
 * falhava com a implementação certa.
 */

function msg(parcial: Partial<MensagemLocal> & { id: string; quando: Date }): MensagemLocal {
  const { quando, ...resto } = parcial;
  return {
    channelId: 'c1',
    author: { id: 'a', username: 'ana', displayName: 'Ana', avatarUrl: null },
    content: 'oi',
    parentId: null,
    replyToId: null,
    attachments: [],
    reactions: [],
    pinnedAt: null,
    saved: false,
    editedAt: null,
    deletedAt: null,
    createdAt: quando.toISOString(),
    ...resto,
  };
}

const dia = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m);

function chefes(secoes: ReturnType<typeof montarSecoes>): boolean[] {
  return secoes.flatMap((s) => s.linhas.map((l) => l.cabeca));
}

describe('montarSecoes', () => {
  it('agrupa duas do mesmo autor dentro de cinco minutos', () => {
    const linhas = montarSecoes([
      msg({ id: '1', quando: dia(4, 14, 30) }),
      msg({ id: '2', quando: dia(4, 14, 33) }),
    ]);
    expect(chefes(linhas)).toEqual([true, false]);
  });

  it('quebra o bloco aos cinco minutos', () => {
    const linhas = montarSecoes([
      msg({ id: '1', quando: dia(4, 14, 30) }),
      msg({ id: '2', quando: dia(4, 14, 35) }),
    ]);
    expect(chefes(linhas)).toEqual([true, true]);
  });

  it('quebra o bloco quando muda o autor', () => {
    const linhas = montarSecoes([
      msg({ id: '1', quando: dia(4, 14, 30) }),
      msg({
        id: '2',
        quando: dia(4, 14, 31),
        author: { id: 'b', username: 'bruno', displayName: 'Bruno', avatarUrl: null },
      }),
    ]);
    expect(chefes(linhas)).toEqual([true, true]);
  });

  it('não agrupa resposta nem o que vem depois dela', () => {
    const linhas = montarSecoes([
      msg({ id: '1', quando: dia(4, 14, 30) }),
      msg({ id: '2', quando: dia(4, 14, 31), replyToId: '1' }),
      msg({ id: '3', quando: dia(4, 14, 32) }),
    ]);
    expect(chefes(linhas)).toEqual([true, true, true]);
  });

  it('não agrupa mensagem de thread', () => {
    const linhas = montarSecoes([
      msg({ id: '1', quando: dia(4, 14, 30) }),
      msg({ id: '2', quando: dia(4, 14, 31), parentId: '1' }),
    ]);
    expect(chefes(linhas)).toEqual([true, true]);
  });

  it('abre uma seção por dia, e a primeira do dia vira cabeça de bloco', () => {
    // Um minuto de diferença, mesmo autor: só a virada do dia separa. Sem a
    // regra explícita, a segunda ficaria órfã logo abaixo da data, sem avatar.
    const secoes = montarSecoes([
      msg({ id: '1', quando: dia(4, 23, 59) }),
      msg({ id: '2', quando: dia(5, 0, 0) }),
    ]);
    expect(secoes).toHaveLength(2);
    expect(secoes.map((s) => s.linhas.length)).toEqual([1, 1]);
    expect(chefes(secoes)).toEqual([true, true]);
  });

  it('uma seção por dia, não uma por mensagem', () => {
    // A seção é o que prende o divisor grudado: com todos no mesmo pai,
    // `position: sticky` empilharia os divisores sobrepostos no topo.
    const secoes = montarSecoes([
      msg({ id: '1', quando: dia(4, 9) }),
      msg({ id: '2', quando: dia(4, 15) }),
      msg({ id: '3', quando: dia(4, 20) }),
    ]);
    expect(secoes).toHaveLength(1);
    expect(secoes[0]?.linhas).toHaveLength(3);
  });

  it('a seção guarda a data de uma mensagem daquele dia', () => {
    const secoes = montarSecoes([msg({ id: '1', quando: dia(4, 9) })]);
    expect(new Date(secoes[0]?.data ?? 0).getDate()).toBe(4);
  });

  it('lista vazia não produz seção nenhuma', () => {
    expect(montarSecoes([])).toEqual([]);
  });
});

describe('rotuloDoDia', () => {
  const agora = new Date(2026, 8, 4, 10, 0);

  it('diz hoje e ontem por extenso', () => {
    expect(rotuloDoDia(new Date(2026, 8, 4, 8, 0).toISOString(), agora)).toBe('hoje');
    expect(rotuloDoDia(new Date(2026, 8, 3, 23, 0).toISOString(), agora)).toBe('ontem');
  });

  it('compara o dia do calendário, não vinte e quatro horas', () => {
    // 23h de ontem e 1h de hoje são duas horas de distância e dias diferentes.
    expect(rotuloDoDia(new Date(2026, 8, 3, 23, 30).toISOString(), new Date(2026, 8, 4, 1, 0))).toBe(
      'ontem',
    );
  });

  it('antes disso, escreve a data', () => {
    const rotulo = rotuloDoDia(new Date(2026, 8, 1, 12, 0).toISOString(), agora);
    expect(rotulo).toContain('1');
    expect(rotulo.toLowerCase()).toContain('setembro');
  });

  it('inclui o ano quando é de outro ano', () => {
    expect(rotuloDoDia(new Date(2025, 11, 20, 12, 0).toISOString(), agora)).toContain('2025');
  });
});
