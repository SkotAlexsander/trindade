import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
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

/**
 * Voz.
 *
 * O requisito central desta fase é de privacidade: **nenhum participante pode
 * descobrir o endereço de rede de outro.** Do lado do servidor isso vira duas
 * coisas verificáveis — um token com escopo de uma sala só, e uma credencial de
 * relay que expira e nunca é fixa.
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.close();
});

async function entrar(cliente: TestClient, username: string): Promise<string> {
  const res = await cliente.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: SENHA_BOA },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { access: string }).access;
}

async function canalDeVoz(slug: string): Promise<string> {
  const linhas = await sql<{ id: string }[]>`
    insert into channels (slug, name, kind, position)
    values (${slug}, ${slug}, 'voice', 0)
    returning id
  `;
  const row = linhas[0];
  if (!row) throw new Error('canal de voz não nasceu');
  return row.id;
}

async function canalDeTexto(slug: string): Promise<string> {
  const linhas = await sql<{ id: string }[]>`
    insert into channels (slug, name, kind, position)
    values (${slug}, ${slug}, 'text', 0)
    returning id
  `;
  const row = linhas[0];
  if (!row) throw new Error('canal de texto não nasceu');
  return row.id;
}

/** Bits 9 e 10: CONNECT_VOICE e SHARE_SCREEN. */
const SO_VOZ = (1n << 9n).toString();
const VOZ_E_TELA = ((1n << 9n) | (1n << 10n)).toString();

async function criarCargo(nome: string, permissions: string): Promise<void> {
  await sql`
    insert into roles (name, position, permissions)
    values (${nome}, 10, ${permissions}::bigint)
  `;
}

interface Concessao {
  video?: {
    room?: string;
    roomJoin?: boolean;
    canPublish?: boolean;
    canPublishSources?: unknown[];
  };
  sub?: string;
  exp?: number;
}

describe('token de voz', () => {
  let cliente: TestClient;
  let sala: string;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
    sala = await canalDeVoz('sala');
    await criarCargo('SóVoz', SO_VOZ);
    await criarCargo('VozETela', VOZ_E_TELA);
  });

  async function pedir(username: string, canal = sala) {
    const token = await entrar(cliente, username);
    return cliente.inject({
      method: 'POST',
      url: `/api/channels/${canal}/voice/token`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it('emite token para quem pode entrar em chamadas', async () => {
    await createUser({ username: 'ana', roleName: 'SóVoz' });
    const res = await pedir('ana');
    expect(res.statusCode, res.body).toBe(200);

    const corpo = res.json() as { token: string; room: string; canShareScreen: boolean };
    expect(corpo.room).toBe(`channel:${sala}`);
    expect(corpo.canShareScreen).toBe(false);
  });

  it('o escopo é uma sala só', async () => {
    // Um token que valesse para qualquer sala transformaria "entrar num canal
    // de voz" em "entrar em todos".
    const outra = await canalDeVoz('outra');
    await createUser({ username: 'ana', roleName: 'SóVoz' });

    const res = await pedir('ana');
    const { video } = decodeJwt((res.json() as { token: string }).token) as Concessao;
    expect(video?.room).toBe(`channel:${sala}`);
    expect(video?.room).not.toBe(`channel:${outra}`);
    expect(video?.roomJoin).toBe(true);
  });

  it('sem SHARE_SCREEN o token não permite publicar tela', async () => {
    // Esconder o botão não é controle de acesso: aqui é o servidor recusando
    // de verdade, e nem mandando o comando à mão a trilha sobe.
    await createUser({ username: 'ana', roleName: 'SóVoz' });
    const res = await pedir('ana');
    const { video } = decodeJwt((res.json() as { token: string }).token) as Concessao;

    expect(video?.canPublishSources).toEqual(['camera', 'microphone']);
  });

  it('com SHARE_SCREEN o token permite tela e áudio da tela', async () => {
    await createUser({ username: 'bia', roleName: 'VozETela' });
    const res = await pedir('bia');
    expect((res.json() as { canShareScreen: boolean }).canShareScreen).toBe(true);

    const { video } = decodeJwt((res.json() as { token: string }).token) as Concessao;
    expect(video?.canPublishSources).toEqual([
      'camera',
      'microphone',
      'screen_share',
      'screen_share_audio',
    ]);
  });

  it('recusa quem não tem CONNECT_VOICE', async () => {
    await criarCargo('Mudo', '0');
    await createUser({ username: 'cadu', roleName: 'Mudo' });
    const res = await pedir('cadu');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'MISSING_PERMISSION' });
  });

  it('recusa canal de texto', async () => {
    const texto = await canalDeTexto('geral');
    await createUser({ username: 'ana', roleName: 'SóVoz' });
    const res = await pedir('ana', texto);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'CHANNEL_NOT_VOICE' });
  });

  it('sem sessão não emite nada', async () => {
    const res = await cliente.inject({
      method: 'POST',
      url: `/api/channels/${sala}/voice/token`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('credencial do relay', () => {
  let cliente: TestClient;
  let sala: string;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
    sala = await canalDeVoz('sala');
    await criarCargo('SóVoz', SO_VOZ);
    await createUser({ username: 'ana', roleName: 'SóVoz' });
  });

  it('é efêmera e conferível pelo HMAC', async () => {
    const token = await entrar(cliente, 'ana');
    const res = await cliente.inject({
      method: 'POST',
      url: `/api/channels/${sala}/voice/token`,
      headers: { authorization: `Bearer ${token}` },
    });

    const { iceServers } = res.json() as {
      iceServers: { urls: string[]; username?: string; credential?: string }[];
    };
    const relay = iceServers[0];
    expect(relay, 'nenhum servidor de relay na resposta').toBeTruthy();

    // `{expiração}:{userId}`, e a expiração está no futuro.
    const [expiracao, userId] = (relay?.username ?? '').split(':');
    expect(Number(expiracao)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    // A senha é o HMAC do usuário, e não um segredo fixo: dois pedidos em
    // segundos diferentes produzem credenciais diferentes.
    const esperada = createHmac('sha1', process.env.TURN_STATIC_SECRET as string)
      .update(relay?.username ?? '')
      .digest('base64');
    expect(relay?.credential).toBe(esperada);
  });

  it('a senha nunca é o próprio segredo', async () => {
    const token = await entrar(cliente, 'ana');
    const res = await cliente.inject({
      method: 'POST',
      url: `/api/channels/${sala}/voice/token`,
      headers: { authorization: `Bearer ${token}` },
    });
    const { iceServers } = res.json() as { iceServers: { credential?: string }[] };
    expect(iceServers[0]?.credential).not.toBe(process.env.TURN_STATIC_SECRET);
  });
});

describe('webhook do LiveKit', () => {
  let cliente: TestClient;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
  });

  it('recusa sem assinatura', async () => {
    const res = await cliente.inject({
      method: 'POST',
      url: '/api/livekit/webhook',
      headers: { 'content-type': 'application/webhook+json' },
      payload: '{"event":"participant_joined"}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('recusa assinatura inventada', async () => {
    const res = await cliente.inject({
      method: 'POST',
      url: '/api/livekit/webhook',
      headers: {
        'content-type': 'application/webhook+json',
        authorization: 'nao.e.um.jwt',
      },
      payload: '{"event":"participant_joined"}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('não exige sessão — quem chama é o SFU, não uma pessoa', async () => {
    // A prova de que a rota está fora do plugin autenticado: sem token, a
    // recusa é por assinatura (401 WEBHOOK_REJECTED), não por login.
    const res = await cliente.inject({
      method: 'POST',
      url: '/api/livekit/webhook',
      headers: { 'content-type': 'application/webhook+json' },
      payload: '{}',
    });
    expect(res.json()).toMatchObject({ code: 'WEBHOOK_REJECTED' });
  });
});

describe('a configuração do relay', () => {
  /**
   * Um arquivo de configuração perde uma linha em silêncio.
   *
   * Sem os `denied-peer-ip`, o coturn é um proxy aberto para escanear a rede
   * interna: quem tiver credencial — e a credencial é dada a todo mundo que
   * entra numa chamada — pede ao relay que abra conexão para 10.0.0.x e lê a
   * resposta. É o mesmo assunto da guarda de SSRF, por outro caminho.
   */
  const conf = readFileSync(
    new URL('../../../infra/turnserver.conf', import.meta.url),
    'utf8',
  );

  it('bloqueia todas as faixas internas', () => {
    for (const faixa of [
      '0.0.0.0-0.255.255.255',
      '10.0.0.0-10.255.255.255',
      '127.0.0.0-127.255.255.255',
      '169.254.0.0-169.254.255.255',
      '172.16.0.0-172.31.255.255',
      '192.168.0.0-192.168.255.255',
      '::1',
      'fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    ]) {
      expect(conf, `faltou denied-peer-ip=${faixa}`).toContain(`denied-peer-ip=${faixa}`);
    }
  });

  it('e o CGNAT, que é metade das conexões brasileiras', () => {
    expect(conf).toContain('denied-peer-ip=100.64.0.0-100.127.255.255');
  });

  it('usa segredo com HMAC, nunca lista de usuários', () => {
    expect(conf).toContain('use-auth-secret');
    expect(conf).not.toMatch(/^user=/m);
  });

  it('não expõe o console de administração', () => {
    expect(conf).toContain('no-cli');
  });
});

describe('a configuração do SFU', () => {
  const yaml = readFileSync(new URL('../../../infra/livekit.yaml', import.meta.url), 'utf8');

  it('não deixa o cliente criar salas', () => {
    // Com `auto_create: true`, qualquer token válido cria salas arbitrárias — e
    // o token é emitido por canal, então isso apagaria o escopo inteiro.
    expect(yaml).toMatch(/auto_create:\s*false/);
  });

  it('limita o tamanho da sala', () => {
    expect(yaml).toMatch(/max_participants:\s*\d+/);
  });
});
