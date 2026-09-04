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

/**
 * Hierarquia de cargos.
 *
 * Sem estas regras, `MANAGE_ROLES` **é** `ADMINISTRATOR`: quem pode atribuir
 * cargos se atribui o de administrador no primeiro clique. É o assunto inteiro
 * deste arquivo.
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

function comToken(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Um cargo qualquer, criado direto no banco para não depender das rotas. */
async function criarCargo(nome: string, position: number, permissions = '0'): Promise<string> {
  const linhas = await sql<{ id: string }[]>`
    insert into roles (name, position, permissions)
    values (${nome}, ${position}, ${permissions}::bigint)
    returning id
  `;
  const row = linhas[0];
  if (!row) throw new Error('cargo de teste não nasceu');
  return row.id;
}

async function idDoCargo(nome: string): Promise<string> {
  const linhas = await sql<{ id: string }[]>`select id from roles where name = ${nome}`;
  const row = linhas[0];
  if (!row) throw new Error(`cargo ${nome} não existe`);
  return row.id;
}

// `MANAGE_ROLES` (bit 6) + `MANAGE_MEMBERS` (bit 7) = 192. De propósito **sem**
// `ADMINISTRATOR`: é exatamente o cargo que a hierarquia precisa segurar.
const GESTAO = '192';

describe('hierarquia de cargos', () => {
  let gestor: { id: string };
  let alvo: { id: string };
  let admin: { id: string };
  let cliente: TestClient;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);

    // Chefia fica logo abaixo de Admin (100); Membro é 0.
    await criarCargo('Chefia', 50, GESTAO);
    gestor = await createUser({ username: 'gestor', roleName: 'Chefia' });
    alvo = await createUser({ username: 'alvo', roleName: 'Membro' });
    admin = await createUser({ username: 'chefe', roleName: 'Admin' });
  });

  it('deixa atribuir cargo abaixo do seu', async () => {
    const token = await entrar(cliente, 'gestor');
    const res = await cliente.inject({
      method: 'PATCH',
      url: `/api/users/${alvo.id}/roles`,
      headers: comToken(token),
      payload: { roleIds: [await idDoCargo('Membro')] },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('recusa atribuir cargo acima do seu', async () => {
    const token = await entrar(cliente, 'gestor');
    const res = await cliente.inject({
      method: 'PATCH',
      url: `/api/users/${alvo.id}/roles`,
      headers: comToken(token),
      payload: { roleIds: [await idDoCargo('Admin')] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'HIERARCHY_VIOLATION' });
  });

  it('recusa atribuir o próprio cargo — empate também é violação', async () => {
    // Sem o "ou igual", dois `Chefia` poderiam se remover em círculo, e cada
    // um poderia vestir o cargo do outro.
    const token = await entrar(cliente, 'gestor');
    const res = await cliente.inject({
      method: 'PATCH',
      url: `/api/users/${alvo.id}/roles`,
      headers: comToken(token),
      payload: { roleIds: [await idDoCargo('Chefia')] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'HIERARCHY_VIOLATION' });
  });

  it('recusa mexer em quem está acima', async () => {
    const token = await entrar(cliente, 'gestor');
    const res = await cliente.inject({
      method: 'PATCH',
      url: `/api/users/${admin.id}/roles`,
      headers: comToken(token),
      payload: { roleIds: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'HIERARCHY_VIOLATION' });
  });

  it('recusa desativar quem está acima, e deixa desativar quem está abaixo', async () => {
    const token = await entrar(cliente, 'gestor');

    const acima = await cliente.inject({
      method: 'POST',
      url: `/api/users/${admin.id}/disable`,
      headers: comToken(token),
    });
    expect(acima.statusCode).toBe(403);
    expect(acima.json()).toMatchObject({ code: 'HIERARCHY_VIOLATION' });

    const abaixo = await cliente.inject({
      method: 'POST',
      url: `/api/users/${alvo.id}/disable`,
      headers: comToken(token),
    });
    expect(abaixo.statusCode, abaixo.body).toBe(204);
  });

  it('recusa mexer na própria conta por esta porta', async () => {
    const token = await entrar(cliente, 'gestor');
    const res = await cliente.inject({
      method: 'POST',
      url: `/api/users/${gestor.id}/disable`,
      headers: comToken(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('sem MANAGE_ROLES nem chega na hierarquia', async () => {
    const token = await entrar(cliente, 'alvo');
    const res = await cliente.inject({
      method: 'PATCH',
      url: `/api/users/${gestor.id}/roles`,
      headers: comToken(token),
      payload: { roleIds: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'MISSING_PERMISSION' });
  });

  it('administrador passa por cima da comparação de posições', async () => {
    const token = await entrar(cliente, 'chefe');
    const res = await cliente.inject({
      method: 'PATCH',
      url: `/api/users/${alvo.id}/roles`,
      headers: comToken(token),
      payload: { roleIds: [await idDoCargo('Chefia')] },
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('cargos', () => {
  let cliente: TestClient;
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
    await criarCargo('Chefia', 50, GESTAO);
    await createUser({ username: 'gestor', roleName: 'Chefia' });
    token = await entrar(cliente, 'gestor');
  });

  it('cria cargo abaixo de quem criou, nunca acima', async () => {
    const res = await cliente.inject({
      method: 'POST',
      url: '/api/roles',
      headers: comToken(token),
      payload: { name: 'Revisão', color: '#4c8df6' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { role } = res.json() as { role: { position: number } };
    expect(role.position).toBeLessThan(50);
  });

  it('recusa dar ao cargo uma permissão que quem cria não tem', async () => {
    // `ADMINISTRATOR` é bit 62. Quem só tem gestão de cargos não pode
    // fabricá-lo — seria dar a volta na hierarquia em duas chamadas.
    const res = await cliente.inject({
      method: 'POST',
      url: '/api/roles',
      headers: comToken(token),
      payload: { name: 'Atalho', permissions: (1n << 62n).toString() },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'HIERARCHY_VIOLATION' });
  });

  it('recusa bit de permissão que não existe', async () => {
    // Bit 30 está na faixa reservada. Gravá-lo hoje faria o cargo ganhar
    // sozinho a permissão que um dia ocupar esse número.
    const res = await cliente.inject({
      method: 'POST',
      url: '/api/roles',
      headers: comToken(token),
      payload: { name: 'Futuro', permissions: (1n << 30n).toString() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_PERMISSIONS' });
  });

  it('recusa editar cargo acima do seu', async () => {
    const res = await cliente.inject({
      method: 'PATCH',
      url: `/api/roles/${await idDoCargo('Admin')}`,
      headers: comToken(token),
      payload: { name: 'Admin renomeado' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'HIERARCHY_VIOLATION' });
  });

  it('recusa apagar o cargo padrão', async () => {
    const res = await cliente.inject({
      method: 'DELETE',
      url: `/api/roles/${await idDoCargo('Membro')}`,
      headers: comToken(token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'DEFAULT_ROLE' });
  });

  it('recusa reordenar colocando um cargo acima do seu', async () => {
    const todos = (
      await sql<{ id: string; position: number }[]>`select id, position from roles order by position desc`
    ).map((r) => r.id);
    const res = await cliente.inject({
      method: 'PUT',
      url: '/api/roles/order',
      headers: comToken(token),
      payload: { roleIds: todos },
    });
    // A lista inclui o Admin, que está acima — arrastar não pode ser o
    // caminho fácil para o que o PATCH proíbe.
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'HIERARCHY_VIOLATION' });
  });

  it('exige a lista inteira ao reordenar', async () => {
    const res = await cliente.inject({
      method: 'PUT',
      url: '/api/roles/order',
      headers: comToken(token),
      payload: { roleIds: [await idDoCargo('Membro')] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INCOMPLETE_ORDER' });
  });

  it('qualquer pessoa lista cargos — o chip de perfil precisa do nome e da cor', async () => {
    await createUser({ username: 'comum', roleName: 'Membro' });
    const outro = createClient(app);
    const res = await outro.inject({
      method: 'GET',
      url: '/api/roles',
      headers: comToken(await entrar(outro, 'comum')),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { roles: unknown[] }).roles.length).toBeGreaterThan(0);
  });
});
