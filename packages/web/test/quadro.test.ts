import { describe, expect, it } from 'vitest';
import {
  cenaDoMapa,
  contarVisiveis,
  ganha,
  mudancasParaOMapa,
  type ElementoDoQuadro,
} from '../src/features/boards/sincronia';

/**
 * A ponte entre a cena do Excalidraw e o `Y.Map` do quadro.
 *
 * Testada sem navegador porque é o pedaço onde mora a regra de convergência: se
 * o desempate der resultados diferentes nos dois lados, dois navegadores se
 * sobrescrevem em eco até alguém fechar a aba — e isso não aparece numa captura
 * de tela. Ver design/11-quadro.md.
 */

function elemento(
  id: string,
  version: number,
  extras: Partial<ElementoDoQuadro> = {},
): ElementoDoQuadro {
  return { id, version, versionNonce: version * 10, ...extras };
}

describe('quem ganha', () => {
  it('a versão maior', () => {
    expect(ganha(elemento('a', 2), elemento('a', 1))).toBe(true);
    expect(ganha(elemento('a', 1), elemento('a', 2))).toBe(false);
  });

  it('elemento que o mapa não conhece entra sempre', () => {
    expect(ganha(elemento('novo', 1), undefined)).toBe(true);
  });

  it('a mesma versão não reescreve nada', () => {
    const igual = elemento('a', 3);
    expect(ganha(igual, { ...igual })).toBe(false);
  });

  it('empate de versão desempata pelo nonce, e nos dois lados igual', () => {
    const meu = { id: 'a', version: 5, versionNonce: 100 };
    const dela = { id: 'a', version: 5, versionNonce: 900 };

    // O ponto: as duas perguntas dão respostas opostas. Se dessem a mesma, os
    // dois navegadores continuariam escrevendo um por cima do outro para
    // sempre.
    expect(ganha(dela, meu)).toBe(true);
    expect(ganha(meu, dela)).toBe(false);
  });
});

describe('o que vai para o mapa', () => {
  it('só o que mudou', () => {
    const mapa = new Map<string, ElementoDoQuadro>([
      ['a', elemento('a', 1)],
      ['b', elemento('b', 4)],
    ]);

    const mudou = mudancasParaOMapa(
      [elemento('a', 1), elemento('b', 5), elemento('c', 1)],
      (id) => mapa.get(id),
    );

    // 'a' está igual: escrevê-lo seria um delta por movimento de mouse.
    expect(mudou.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('devolve cópias, e não o próprio objeto da cena', () => {
    const original = elemento('a', 1);
    const [copia] = mudancasParaOMapa([original], () => undefined);

    expect(copia).toEqual(original);
    /* O ponto: o Excalidraw altera os elementos no lugar e o `Y.Map` guarda o
       objeto que recebeu. Guardar a referência faria a comparação seguinte
       comparar o elemento com ele mesmo — e o traço que cresceu depois do
       primeiro instante nunca sairia daqui. */
    expect(copia).not.toBe(original);
  });

  it('apagar é uma mudança como outra qualquer', () => {
    const mapa = new Map<string, ElementoDoQuadro>([['a', elemento('a', 1)]]);
    const mudou = mudancasParaOMapa([elemento('a', 2, { isDeleted: true })], (id) => mapa.get(id));
    expect(mudou).toHaveLength(1);
    expect(mudou[0]?.isDeleted).toBe(true);
  });
});

describe('a cena que vem do mapa', () => {
  it('sai na ordem do índice fracionário, não na do mapa', () => {
    const cena = cenaDoMapa([
      elemento('c', 1, { index: 'a3' }),
      elemento('a', 1, { index: 'a1' }),
      elemento('b', 1, { index: 'a2' }),
    ]);

    // No Excalidraw a ordem do vetor **é** o empilhamento: sem ordenar, cada
    // recarregamento trocaria o que está na frente de quê.
    expect(cena.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('sem índice, o id decide — e decide igual nos dois lados', () => {
    const cena = cenaDoMapa([elemento('z', 1), elemento('a', 1)]);
    expect(cena.map((e) => e.id)).toEqual(['a', 'z']);
  });

  it('também devolve cópias: o Excalidraw altera o que recebe', () => {
    const guardado = elemento('a', 1, { index: 'a1' });
    const [saiu] = cenaDoMapa([guardado]);
    expect(saiu).not.toBe(guardado);
  });

  it('ignora o que não é elemento', () => {
    const cena = cenaDoMapa([elemento('a', 1), null, 'lixo', { semId: true }]);
    expect(cena).toHaveLength(1);
  });
});

describe('a contagem do limite', () => {
  it('não conta o que foi apagado', () => {
    const valores = [
      elemento('a', 1),
      elemento('b', 2, { isDeleted: true }),
      elemento('c', 1),
    ];
    // O Excalidraw marca em vez de remover: contar as chaves diria que um
    // quadro esvaziado continua cheio.
    expect(contarVisiveis(valores)).toBe(2);
  });
});
