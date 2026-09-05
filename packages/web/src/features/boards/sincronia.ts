/**
 * A tradução entre a cena do Excalidraw e o `Y.Map` do quadro.
 *
 * Fica separada da tela de propósito: é aqui que mora a regra de quem ganha
 * quando duas pessoas mexem no mesmo elemento, e essa regra se testa com dois
 * objetos e nenhum navegador. Ver design/11-quadro.md.
 */

export interface ElementoDoQuadro {
  id: string;
  /** Sobe a cada alteração do elemento. É o relógio do Excalidraw. */
  version: number;
  /** Sorteado a cada alteração — serve para desempatar versões iguais. */
  versionNonce: number;
  /**
   * Índice fracionário do Excalidraw: a ordem de empilhamento como texto, para
   * caber entre dois vizinhos sem reescrever a cena. É o que devolve o z-order
   * depois de um mapa, que não guarda ordem nenhuma.
   */
  index?: string | null;
  /**
   * Apagar não remove: marca. É assim que o desfazer de uma pessoa não
   * ressuscita o traço de outra — e é por isso que o mapa só cresce.
   */
  isDeleted?: boolean;
  [campo: string]: unknown;
}

/**
 * Quem ganha quando os dois lados mexeram no mesmo elemento.
 *
 * Versão maior ganha; empate desempata pelo `versionNonce`, comparando
 * números. O desempate precisa dar o **mesmo** resultado nos dois navegadores
 * — se cada um escolher o seu, os dois se sobrescrevem em eco até alguém
 * fechar a aba.
 */
export function ganha(novo: ElementoDoQuadro, atual: ElementoDoQuadro | undefined): boolean {
  if (!atual) return true;
  if (novo.version !== atual.version) return novo.version > atual.version;
  if (novo.versionNonce !== atual.versionNonce) return novo.versionNonce > atual.versionNonce;
  return false;
}

/**
 * Uma cópia funda, e ela **não** é zelo excessivo.
 *
 * O Excalidraw altera os elementos no lugar, e o `Y.Map` guarda o objeto que
 * recebeu — em memória, sem copiar nada. Guardar a referência faz as duas
 * pontas apontarem para o mesmo objeto: a comparação seguinte compara o
 * elemento com ele mesmo, conclui que nada mudou, e o traço que continuou
 * crescendo depois do primeiro instante nunca chega ao outro lado.
 *
 * Foi assim que um retângulo saiu daqui como um ponto de 0×0 e apareceu como
 * um ponto no navegador da outra pessoa, enquanto no desenhista estava inteiro.
 */
function copiar(elemento: ElementoDoQuadro): ElementoDoQuadro {
  return structuredClone(elemento);
}

/**
 * O que a cena local tem de novo em relação ao mapa.
 *
 * Devolve só os elementos que mudaram: escrever a cena inteira a cada traço
 * geraria um delta do tamanho do quadro a cada movimento do mouse.
 */
export function mudancasParaOMapa(
  cena: readonly ElementoDoQuadro[],
  noMapa: (id: string) => ElementoDoQuadro | undefined,
): ElementoDoQuadro[] {
  const mudou: ElementoDoQuadro[] = [];
  for (const elemento of cena) {
    if (ganha(elemento, noMapa(elemento.id))) mudou.push(copiar(elemento));
  }
  return mudou;
}

/**
 * A cena a desenhar, a partir do mapa.
 *
 * O `Y.Map` não guarda ordem, e no Excalidraw a ordem do vetor **é** o
 * empilhamento: sem ordenar pelo índice fracionário, cada recarregamento
 * embaralharia o que está na frente de quê.
 */
export function cenaDoMapa(valores: Iterable<unknown>): ElementoDoQuadro[] {
  // Copiados na volta também: o que sai daqui vai para dentro do Excalidraw,
  // que altera elemento no lugar. Sem a cópia, ele passaria a alterar o valor
  // que está dentro do `Y.Map` — e o mapa deixaria de ser o que os outros veem.
  const elementos = [...valores].filter((v): v is ElementoDoQuadro => ehElemento(v)).map(copiar);
  return elementos.sort((a, b) => {
    const ia = a.index ?? '';
    const ib = b.index ?? '';
    if (ia === ib) return a.id.localeCompare(b.id);
    return ia < ib ? -1 : 1;
  });
}

/** Quantos elementos estão desenhados — o que foi apagado não conta. */
export function contarVisiveis(valores: Iterable<unknown>): number {
  let total = 0;
  for (const valor of valores) {
    if (ehElemento(valor) && valor.isDeleted !== true) total += 1;
  }
  return total;
}

function ehElemento(valor: unknown): valor is ElementoDoQuadro {
  if (typeof valor !== 'object' || valor === null) return false;
  const alvo = valor as { id?: unknown; version?: unknown };
  return typeof alvo.id === 'string' && typeof alvo.version === 'number';
}
