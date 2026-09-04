import type { Channel, User } from '@trindade/shared';
import { EMOJIS, buscarEmojis } from './emojis';

/**
 * O que está sendo completado no compositor.
 *
 * Fora do componente porque é a parte que rende teste: onde o gatilho começa,
 * quando ele deixa de valer, e o que conta como parte do termo.
 * Ver design/04-mensagens.md, "Autocompletar".
 */

export type TipoDeGatilho = '@' | '#' | ':';

export interface Gatilho {
  tipo: TipoDeGatilho;
  /** O que veio depois do gatilho, sem ele. Pode ser vazio. */
  termo: string;
  /** Índice do caractere de gatilho no texto. */
  inicio: number;
}

/** Depois disto, quem digitou já desistiu do gatilho e está escrevendo. */
const TERMO_MAXIMO = 32;

/**
 * Encontra o gatilho ativo antes do cursor, se houver.
 *
 * O gatilho só vale no começo de uma palavra: `alguem@exemplo.com` não abre a
 * lista de pessoas, e é o caso que aparece toda vez que alguém escreve um
 * e-mail.
 */
export function gatilhoAtivo(texto: string, cursor: number): Gatilho | null {
  for (let i = cursor - 1; i >= 0 && cursor - i <= TERMO_MAXIMO + 1; i -= 1) {
    const c = texto[i];
    if (c === undefined) break;

    // Espaço antes de achar o gatilho: não há gatilho aberto.
    if (/\s/.test(c)) return null;

    if (c === '@' || c === '#' || c === ':') {
      const anterior = i > 0 ? texto[i - 1] : ' ';
      if (anterior !== undefined && !/[\s([{]/.test(anterior)) return null;
      return { tipo: c, termo: texto.slice(i + 1, cursor), inicio: i };
    }
  }
  return null;
}

export interface Sugestao {
  chave: string;
  /** O que aparece na lista. */
  rotulo: string;
  /** Segunda linha, quando ajuda a desambiguar. */
  detalhe?: string;
  /** Emoji ou inicial, à esquerda. */
  simbolo?: string;
  /** O que substitui o gatilho no texto, já com o espaço final. */
  troca: string;
}

const MAXIMO = 8;

function combina(texto: string, termo: string): boolean {
  if (!termo) return true;
  return texto.toLowerCase().startsWith(termo.toLowerCase());
}

/**
 * As sugestões de um gatilho.
 *
 * Com `@` sozinho já lista as cinco pessoas: exigir uma letra antes de mostrar
 * cinco nomes é cerimônia. Ver CLAUDE.md, "o elenco é fixo".
 */
export function sugerir(
  gatilho: Gatilho,
  pessoas: readonly User[],
  canais: readonly Channel[],
): Sugestao[] {
  const termo = gatilho.termo;

  if (gatilho.tipo === '@') {
    return pessoas
      .filter((p) => combina(p.username, termo) || combina(p.displayName, termo))
      .slice(0, MAXIMO)
      .map((p) => ({
        chave: p.id,
        rotulo: p.displayName,
        detalhe: `@${p.username}`,
        troca: `@${p.username} `,
      }));
  }

  if (gatilho.tipo === '#') {
    return canais
      .filter((c) => c.kind === 'text' && combina(c.name, termo))
      .slice(0, MAXIMO)
      .map((c) => ({
        chave: c.id,
        rotulo: `#${c.name}`,
        ...(c.topic ? { detalhe: c.topic } : {}),
        troca: `#${c.slug} `,
      }));
  }

  // `:` sem nada listaria a coleção inteira sem informação nenhuma. Duas
  // letras é o ponto em que a lista passa a dizer algo.
  if (termo.length < 2) return [];
  return buscarEmojis(termo, MAXIMO).map((e) => ({
    chave: e.char,
    rotulo: e.nomes[0] ?? e.char,
    simbolo: e.char,
    troca: `${e.char} `,
  }));
}

export { EMOJIS };
