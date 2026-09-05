import sharp from 'sharp';
import { encode as encodeBlurhash } from 'blurhash';

/**
 * Toda imagem é re-encodada antes de chegar ao disco.
 *
 * Foto de celular carrega EXIF com coordenadas de GPS. Servir o arquivo
 * original faz cada pessoa publicar onde mora sem saber — ver
 * docs/04-seguranca.md, "Upload de arquivo". O re-encode resolve três coisas
 * de uma vez: o metadado some, o formato é validado de verdade (se não for
 * imagem, o `sharp` lança) e `limitInputPixels` barra a bomba de descompressão.
 *
 * **Nenhum byte original de upload chega ao disco.**
 */

/** Um PNG de 2 KB que vira 10 GB na memória para aqui. */
const PIXELS_MAXIMOS = 50_000_000;

/** O maior lado que guardamos. A lightbox não precisa de mais que isto. */
const LADO_MAXIMO = 1920;

export interface ImagemProcessada {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  blurhash: string | null;
}

/**
 * O tipo real do arquivo, pelos bytes.
 *
 * A extensão e o `Content-Type` declarado são os dois controlados por quem
 * envia; nenhum dos dois entra nesta decisão. SVG fica **de fora** de propósito:
 * é um formato de imagem que também é um documento com script, e rasterizar SVG
 * de terceiro abre uma porta que nada aqui precisa. Ele cai como arquivo
 * comum, baixado e nunca renderizado.
 */
export function sniffImagem(buf: Buffer): 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  const seis = buf.subarray(0, 6).toString('latin1');
  if (seis === 'GIF87a' || seis === 'GIF89a') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const marca = buf.subarray(8, 12).toString('latin1');
    if (marca.startsWith('avif') || marca.startsWith('avis') || marca.startsWith('heic')) {
      return 'avif';
    }
  }
  return null;
}

/** Re-encoda para WebP, tirando todo metadado no caminho. */
export async function reencodar(bruto: Buffer, animada: boolean): Promise<ImagemProcessada> {
  const entrada = sharp(bruto, { limitInputPixels: PIXELS_MAXIMOS, animated: animada });
  const meta = await entrada.metadata();

  const saida = await sharp(bruto, { limitInputPixels: PIXELS_MAXIMOS, animated: animada })
    // `rotate()` sem argumento aplica a orientação do EXIF e depois a descarta:
    // sem ele, a foto tirada de lado chega deitada.
    .rotate()
    .resize(LADO_MAXIMO, LADO_MAXIMO, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  // Numa imagem animada `pageHeight` é a altura de um quadro; `height` é a
  // tira inteira empilhada, e usá-la faria a miniatura nascer com a proporção
  // de uma coluna de fotos.
  const alturaDeQuadro = animada
    ? (meta.pageHeight ?? saida.info.pageHeight ?? saida.info.height)
    : saida.info.height;

  return {
    buffer: saida.data,
    contentType: 'image/webp',
    width: saida.info.width,
    height: alturaDeQuadro,
    blurhash: await calcularBlurhash(saida.data),
  };
}

/**
 * A mancha colorida que ocupa o lugar da imagem enquanto ela carrega.
 *
 * Falhar aqui não pode derrubar o upload: sem blurhash a imagem aparece sobre
 * um retângulo neutro, e o arquivo continua perfeitamente bom.
 */
async function calcularBlurhash(webp: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(webp)
      .raw()
      .ensureAlpha()
      .resize(32, 32, { fit: 'inside' })
      .toBuffer({ resolveWithObject: true });
    return encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    return null;
  }
}

/** O lado do avatar. 256 basta: ele nunca aparece maior que 64 na interface. */
const LADO_DO_AVATAR = 256;

/**
 * O avatar: quadrado, 256×256, cortado pelo centro.
 *
 * `fit: 'cover'` e não `contain` porque o avatar é sempre um círculo na
 * interface — sobra branca em volta apareceria como um anel.
 *
 * O pipeline é o mesmo de `reencodar`, e pela mesma razão: o metadado some, o
 * formato é validado de verdade, e o `limitInputPixels` barra a bomba de
 * descompressão. Ver docs/04-seguranca.md.
 */
export async function reencodarAvatar(bruto: Buffer): Promise<ImagemProcessada> {
  const saida = await sharp(bruto, { limitInputPixels: PIXELS_MAXIMOS })
    .rotate()
    .resize(LADO_DO_AVATAR, LADO_DO_AVATAR, { fit: 'cover' })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: saida.data,
    contentType: 'image/webp',
    width: saida.info.width,
    height: saida.info.height,
    blurhash: await calcularBlurhash(saida.data),
  };
}

/** A miniatura do quadro, do tamanho do cartão do painel. */
const LARGURA_DA_MINIATURA = 400;
const ALTURA_DA_MINIATURA = 300;

/**
 * A miniatura de um quadro: 400×300, cortada pelo centro.
 *
 * Ela nasce no navegador, pelo `exportToBlob` do Excalidraw, e mesmo assim
 * passa por aqui. Não é desconfiança do desenho: é que **nenhum byte de upload
 * chega ao disco sem re-encode**, e uma exceção "só para esta rota" é como a
 * regra deixa de valer. De quebra, o PNG de saída do Excalidraw vira um WebP
 * cinco vezes menor.
 */
export async function reencodarMiniatura(bruto: Buffer): Promise<ImagemProcessada> {
  const saida = await sharp(bruto, { limitInputPixels: PIXELS_MAXIMOS })
    .rotate()
    .resize(LARGURA_DA_MINIATURA, ALTURA_DA_MINIATURA, { fit: 'cover' })
    .webp({ quality: 78 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: saida.data,
    contentType: 'image/webp',
    width: saida.info.width,
    height: saida.info.height,
    blurhash: null,
  };
}
