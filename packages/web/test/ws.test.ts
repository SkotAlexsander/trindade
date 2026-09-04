import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as ModuloWs from '../src/lib/ws';
import type * as ModuloHttp from '../src/lib/http';
import { WebSocketServer, type WebSocket as WsServerSocket } from 'ws';
import { CLOSE } from '@trindade/shared';

/**
 * O cliente do gateway contra um servidor WebSocket de verdade.
 *
 * Estas regras — reconectar, esperar mais a cada tentativa, enfileirar o que
 * foi escrito fora do ar — são de tempo, e teste de tempo em navegador é
 * teste instável. Aqui o servidor é nosso e fecha a conexão na hora que
 * mandamos.
 */

interface Servidor {
  porta: number;
  wss: WebSocketServer;
  conexoes: WsServerSocket[];
  /** Instante de cada handshake, para medir o backoff. */
  quando: number[];
  recebidas: unknown[];
  /** Com isto ligado, o servidor derruba quem chegar. Simula estar fora. */
  fora: boolean;
}

async function subirServidor(): Promise<Servidor> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once('listening', r));
  const endereco = wss.address();
  if (typeof endereco === 'string' || endereco === null) throw new Error('sem porta');

  const s: Servidor = {
    porta: endereco.port,
    wss,
    conexoes: [],
    quando: [],
    recebidas: [],
    fora: false,
  };

  wss.on('connection', (socket) => {
    s.quando.push(Date.now());
    if (s.fora) {
      // `terminate` e não `close`: 1006 é reservado e não pode ser enviado no
      // quadro. Queda de rede é exatamente isto — o socket some sem despedida.
      socket.terminate();
      return;
    }
    s.conexoes.push(socket);
    socket.on('message', (bruto) => s.recebidas.push(JSON.parse(String(bruto))));
    socket.send(
      JSON.stringify({
        op: 'READY',
        d: { user: null, users: [], channels: [], readState: [], voiceStates: [], first: true },
      }),
    );
  });

  return s;
}

async function esperar(condicao: () => boolean, limiteMs = 8000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condição não aconteceu a tempo');
}

let servidor: Servidor;
// Import dinâmico: o módulo guarda o socket em variável de módulo, então cada
// caso precisa de uma instância nova. `location` tem de existir antes.
let ws: typeof ModuloWs;
let http: typeof ModuloHttp;

beforeEach(async () => {
  servidor = await subirServidor();
  (globalThis as { location?: unknown }).location = {
    protocol: 'http:',
    host: `127.0.0.1:${servidor.porta}`,
  };
  ws = await import(`../src/lib/ws?t=${Date.now()}`);
  http = await import(`../src/lib/http?t=${Date.now()}`);
  http.setAccessToken('token-de-teste');
});

afterEach(async () => {
  ws.desconectar();
  for (const c of servidor.conexoes) c.terminate();
  await new Promise<void>((r) => servidor.wss.close(() => r()));
});

describe('conexão', () => {
  it('conecta e só fica aberto depois do READY', async () => {
    const estados: string[] = [];
    ws.onEstado((e) => estados.push(e));
    ws.conectar();

    await esperar(() => ws.estadoAtual() === 'aberto');
    expect(estados).toEqual(['conectando', 'aberto']);
  });

  it('leva o token na query, nunca em cabeçalho', async () => {
    const urls: string[] = [];
    servidor.wss.on('headers', (_, req) => urls.push(req.url ?? ''));
    ws.conectar();
    await esperar(() => urls.length > 0);
    expect(urls[0]).toContain('token=token-de-teste');
  });

  it('o primeiro READY não é reconexão; o segundo é', async () => {
    const aberturas: boolean[] = [];
    ws.onAbertura(({ reconexao }) => aberturas.push(reconexao));
    ws.conectar();
    await esperar(() => aberturas.length === 1);
    expect(aberturas).toEqual([false]);

    servidor.conexoes[0]?.terminate();
    await esperar(() => aberturas.length === 2, 10_000);
    expect(aberturas).toEqual([false, true]);
  });
});

describe('reconexão', () => {
  it('volta sozinho quando o servidor derruba', async () => {
    ws.conectar();
    await esperar(() => ws.estadoAtual() === 'aberto');

    servidor.conexoes[0]?.terminate();
    await esperar(() => ws.estadoAtual() === 'caido');
    await esperar(() => ws.estadoAtual() === 'aberto', 10_000);
    expect(servidor.quando.length).toBeGreaterThanOrEqual(2);
  });

  it('espera mais a cada tentativa', async () => {
    servidor.fora = true;
    ws.conectar();
    // Quatro handshakes recusados: a 1ª é imediata e depois as esperas são
    // 1000, 2000 e 4000 como alvo, cada uma com metade fixa e metade
    // sorteada — ou seja, [500,1000], [1000,2000] e [2000,4000].
    await esperar(() => servidor.quando.length >= 4, 20_000);

    const [a, b, c, d] = servidor.quando as [number, number, number, number];
    const esperas = [b - a, c - b, d - c];

    expect(esperas[0]).toBeGreaterThan(400);
    expect(esperas[0]).toBeLessThan(1200);
    expect(esperas[1]).toBeGreaterThan(900);
    expect(esperas[1]).toBeLessThan(2300);

    // Comparar tentativas vizinhas seria frouxo: com jitter de metade, as
    // faixas se encostam nas pontas e um par pode sair quase igual. A terceira
    // contra a primeira não tem sobreposição possível.
    expect(esperas[2]).toBeGreaterThan(esperas[0]);
    expect(esperas[2]).toBeGreaterThan(1900);
  });

  it('`tentarAgora` não espera o backoff', async () => {
    servidor.fora = true;
    ws.conectar();
    await esperar(() => servidor.quando.length >= 2, 8000);

    servidor.fora = false;
    const antes = servidor.quando.length;
    ws.tentarAgora();
    await esperar(() => servidor.quando.length > antes, 1500);
    await esperar(() => ws.estadoAtual() === 'aberto', 3000);
  });

  it('conta desativada não reconecta', async () => {
    ws.conectar();
    await esperar(() => ws.estadoAtual() === 'aberto');

    const tentativasAntes = servidor.quando.length;
    servidor.conexoes[0]?.close(CLOSE.ACCOUNT_DISABLED, 'ACCOUNT_DISABLED');
    await new Promise((r) => setTimeout(r, 3000));

    // Insistir aqui só produziria um laço de handshake recusado: a conta não
    // existe mais para efeitos práticos.
    expect(servidor.quando.length).toBe(tentativasAntes);
    expect(ws.estadoAtual()).toBe('ocioso');
  });
});

describe('fila de quem escreveu fora do ar', () => {
  const mensagem = {
    op: 'MESSAGE_CREATE' as const,
    d: {
      channelId: '00000000-0000-4000-8000-000000000001',
      content: 'escrita offline',
      clientNonce: '00000000-0000-4000-8000-000000000002',
    },
  };

  it('enfileira e entrega quando volta', async () => {
    ws.conectar();
    await esperar(() => ws.estadoAtual() === 'aberto');

    servidor.conexoes[0]?.terminate();
    await esperar(() => ws.estadoAtual() === 'caido');

    expect(ws.enviar(mensagem)).toBe(false);
    expect(ws.tamanhoDaFila()).toBe(1);

    await esperar(() => ws.estadoAtual() === 'aberto', 10_000);
    await esperar(() => servidor.recebidas.length > 0, 3000);
    expect(servidor.recebidas[0]).toMatchObject({ op: 'MESSAGE_CREATE' });
    expect(ws.tamanhoDaFila()).toBe(0);
  });

  it('não enfileira "está digitando"', async () => {
    ws.conectar();
    await esperar(() => ws.estadoAtual() === 'aberto');
    servidor.conexoes[0]?.terminate();
    await esperar(() => ws.estadoAtual() === 'caido');

    // Indicador guardado por quarenta segundos e entregue depois é uma
    // informação falsa: ninguém está digitando mais.
    expect(
      ws.enviar({
        op: 'TYPING_START',
        d: { channelId: '00000000-0000-4000-8000-000000000001' },
      }),
    ).toBe(false);
    expect(ws.tamanhoDaFila()).toBe(0);
  });

  it('desconectar de propósito esvazia a fila', async () => {
    ws.conectar();
    await esperar(() => ws.estadoAtual() === 'aberto');
    servidor.conexoes[0]?.terminate();
    await esperar(() => ws.estadoAtual() === 'caido');

    ws.enviar(mensagem);
    expect(ws.tamanhoDaFila()).toBe(1);
    ws.desconectar();
    expect(ws.tamanhoDaFila()).toBe(0);
  });
});
