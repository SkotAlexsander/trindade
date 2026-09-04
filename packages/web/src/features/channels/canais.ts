import type { Channel } from '@trindade/shared';

export interface ChannelWithState extends Channel {
  unread: boolean;
  mentions: number;
}

/**
 * Estado de leitura ainda não existe — `read_state` só é alimentado na fase 5.
 * Até lá, um valor derivado do id mantém a lista com os quatro estados
 * visíveis para revisão, e sai junto com a chegada do dado real.
 */
export function withPlaceholderState(channels: Channel[]): ChannelWithState[] {
  return channels.map((channel, indice) => ({
    ...channel,
    unread: indice === 1 || indice === 2,
    mentions: indice === 2 ? 3 : 0,
  }));
}

export interface Category {
  nome: string | null;
  canais: ChannelWithState[];
}

/** Agrupa preservando a ordem que o servidor devolveu. */
export function groupByCategory(channels: ChannelWithState[]): Category[] {
  const grupos: Category[] = [];
  for (const canal of channels) {
    const chave = canal.category;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nome === chave) ultimo.canais.push(canal);
    else grupos.push({ nome: chave, canais: [canal] });
  }
  return grupos;
}

/** Primeiro canal não lido, ou `geral`, ou o primeiro que houver. */
export function primeiroDestino(channels: ChannelWithState[]): ChannelWithState | undefined {
  return (
    channels.find((c) => c.kind === 'text' && (c.mentions > 0 || c.unread)) ??
    channels.find((c) => c.slug === 'geral') ??
    channels.find((c) => c.kind === 'text')
  );
}
