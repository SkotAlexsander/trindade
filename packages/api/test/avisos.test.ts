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
import { ateAsNove, HORA_DO_LEMBRETE } from '../src/services/lembretes.js';

/**
 * Silenciar canal e o lembrete de prazo.
 *
 * O servidor decide pouco sobre notificação — a tabela inteira de
 * design/09-notificacoes.md roda no cliente. O que é dele: guardar o silêncio
 * (que é de conta, não de máquina) e acordar às 9h para dizer o que vence hoje.
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

async function entrar(cliente: TestClient, username: string): Promise<string> {
  const res = await cliente.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: SENHA_BOA },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { access: string }).access;
}

interface Estado {
  channelId: string;
  mutedUntil: string | null;
  mentionCount: number;
  lastReadMessageId: string | null;
}

describe('silenciar canal', () => {
  let cliente: TestClient;
  let token: string;
  let canal: string;
  let eu: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    cliente = createClient(app);
    eu = await createUser({ username: 'ana' });
    token = await entrar(cliente, 'ana');
    canal = await canalDeTexto(`avisos-${Date.now()}`);
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function estado(): Promise<Estado | undefined> {
    const res = await cliente.inject({ method: 'GET', url: '/api/read-state', headers: auth() });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { states: Estado[] }).states.find((e) => e.channelId === canal);
  }

  it('silencia com prazo e devolve o prazo no estado de leitura', async () => {
    const ate = new Date(Date.now() + 3_600_000).toISOString();
    const res = await cliente.inject({
      method: 'PUT',
      url: `/api/channels/${canal}/mute`,
      headers: auth(),
      payload: { until: ate },
    });
    expect(res.statusCode, res.body).toBe(204);

    const depois = await estado();
    expect(depois?.mutedUntil).not.toBeNull();
    expect(Date.parse(depois?.mutedUntil as string)).toBeCloseTo(Date.parse(ate), -3);
  });

  it('reativar limpa o prazo', async () => {
    await cliente.inject({
      method: 'PUT',
      url: `/api/channels/${canal}/mute`,
      headers: auth(),
      payload: { until: new Date(Date.now() + 3_600_000).toISOString() },
    });
    const res = await cliente.inject({
      method: 'DELETE',
      url: `/api/channels/${canal}/mute`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);
    expect((await estado())?.mutedUntil).toBeNull();
  });

  /*
   * O caso que a primeira versão errava: `marcarLido` mandava `mutedUntil:
   * null` no evento, e ler um canal calado o descalava na outra aba.
   */
  it('ler um canal silenciado não o dessilencia', async () => {
    const ate = new Date(Date.now() + 3_600_000).toISOString();
    await cliente.inject({
      method: 'PUT',
      url: `/api/channels/${canal}/mute`,
      headers: auth(),
      payload: { until: ate },
    });

    const linhas = await sql<{ id: string }[]>`
      insert into messages (channel_id, author_id, content, client_nonce)
      values (${canal}, ${eu.id}, 'oi', gen_random_uuid())
      returning id
    `;
    const res = await cliente.inject({
      method: 'PUT',
      url: `/api/channels/${canal}/read`,
      headers: auth(),
      payload: { messageId: linhas[0]?.id },
    });
    expect(res.statusCode, res.body).toBe(204);

    expect((await estado())?.mutedUntil).not.toBeNull();
  });

  it('o silêncio é de cada pessoa, não do canal', async () => {
    await cliente.inject({
      method: 'PUT',
      url: `/api/channels/${canal}/mute`,
      headers: auth(),
      payload: { until: new Date(Date.now() + 3_600_000).toISOString() },
    });

    await createUser({ username: 'bruno' });
    const outro = createClient(app);
    const tokenDele = await entrar(outro, 'bruno');
    const res = await outro.inject({
      method: 'GET',
      url: '/api/read-state',
      headers: { authorization: `Bearer ${tokenDele}` },
    });

    const dele = (res.json() as { states: Estado[] }).states.find((e) => e.channelId === canal);
    expect(dele?.mutedUntil ?? null).toBeNull();
  });

  it('recusa canal que não existe', async () => {
    const res = await cliente.inject({
      method: 'PUT',
      url: '/api/channels/00000000-0000-4000-8000-000000000000/mute',
      headers: auth(),
      payload: { until: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('o relógio do lembrete', () => {
  /*
   * `setTimeout` até a próxima 9h e reagendamento a cada volta, em vez de um
   * intervalo de 24h: o intervalo fixo escorrega com o horário de verão e com
   * qualquer atraso do processo, e em um mês o "lembrete das 9h" chega às 9h40.
   */
  it('mira nas 9h de hoje quando ainda não deu', () => {
    const agora = new Date(2026, 8, 4, 7, 30, 0);
    const alvo = new Date(agora.getTime() + ateAsNove(agora));
    expect(alvo.getHours()).toBe(HORA_DO_LEMBRETE);
    expect(alvo.getDate()).toBe(4);
  });

  it('e nas de amanhã quando já passou', () => {
    const agora = new Date(2026, 8, 4, 9, 0, 1);
    const alvo = new Date(agora.getTime() + ateAsNove(agora));
    expect(alvo.getHours()).toBe(HORA_DO_LEMBRETE);
    expect(alvo.getDate()).toBe(5);
  });

  it('exatamente às 9h agenda para o dia seguinte, e não dispara duas vezes', () => {
    const agora = new Date(2026, 8, 4, 9, 0, 0);
    const alvo = new Date(agora.getTime() + ateAsNove(agora));
    expect(alvo.getDate()).toBe(5);
  });
});

describe('o que vence hoje', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('lista só a tarefa com dono, aberta e com prazo hoje', async () => {
    const ana = await createUser({ username: 'ana' });
    const canal = await canalDeTexto(`prazos-${Date.now()}`);

    const criar = (titulo: string, dono: string | null, prazo: string | null, feita = false) => sql`
      insert into tasks (channel_id, title, column_key, position, assignee_id, due_at,
                         created_by, completed_at)
      values (${canal}, ${titulo}, 'todo', 1000, ${dono}, ${prazo}, ${ana.id},
              ${feita ? new Date() : null})
    `;

    const hoje = new Date();
    hoje.setHours(15, 0, 0, 0);
    const amanha = new Date(hoje.getTime() + 86_400_000);

    await criar('vence hoje', ana.id, hoje.toISOString());
    await criar('vence amanhã', ana.id, amanha.toISOString());
    await criar('sem dono', null, hoje.toISOString());
    await criar('já feita', ana.id, hoje.toISOString(), true);
    await criar('sem prazo', ana.id, null);

    const { vencendoHoje } = await import('../src/db/tasks.js');
    const linhas = await vencendoHoje();

    expect(linhas.map((l) => l.title)).toEqual(['vence hoje']);
  });
});
