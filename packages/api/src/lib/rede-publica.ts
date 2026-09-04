import { isIP } from 'node:net';

/**
 * Endereço é público, ou é de casa?
 *
 * Isto existe por causa de uma coisa só: o servidor busca a prévia de link no
 * lugar de quem lê (docs/04-seguranca.md), e um servidor que busca uma URL
 * escolhida por outra pessoa é um servidor que pode ser mandado bater na porta
 * da própria rede — o metadado da nuvem, o Postgres, o painel do MinIO. É o
 * SSRF, e a defesa é decidir, antes de conectar, se o **endereço resolvido** é
 * de fora.
 */

function bloqueadoV4(a: number, b: number): boolean {
  if (a === 0) return true;                     // 0.0.0.0/8, "este host"
  if (a === 10) return true;                    // privado
  if (a === 127) return true;                   // laço local
  if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;      // link-local — e o metadado da nuvem
  if (a === 172 && b >= 16 && b <= 31) return true;    // privado
  if (a === 192 && b === 168) return true;      // privado
  if (a === 192 && b === 0) return true;        // 192.0.0/24 e 192.0.2/24 (doc)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51) return true;       // documentação
  if (a === 203 && b === 0) return true;        // documentação
  if (a >= 224) return true;                    // multicast e reservado, até 255
  return false;
}

function partesV4(texto: string): [number, number] | null {
  const p = texto.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [p[0] as number, p[1] as number];
}

/** Expande `::` e devolve os 8 grupos de 16 bits. */
function gruposV6(texto: string): number[] | null {
  const semZona = texto.split('%')[0] ?? texto;
  const [antes = '', depois] = semZona.split('::');
  const cabeca = antes ? antes.split(':') : [];
  const cauda = depois !== undefined && depois ? depois.split(':') : [];

  // Um IPv6 pode terminar num IPv4 escrito por extenso (`::ffff:127.0.0.1`).
  const final: string[] = [];
  for (const parte of [...cabeca, ...cauda]) {
    if (parte.includes('.')) {
      const v4 = parte.split('.').map(Number);
      if (v4.length !== 4) return null;
      final.push((((v4[0] as number) << 8) | (v4[1] as number)).toString(16));
      final.push((((v4[2] as number) << 8) | (v4[3] as number)).toString(16));
    } else {
      final.push(parte);
    }
  }

  const quantosNaCabeca = cabeca.reduce((n, p) => n + (p.includes('.') ? 2 : 1), 0);
  const faltam = 8 - final.length;
  if (depois === undefined && faltam !== 0) return null;
  if (faltam < 0) return null;

  const grupos = [
    ...final.slice(0, quantosNaCabeca),
    ...Array<string>(faltam).fill('0'),
    ...final.slice(quantosNaCabeca),
  ].map((g) => parseInt(g || '0', 16));

  return grupos.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : grupos;
}

/**
 * `true` só quando temos certeza de que o endereço mora na internet pública.
 *
 * Na dúvida — texto que não parse, família que não conhecemos — devolve
 * `false`. Numa guarda, o silêncio é "não".
 */
export function enderecoPublico(ip: string): boolean {
  const familia = isIP(ip);

  if (familia === 4) {
    const p = partesV4(ip);
    return p ? !bloqueadoV4(p[0], p[1]) : false;
  }

  if (familia !== 6) return false;

  const g = gruposV6(ip);
  if (!g) return false;
  // Os zeros nunca entram em uso: `gruposV6` devolve oito grupos ou `null`.
  // Eles estão aqui só para `noUncheckedIndexedAccess` não espalhar `!` por
  // cima de uma guarda de segurança.
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

  // `::` e `::1`.
  if ((g0 | g1 | g2 | g3 | g4 | g5 | g6) === 0 && (g7 === 0 || g7 === 1)) return false;

  // IPv4 embutido: `::ffff:a.b.c.d` (mapeado) e `64:ff9b::/96` (NAT64) chegam
  // no v4 de verdade, e é ele que decide.
  const v4Embutido =
    (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) ||
    (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0);
  if (v4Embutido) {
    return !bloqueadoV4((g6 >> 8) & 0xff, g6 & 0xff);
  }
  // 6to4 carrega o v4 nos dois grupos seguintes.
  if (g0 === 0x2002) return !bloqueadoV4((g1 >> 8) & 0xff, g1 & 0xff);

  if ((g0 & 0xfe00) === 0xfc00) return false;  // fc00::/7, único local
  if ((g0 & 0xffc0) === 0xfe80) return false;  // fe80::/10, link-local
  if ((g0 & 0xff00) === 0xff00) return false;  // ff00::/8, multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false;        // documentação
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return false; // buraco negro

  return true;
}
