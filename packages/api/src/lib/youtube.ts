/**
 * Reconhece um vídeo do YouTube numa URL.
 *
 * O identificador que sai daqui vai **para dentro de uma URL de iframe**, e por
 * isso a validação é por forma, não por tentativa: onze caracteres do alfabeto
 * do YouTube e nada mais. Um id que não bate com isso não é vídeo — não importa
 * o quanto o resto da URL pareça convincente.
 *
 * Ver design/04-mensagens.md, "Vídeo".
 */

/** `dQw4w9WgXcQ` — onze caracteres, base64url. É a forma, e ela nunca mudou. */
const ID = /^[A-Za-z0-9_-]{11}$/;

const DOMINIOS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  // O domínio sem cookie também é aceito na entrada: alguém pode colar o
  // endereço de um embed.
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/**
 * O id do vídeo, ou `null`.
 *
 * As quatro formas que aparecem no mundo real: `/watch?v=`, o encurtado
 * `youtu.be/`, `/shorts/` e `/embed/`. Playlist, canal e resultado de busca
 * não são vídeo e devolvem `null` — um cartão de "vídeo" que abre uma lista é
 * uma promessa quebrada.
 */
export function idDoYoutube(bruto: string): string | null {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!DOMINIOS.has(url.hostname.toLowerCase())) return null;

  const partes = url.pathname.split('/').filter(Boolean);

  // youtu.be/<id>
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    return aceitar(partes[0]);
  }

  // /watch?v=<id>
  if (partes[0] === 'watch') return aceitar(url.searchParams.get('v'));

  // /shorts/<id>, /embed/<id>, /live/<id>
  if (partes[0] === 'shorts' || partes[0] === 'embed' || partes[0] === 'live') {
    return aceitar(partes[1]);
  }

  return null;
}

function aceitar(valor: string | null | undefined): string | null {
  return valor && ID.test(valor) ? valor : null;
}

/**
 * O instante em que o vídeo deve começar, em segundos.
 *
 * `?t=90`, `?t=1m30s` e `?start=90` — as três formas que o YouTube gera. Quem
 * cola um link com tempo quer aquele trecho; começar do zero é perder a única
 * informação que a pessoa se deu ao trabalho de incluir.
 */
export function segundosDoYoutube(bruto: string): number | null {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }

  const cru = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (!cru) return null;

  if (/^\d+$/.test(cru)) return limitar(Number(cru));

  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(cru);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const horas = Number(m[1] ?? 0);
  const minutos = Number(m[2] ?? 0);
  const segundos = Number(m[3] ?? 0);
  return limitar(horas * 3600 + minutos * 60 + segundos);
}

/** Vinte e quatro horas. Acima disso é lixo, não um instante de vídeo. */
function limitar(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n <= 86_400 ? Math.floor(n) : null;
}
