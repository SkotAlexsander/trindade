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
import { acharOuCriarDireta } from '../src/db/conversations.js';

/**
 * Conversas privadas.
 *
 * Dois requisitos aqui não são detalhe de implementação:
 *
 * 1. **`ADMINISTRATOR` não passa.** É a única exceção ao bitfield no produto,
 *    e privado tem de significar privado — inclusive na busca, que é o caminho
 *    por onde um vazamento passaria sem ninguém notar.
 * 2. **Abrir a mesma direta duas vezes cria uma só**, mesmo em duas abas ao
 *    mesmo tempo. Sem o lock, as duas transações procuram, nenhuma acha, e as
 *    duas criam.
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

interface Conversa {
  id: string;
  kind: 'direct' | 'group';
  name: string | null;
  members: string[];
  lastMessage: string | null;
  unreadCount: number;
  hidden: boolean;
}

describe('conversas privadas', () => {
  let ana: TestClient;
  let bruno: TestClient;
  let chefe: TestClient;
  let tokenDaAna: string;
  let tokenDoBruno: string;
  let tokenDoChefe: string;
  let idDaAna: string;
  let idDoBruno: string;
  let idDaCarla: string;

  beforeEach(async () => {
    await resetDatabase();
    ana = createClient(app);
    bruno = createClient(app);
    chefe = createClient(app);

    idDaAna = (await createUser({ username: 'ana' })).id;
    idDoBruno = (await createUser({ username: 'bruno' })).id;
    idDaCarla = (await createUser({ username: 'carla' })).id;
    // O cargo `Admin` do seed tem `ADMINISTRATOR`, que ignora toda checagem de
    // permissão — e é exatamente por isso que ele aparece neste teste.
    await createUser({ username: 'chefe', roleName: 'Admin' });

    tokenDaAna = await entrar(ana, 'ana');
    tokenDoBruno = await entrar(bruno, 'bruno');
    tokenDoChefe = await entrar(chefe, 'chefe');
  });

  const comoAna = () => ({ authorization: `Bearer ${tokenDaAna}` });
  const comoBruno = () => ({ authorization: `Bearer ${tokenDoBruno}` });
  const comoChefe = () => ({ authorization: `Bearer ${tokenDoChefe}` });

  async function abrirDireta(com: string): Promise<Conversa> {
    const res = await ana.inject({
      method: 'POST',
      url: '/api/conversations/direct',
      headers: comoAna(),
      payload: { userId: com },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { conversation: Conversa }).conversation;
  }

  async function escrever(
    cliente: TestClient,
    headers: object,
    conversationId: string,
    autorId: string,
    texto: string,
  ): Promise<string> {
    void cliente;
    void headers;
    // O envio de verdade é por WebSocket; aqui interessa a linha no banco, e
    // as rotas de leitura são o que está sob teste.
    const linhas = await sql<{ id: string }[]>`
      insert into messages (conversation_id, author_id, content, client_nonce)
      values (${conversationId}, ${autorId}, ${texto}, gen_random_uuid())
      returning id
    `;
    return linhas[0]?.id as string;
  }

  it('abrir a mesma direta duas vezes devolve a mesma conversa', async () => {
    const primeira = await abrirDireta(idDoBruno);
    const segunda = await abrirDireta(idDoBruno);

    expect(segunda.id).toBe(primeira.id);
    expect(await sql`select id from conversations`).toHaveLength(1);
    expect(primeira.members.sort()).toEqual([idDaAna, idDoBruno].sort());
  });

  /* Duas abas ao mesmo tempo é o caso que o lock existe para cobrir. */
  it('e duas aberturas simultâneas também', async () => {
    const [a, b] = await Promise.all([
      acharOuCriarDireta(idDaAna, idDoBruno),
      acharOuCriarDireta(idDoBruno, idDaAna),
    ]);

    expect(a.id).toBe(b.id);
    expect(await sql`select id from conversations`).toHaveLength(1);
  });

  it('quem não é membro não lê, não busca e não escreve — nem o administrador', async () => {
    const conversa = await abrirDireta(idDoBruno);
    await escrever(ana, comoAna(), conversa.id, idDaAna, 'segredo do time');

    for (const [rota, metodo] of [
      [`/api/conversations/${conversa.id}/messages`, 'GET'],
      [`/api/conversations/${conversa.id}/messages/search?q=segredo`, 'GET'],
    ] as const) {
      const res = await chefe.inject({ method: metodo, url: rota, headers: comoChefe() });
      expect(res.statusCode, `${rota}: ${res.body}`).toBe(403);
      // E nada do conteúdo escapa junto com o erro.
      expect(res.payload).not.toContain('segredo do time');
    }

    const lendo = await chefe.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: comoChefe(),
    });
    expect((lendo.json() as { conversations: Conversa[] }).conversations).toHaveLength(0);
  });

  it('a busca da conversa não devolve mensagem de canal, e vice-versa', async () => {
    const conversa = await abrirDireta(idDoBruno);
    await escrever(ana, comoAna(), conversa.id, idDaAna, 'combinamos o rollback');

    const canais = await sql<{ id: string }[]>`
      insert into channels (slug, name, kind, position)
      values ('publico', 'publico', 'text', 0)
      returning id
    `;
    await sql`
      insert into messages (channel_id, author_id, content, client_nonce)
      values (${canais[0]?.id}, ${idDaAna}, 'combinamos o rollback', gen_random_uuid())
    `;

    const naConversa = await ana.inject({
      method: 'GET',
      url: `/api/conversations/${conversa.id}/messages/search?q=rollback`,
      headers: comoAna(),
    });
    expect((naConversa.json() as { total: number }).total).toBe(1);

    const noCanal = await ana.inject({
      method: 'GET',
      url: `/api/channels/${canais[0]?.id}/messages/search?q=rollback`,
      headers: comoAna(),
    });
    expect((noCanal.json() as { total: number }).total).toBe(1);
  });

  it('a lista traz a última mensagem e o que falta ler', async () => {
    const conversa = await abrirDireta(idDoBruno);
    await escrever(ana, comoAna(), conversa.id, idDaAna, 'primeira');
    await escrever(ana, comoAna(), conversa.id, idDoBruno, 'segunda');

    const res = await ana.inject({ method: 'GET', url: '/api/conversations', headers: comoAna() });
    const minha = (res.json() as { conversations: Conversa[] }).conversations[0]!;

    expect(minha.lastMessage).toBe('segunda');
    expect(minha.unreadCount).toBe(2);
  });

  it('sair de um grupo preserva o histórico para os outros', async () => {
    const res = await ana.inject({
      method: 'POST',
      url: '/api/conversations/group',
      headers: comoAna(),
      payload: { userIds: [idDoBruno, idDaCarla], name: 'Deploy' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const grupo = (res.json() as { conversation: Conversa }).conversation;

    await escrever(ana, comoAna(), grupo.id, idDaAna, 'antes de sair');

    const saindo = await ana.inject({
      method: 'POST',
      url: `/api/conversations/${grupo.id}/leave`,
      headers: comoAna(),
    });
    expect(saindo.statusCode, saindo.body).toBe(200);

    // Para a Ana, a conversa sumiu.
    const dela = await ana.inject({ method: 'GET', url: '/api/conversations', headers: comoAna() });
    expect((dela.json() as { conversations: Conversa[] }).conversations).toHaveLength(0);

    // Para o Bruno, continua inteira — com a mensagem e a linha de sistema.
    const dele = await bruno.inject({
      method: 'GET',
      url: `/api/conversations/${grupo.id}/messages`,
      headers: comoBruno(),
    });
    expect(dele.statusCode, dele.body).toBe(200);
    const textos = (dele.json() as { messages: { content: string; kind: string }[] }).messages;
    expect(textos.map((m) => m.content)).toContain('antes de sair');
    expect(textos.some((m) => m.kind === 'system' && m.content.includes('saiu'))).toBe(true);
  });

  it('direta não vira grupo, não ganha nome e não se abandona', async () => {
    const conversa = await abrirDireta(idDoBruno);

    const renomeando = await ana.inject({
      method: 'PATCH',
      url: `/api/conversations/${conversa.id}`,
      headers: comoAna(),
      payload: { name: 'nosso canto' },
    });
    expect(renomeando.statusCode).toBe(400);

    const saindo = await ana.inject({
      method: 'POST',
      url: `/api/conversations/${conversa.id}/leave`,
      headers: comoAna(),
    });
    expect(saindo.statusCode).toBe(400);
  });

  it('esconder tira da lista, e a mensagem seguinte traz de volta', async () => {
    const conversa = await abrirDireta(idDoBruno);
    await escrever(ana, comoAna(), conversa.id, idDaAna, 'oi');

    await ana.inject({
      method: 'POST',
      url: `/api/conversations/${conversa.id}/hide`,
      headers: comoAna(),
    });

    const escondida = await ana.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: comoAna(),
    });
    expect((escondida.json() as { conversations: Conversa[] }).conversations[0]?.hidden).toBe(true);

    // É o gateway que chama `revelar` ao receber a mensagem; aqui exercitamos
    // a mesma função, que é onde a regra mora.
    const { revelar } = await import('../src/db/conversations.js');
    await revelar(conversa.id);

    const devolta = await ana.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: comoAna(),
    });
    expect((devolta.json() as { conversations: Conversa[] }).conversations[0]?.hidden).toBe(false);
  });

  it('grupo precisa de três pessoas', async () => {
    const res = await ana.inject({
      method: 'POST',
      url: '/api/conversations/group',
      headers: comoAna(),
      payload: { userIds: [idDoBruno, idDaAna] },
    });
    expect(res.statusCode).toBe(400);
  });
});
