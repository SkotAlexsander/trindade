import { describe, expect, it } from 'vitest';
import {
  AA_TEXT,
  contrastRatio,
  ensureContrast,
  parseHex,
  sobrepor,
} from '../src/lib/contraste';

/**
 * Cor de cargo é escolhida por gente, num seletor de cores, sem pensar no
 * fundo. Alguém vai escolher azul-marinho, e no tema escuro ele fica
 * invisível. Estas regras são o que impede o nome do cargo de sumir.
 */

function razao(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) throw new Error(`hex inválido: ${a} / ${b}`);
  return contrastRatio(ca, cb);
}

const ESCURO = '#101a2e';
const CLARO = '#ffffff';

describe('ensureContrast', () => {
  it('não mexe no que já é legível', () => {
    expect(ensureContrast('#ffffff', ESCURO)).toBe('#ffffff');
  });

  it('clareia cor escura sobre fundo escuro', () => {
    const ajustada = ensureContrast('#0b1d5c', ESCURO);
    expect(ajustada).not.toBe('#0b1d5c');
    expect(razao(ajustada, ESCURO)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('escurece cor clara sobre fundo claro', () => {
    const ajustada = ensureContrast('#ffe680', CLARO);
    expect(razao(ajustada, CLARO)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('preserva o matiz — o cargo continua reconhecível', () => {
    // Azul entra, azul sai: o canal azul segue sendo o maior dos três.
    const ajustada = parseHex(ensureContrast('#0b1d5c', ESCURO));
    expect(ajustada).not.toBeNull();
    expect(ajustada?.b).toBeGreaterThan(ajustada?.r ?? 0);
    expect(ajustada?.b).toBeGreaterThan(ajustada?.g ?? 0);
  });

  it('devolve a entrada quando o hex não presta', () => {
    expect(ensureContrast('vermelho', ESCURO)).toBe('vermelho');
  });

  it('aguenta preto sobre preto', () => {
    const ajustada = ensureContrast('#000000', '#000000');
    expect(razao(ajustada, '#000000')).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('sobrepor', () => {
  it('a 0% é o fundo, a 100% é a cor', () => {
    expect(sobrepor('#ff0000', '#000000', 0)).toBe('#000000');
    expect(sobrepor('#ff0000', '#000000', 1)).toBe('#ff0000');
  });

  it('a 12% fica muito mais perto do fundo', () => {
    const misturado = sobrepor('#ff0000', '#000000', 0.12);
    expect(parseHex(misturado)?.r).toBeLessThan(60);
  });
});

describe('o chip de cargo', () => {
  /**
   * A regra do chip, exatamente como o componente a aplica: primeiro a cor
   * legível sobre a superfície, depois a pílula a 12% **dessa** cor.
   */
  function chip(cor: string, superficie: string) {
    const base = ensureContrast(cor, superficie);
    const fundo = sobrepor(base, superficie, 0.12);
    return { fundo, texto: ensureContrast(base, fundo) };
  }

  it('mantém o texto legível nos dois temas', () => {
    for (const superficie of [ESCURO, CLARO]) {
      for (const cor of ['#0b1d5c', '#ffe680', '#22d3ee', '#111111', '#f5f5f5']) {
        const { fundo, texto } = chip(cor, superficie);
        expect(razao(texto, fundo), `${cor} sobre ${superficie}`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('a pílula aparece mesmo com cor escura em tema escuro', () => {
    // Tingir com o hex cru devolveria o próprio fundo, e o chip sumiria: 12%
    // de azul-marinho sobre um fundo quase preto não muda nada.
    const cru = sobrepor('#0b1d5c', ESCURO, 0.12);
    const { fundo } = chip('#0b1d5c', ESCURO);
    expect(razao(cru, ESCURO)).toBeLessThan(1.1);
    expect(razao(fundo, ESCURO)).toBeGreaterThan(1.1);
  });
});
