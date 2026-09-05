import { Sala } from './sala';

export { Sala };

/**
 * O Worker.
 *
 * Faz três coisas e nada além: serve o front estático, encaminha a conexão da
 * sala para o Durable Object certo, e — a partir da fatia 2 — fala com o SFU
 * guardando o segredo do app longe do navegador.
 *
 * Ver prompts/fase-12-sala-sem-servidor.md e design/15-sem-servidor-alugado.md.
 */

export interface Env {
  SALA: DurableObjectNamespace<Sala>;
  ASSETS: Fetcher;
  /** Fatia 2. Entra por `wrangler secret put`, nunca no repositório. */
  REALTIME_APP_ID?: string;
  REALTIME_APP_SECRET?: string;
}

/**
 * O nome da sala vira o id do Durable Object.
 *
 * `idFromName` é determinístico: o mesmo nome leva sempre ao mesmo objeto, em
 * qualquer ponto da rede. É o que faz duas pessoas digitando "trindade" caírem
 * na mesma sala sem existir um registro de salas em lugar nenhum — que seria
 * justamente o banco de dados que este produto não tem.
 */
const NOME_DE_SALA = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

function normalizar(bruto: string): string | null {
  const nome = decodeURIComponent(bruto).trim().toLowerCase();
  return NOME_DE_SALA.test(nome) ? nome : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- a conexão da sala ---------------------------------------------
    const naSala = /^\/sala\/([^/]+)\/ws$/.exec(url.pathname);
    if (naSala) {
      const nome = normalizar(naSala[1]!);
      if (!nome) return new Response('nome de sala inválido', { status: 400 });

      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('esta rota é só para WebSocket', { status: 426 });
      }

      const objeto = env.SALA.get(env.SALA.idFromName(nome));
      return objeto.fetch(request);
    }

    // --- o front --------------------------------------------------------
    //
    // Qualquer caminho que não seja a conexão cai no `index.html`: a sala é uma
    // página só, e `/sala/trindade` precisa servir a mesma coisa que `/`.
    if (url.pathname.startsWith('/sala/')) {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
