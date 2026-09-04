import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  startApp,
  resetDatabase,
  createUser,
  createClient,
  sql,
  SENHA_BOA,
  type TestApp,
  type TestClient,
} from './helpers.js';

let app: TestApp;
let client: TestClient;

beforeAll(async () => {
  app = await startApp();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('0000000000000000000000000000000000000:0\n', { status: 200 })),
  );
});

afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await resetDatabase();
  client = createClient(app);
  // `resetDatabase` trunca `users` em cascata, o que leva os canais junto.
  await sql`
    insert into channels (slug, name, kind, category, position)
    values ('geral', 'geral', 'text', null, 0)
    on conflict (slug) do nothing
  `;
});

async function entrar(username: string, roleName: string): Promise<string> {
  await createUser({ username, roleName });
  const res = await client.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: SENHA_BOA },
  });
  return res.json().access as string;
}

describe('canais', () => {
  it('lista os canais para qualquer pessoa autenticada', async () => {
    const access = await entrar('ana', 'Membro');
    const res = await client.inject({
      method: 'GET',
      url: '/api/channels',
      headers: { authorization: `Bearer ${access}` },
    });

    expect(res.statusCode).toBe(200);
    // Não há ACL por canal: com cinco pessoas todo mundo vê todo canal.
    expect(res.json().channels.map((c: { slug: string }) => c.slug)).toContain('geral');
  });

  it('recusa listar sem autenticação', async () => {
    const res = await client.inject({ method: 'GET', url: '/api/channels' });
    expect(res.statusCode).toBe(401);
  });

  it('membro não cria canal, admin cria', async () => {
    const membro = await entrar('ana', 'Membro');
    const negado = await client.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${membro}` },
      payload: { name: 'produto', slug: 'produto' },
    });
    expect(negado.statusCode).toBe(403);
    expect(negado.json().code).toBe('MISSING_PERMISSION');

    const admin = await entrar('chefe', 'Admin');
    const criado = await client.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: 'produto', slug: 'produto', topic: 'o que construímos' },
    });
    expect(criado.statusCode).toBe(201);
    expect(criado.json().channel.slug).toBe('produto');
  });

  it('recusa slug repetido', async () => {
    const admin = await entrar('chefe', 'Admin');
    const res = await client.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: 'geral', slug: 'geral' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SLUG_TAKEN');
  });

  it('arquiva em vez de excluir, e o canal some da listagem', async () => {
    const admin = await entrar('chefe', 'Admin');
    const cabecalho = { authorization: `Bearer ${admin}` };

    const criado = await client.inject({
      method: 'POST',
      url: '/api/channels',
      headers: cabecalho,
      payload: { name: 'temporario', slug: 'temporario' },
    });
    const id = criado.json().channel.id as string;

    const arquivado = await client.inject({
      method: 'POST',
      url: `/api/channels/${id}/archive`,
      headers: cabecalho,
    });
    expect(arquivado.statusCode).toBe(200);
    expect(arquivado.json().channel.archivedAt).not.toBeNull();

    const lista = await client.inject({ method: 'GET', url: '/api/channels', headers: cabecalho });
    expect(lista.json().channels.map((c: { slug: string }) => c.slug)).not.toContain('temporario');

    // A linha continua no banco: arquivar não é excluir.
    const [linha] = await sql<{ count: string }[]>`
      select count(*)::text as count from channels where slug = 'temporario'
    `;
    expect(linha?.count).toBe('1');
  });

  it('reordena inteiro ou nada', async () => {
    const admin = await entrar('chefe', 'Admin');
    const cabecalho = { authorization: `Bearer ${admin}` };

    for (const slug of ['a', 'b']) {
      await client.inject({
        method: 'POST',
        url: '/api/channels',
        headers: cabecalho,
        payload: { name: slug, slug },
      });
    }

    const antes = await client.inject({ method: 'GET', url: '/api/channels', headers: cabecalho });
    const canais = antes.json().channels as Array<{ id: string; slug: string }>;

    const res = await client.inject({
      method: 'PATCH',
      url: '/api/channels/reorder',
      headers: cabecalho,
      payload: {
        order: [...canais].reverse().map((c, i) => ({ id: c.id, position: i, category: null })),
      },
    });

    expect(res.statusCode).toBe(200);
    const depois = res.json().channels as Array<{ slug: string }>;
    expect(depois.map((c) => c.slug)).toEqual([...canais].reverse().map((c) => c.slug));
  });

  it('membro não reordena', async () => {
    const membro = await entrar('ana', 'Membro');
    const res = await client.inject({
      method: 'PATCH',
      url: '/api/channels/reorder',
      headers: { authorization: `Bearer ${membro}` },
      payload: { order: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a rota reorder não é confundida com um id', async () => {
    // `/channels/reorder` é registrada antes de `/channels/:id`; se a ordem
    // invertesse, "reorder" viraria um id e a validação recusaria com 400.
    const admin = await entrar('chefe', 'Admin');
    const res = await client.inject({
      method: 'PATCH',
      url: '/api/channels/reorder',
      headers: { authorization: `Bearer ${admin}` },
      payload: { order: [] },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('pessoas', () => {
  it('devolve o elenco inteiro, sem paginação, com os cargos', async () => {
    const access = await entrar('ana', 'Membro');
    await createUser({ username: 'bruno', roleName: 'Membro' });
    await createUser({ username: 'carla', roleName: 'Admin' });

    const res = await client.inject({
      method: 'GET',
      url: '/api/users',
      headers: { authorization: `Bearer ${access}` },
    });

    expect(res.statusCode).toBe(200);
    const users = res.json().users as Array<{ username: string; roles: Array<{ name: string }> }>;
    expect(users).toHaveLength(3);
    expect(users.find((u) => u.username === 'carla')?.roles[0]?.name).toBe('Admin');
    // Nenhum hash de senha na resposta.
    expect(res.payload).not.toContain('argon2');
  });
});
