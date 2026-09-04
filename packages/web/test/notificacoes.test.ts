import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_MS,
  decidir,
  type Acontecimento,
  type Contexto,
} from '../src/features/notifications/regras';
import { PADRAO, dentroDoNaoPerturbe } from '../src/features/notifications/preferencias';

/**
 * As regras de design/09-notificacoes.md.
 *
 * A decisão é uma função pura de propósito, e é aqui que ela se prova: cada
 * caso abaixo é uma linha da tabela ou uma das quatro regras contra ruído.
 * Testar isso pela interface exigiria um navegador com permissão de
 * notificação, foco de janela e relógio controlado.
 */

const EU = 'eu';
const OUTRO = 'outra-pessoa';
const AGORA = Date.parse('2026-09-04T14:00:00');

function ctx(parcial: Partial<Contexto> = {}): Contexto {
  return {
    meuId: EU,
    prefs: { ...PADRAO },
    emFoco: false,
    canalAberto: false,
    ocupado: false,
    compartilhandoTela: false,
    silenciadoAte: null,
    ultimoAvisoDoCanal: null,
    ultimoAutorDoCanal: null,
    agora: AGORA,
    ...parcial,
  };
}

function evento(parcial: Partial<Acontecimento> = {}): Acontecimento {
  return { motivo: 'mencao', channelId: 'c1', autorId: OUTRO, quando: AGORA, ...parcial };
}

describe('o que gera notificação', () => {
  it('menção toca, mostra e conta', () => {
    expect(decidir(evento(), ctx())).toEqual({
      som: 'chamado',
      desktop: true,
      badge: true,
      agrupa: false,
    });
  });

  it('thread tem som próprio, mais discreto', () => {
    expect(decidir(evento({ motivo: 'thread' }), ctx()).som).toBe('thread');
  });

  it('mensagem de canal não notifica — o ponto na lista é o aviso dela', () => {
    expect(decidir(evento({ motivo: 'canal' }), ctx())).toEqual({
      som: null,
      desktop: false,
      badge: false,
      agrupa: false,
    });
  });

  it('o lembrete de prazo mostra sem tocar e sem contar', () => {
    const d = decidir(evento({ motivo: 'prazo', autorId: null }), ctx());
    expect(d).toEqual({ som: null, desktop: true, badge: false, agrupa: false });
  });
});

describe('regras contra ruído', () => {
  /* O bug mais comum do gênero: responder na própria thread e receber aviso. */
  it('nada do que você fez notifica você', () => {
    expect(decidir(evento({ autorId: EU }), ctx()).som).toBeNull();
    expect(decidir(evento({ autorId: EU, motivo: 'thread' }), ctx()).badge).toBe(false);
  });

  it('nada notifica se a janela está em foco e o canal está aberto', () => {
    expect(decidir(evento(), ctx({ emFoco: true, canalAberto: true })).som).toBeNull();
  });

  it('mas notifica se a janela está em foco com outro canal aberto', () => {
    expect(decidir(evento(), ctx({ emFoco: true, canalAberto: false })).som).toBe('chamado');
  });

  it('compartilhando a tela, o som fica e o desktop some', () => {
    // A notificação apareceria na tela de todo mundo; o som é só seu.
    const d = decidir(evento(), ctx({ compartilhandoTela: true }));
    expect(d.som).toBe('chamado');
    expect(d.desktop).toBe(false);
  });

  it('agrupa mensagens seguidas da mesma pessoa no mesmo canal', () => {
    const juntas = ctx({
      ultimoAutorDoCanal: OUTRO,
      ultimoAvisoDoCanal: AGORA - 20_000,
    });
    expect(decidir(evento(), juntas).agrupa).toBe(true);

    // Outra pessoa é outra notificação, mesmo dentro do minuto.
    const deOutro = ctx({ ultimoAutorDoCanal: 'terceiro', ultimoAvisoDoCanal: AGORA - 20_000 });
    expect(decidir(evento(), deOutro).agrupa).toBe(false);
  });

  it('o cooldown segura a thread e não segura a menção', () => {
    const recente = ctx({ ultimoAvisoDoCanal: AGORA - COOLDOWN_MS / 2 });
    expect(decidir(evento({ motivo: 'thread' }), recente).desktop).toBe(false);
    // Menção direta atravessa o cooldown: é alguém falando com você.
    expect(decidir(evento({ motivo: 'mencao' }), recente).desktop).toBe(true);

    const antigo = ctx({ ultimoAvisoDoCanal: AGORA - COOLDOWN_MS - 1 });
    expect(decidir(evento({ motivo: 'thread' }), antigo).desktop).toBe(true);
  });
});

describe('silenciar e não perturbe', () => {
  it('canal silenciado cala o fluxo e deixa passar a menção direta', () => {
    const mudo = ctx({ silenciadoAte: AGORA + 3_600_000 });

    expect(decidir(evento({ motivo: 'thread' }), mudo)).toEqual({
      som: null,
      desktop: false,
      badge: false,
      agrupa: false,
    });
    // "Não me interrompa com o fluxo" não é "me esconda quando falam comigo".
    expect(decidir(evento({ motivo: 'mencao' }), mudo).som).toBe('chamado');
    expect(decidir(evento({ motivo: 'resposta' }), mudo).desktop).toBe(true);
  });

  it('silêncio vencido volta a notificar', () => {
    const venceu = ctx({ silenciadoAte: AGORA - 1 });
    expect(decidir(evento({ motivo: 'thread' }), venceu).desktop).toBe(true);
  });

  it('ocupado mantém o badge e cala som e desktop', () => {
    // Quem está ocupado deve poder saber depois o que perdeu.
    const d = decidir(evento(), ctx({ ocupado: true }));
    expect(d).toEqual({ som: null, desktop: false, badge: true, agrupa: false });
  });

  it('não perturbe agendado cala como o ocupado', () => {
    const prefs = { ...PADRAO, naoPerturbe: true, naoPerturbeDe: '13:00', naoPerturbeAte: '15:00' };
    const d = decidir(evento(), ctx({ prefs }));
    expect(d.som).toBeNull();
    expect(d.badge).toBe(true);
  });

  it('preferência de som desligada tira o som e mantém o resto', () => {
    const semSom = ctx({ prefs: { ...PADRAO, somDeChamado: false } });
    const d = decidir(evento(), semSom);
    expect(d.som).toBeNull();
    expect(d.desktop).toBe(true);
    expect(d.badge).toBe(true);
  });
});

describe('dentroDoNaoPerturbe', () => {
  const as = (hhmm: string) => new Date(`2026-09-04T${hhmm}:00`);

  it('desligado é sempre fora', () => {
    expect(dentroDoNaoPerturbe({ ...PADRAO, naoPerturbe: false }, as('23:00'))).toBe(false);
  });

  /* "Das 22h às 8h" é o caso normal, e é o que um intervalo simples erra: a
     madrugada, que é justamente o que se quer calar, ficaria de fora. */
  it('atravessa a meia-noite', () => {
    const p = { ...PADRAO, naoPerturbe: true, naoPerturbeDe: '22:00', naoPerturbeAte: '08:00' };
    expect(dentroDoNaoPerturbe(p, as('23:30'))).toBe(true);
    expect(dentroDoNaoPerturbe(p, as('03:00'))).toBe(true);
    expect(dentroDoNaoPerturbe(p, as('07:59'))).toBe(true);
    expect(dentroDoNaoPerturbe(p, as('08:00'))).toBe(false);
    expect(dentroDoNaoPerturbe(p, as('14:00'))).toBe(false);
  });

  it('intervalo dentro do mesmo dia funciona como se espera', () => {
    const p = { ...PADRAO, naoPerturbe: true, naoPerturbeDe: '13:00', naoPerturbeAte: '15:00' };
    expect(dentroDoNaoPerturbe(p, as('14:00'))).toBe(true);
    expect(dentroDoNaoPerturbe(p, as('12:59'))).toBe(false);
  });

  it('começo igual ao fim é intervalo vazio, e não o dia inteiro', () => {
    const p = { ...PADRAO, naoPerturbe: true, naoPerturbeDe: '09:00', naoPerturbeAte: '09:00' };
    expect(dentroDoNaoPerturbe(p, as('09:00'))).toBe(false);
  });
});
