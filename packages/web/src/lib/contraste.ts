/**
 * Contraste WCAG para cor de cargo.
 *
 * Cargo tem cor livre escolhida por quem administra, e alguém vai escolher um
 * azul-marinho ilegível sobre o fundo escuro. A cor original fica no banco
 * intacta; o ajuste acontece só na exibição. Ver design/01-tokens.md.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb | null {
  const limpo = hex.trim().replace(/^#/, '');
  const cheio =
    limpo.length === 3
      ? limpo
          .split('')
          .map((c) => c + c)
          .join('')
      : limpo;
  if (!/^[0-9a-fA-F]{6}$/.test(cheio)) return null;
  return {
    r: parseInt(cheio.slice(0, 2), 16),
    g: parseInt(cheio.slice(2, 4), 16),
    b: parseInt(cheio.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const parte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${parte(r)}${parte(g)}${parte(b)}`;
}

/** Luminância relativa da WCAG 2.1. */
export function luminance({ r, g, b }: Rgb): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razão de contraste entre duas cores, de 1 (igual) a 21 (preto sobre branco). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const claro = Math.max(la, lb);
  const escuro = Math.min(la, lb);
  return (claro + 0.05) / (escuro + 0.05);
}

// --- HSL, para clarear ou escurecer sem mudar o matiz --------------------

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / delta + 2) / 6;
  else h = ((rn - gn) / delta + 4) / 6;

  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: canal(h + 1 / 3) * 255, g: canal(h) * 255, b: canal(h - 1 / 3) * 255 };
}

export const AA_TEXT = 4.5;

/**
 * Ajusta a cor até atingir o contraste mínimo contra o fundo.
 *
 * Anda pela luminosidade em HSL preservando matiz e saturação — clareando sobre
 * fundo escuro, escurecendo sobre fundo claro. Se nem o branco (ou o preto)
 * puro alcançar o alvo, devolve o extremo: melhor um cinza legível do que uma
 * cor bonita que ninguém lê.
 */
export function ensureContrast(color: string, background: string, minimo = AA_TEXT): string {
  const cor = parseHex(color);
  const fundo = parseHex(background);
  if (!cor || !fundo) return color;

  if (contrastRatio(cor, fundo) >= minimo) return color;

  const fundoEscuro = luminance(fundo) < 0.5;
  const hsl = rgbToHsl(cor);
  const passo = 0.02;

  let l = hsl.l;
  for (let i = 0; i < 50; i += 1) {
    l = fundoEscuro ? Math.min(1, l + passo) : Math.max(0, l - passo);
    const candidato = hslToRgb({ ...hsl, l });
    if (contrastRatio(candidato, fundo) >= minimo) return toHex(candidato);
    if (l === 0 || l === 1) break;
  }

  return toHex(hslToRgb({ ...hsl, l: fundoEscuro ? 1 : 0 }));
}

/**
 * Cor de fallback do avatar, derivada do id — estável e sem guardar nada.
 *
 * O matiz não varia pelos 360°: fica preso à faixa de 170° a 320°, que vai do
 * ciano ao magenta passando por azul e violeta. Com a volta inteira, ids
 * caíam em marrom e verde-oliva, que numa paleta neon lêem como erro de
 * renderização. Saturação e luminosidade são fixas, para nenhum avatar sair
 * berrante nem apagado demais.
 */
const AVATAR_HUE_MIN = 170;
const AVATAR_HUE_MAX = 320;

export function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const matiz = AVATAR_HUE_MIN + (hash % (AVATAR_HUE_MAX - AVATAR_HUE_MIN));
  return toHex(hslToRgb({ h: matiz / 360, s: 0.45, l: 0.42 }));
}

/**
 * A cor sobre o fundo, com transparência, achatada num hex.
 *
 * O chip de cargo tem fundo com 12% da cor do cargo, e o texto precisa ter
 * contraste contra **o resultado dessa mistura** — não contra a cor pura nem
 * contra o fundo puro. Medir contra qualquer um dos dois erra para os dois
 * lados: cor clara sobre fundo escuro fica com o texto escuro demais, e o
 * contrário some.
 */
export function sobrepor(cor: string, fundo: string, alfa: number): string {
  const c = parseHex(cor);
  const f = parseHex(fundo);
  if (!c || !f) return fundo;
  return toHex({
    r: c.r * alfa + f.r * (1 - alfa),
    g: c.g * alfa + f.g * (1 - alfa),
    b: c.b * alfa + f.b * (1 - alfa),
  });
}
