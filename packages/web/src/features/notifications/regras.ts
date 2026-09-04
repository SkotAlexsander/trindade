import type { PreferenciasDeAviso } from './preferencias';
import { dentroDoNaoPerturbe } from './preferencias';

/**
 * A tabela de design/09-notificacoes.md, como função pura.
 *
 * Com cinco pessoas o problema não é falta de aviso, é excesso: cada regra aqui
 * existe para que uma notificação, quando chegar, signifique alguma coisa. E
 * como é decisão e não efeito, ela mora numa função sem `window`, sem `Audio` e
 * sem `Notification` — o teste roda a tabela inteira sem navegador nenhum.
 *
 * **Nada é decidido no servidor** além de `mention_count` em `read_state`. O
 * servidor manda o que aconteceu; o que fazer com isso é de quem recebe.
 */

export type Motivo = 'mencao' | 'aqui' | 'resposta' | 'thread' | 'tarefa' | 'canal' | 'prazo';

export interface Acontecimento {
  motivo: Motivo;
  channelId: string;
  /** Quem causou. `null` quando foi o sistema (prazo de tarefa). */
  autorId: string | null;
  /** Momento do acontecimento, para agrupar e para o cooldown. */
  quando: number;
}

export interface Contexto {
  meuId: string;
  prefs: PreferenciasDeAviso;
  /** A janela do produto está em foco? */
  emFoco: boolean;
  /** O canal do acontecimento está aberto na tela? */
  canalAberto: boolean;
  /** Presença "ocupado" — o não perturbe manual. */
  ocupado: boolean;
  /** Compartilhando a tela: a notificação apareceria para todo mundo. */
  compartilhandoTela: boolean;
  /** `muted_until` do canal, em milissegundos. `null` = não silenciado. */
  silenciadoAte: number | null;
  /** Quando este canal notificou pela última vez — o cooldown de 5 minutos. */
  ultimoAvisoDoCanal: number | null;
  /** Quem causou o último aviso deste canal, para agrupar. */
  ultimoAutorDoCanal: string | null;
  agora: number;
}

export interface Decisao {
  som: 'chamado' | 'thread' | null;
  desktop: boolean;
  /** Entra no contador do título. */
  badge: boolean;
  /** Atualiza a notificação anterior em vez de abrir outra. */
  agrupa: boolean;
}

const NADA: Decisao = { som: null, desktop: false, badge: false, agrupa: false };

/** Motivos que são alguém falando **com você**, e não perto de você. */
const DIRETOS: ReadonlySet<Motivo> = new Set(['mencao', 'aqui', 'resposta', 'tarefa']);

export const COOLDOWN_MS = 5 * 60 * 1000;
export const JANELA_DE_AGRUPAMENTO_MS = 60 * 1000;

export function decidir(evento: Acontecimento, ctx: Contexto): Decisao {
  // 1. Você mesmo. Parece óbvio e é o bug mais comum: responder na própria
  //    thread e receber aviso disso.
  if (evento.autorId === ctx.meuId) return NADA;

  const direto = DIRETOS.has(evento.motivo);

  // 2. Silenciado remove som, desktop e badge — mas **menção direta passa**.
  //    Silenciar um canal é dizer "não me interrompa com o fluxo", não "me
  //    esconda quando alguém fala comigo pelo nome".
  const silenciado = ctx.silenciadoAte !== null && ctx.silenciadoAte > ctx.agora;
  if (silenciado && !direto) return NADA;

  // 3. Mensagem de canal nunca passa daqui: o ponto na lista é o aviso dela.
  //    Enquete nova idem — nasce como mensagem de canal.
  if (evento.motivo === 'canal') return NADA;

  // 4. Você já está vendo. Aviso do que está na sua frente é ruído puro.
  if (ctx.emFoco && ctx.canalAberto) return NADA;

  const calado = ctx.ocupado || dentroDoNaoPerturbe(ctx.prefs, new Date(ctx.agora));

  /* 5. O cooldown vale para o que não é direto. Sem ele, uma conversa animada
        numa thread vira cinco notificações em dois minutos. */
  const dentroDoCooldown =
    ctx.ultimoAvisoDoCanal !== null && ctx.agora - ctx.ultimoAvisoDoCanal < COOLDOWN_MS;
  if (!direto && dentroDoCooldown) return NADA;

  /* 6. Agrupar: mensagens seguidas da mesma pessoa no mesmo canal em um minuto
        atualizam a notificação anterior em vez de abrir outra. O badge conta
        assim mesmo — o que se evita é a pilha na área de trabalho. */
  const agrupa =
    ctx.ultimoAutorDoCanal !== null &&
    ctx.ultimoAutorDoCanal === evento.autorId &&
    ctx.ultimoAvisoDoCanal !== null &&
    ctx.agora - ctx.ultimoAvisoDoCanal < JANELA_DE_AGRUPAMENTO_MS;

  // 7. Ocupado e não perturbe mantêm badge e pontos: quem está ocupado deve
  //    poder saber depois o que perdeu.
  if (calado) return { som: null, desktop: false, badge: direto, agrupa: false };

  // 8. Durante compartilhamento de tela, nada de desktop — a notificação
  //    apareceria na tela de todo mundo. O som continua: ele é seu.
  const desktop = !ctx.compartilhandoTela;

  if (evento.motivo === 'prazo') {
    // O lembrete das 9h avisa, mas não conta como coisa não lida: não há
    // mensagem nenhuma esperando você.
    return { som: null, desktop, badge: false, agrupa: false };
  }

  if (evento.motivo === 'thread') {
    return {
      som: ctx.prefs.somDeThread ? 'thread' : null,
      desktop,
      badge: true,
      agrupa,
    };
  }

  return {
    som: ctx.prefs.somDeChamado ? 'chamado' : null,
    desktop,
    badge: true,
    agrupa,
  };
}
