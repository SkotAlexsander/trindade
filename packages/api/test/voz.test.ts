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

const conf = readFileSync(new URL('../../../infra/turnserver.conf', import.meta.url), 'utf8');

describe('a configuração do relay', () => {
  /**
   * Um arquivo de configuração perde uma linha em silêncio.
   *
   * Sem os `denied-peer-ip`, o coturn é um proxy aberto para escanear a rede
   * interna: quem tiver credencial — e a credencial é dada a todo mundo que
   * entra numa chamada — pede ao relay que abra conexão para 10.0.0.x e lê a
   * resposta. É o mesmo assunto da guarda de SSRF, por outro caminho.
   */
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

describe('a configuração de desenvolvimento do relay', () => {
  /**
   * O arquivo de desenvolvimento existe porque com `iceTransportPolicy:
   * 'relay'` a mídia toda passa pelo relay, e nesta máquina o SFU mora num
   * container — com endereço privado, que é exatamente o que a lista de
   * negados recusa. Sem a exceção, a chamada local nunca fecha.
   *
   * O risco de ter dois arquivos é um deles envelhecer sozinho. Estes testes
   * são o que impede isso: as mesmas faixas negadas, e **uma** exceção.
   */
  const dev = readFileSync(
    new URL('../../../infra/turnserver.dev.conf', import.meta.url),
    'utf8',
  );

  /** Uma linha por vez, sem o retorno de carro: o arquivo de produção está
      versionado e chega com fim de linha do Windows nesta máquina. */
  const linhas = (texto: string) =>
    texto.split(String.fromCharCode(10)).map((linha) => linha.trim());

  it('nega as mesmas faixas que a de produção', () => {
    const negadas = (texto: string) =>
      linhas(texto).filter((linha) => linha.startsWith('denied-peer-ip=')).sort();
    expect(negadas(dev)).toEqual(negadas(conf));
  });

  it('e abre exceção para um endereço só — o do SFU', () => {
    const permitidas = linhas(dev).filter((l) => l.startsWith('allowed-peer-ip='));
    expect(permitidas).toEqual(['allowed-peer-ip=172.30.0.10']);
  });

  it('continua com segredo por HMAC e sem console', () => {
    expect(dev).toContain('use-auth-secret');
    expect(dev).toContain('no-cli');
    expect(dev).not.toMatch(/^user=/m);
  });
});

/**
 * O que o compose de **produção** monta.
 *
 * Estes três testes existem porque os três defeitos aconteceram de verdade, e
 * nenhum deles apareceria antes do dia da publicação: o arquivo de produção do
 * coturn era o de desenvolvimento com outro nome, o LiveKit subia sem par de
 * chaves, e o webhook apontava para um endereço que não existia. Um deles é
 * pior que um erro — o segredo do TURN estava versionado.
 */
describe('o que o compose de produção monta', () => {
  const compose = readFileSync(
    new URL('../../../docker-compose.prod.yml', import.meta.url),
    'utf8',
  );

  /** Só as diretivas. Comentário é prosa, e prosa pode citar o que já foi. */
  const diretivas = conf
    .split(String.fromCharCode(10))
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0 && !linha.startsWith('#'));

  it('o modelo do coturn não carrega segredo nem realm de desenvolvimento', () => {
    // O coturn não lê variável de ambiente; o `implantar.sh` substitui e o
    // renderizado fica fora do git. O que está versionado tem de ser o modelo.
    expect(diretivas).toContain('static-auth-secret=${TURN_STATIC_SECRET}');
    expect(diretivas).toContain('realm=${DOMINIO_TURN}');

    const segredo = diretivas.find((l) => l.startsWith('static-auth-secret='));
    expect(segredo, 'segredo literal versionado').toBe(
      'static-auth-secret=${TURN_STATIC_SECRET}',
    );
    expect(diretivas, 'realm de desenvolvimento em produção').not.toContain('realm=localhost');
  });

  it('e serve a faixa de portas e os certificados que a documentação pede', () => {
    expect(diretivas).toContain('min-port=50201');
    expect(diretivas).toContain('max-port=50400');
    // Comentados, o TURN sobre TLS não sobe — e é ele que passa em rede
    // corporativa que bloqueia UDP, que é metade da razão de o relay existir.
    expect(diretivas.some((l) => l.startsWith('cert='))).toBe(true);
    expect(diretivas.some((l) => l.startsWith('pkey='))).toBe(true);
  });

  it('o LiveKit recebe as chaves', () => {
    // `livekit.prod.yaml` usa ${LIVEKIT_API_KEY} e ${LIVEKIT_API_SECRET}. Sem
    // `env_file`, os dois chegam vazios: o SFU sobe sem par de chaves e recusa
    // todo token que a API emitir, sem dizer por quê.
    const bloco = compose.slice(compose.indexOf('livekit:'), compose.indexOf('coturn:'));
    expect(bloco, 'o serviço livekit ficou sem env_file').toContain('env_file: .env');
  });

  it('a API é alcançável pelo webhook, e só de dentro da máquina', () => {
    // O LiveKit roda com `network_mode: host` e entrega o webhook em
    // 127.0.0.1:3000. Sem publicar a porta, ele nunca chega — e é o webhook
    // que conserta o estado de voz quando alguém cai sem se despedir.
    const bloco = compose.slice(compose.indexOf('api:'), compose.indexOf('postgres:'));
    expect(bloco).toContain("'127.0.0.1:3000:3000'");
    // Publicar em 0.0.0.0 abriria um caminho para a API que ignora o Caddy e
    // todos os cabeçalhos de segurança.
    expect(bloco).not.toMatch(/^\s+- '?0\.0\.0\.0:/m);
    expect(bloco).not.toMatch(/^\s+- '?3000:3000'?$/m);
  });

  it('o webhook aponta para onde a API de fato responde', () => {
    const prod = readFileSync(
      new URL('../../../infra/livekit.prod.yaml', import.meta.url),
      'utf8',
    );
    expect(prod).toContain('http://127.0.0.1:3000/api/livekit/webhook');
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
