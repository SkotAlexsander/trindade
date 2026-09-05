import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Todo `var(--x)` do CSS aponta para um token que existe?
 *
 * Este teste nasceu de um apagão silencioso. Seis arquivos usavam
 * `--weight-regular`, `--weight-semibold`, `--bg-base` e `--dur-fast`, que
 * nunca foram definidos — os nomes certos são `--weight-normal`,
 * `--weight-semi`, e por aí. Eram 64 usos.
 *
 * O que torna isso pior do que um erro comum é o silêncio: uma `var()` que não
 * resolve deixa a declaração **inválida no tempo de cálculo**, e a propriedade
 * cai para o valor herdado. Como quase todas estavam num `font:` abreviado —
 * e `font` é herdada — meia dúzia de telas simplesmente usavam a tipografia do
 * elemento pai. Nenhum erro no console, nenhum aviso do compilador, nenhuma
 * tela obviamente quebrada: só tamanhos errados que ninguém sabia que estavam
 * errados.
 *
 * O CSS não tem compilador para pegar isso. Este teste é o compilador.
 */

// `fileURLToPath`, e não `.pathname`: o caminho deste projeto tem espaço, e o
// `pathname` de uma URL o entrega como `%20`.
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

/** Comentário é conversa, não código: o que está dentro dele não conta. */
function semComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const arquivos = todosOsCss(RAIZ);
const definidos = new Set<string>();

for (const caminho of arquivos) {
  const css = semComentarios(readFileSync(caminho, 'utf8'));
  for (const [, nome] of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) definidos.add(nome!);
}

// Variáveis que o TypeScript define em `style` inline também valem.
function todosOsTsx(dir: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) achados.push(...todosOsTsx(caminho));
    else if (nome.endsWith('.tsx') || nome.endsWith('.ts')) achados.push(caminho);
  }
  return achados;
}

for (const caminho of todosOsTsx(RAIZ)) {
  const fonte = readFileSync(caminho, 'utf8');
  for (const [, nome] of fonte.matchAll(/['"](--[a-z0-9-]+)['"]/g)) definidos.add(nome!);
}

describe('os tokens de CSS', () => {
  it('existem todos os que são usados', () => {
    const orfaos: string[] = [];

    for (const caminho of arquivos) {
      const css = semComentarios(readFileSync(caminho, 'utf8'));
      css.split('\n').forEach((linha, i) => {
        for (const [, usado] of linha.matchAll(/var\((--[a-z0-9-]+)/g)) {
          // Com valor de reserva a declaração sobrevive; sem, ela morre.
          const temReserva = new RegExp(`var\\(${usado}\\s*,`).test(linha);
          if (!definidos.has(usado!) && !temReserva) {
            orfaos.push(`${caminho.split(/[\\/]/).slice(-2).join('/')}:${i + 1}  ${usado}`);
          }
        }
      });
    }

    expect(orfaos).toEqual([]);
  });

  it('não sobrou valor literal de cor fora do arquivo de tokens', () => {
    // A primeira linha de `tokens.css` promete isto desde a fase 1. Vinte e
    // poucos literais tinham escapado — `#fff` e `rgba(0,0,0,…)` sobre mídia,
    // cada um com uma opacidade diferente do vizinho.
    const fugitivos: string[] = [];
    const cor = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

    for (const caminho of arquivos) {
      if (caminho.endsWith('tokens.css')) continue;
      const css = semComentarios(readFileSync(caminho, 'utf8'));
      css.split('\n').forEach((linha, i) => {
        // Tira os `var()` antes de procurar: uma cor **dentro** de uma sombra
        // composta continua sendo literal, e deixar a linha inteira passar por
        // causa de um token no começo dela é o buraco por onde eles voltam.
        const resto = linha.replace(/var\(--[a-z0-9-]+\)/g, '');
        if (!cor.test(resto)) return;
        fugitivos.push(`${caminho.split(/[\\/]/).slice(-2).join('/')}:${i + 1}  ${linha.trim()}`);
      });
    }

    expect(fugitivos).toEqual([]);
  });
});
