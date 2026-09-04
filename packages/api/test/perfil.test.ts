import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  SENHA_BOA,
  createClient,
  createUser,
  resetDatabase,
  startApp,
  type TestApp,
  type TestClient,
} from './helpers.js';

/**
 * Perfil e avatar.
 *
 * O que importa aqui é uma frase só: **nenhum byte original chega ao disco**.
 * Foto de celular carrega EXIF com coordenadas de GPS, e servir o arquivo
 * original faria cada pessoa publicar onde mora sem saber.
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

/** Um multipart montado à mão: o `inject` do Fastify não monta um. */
function multipart(nome: string, conteudo: Buffer, contentType: string) {
  const limite = '----trindadeTeste';
  const cabeca = Buffer.from(
    `--${limite}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${nome}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const rodape = Buffer.from(`\r\n--${limite}--\r\n`);
  return {
    payload: Buffer.concat([cabeca, conteudo, rodape]),
    contentType: `multipart/form-data; boundary=${limite}`,
  };
}

/** Um JPEG com GPS e uma orientação que precisa ser aplicada. */
async function fotoComExif(): Promise<Buffer> {
  const base = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#c0392b' },
  })
    .jpeg()
    .toBuffer();

  return sharp(base)
    .withExif({
      IFD0: { ImageDescription: 'descricao-secreta', Orientation: '6' },
      IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
    })
    .jpeg()
    .toBuffer();
}

describe('perfil', () => {
  let cliente: TestClient;
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
    await createUser({ username: 'ana', displayName: 'Ana Silva' });
    token = await entrar(cliente, 'ana');
  });

  const cab = () => ({ authorization: `Bearer ${token}` });

  it('atualiza só o que veio', async () => {
    const res = await cliente.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: cab(),
      payload: { bio: 'cuidando do backend' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { user } = res.json() as { user: { bio: string; displayName: string } };
    expect(user.bio).toBe('cuidando do backend');
    // O nome não foi mandado, então não pode ter mudado.
    expect(user.displayName).toBe('Ana Silva');
  });

  it('distingue apagar de não mexer', async () => {
    await cliente.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: cab(),
      payload: { bio: 'algo', accentColor: '#4c8df6' },
    });

    // `null` apaga a bio; a cor, ausente, fica.
    const res = await cliente.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: cab(),
      payload: { bio: null },
    });
    const { user } = res.json() as { user: { bio: string | null; accentColor: string | null } };
    expect(user.bio).toBeNull();
    expect(user.accentColor).toBe('#4c8df6');
  });

  it('recusa cor fora do formato', async () => {
    const res = await cliente.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: cab(),
      payload: { accentColor: 'vermelho' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('avatar', () => {
  let cliente: TestClient;
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
    await createUser({ username: 'ana' });
    token = await entrar(cliente, 'ana');
  });

  const cab = () => ({ authorization: `Bearer ${token}` });

  async function subir(nome: string, bytes: Buffer, tipo: string) {
    const { payload, contentType } = multipart(nome, bytes, tipo);
    return cliente.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: { ...cab(), 'content-type': contentType },
      payload,
    });
  }

  it('re-encoda para WebP quadrado e apaga o metadado', async () => {
    const res = await subir('foto.jpg', await fotoComExif(), 'image/jpeg');
    expect(res.statusCode, res.body).toBe(200);

    const { avatarUrl, avatarBlurhash } = res.json() as {
      avatarUrl: string;
      avatarBlurhash: string | null;
    };
    expect(avatarUrl).toMatch(/^\/api\/files\/avatares\//);
    // A chave é aleatória: o nome enviado nunca vira caminho.
    expect(avatarUrl).not.toContain('foto');
    expect(avatarBlurhash).toBeTruthy();

    const arquivo = await cliente.inject({ method: 'GET', url: avatarUrl });
    expect(arquivo.statusCode).toBe(200);
    expect(arquivo.headers['content-type']).toBe('image/webp');
    expect(arquivo.headers['x-content-type-options']).toBe('nosniff');

    const bytes = arquivo.rawPayload;
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP');

    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    // Nenhum EXIF, e nenhum resto do texto que estava lá dentro.
    expect(meta.exif).toBeUndefined();
    expect(bytes.includes(Buffer.from('descricao-secreta'))).toBe(false);
  });

  it('recusa um .txt renomeado para .png', async () => {
    // A extensão e o `Content-Type` mentem os dois. A decisão é dos bytes.
    const res = await subir('inocente.png', Buffer.from('só texto, nada de imagem'), 'image/png');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('recusa SVG, que é imagem e documento com script ao mesmo tempo', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const res = await subir('logo.svg', svg, 'image/svg+xml');
    expect(res.statusCode).toBe(400);
  });

  it('apaga a foto anterior do storage ao trocar', async () => {
    const primeira = await subir('a.jpg', await fotoComExif(), 'image/jpeg');
    const urlAntiga = (primeira.json() as { avatarUrl: string }).avatarUrl;

    const segunda = await subir('b.jpg', await fotoComExif(), 'image/jpeg');
    const urlNova = (segunda.json() as { avatarUrl: string }).avatarUrl;
    expect(urlNova).not.toBe(urlAntiga);

    // A antiga não é só inacessível: ela saiu do disco. A rota consulta o
    // banco antes de servir, então o 404 cobre as duas coisas.
    const velha = await cliente.inject({ method: 'GET', url: urlAntiga });
    expect(velha.statusCode).toBe(404);
  });

  it('apagar o avatar devolve a pessoa ao estado sem foto', async () => {
    await subir('a.jpg', await fotoComExif(), 'image/jpeg');
    const apagou = await cliente.inject({ method: 'DELETE', url: '/api/me/avatar', headers: cab() });
    expect(apagou.statusCode).toBe(204);

    const eu = await cliente.inject({ method: 'GET', url: '/api/me', headers: cab() });
    const { user } = eu.json() as { user: { avatarUrl: string | null } };
    expect(user.avatarUrl).toBeNull();
  });

  it('sem sessão não sobe nada', async () => {
    const { payload, contentType } = multipart('a.jpg', await fotoComExif(), 'image/jpeg');
    const res = await cliente.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: { 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });
});
