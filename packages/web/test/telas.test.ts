import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TELAS } from '../src/lib/telas';

/**
 * Os breakpoints do CSS são os quatro de `lib/telas.ts`, e só eles.
 *
 * Media query não aceita `var()` — os números precisam estar escritos em cada
 * folha. O que dá para impedir é a quinta largura aparecer sem que ninguém
 * decida que ela existe: um `@media (max-width: 760px)` solto num módulo é
 * como a interface passa a mudar de forma em lugares que ninguém documentou, e
 * a quebra fica entre dois breakpoints onde ninguém olha.
 */

const RAIZ = fileURLToPath(new URL('../src', import.meta.url));

function todosOsCss(dir: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) achados.push(...todosOsCss(caminho));
    else if (nome.endsWith('.css')) achados.push(caminho);
  }
  return achados;
}

describe('as larguras em que a interface muda', () => {
  it('todo `@media` de largura usa um dos breakpoints nomeados', () => {
    const permitidos = new Set(Object.values(TELAS).map(String));
    const fora: string[] = [];

    for (const caminho of todosOsCss(RAIZ)) {
      const css = readFileSync(caminho, 'utf8');
      css.split('\n').forEach((linha, i) => {
        /* Só `@media`. `@container` mede a **caixa do elemento**, não a
           janela, e tem os limiares dele: a grade da chamada muda de arranjo
           conforme o espaço que sobrou para ela, o que não tem relação com o
           tamanho do monitor. */
        if (!linha.trimStart().startsWith('@media')) return;
        for (const [, largura] of linha.matchAll(/\(m(?:in|ax)-width:\s*(\d+)px\)/g)) {
          if (!permitidos.has(largura!)) {
            fora.push(`${caminho.split(/[\\/]/).slice(-2).join('/')}:${i + 1}  ${largura}px`);
          }
        }
      });
    }

    expect(fora).toEqual([]);
  });

  it('e os breakpoints sobem, sem repetir', () => {
    const valores = Object.values(TELAS);
    expect([...valores].sort((a, b) => a - b)).toEqual(valores);
    expect(new Set(valores).size).toBe(valores.length);
  });
});
