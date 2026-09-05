import { randomBytes } from 'node:crypto';
import type { LinkPreview } from '@trindade/shared';
import { RecusadoNaBusca, buscarExterno, validarUrl } from '../lib/busca-externa.js';
import { reencodar, sniffImagem } from '../lib/imagem.js';
import { idDoYoutube, segundosDoYoutube } from '../lib/youtube.js';

/**
 * A prévia de link, buscada pelo servidor.
 *
 * Quem lê nunca toca no site de origem — nem para o texto, nem para a
 * miniatura. Se o navegador de quem lê baixasse a imagem da prévia, o dono do
 * link colheria o IP de todo mundo que abriu a conversa, e a metade cuidadosa
 * do trabalho não teria servido para nada. É o mesmo princípio de privacidade
 * das chamadas, aplicado ao texto — ver design/04-mensagens.md.
 *
 * O cache mora na memória. Com cinco pessoas e um punhado de links por dia,
 * uma tabela seria cerimônia; reiniciar o processo custa uma busca a mais.
 */

const HTML_MAXIMO = 512 * 1024;
const IMAGEM_MAXIMA = 4 * 1024 * 1024;

const VIDA_MS = 6 * 60 * 60 * 1000;
/** Falha vale menos tempo: o site pode estar só de pé errado hoje. */
const VIDA_DA_FALHA_MS = 10 * 60 * 1000;
const CAPACIDADE = 200;

interface Entrada {
  ate: number;
  previa: LinkPreview | null;
  thumb: { bytes: Buffer; contentType: string } | null;
  /** O endereço público da miniatura. Aleatório — ver `idDaMiniatura`. */
  idDoThumb: string | null;
}

const cache = new Map<string, Entrada>();
/** Duas pessoas abrindo o mesmo canal não podem virar duas buscas. */
const emVoo = new Map<string, Promise<LinkPreview | null>>();

function guardar(chave: string, entrada: Entrada): void {
  cache.delete(chave);
  cache.set(chave, entrada);
  while (cache.size > CAPACIDADE) {
    const maisVelha = cache.keys().next();
    if (maisVelha.done) break;
    cache.delete(maisVelha.value);
  }
}

/**
 * O endereço da miniatura é **aleatório**, não derivado da URL.
 *
 * Era `sha256(url)` cortado em 22 caracteres, e isso transformava a rota num
 * oráculo: quem suspeitasse de um link podia calcular o mesmo hash e perguntar
 * ao servidor se aquela URL já tinha sido compartilhada aqui. A resposta —
 * 200 ou 404 — contava.
 *
 * 24 bytes aleatórios não se adivinham, e é a mesma regra que já vale para
 * anexo e avatar em `lib/storage.ts`: quem tem a URL tem o arquivo, e a URL só
 * existe para quem recebeu o cartão.
 */
function idDaMiniatura(): string {
  return randomBytes(24).toString('base64url');
}

export function thumbEmCache(id: string): { bytes: Buffer; contentType: string } | null {
  for (const entrada of cache.values()) {
    if (entrada.thumb && entrada.idDoThumb === id) return entrada.thumb;
  }
  return null;
}

/** `null` quando não há prévia a mostrar — e isso nunca é um erro para quem lê. */
export async function previaDeLink(bruto: string): Promise<LinkPreview | null> {
  const url = validarUrl(bruto).href;

  const guardada = cache.get(url);
  if (guardada && guardada.ate > Date.now()) {
    cache.delete(url);
    cache.set(url, guardada);
    return guardada.previa;
  }

  const jaIndo = emVoo.get(url);
  if (jaIndo) return jaIndo;

  const promessa = montar(url).finally(() => emVoo.delete(url));
  emVoo.set(url, promessa);
  return promessa;
}

/** O oEmbed do YouTube cabe em meio quilobyte; a página de assistir, não. */
const OEMBED_MAXIMO = 16 * 1024;

/**
 * Vídeo do YouTube: o cartão sai do **oEmbed**, não da página.
 *
 * A página de assistir tem mais de um megabyte e o teto da busca externa é de
 * 512 KB — legítimo, e é o que impede um site hostil de nos fazer baixar um
 * arquivo enorme. O resultado era que todo link do YouTube caía sem cartão.
 *
 * O oEmbed é a porta que o próprio YouTube abre para isto: devolve título,
 * autor e a miniatura em algumas centenas de bytes, num formato estável. A
 * miniatura continua passando pelo `sharp` e sendo servida do nosso domínio,
 * como a de qualquer outro cartão — quem lê não toca no Google até apertar o
 * play. Ver `features/messages/Video.tsx`.
 */
async function montarVideo(url: string, id: string): Promise<LinkPreview | null> {
  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

  let dados: { title?: string; author_name?: string; thumbnail_url?: string };
  try {
    const resposta = await buscarExterno(oembed, {
      maxBytes: OEMBED_MAXIMO,
      aceita: (ct) => ct === 'application/json' || ct === 'text/javascript',
    });
    dados = JSON.parse(resposta.corpo.toString('utf8')) as typeof dados;
  } catch {
    // Vídeo privado, removido, ou o YouTube fora do ar: cai no caminho comum,
    // que tenta a página e provavelmente também não dá em nada. Um link sem
    // cartão continua sendo um link que funciona.
    return null;
  }

  if (!dados.title) return null;

  const thumb = await miniatura(dados.thumbnail_url, oembed);
  const idDoThumb = thumb ? idDaMiniatura() : null;
  const previa: LinkPreview = {
    url,
    title: cortar(dados.title, 160),
    // O canal no lugar da descrição: é o que diz de quem é o vídeo, e o
    // oEmbed não devolve descrição nenhuma.
    description: dados.author_name ? cortar(dados.author_name, 120) : null,
    siteName: 'YouTube',
    thumbUrl: idDoThumb ? `/api/link-preview/thumb/${idDoThumb}` : null,
    thumbWidth: thumb?.width ?? null,
    thumbHeight: thumb?.height ?? null,
    video: { provider: 'youtube', id, startAt: segundosDoYoutube(url) },
  };

  guardar(url, {
    ate: Date.now() + VIDA_MS,
    previa,
    thumb: thumb ? { bytes: thumb.bytes, contentType: thumb.contentType } : null,
    idDoThumb,
  });
  return previa;
}

async function montar(url: string): Promise<LinkPreview | null> {
  const idDeVideo = idDoYoutube(url);
  if (idDeVideo) {
    const video = await montarVideo(url, idDeVideo);
    if (video) return video;
  }

  let pagina: Awaited<ReturnType<typeof buscarExterno>>;
  try {
    pagina = await buscarExterno(url, {
      maxBytes: HTML_MAXIMO,
      aceita: (ct) => ct === 'text/html' || ct === 'application/xhtml+xml',
    });
  } catch (err) {
    if (!(err instanceof RecusadoNaBusca)) throw err;
    guardar(url, { ate: Date.now() + VIDA_DA_FALHA_MS, previa: null, thumb: null, idDoThumb: null });
    return null;
  }

  const meta = lerMeta(pagina.corpo);
  const titulo = meta['og:title'] ?? meta['twitter:title'] ?? meta['<title>'] ?? null;
  const descricao =
    meta['og:description'] ?? meta['twitter:description'] ?? meta['description'] ?? null;

  // Sem título não há cartão: um retângulo com só o domínio dentro é ruído.
  if (!titulo) {
    guardar(url, { ate: Date.now() + VIDA_DA_FALHA_MS, previa: null, thumb: null, idDoThumb: null });
    return null;
  }

  const thumb = await miniatura(meta['og:image'] ?? meta['twitter:image'], pagina.url);
  const idDoThumb = thumb ? idDaMiniatura() : null;

  const previa: LinkPreview = {
    url,
    title: cortar(titulo, 160),
    description: descricao ? cortar(descricao, 320) : null,
    siteName: meta['og:site_name'] ? cortar(meta['og:site_name'], 64) : new URL(url).hostname,
    thumbUrl: idDoThumb ? `/api/link-preview/thumb/${idDoThumb}` : null,
    thumbWidth: thumb?.width ?? null,
    thumbHeight: thumb?.height ?? null,
    /* O identificador sai da **URL**, não do HTML: o que a página diz sobre si
       mesma é metadado de terceiro, e isto vira `src` de um iframe. */
    video: idDeVideo
      ? { provider: 'youtube', id: idDeVideo, startAt: segundosDoYoutube(url) }
      : null,
  };

  guardar(url, {
    ate: Date.now() + VIDA_MS,
    previa,
    thumb: thumb ? { bytes: thumb.bytes, contentType: thumb.contentType } : null,
    idDoThumb,
  });
  return previa;
}

async function miniatura(
  bruta: string | undefined,
  base: string,
): Promise<{ bytes: Buffer; contentType: string; width: number; height: number } | null> {
  if (!bruta) return null;
  try {
    // A URL da imagem vem do mesmo lugar que o resto: de um estranho. Ela
    // passa pela guarda inteira outra vez, incluindo a do endereço.
    const absoluta = validarUrl(new URL(bruta, base).href).href;
    const arquivo = await buscarExterno(absoluta, {
      maxBytes: IMAGEM_MAXIMA,
      aceita: (ct) => ct.startsWith('image/'),
    });
    // O re-encode não é só sobre metadado aqui: é o que garante que o byte
    // servido de dentro do nosso domínio saiu do `sharp`, e não da mão de quem
    // escolheu o link.
    if (!sniffImagem(arquivo.corpo)) return null;
    const imagem = await reencodar(arquivo.corpo, false);
    return {
      bytes: imagem.buffer,
      contentType: imagem.contentType,
      width: imagem.width,
      height: imagem.height,
    };
  } catch {
    // Cartão sem imagem continua sendo um cartão útil.
    return null;
  }
}

function cortar(texto: string, limite: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1)}…`;
}

// --- leitura do HTML -------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function desescapar(texto: string): string {
  return texto.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (inteiro, nome: string) => {
    const chave = nome.toLowerCase();
    const conhecida = ENTIDADES[chave];
    if (conhecida !== undefined) return conhecida;
    if (chave.startsWith('#x')) {
      const n = parseInt(chave.slice(2), 16);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : inteiro;
    }
    if (chave.startsWith('#')) {
      const n = parseInt(chave.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : inteiro;
    }
    return inteiro;
  });
}

/**
 * As poucas etiquetas de que a prévia precisa.
 *
 * Não é um parser de HTML e não pretende ser: nada daqui vira marcação, só
 * texto que a interface desenha como texto. Ler `<meta>` e `<title>` com
 * expressão regular é suficiente exatamente porque a saída não pode virar nó
 * nenhum — é a mesma razão pela qual o markdown do projeto dispensa DOMPurify.
 */
export function lerMeta(bruto: Buffer): Record<string, string> {
  const html = decodificar(bruto);
  const achados: Record<string, string> = {};

  // O `>` pode morar **dentro** de um atributo — `content="a > b"`, ou um
  // título que cite HTML. Parar no primeiro `>` cortaria a etiqueta ao meio e
  // perderia justamente esses casos, então as aspas são atravessadas inteiras.
  for (const [, atributos] of html.matchAll(/<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = lerAtributos(atributos ?? '');
    const chave = attrs['property'] ?? attrs['name'];
    const valor = attrs['content'];
    if (!chave || !valor) continue;
    // O primeiro vence: páginas repetem `og:image` e a de cima é a principal.
    achados[chave.toLowerCase()] ??= desescapar(valor);
  }

  const titulo = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titulo?.[1]) achados['<title>'] = desescapar(titulo[1]);

  return achados;
}

function lerAtributos(bruto: string): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [, nome, comAspas, comApostrofo, nu] of bruto.matchAll(
    /([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
  )) {
    if (nome) saida[nome.toLowerCase()] = comAspas ?? comApostrofo ?? nu ?? '';
  }
  return saida;
}

/** Respeita o `charset` declarado; cai em UTF-8 quando não dá para saber. */
function decodificar(bruto: Buffer): string {
  const inicio = bruto.subarray(0, 4096).toString('latin1');
  const declarado = /charset\s*=\s*["']?([\w-]+)/i.exec(inicio)?.[1]?.toLowerCase();
  if (declarado && declarado !== 'utf-8' && declarado !== 'utf8') {
    try {
      return new TextDecoder(declarado, { fatal: false }).decode(bruto);
    } catch {
      /* codificação que o Node não conhece: segue em UTF-8 */
    }
  }
  return bruto.toString('utf8');
}

/** Só para os testes: o cache é um módulo, e um teste não pode herdar o outro. */
export function limparCacheDePrevias(): void {
  cache.clear();
  emVoo.clear();
}
