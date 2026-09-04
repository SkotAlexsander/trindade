import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SENHA_BOA,
  createClient,
  createUser,
  resetDatabase,
  sql,
  startApp,
  type TestApp,
  type TestClient,
} from './helpers.js';
import {
  faxinar,
  limparAuditoriaAntiga,
  limparNonces,
  limparRefreshVencidos,
} from '../src/services/faxina.js';

/**
 * Operação: faxina, saúde e métricas.
 *
 * A fase que decide se o projeto é protótipo ou coisa que roda. O que se
 * verifica aqui é o que ninguém olha no dia a dia — e que por isso só aparece
 * quando já virou problema: tabela que cresceu para sempre, saúde que responde
 * 200 com o banco fora do ar, métrica aberta para quem passar.
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.close();
});

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe('a faxina', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('apaga o nonce depois de 24h e deixa o de hoje', async () => {
    const autor = await createUser({ username: 'ana' });
    const canal = await sql<{ id: string }[]>`
      insert into channels (slug, name, kind, position) values ('geral', 'geral', 'text', 0)
      returning id
    `;
    const canalId = canal[0]?.id as string;

    // `client_nonce` é uuid: quem o gera é o cliente, com `crypto.randomUUID`.
    await sql`
      insert into messages (channel_id, author_id, content, client_nonce, created_at)
      values (${canalId}, ${autor.id}, 'velha', gen_random_uuid(), now() - interval '25 hours'),
             (${canalId}, ${autor.id}, 'nova', gen_random_uuid(), now())
    `;

    expect(await limparNonces()).toBe(1);

    const restantes = await sql<{ content: string; client_nonce: string | null }[]>`
      select content, client_nonce from messages order by created_at
    `;
    // O de hoje continua: é ele que ainda pode recusar um reenvio.
    expect(restantes.map((r) => [r.content, r.client_nonce === null])).toEqual([
      ['velha', true],
      ['nova', false],
    ]);
  });

  it('apaga token vencido há mais de 30 dias e guarda o de ontem', async () => {
    const dono = await createUser({ username: 'bia' });
    await sql`
      insert into refresh_tokens (user_id, family_id, token_hash, expires_at)
      values (${dono.id}, gen_random_uuid(), 'antigo', now() - interval '31 days'),
             (${dono.id}, gen_random_uuid(), 'recente', now() - interval '1 day')
    `;

    expect(await limparRefreshVencidos()).toBe(1);

    // O vencido ontem fica: é o que ainda permite detectar reuso, que é sinal
    // de roubo.
    const sobrou = await sql<{ token_hash: string }[]>`select token_hash from refresh_tokens`;
    expect(sobrou.map((t) => t.token_hash)).toEqual(['recente']);
  });

  it('apaga auditoria com mais de 180 dias', async () => {
    const quem = await createUser({ username: 'cadu' });
    await sql`
      insert into audit_log (actor_id, action, created_at)
      values (${quem.id}, 'antiga', now() - interval '181 days'),
             (${quem.id}, 'recente', now() - interval '10 days')
    `;

    expect(await limparAuditoriaAntiga()).toBe(1);
    const sobrou = await sql<{ action: string }[]>`select action from audit_log`;
    expect(sobrou.map((a) => a.action)).toEqual(['recente']);
  });

  it('uma tarefa que falha não impede as outras', async () => {
    // A varredura de anexos precisa de storage; sem ele, devolve zero em vez de
    // derrubar a volta inteira.
    const resultado = await faxinar(log);
    expect(resultado).toMatchObject({ anexos: 0, nonces: 0, refresh: 0, auditoria: 0 });
  });
});

describe('a saúde', () => {
  let cliente: TestClient;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
  });

  it('toca o banco de verdade', async () => {
    const res = await cliente.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, db: true });
  });

  it('e diz do storage sem confundir "desligado" com "caído"', async () => {
    // Nulo é "não configurado", e isso não derruba a saúde: servidor sem
    // anexos é uma escolha. Falso seria configurado e fora do ar.
    const { storage } = (await cliente.inject({ method: 'GET', url: '/api/health' })).json() as {
      storage: boolean | null;
    };
    expect(storage === null || typeof storage === 'boolean').toBe(true);
  });
});

describe('as métricas', () => {
  let cliente: TestClient;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
  });

  it('não servem nada sem o token certo', async () => {
    const res = await cliente.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('trindade_');
  });

  it('nem com token errado do mesmo tamanho', async () => {
    const certo = process.env.METRICS_TOKEN as string;
    const errado = 'x'.repeat(certo.length);
    const res = await cliente.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: `Bearer ${errado}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('com o token, entregam o que serve para operar', async () => {
    const res = await cliente.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: `Bearer ${process.env.METRICS_TOKEN as string}` },
    });
    expect(res.statusCode).toBe(200);
    for (const metrica of [
      'trindade_http_duracao_segundos',
      'trindade_ws_conexoes',
      'trindade_erros_total',
    ]) {
      expect(res.body).toContain(metrica);
    }
  });

  it('e não identificam ninguém', async () => {
    // Rótulo é rota, método e código. Uma série por pessoa seria um histórico
    // de presença de cada um — justamente o que este projeto não guarda.
    const eu = await createUser({ username: 'dora' });
    await cliente.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'dora', password: SENHA_BOA },
    });

    const res = await cliente.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: `Bearer ${process.env.METRICS_TOKEN as string}` },
    });
    expect(res.body).not.toContain(eu.id);
    expect(res.body).not.toContain('dora');
    expect(res.body).not.toContain('127.0.0.1');
  });

  it('a rota vira rótulo pelo padrão, não pela URL com id', async () => {
    // `/api/channels/:id/messages` e não `/api/channels/<uuid>/messages`: um id
    // num rótulo vira uma série temporal por canal, e daí por pessoa.
    const alvo = '11111111-2222-3333-4444-555555555555';
    await cliente.inject({ method: 'GET', url: `/api/channels/${alvo}/messages` });

    const res = await cliente.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: `Bearer ${process.env.METRICS_TOKEN as string}` },
    });
    expect(res.body).toMatch(/rota="[^"]*:id/);
    expect(res.body).not.toContain(alvo);
  });
});

describe('os cabeçalhos que o Caddy serve', () => {
  /**
   * O arquivo é lido, e não reescrito aqui.
   *
   * A CSP é do tipo de coisa que se relaxa às três da manhã para destravar um
   * deploy e ninguém aperta de volta. Estes testes são o atrito que faz esse
   * relaxamento aparecer no diff.
   */
  const arquivo = readFileSync(
    new URL('../../../infra/cabecalhos.caddy', import.meta.url),
    'utf8',
  );
  const csp = /Content-Security-Policy\s+"([^"]+)"/.exec(arquivo)?.[1] ?? '';

  it('script-src não aceita inline nem eval', () => {
    // `unsafe-inline` em script-src anula o benefício inteiro da política: é
    // exatamente o que um XSS precisa para executar.
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('e a página não pode ser emoldurada nem enviar formulário para fora', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('geolocalização fechada, câmera e microfone só na própria origem', () => {
    const permissions = /Permissions-Policy\s+"([^"]+)"/.exec(arquivo)?.[1] ?? '';
    expect(permissions).toContain('geolocation=()');
    expect(permissions).toContain('camera=(self)');
    expect(permissions).toContain('microphone=(self)');
  });

  it('HSTS de dois anos, sem referrer e sem sniffing', () => {
    expect(arquivo).toMatch(/max-age=63072000; includeSubDomains; preload/);
    expect(arquivo).toContain('Referrer-Policy "no-referrer"');
    expect(arquivo).toContain('X-Content-Type-Options "nosniff"');
  });

  it('e o domínio dos anexos serve bytes, não aplicação', () => {
    // `default-src 'none'; sandbox` no domínio de mídia: um HTML servido de lá
    // não executa nada e não alcança nada.
    const caddyfile = readFileSync(new URL('../../../infra/Caddyfile', import.meta.url), 'utf8');
    expect(caddyfile).toContain("default-src 'none'; sandbox");
  });
});
