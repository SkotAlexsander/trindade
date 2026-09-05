import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LIMITE_DE_ERROS,
  REPETIR_MS,
  corpoDoAviso,
  decidir,
  esquecerSituacoes,
  usoDoDisco,
  vigiar,
} from '../src/services/alerta.js';
import {
  JANELA_DE_ERROS_MS,
  errosDeServidorRecentes,
  esquecerErros,
  medirRequisicoes,
  registrarErroDeServidor,
} from '../src/lib/metricas.js';

/**
 * O alerta.
 *
 * O webhook aqui é um servidor de verdade, não um `fetch` trocado por engano:
 * o que se quer saber é se sai uma requisição HTTP com o corpo certo, e isso
 * um dublê não responde.
 */

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

let servidor: Server;
let url: string;
let recebidos: string[] = [];

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (pedaco: Buffer) => (corpo += pedaco.toString('utf8')));
    req.on('end', () => {
      recebidos.push(corpo);
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/avisos`;
});

afterAll(async () => {
  await new Promise<void>((pronto) => servidor.close(() => pronto()));
});

beforeEach(() => {
  recebidos = [];
  esquecerSituacoes();
  esquecerErros();
});

function textos(): string[] {
  return recebidos.map((corpo) => (JSON.parse(corpo) as { content: string }).content);
}

const DISCO_CHEIO = () => Promise.resolve({ blocks: 100, bfree: 9, bavail: 9 });
const DISCO_FOLGADO = () => Promise.resolve({ blocks: 100, bfree: 60, bavail: 60 });

describe('quando falar', () => {
  it('fala na virada, cala no meio, repete depois de seis horas', () => {
    const situacao = { desde: null as number | null, ultimoAviso: 0 };

    expect(decidir(situacao, true, 1000)).toBe('comecou');
    situacao.desde = 1000;
    situacao.ultimoAviso = 1000;

    // Repetir de cinco em cinco minutos é como se treina alguém a ignorar o
    // canal de alertas.
    expect(decidir(situacao, true, 1000 + 5 * 60_000)).toBe(null);
    expect(decidir(situacao, true, 1000 + REPETIR_MS)).toBe('continua');

    expect(decidir(situacao, false, 1000 + 60_000)).toBe('passou');
  });

  it('não fala de um problema que nunca existiu', () => {
    expect(decidir({ desde: null, ultimoAviso: 0 }, false, 1000)).toBe(null);
  });
});

describe('o disco', () => {
  it('conta como o `df` conta', () => {
    // 100 blocos, 20 livres, mas só 15 disponíveis: a diferença são os blocos
    // reservados para o root. O `df` mostra 84% (80 de 95), não 85% (85 de 100).
    const uso = usoDoDisco({ blocks: 100, bfree: 20, bavail: 15 });
    expect(Math.round(uso * 100)).toBe(84);
    expect(uso).not.toBeCloseTo(1 - 15 / 100, 5);
  });

  it('avisa acima do limite e avisa de novo quando desafoga', async () => {
    const inicio = Date.UTC(2026, 8, 5, 3, 0, 0);

    expect(await vigiar(log, { agora: inicio, url, disco: DISCO_CHEIO })).toMatchObject({
      disco: 'comecou',
    });
    expect(textos()[0]).toContain('Disco em 91%');

    // Segunda volta com o mesmo problema: silêncio.
    expect(await vigiar(log, { agora: inicio + 60_000, url, disco: DISCO_CHEIO })).toMatchObject({
      disco: null,
    });
    expect(recebidos).toHaveLength(1);

    // Alerta que nunca diz "voltou ao normal" obriga alguém a conferir na mão.
    expect(await vigiar(log, { agora: inicio + 120_000, url, disco: DISCO_FOLGADO })).toMatchObject(
      { disco: 'passou' },
    );
    expect(textos()[1]).toContain('de volta ao normal');
  });
});

describe('os 5xx', () => {
  it('conta a janela, não o total desde que o processo subiu', () => {
    const agora = 10 * JANELA_DE_ERROS_MS;
    registrarErroDeServidor(agora - JANELA_DE_ERROS_MS - 1);
    registrarErroDeServidor(agora - 1000);
    expect(errosDeServidorRecentes(agora)).toBe(1);
  });

  it('o 500 de uma rota entra na conta', async () => {
    const app = Fastify();
    medirRequisicoes(app);
    app.get('/estoura', () => {
      throw new Error('estourou');
    });
    app.get('/nada', (_req, reply) => reply.code(404).send());

    await app.inject({ method: 'GET', url: '/estoura' });
    await app.inject({ method: 'GET', url: '/nada' });
    await app.close();

    // 4xx é o cliente pedindo errado, e acontece o tempo todo.
    expect(errosDeServidorRecentes()).toBe(1);
  });

  it('avisa quando passam do limite e avisa quando param', async () => {
    const inicio = Date.now();
    for (let i = 0; i < LIMITE_DE_ERROS; i += 1) registrarErroDeServidor(inicio);

    expect(await vigiar(log, { agora: inicio, url, disco: DISCO_FOLGADO })).toMatchObject({
      erros: 'comecou',
    });
    expect(textos()[0]).toContain(`${LIMITE_DE_ERROS} respostas 5xx`);

    // A janela esvazia sozinha: ninguém precisa zerar contador nenhum.
    const depois = inicio + JANELA_DE_ERROS_MS + 1;
    expect(await vigiar(log, { agora: depois, url, disco: DISCO_FOLGADO })).toMatchObject({
      erros: 'passou',
    });
    expect(textos()[1]).toBe('Os erros 5xx pararam.');
  });
});

describe('o envio', () => {
  it('o mesmo corpo serve Discord e Slack', () => {
    const corpo = JSON.parse(corpoDoAviso('disco cheio')) as Record<string, string>;
    expect(corpo.content).toBe('disco cheio');
    expect(corpo.text).toBe('disco cheio');
  });

  it('sem webhook configurado, ninguém é incomodado', async () => {
    // A decisão continua acontecendo — o que não acontece é a requisição.
    const dito = await vigiar(log, { agora: Date.now(), url: undefined, disco: DISCO_CHEIO });
    expect(dito.disco).toBe('comecou');
    expect(recebidos).toHaveLength(0);
  });

  it('um webhook fora do ar não derruba a volta', async () => {
    const dito = await vigiar(log, {
      agora: Date.now(),
      // Porta fechada de propósito: o `fetch` falha, e a volta tem de terminar.
      url: 'http://127.0.0.1:9/avisos',
      disco: DISCO_CHEIO,
    });
    expect(dito.disco).toBe('comecou');
  });
});
