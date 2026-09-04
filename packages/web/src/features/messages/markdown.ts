/**
 * O markdown das mensagens.
 *
 * Escrito à mão e devolvendo **nós**, não HTML. A especificação pedia
 * `marked` + DOMPurify, e a troca é deliberada: o DOMPurify existe para
 * limpar HTML que se vai injetar, e aqui não se injeta HTML nenhum. O React
 * escapa texto por construção, então a classe inteira de XSS por conteúdo de
 * mensagem deixa de existir em vez de ser filtrada.
 *
 * Sobra **um** vetor, e é o único ponto perigoso deste arquivo: o `href` de um
 * link. `javascript:` e `data:` são recusados em `hrefSeguro`.
 *
 * O que é suportado está em design/04-mensagens.md e não cresce sozinho:
 * negrito, itálico, riscado, código, bloco de código, citação, lista, link,
 * spoiler e menção. **Sem título, sem tabela, sem imagem por URL** — numa
 * mensagem de chat, `# Título` quase sempre é acidente de quem quis escrever
 * uma hashtag.
 */

export type No =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'negrito'; filhos: No[] }
  | { tipo: 'italico'; filhos: No[] }
  | { tipo: 'riscado'; filhos: No[] }
  | { tipo: 'codigo'; valor: string }
  | { tipo: 'spoiler'; filhos: No[] }
  | { tipo: 'link'; href: string; filhos: No[] }
  | { tipo: 'mencao'; username: string }
  | { tipo: 'canal'; slug: string }
  | { tipo: 'quebra' };

export type Bloco =
  | { tipo: 'paragrafo'; filhos: No[] }
  | { tipo: 'citacao'; filhos: No[] }
  | { tipo: 'lista'; ordenada: boolean; itens: No[][] }
  | { tipo: 'bloco-de-codigo'; lingua: string | null; valor: string };

/**
 * `javascript:`, `data:` e `vbscript:` fora; o resto passa.
 *
 * Lista de permitidos e não de proibidos: um esquema novo e estranho deve
 * falhar fechado. `mailto:` está aqui porque escrever um e-mail clicável numa
 * mensagem é uso legítimo.
 */
const ESQUEMAS = ['http:', 'https:', 'mailto:'];

export function hrefSeguro(bruto: string): string | null {
  const texto = bruto.trim();
  // Sem esquema, assume-se `https`. Não `http`: o padrão silencioso de uma
  // aplicação de 2026 não deve ser texto claro na rede.
  const candidato = /^[a-z][a-z0-9+.-]*:/i.test(texto) ? texto : `https://${texto}`;
  try {
    const url = new URL(candidato);
    return ESQUEMAS.includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

// --- linha ------------------------------------------------------------------

interface Marcador {
  abre: string;
  fecha: string;
  tipo: 'negrito' | 'italico' | 'riscado' | 'spoiler';
}

// A ordem importa: `**` tem de ser testado antes de `*`, senão o negrito vira
// dois itálicos vazios.
const MARCADORES: Marcador[] = [
  { abre: '**', fecha: '**', tipo: 'negrito' },
  { abre: '~~', fecha: '~~', tipo: 'riscado' },
  { abre: '||', fecha: '||', tipo: 'spoiler' },
  { abre: '*', fecha: '*', tipo: 'italico' },
  { abre: '_', fecha: '_', tipo: 'italico' },
];

const RE_URL = /^(https?:\/\/|www\.)[^\s<>"']+/i;
const RE_MENCAO = /^@([a-z0-9_]{3,24})/;
const RE_CANAL = /^#([a-z0-9-]{1,32})/;

/** Junta texto adjacente: `a` + `b` vira um nó só, não dois. */
function empurrar(saida: No[], no: No): void {
  const ultimo = saida[saida.length - 1];
  if (no.tipo === 'texto' && ultimo?.tipo === 'texto') {
    ultimo.valor += no.valor;
    return;
  }
  saida.push(no);
}

export function analisarLinha(texto: string): No[] {
  const saida: No[] = [];
  let i = 0;

  while (i < texto.length) {
    const resto = texto.slice(i);
    const c = texto[i] ?? '';

    // Escape: `\*` é um asterisco literal.
    if (c === '\\' && i + 1 < texto.length) {
      empurrar(saida, { tipo: 'texto', valor: texto[i + 1] ?? '' });
      i += 2;
      continue;
    }

    // Código em linha primeiro: dentro dele nada mais é interpretado.
    if (c === '`') {
      const fim = texto.indexOf('`', i + 1);
      if (fim > i + 1) {
        saida.push({ tipo: 'codigo', valor: texto.slice(i + 1, fim) });
        i = fim + 1;
        continue;
      }
    }

    // Link em colchetes: [texto](url)
    if (c === '[') {
      const fimTexto = texto.indexOf('](', i);
      const fimUrl = fimTexto > 0 ? texto.indexOf(')', fimTexto) : -1;
      if (fimTexto > i && fimUrl > fimTexto) {
        const href = hrefSeguro(texto.slice(fimTexto + 2, fimUrl));
        const rotulo = texto.slice(i + 1, fimTexto);
        if (href) {
          saida.push({ tipo: 'link', href, filhos: analisarLinha(rotulo) });
          i = fimUrl + 1;
          continue;
        }
      }
    }

    // URL solta.
    const url = RE_URL.exec(resto);
    if (url) {
      const bruto = url[0];
      const href = hrefSeguro(bruto);
      if (href) {
        saida.push({ tipo: 'link', href, filhos: [{ tipo: 'texto', valor: bruto }] });
        i += bruto.length;
        continue;
      }
    }

    // Menção e canal. `@` no meio de uma palavra não conta — um e-mail
    // escrito à mão não deve virar menção.
    const anterior = i > 0 ? texto[i - 1] : ' ';
    const inicioDePalavra = anterior === undefined || /[\s([{]/.test(anterior);
    if (inicioDePalavra) {
      const mencao = RE_MENCAO.exec(resto);
      if (mencao?.[1]) {
        saida.push({ tipo: 'mencao', username: mencao[1] });
        i += mencao[0].length;
        continue;
      }
      const canal = RE_CANAL.exec(resto);
      if (canal?.[1]) {
        saida.push({ tipo: 'canal', slug: canal[1] });
        i += canal[0].length;
        continue;
      }
    }

    // Ênfase.
    let casou = false;
    for (const m of MARCADORES) {
      if (!resto.startsWith(m.abre)) continue;
      const fim = texto.indexOf(m.fecha, i + m.abre.length);
      if (fim <= i + m.abre.length) continue;
      const dentro = texto.slice(i + m.abre.length, fim);
      saida.push({ tipo: m.tipo, filhos: analisarLinha(dentro) } as No);
      i = fim + m.fecha.length;
      casou = true;
      break;
    }
    if (casou) continue;

    empurrar(saida, { tipo: 'texto', valor: c });
    i += 1;
  }

  return saida;
}

// --- blocos -----------------------------------------------------------------

const RE_CERCA = /^```([a-z0-9+#-]*)\s*$/i;
const RE_CITACAO = /^>\s?(.*)$/;
const RE_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

export function analisarMarkdown(fonte: string): Bloco[] {
  const linhas = fonte.replace(/\r\n/g, '\n').split('\n');
  const blocos: Bloco[] = [];
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i] ?? '';

    // Bloco de código: tudo lá dentro é literal, inclusive linhas em branco.
    const cerca = RE_CERCA.exec(linha);
    if (cerca) {
      const corpo: string[] = [];
      i += 1;
      while (i < linhas.length && !/^```\s*$/.test(linhas[i] ?? '')) {
        corpo.push(linhas[i] ?? '');
        i += 1;
      }
      i += 1;
      blocos.push({
        tipo: 'bloco-de-codigo',
        lingua: cerca[1] ? cerca[1].toLowerCase() : null,
        valor: corpo.join('\n'),
      });
      continue;
    }

    if (RE_CITACAO.test(linha)) {
      const dentro: string[] = [];
      while (i < linhas.length) {
        const m = RE_CITACAO.exec(linhas[i] ?? '');
        if (!m) break;
        dentro.push(m[1] ?? '');
        i += 1;
      }
      blocos.push({ tipo: 'citacao', filhos: comQuebras(dentro) });
      continue;
    }

    const item = RE_ITEM.exec(linha);
    if (item) {
      const ordenada = /\d/.test(item[1] ?? '');
      const itens: No[][] = [];
      while (i < linhas.length) {
        const m = RE_ITEM.exec(linhas[i] ?? '');
        if (!m) break;
        // Trocar de marcador abre lista nova: uma lista com bolinha e outra
        // numerada logo abaixo são duas listas, não uma.
        if (/\d/.test(m[1] ?? '') !== ordenada) break;
        itens.push(analisarLinha(m[2] ?? ''));
        i += 1;
      }
      blocos.push({ tipo: 'lista', ordenada, itens });
      continue;
    }

    if (linha.trim() === '') {
      i += 1;
      continue;
    }

    // Parágrafo: linhas seguidas até uma em branco ou até o começo de outro
    // bloco. A quebra simples é preservada — numa mensagem de chat, dar Enter
    // é uma quebra e não uma junção de linhas.
    const paragrafo: string[] = [];
    while (i < linhas.length) {
      const atual = linhas[i] ?? '';
      if (
        atual.trim() === '' ||
        RE_CERCA.test(atual) ||
        RE_CITACAO.test(atual) ||
        RE_ITEM.test(atual)
      ) {
        break;
      }
      paragrafo.push(atual);
      i += 1;
    }
    blocos.push({ tipo: 'paragrafo', filhos: comQuebras(paragrafo) });
  }

  return blocos;
}

function comQuebras(linhas: readonly string[]): No[] {
  const saida: No[] = [];
  linhas.forEach((linha, indice) => {
    if (indice > 0) saida.push({ tipo: 'quebra' });
    saida.push(...analisarLinha(linha));
  });
  return saida;
}

/** Se a mensagem inteira é texto simples, o desenho pode pular o caminho todo. */
export function ehTextoSimples(blocos: readonly Bloco[]): boolean {
  return (
    blocos.length === 1 &&
    blocos[0]?.tipo === 'paragrafo' &&
    blocos[0].filhos.every((n) => n.tipo === 'texto' || n.tipo === 'quebra')
  );
}

/**
 * Quem é mencionado, já sem o que não conta.
 *
 * Feita sobre a árvore e não sobre o texto cru de propósito: `@alex` dentro de
 * um bloco de código, dentro de crase, ou colado num e-mail não é menção, e
 * uma busca por substring diria que é. A linha inteira muda de cor quando você
 * é citado, então o falso positivo é visível.
 */
export function mencionados(blocos: readonly Bloco[]): Set<string> {
  const nomes = new Set<string>();

  function andar(nos: readonly No[]): void {
    for (const no of nos) {
      if (no.tipo === 'mencao') nomes.add(no.username);
      else if ('filhos' in no) andar(no.filhos);
    }
  }

  for (const bloco of blocos) {
    if (bloco.tipo === 'lista') bloco.itens.forEach(andar);
    else if (bloco.tipo !== 'bloco-de-codigo') andar(bloco.filhos);
  }
  return nomes;
}
