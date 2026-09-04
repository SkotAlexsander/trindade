import type { Channel } from '@trindade/shared';

export interface ChannelWithState extends Channel {
  unread: boolean;
  mentions: number;
}

/**
 * Junta os canais com o estado de leitura de verdade.
 *
 * Substituiu o valor de espaço reservado da fase 4, que derivava "não lido" do
 * índice na lista — útil para revisar os quatro estados, e mentira assim que
 * alguém usava o produto.
 */
export function withReadState(
  channels: readonly Channel[],
  leitura: Record<string, { unreadCount: number; mentionCount: number }>,
): ChannelWithState[] {
  return channels.map((channel) => {
    const estado = leitura[channel.id];
    return {
      ...channel,
      unread: (estado?.unreadCount ?? 0) > 0,
      mentions: estado?.mentionCount ?? 0,
    };
  });
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
