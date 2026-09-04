import type { HighlighterCore } from 'shiki/core';

/**
 * Realce de sintaxe.
 *
 * O Shiki inteiro traz duzentas linguagens e sessenta temas. Aqui entram
 * **oito** linguagens e um tema, pelo caminho de granularidade fina, e tudo
 * isso desce num pedaço separado que só é buscado quando alguém escreve o
 * primeiro bloco de código. Uma conversa sem código nunca paga por isto.
 *
 * O motor é o de JavaScript, não o WASM do Oniguruma: são centenas de
 * kilobytes a menos e, para as linguagens desta lista, o resultado é o mesmo.
 */

/** O que uma equipe de cinco pessoas escreve numa conversa de trabalho. */
const LINGUAS = {
  ts: () => import('shiki/langs/typescript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  js: () => import('shiki/langs/javascript.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  sh: () => import('shiki/langs/shellscript.mjs'),
  bash: () => import('shiki/langs/shellscript.mjs'),
  shell: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  py: () => import('shiki/langs/python.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  yml: () => import('shiki/langs/yaml.mjs'),
} as const;

export type Lingua = keyof typeof LINGUAS;

export function linguaConhecida(nome: string | null): Lingua | null {
  if (!nome) return null;
  const chave = nome.toLowerCase();
  return chave in LINGUAS ? (chave as Lingua) : null;
}

let realcador: Promise<HighlighterCore> | null = null;
const carregadas = new Set<string>();

async function obter(): Promise<HighlighterCore> {
  realcador ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, tema] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      // Base escura de tom azulado, que é a única da coleção que não briga
      // com a paleta. As cores vêm ajustadas por CSS em cima dela.
      import('shiki/themes/github-dark-default.mjs'),
    ]);

    return createHighlighterCore({
      themes: [tema.default],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return realcador;
}

export interface Pedaco {
  texto: string;
  cor: string | undefined;
}

/**
 * Devolve as linhas em pedaços coloridos, ou `null` se a linguagem não estiver
 * na lista.
 *
 * **Pedaços e não HTML.** O Shiki sabe devolver HTML pronto, e usá-lo exigiria
 * `dangerouslySetInnerHTML` — que é justamente o que este projeto não faz com
 * conteúdo de mensagem. Com os tokens, o React desenha e escapa por
 * construção. Ver `markdown.ts`, mesma decisão.
 *
 * `null` não é erro: o bloco continua aparecendo, só sem cor. Uma linguagem
 * fora da lista não pode fazer a mensagem sumir.
 */
export async function realcar(codigo: string, lingua: Lingua): Promise<Pedaco[][] | null> {
  try {
    const shiki = await obter();
    if (!carregadas.has(lingua)) {
      const modulo = await LINGUAS[lingua]();
      await shiki.loadLanguage(modulo.default);
      carregadas.add(lingua);
    }
    const { tokens } = shiki.codeToTokens(codigo, {
      lang: lingua,
      theme: 'github-dark-default',
    });
    return tokens.map((linha) => linha.map((t) => ({ texto: t.content, cor: t.color })));
  } catch {
    return null;
  }
}
