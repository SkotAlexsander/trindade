import { randomUUID } from 'node:crypto';
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
 * O quadro de tarefas.
 *
 * Três coisas aqui não são detalhe de implementação, são a regra do produto:
 * a coluna e o estado de concluída são a mesma informação vista de dois lados,
 * a linha de sistema no canal sai **uma vez** (na transição), e tarefa
 * concluída não se apaga. Ver design/08-projeto.md.
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.close();
});

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

/** Um cargo sem MANAGE_TASKS, para provar que o servidor é quem decide. */
async function criarCargoSemQuadro(nome: string): Promise<void> {
  // Bit 0 (SEND_MESSAGE) só: escrever no canal, sem tocar no quadro.
  await sql`insert into roles (name, position, permissions) values (${nome}, 10, 1::bigint)`;
}

async function entrar(cliente: TestClient, username: string): Promise<string> {
  const res = await cliente.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: SENHA_BOA },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { access: string }).access;
}

interface Tarefa {
  id: string;
  channelId: string;
  title: string;
  columnKey: 'todo' | 'doing' | 'done';
  position: number;
  assigneeId: string | null;
  dueAt: string | null;
  sourceMessageId: string | null;
  completedAt: string | null;
}

describe('quadro de tarefas', () => {
  let cliente: TestClient;
  let token: string;
  let canal: string;
  let eu: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
    eu = await createUser({ username: 'ana' });
    token = await entrar(cliente, 'ana');
    canal = await canalDeTexto(`quadro-${Date.now()}`);
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function criar(payload: Record<string, unknown>): Promise<Tarefa> {
    const res = await cliente.inject({
      method: 'POST',
      url: `/api/channels/${canal}/tasks`,
      headers: auth(),
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { task: Tarefa }).task;
  }

  async function alterar(id: string, payload: Record<string, unknown>) {
    return cliente.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      headers: auth(),
      payload,
    });
  }

  it('nasce em "A fazer" e cada nova entra no fim da coluna', async () => {
    const primeira = await criar({ title: 'Revisar a migração' });
    const segunda = await criar({ title: 'Marcar a call' });

    expect(primeira.columnKey).toBe('todo');
    expect(primeira.completedAt).toBeNull();
    // O topo é o que já foi combinado; empurrar isso para baixo a cada
    // criação embaralharia a leitura de quem chega.
    expect(segunda.position).toBeGreaterThan(primeira.position);
  });

  it('a coluna e o estado de concluída andam juntos, nos dois sentidos', async () => {
    const tarefa = await criar({ title: 'Fechar a fase 9' });

    const feita = await alterar(tarefa.id, { columnKey: 'done', position: 1000 });
    expect(feita.statusCode, feita.body).toBe(200);
    expect((feita.json() as { task: Tarefa }).task.completedAt).not.toBeNull();

    // Tirar de "Feito" desfaz: sem isso, o cartão sairia de lá continuando
    // marcado como concluído, e a lista do que o grupo fez mentiria.
    const reaberta = await alterar(tarefa.id, { columnKey: 'todo', position: 1000 });
    expect((reaberta.json() as { task: Tarefa }).task.completedAt).toBeNull();
  });

  it('anuncia a conclusão no canal uma vez só, na transição', async () => {
    const tarefa = await criar({ title: 'Revisar a migração' });

    await alterar(tarefa.id, { concluida: true, columnKey: 'done' });

    const depoisDaPrimeira = await sql<{ content: string; kind: string }[]>`
      select content, kind from messages where channel_id = ${canal} order by created_at
    `;
    expect(depoisDaPrimeira).toHaveLength(1);
    expect(depoisDaPrimeira[0]?.kind).toBe('system');
    expect(depoisDaPrimeira[0]?.content).toContain('Revisar a migração');

    // Arrastar o cartão dentro de "Feito" não é uma conclusão nova. Sem a
    // checagem de transição, o canal viraria eco do quadro.
    await alterar(tarefa.id, { columnKey: 'done', position: 2000 });
    const depoisDoArrasto = await sql<{ id: string }[]>`
      select id from messages where channel_id = ${canal}
    `;
    expect(depoisDoArrasto).toHaveLength(1);
  });

  it('guarda o elo de volta para a mensagem de origem', async () => {
    const linhas = await sql<{ id: string }[]>`
      insert into messages (channel_id, author_id, content, client_nonce)
      values (${canal}, ${eu.id}, 'precisamos revisar a migração', ${randomUUID()})
      returning id
    `;
    const mensagem = linhas[0]?.id as string;

    const tarefa = await criar({ title: 'revisar a migração', sourceMessageId: mensagem });
    expect(tarefa.sourceMessageId).toBe(mensagem);
  });

  it('tarefa concluída fica no histórico e não se apaga', async () => {
    const tarefa = await criar({ title: 'Publicar a fase 8' });
    await alterar(tarefa.id, { concluida: true, columnKey: 'done' });

    const res = await cliente.inject({
      method: 'DELETE',
      url: `/api/tasks/${tarefa.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code ?? res.json().code).toBe('TASK_DONE');

    const restou = await sql`select id from tasks where id = ${tarefa.id}`;
    expect(restou).toHaveLength(1);
  });

  it('apaga a que nunca aconteceu', async () => {
    const tarefa = await criar({ title: 'Ideia que morreu' });
    const res = await cliente.inject({
      method: 'DELETE',
      url: `/api/tasks/${tarefa.id}`,
      headers: auth(),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await sql`select id from tasks where id = ${tarefa.id}`).toHaveLength(0);
  });

  it('sem MANAGE_TASKS o servidor recusa criar, mexer e apagar', async () => {
    // Esconder o botão no cliente não é controle de acesso: quem entrega a
    // regra é a rota.
    const tarefa = await criar({ title: 'Da Ana' });

    await criarCargoSemQuadro('Visitante');
    await createUser({ username: 'bruno', roleName: 'Visitante' });
    const outro = createClient(app);
    const tokenDele = await entrar(outro, 'bruno');
    const cabecalho = { authorization: `Bearer ${tokenDele}` };

    const criando = await outro.inject({
      method: 'POST',
      url: `/api/channels/${canal}/tasks`,
      headers: cabecalho,
      payload: { title: 'não deveria entrar' },
    });
    expect(criando.statusCode).toBe(403);

    const mexendo = await outro.inject({
      method: 'PATCH',
      url: `/api/tasks/${tarefa.id}`,
      headers: cabecalho,
      payload: { columnKey: 'done' },
    });
    expect(mexendo.statusCode).toBe(403);

    const apagando = await outro.inject({
      method: 'DELETE',
      url: `/api/tasks/${tarefa.id}`,
      headers: cabecalho,
    });
    expect(apagando.statusCode).toBe(403);

    // Ver, vê: o quadro é do canal, e quem lê o canal lê o quadro.
    const lendo = await outro.inject({
      method: 'GET',
      url: `/api/channels/${canal}/tasks`,
      headers: cabecalho,
    });
    expect(lendo.statusCode, lendo.body).toBe(200);
    expect((lendo.json() as { tasks: Tarefa[] }).tasks).toHaveLength(1);
  });

  it('recusa canal que não existe e tarefa que não existe', async () => {
    const semCanal = await cliente.inject({
      method: 'POST',
      url: `/api/channels/00000000-0000-4000-8000-000000000000/tasks`,
      headers: auth(),
      payload: { title: 'no vazio' },
    });
    expect(semCanal.statusCode).toBe(404);

    const semTarefa = await alterar('00000000-0000-4000-8000-000000000000', { title: 'x' });
    expect(semTarefa.statusCode).toBe(404);
  });
});
