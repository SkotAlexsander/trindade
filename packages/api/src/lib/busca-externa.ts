import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { enderecoPublico } from './rede-publica.js';

/**
 * Buscar uma URL que outra pessoa escolheu, sem virar proxy da rede interna.
 *
 * O servidor busca a prévia no lugar de quem lê — é o que impede o link
 * enviado de colher o IP de todos os leitores (design/04-mensagens.md). O
 * preço é este arquivo: a partir do momento em que o destino é escolhido por
 * um usuário, cada passo precisa de guarda.
 *
 * A ordem importa. Resolvemos o nome **nós mesmos**, conferimos o endereço, e
 * conectamos **no endereço conferido** com o `Host` original no cabeçalho. Se
 * em vez disso passássemos o nome para o cliente HTTP, haveria uma janela
 * entre a nossa consulta e a dele em que a mesma resposta de DNS pode mudar
 * para `127.0.0.1` — é o rebind, e ele derrota a checagem feita cedo demais.
 */

export type MotivoDeRecusa =
  | 'ESQUEMA'
  | 'PORTA'
  | 'CREDENCIAL_NA_URL'
  | 'ENDERECO_INTERNO'
  | 'REDIRECIONAMENTOS'
  | 'TIPO'
  | 'TAMANHO'
  | 'TEMPO'
  | 'REDE'
  | 'STATUS';

export class RecusadoNaBusca extends Error {
  constructor(readonly motivo: MotivoDeRecusa, mensagem: string) {
    super(mensagem);
    this.name = 'RecusadoNaBusca';
  }
}

const MAXIMO_DE_SALTOS = 3;
const TEMPO_MS = 5_000;

/** As duas portas da web. `:5432`, `:9000` e `:6379` não são engano de ninguém. */
const PORTAS = new Set(['', '80', '443']);

export interface Externo {
  /** A URL final, depois dos redirecionamentos. */
  url: string;
  contentType: string;
  corpo: Buffer;
}

export async function buscarExterno(
  bruto: string,
  opcoes: { maxBytes: number; aceita: (contentType: string) => boolean },
): Promise<Externo> {
  let alvo = validarUrl(bruto);

  for (let salto = 0; salto <= MAXIMO_DE_SALTOS; salto += 1) {
    const resposta = await umaVolta(alvo, opcoes.maxBytes);

    if (resposta.tipo === 'redirecionamento') {
      // Cada destino novo passa pela validação inteira de novo, inclusive a do
      // endereço: um host público que redireciona para `169.254.169.254` é a
      // forma mais comum de SSRF que sobrevive a uma checagem só na entrada.
      alvo = validarUrl(new URL(resposta.destino, alvo.href).href);
      continue;
    }

    const contentType = (resposta.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!opcoes.aceita(contentType)) {
      throw new RecusadoNaBusca('TIPO', `tipo não aceito: ${contentType || 'sem tipo'}`);
    }
    return { url: alvo.href, contentType, corpo: resposta.corpo };
  }

  throw new RecusadoNaBusca('REDIRECIONAMENTOS', 'redirecionamentos demais');
}

export function validarUrl(bruto: string): URL {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new RecusadoNaBusca('ESQUEMA', 'não é uma URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RecusadoNaBusca('ESQUEMA', `esquema não aceito: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new RecusadoNaBusca('CREDENCIAL_NA_URL', 'URL com credencial embutida');
  }
  if (!PORTAS.has(url.port)) {
    throw new RecusadoNaBusca('PORTA', `porta não aceita: ${url.port}`);
  }
  return url;
}

/** O endereço público para onde este nome aponta agora, ou recusa. */
async function resolverPublico(hostname: string): Promise<{ ip: string; familia: number }> {
  // O hostname pode já ser um IP — `[::1]` chega aqui sem colchetes.
  const nu = hostname.replace(/^\[|\]$/g, '');

  let candidatos: { address: string; family: number }[];
  try {
    candidatos = await lookup(nu, { all: true, verbatim: true });
  } catch {
    throw new RecusadoNaBusca('REDE', `não consegui resolver ${hostname}`);
  }

  const bom = candidatos.find((c) => enderecoPublico(c.address));
  if (!bom) {
    // A mensagem é deliberadamente igual para todos os casos internos: dizer
    // "resolveu para 10.0.0.5" transformaria a prévia num scanner de rede.
    throw new RecusadoNaBusca('ENDERECO_INTERNO', 'esse endereço não é público');
  }
  return { ip: bom.address, familia: bom.family };
}

type Volta =
  | { tipo: 'redirecionamento'; destino: string }
  | { tipo: 'corpo'; contentType: string | null; corpo: Buffer };

async function umaVolta(url: URL, maxBytes: number): Promise<Volta> {
  const { ip, familia } = await resolverPublico(url.hostname);
  const seguro = url.protocol === 'https:';
  const requisitar = seguro ? https.request : http.request;

  return new Promise<Volta>((resolver, rejeitar) => {
    const req = requisitar(
      {
        // Conectamos no endereço conferido, não no nome.
        host: familia === 6 ? `[${ip}]` : ip,
        port: url.port ? Number(url.port) : seguro ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        // …e devolvemos o nome nos dois lugares em que ele ainda importa: o
        // `Host`, para o servidor saber qual site queremos, e o `servername`,
        // para o certificado ser conferido contra o domínio e não contra o IP.
        ...(seguro ? { servername: url.hostname, rejectUnauthorized: true } : {}),
        headers: {
          host: url.host,
          'user-agent': 'TrindadeBot/1.0 (+prévia de link)',
          accept: 'text/html,application/xhtml+xml,image/*;q=0.8',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.6',
        },
        timeout: TEMPO_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          resolver({ tipo: 'redirecionamento', destino: res.headers.location });
          return;
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          rejeitar(new RecusadoNaBusca('STATUS', `o site respondeu ${status}`));
          return;
        }

        // O `content-length` é uma dica, não uma promessa: cortamos pelo que
        // realmente chega.
        const pedacos: Buffer[] = [];
        let total = 0;
        res.on('data', (p: Buffer) => {
          total += p.length;
          if (total > maxBytes) {
            res.destroy();
            rejeitar(new RecusadoNaBusca('TAMANHO', 'resposta grande demais'));
            return;
          }
          pedacos.push(p);
        });
        res.on('end', () =>
          resolver({
            tipo: 'corpo',
            contentType: res.headers['content-type'] ?? null,
            corpo: Buffer.concat(pedacos),
          }),
        );
        res.on('error', () => rejeitar(new RecusadoNaBusca('REDE', 'a conexão caiu')));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      rejeitar(new RecusadoNaBusca('TEMPO', 'o site demorou demais'));
    });
    req.on('error', (err) => {
      if (err instanceof RecusadoNaBusca) rejeitar(err);
      else rejeitar(new RecusadoNaBusca('REDE', 'não consegui chegar nesse endereço'));
    });
    req.end();
  });
}
