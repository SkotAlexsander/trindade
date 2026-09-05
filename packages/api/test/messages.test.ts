import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mesmaSequencia, agregarReacoes } from '@trindade/shared';
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
import { consumirFicha, resetRateLimit, statusPublico } from '../src/ws/gateway.js';
import * as messagesDb from '../src/db/messages.js';

let app: TestApp;
let client: TestClient;
let canalId: string;

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
  resetRateLimit();
  const linhas = await sql<{ id: string }[]>`
    insert into channels (slug, name, kind, position) values ('geral', 'geral', 'text', 0)
    on conflict (slug) do update set name = 'geral'
    returning id
  `;
  canalId = linhas[0]?.id ?? '';
});

async function entrar(username = 'ana'): Promise<{ access: string; id: string }> {
  const user = await createUser({ username });
  const res = await client.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: SENHA_BOA },
  });
  return { access: res.json().access as string, id: user.id };
}

async function escrever(autorId: string, texto: string, nonce = crypto.randomUUID()) {
  return messagesDb.createMessage({
    channelId: canalId,
    authorId: autorId,
    content: texto,
    clientNonce: nonce,
    replyToId: null,
    parentId: null,
  });
}

describe('histórico', () => {
  it('devolve em ordem crescente e pagina por id, não por offset', async () => {
    client = createClient(app);
    const { access, id } = await entrar();

    for (let i = 1; i <= 12; i += 1) await escrever(id, `mensagem ${i}`);

    const primeira = await client.inject({
      method: 'GET',
      url: `/api/channels/${canalId}/messages?limit=5`,
      headers: { authorization: `Bearer ${access}` },
    });
    const pagina1 = primeira.json().messages as Array<{ id: string; content: string }>;

    expect(pagina1).toHaveLength(5);
    expect(primeira.json().hasMore).toBe(true);
    // Crescente: a mais antiga do lote primeiro.
    expect(pagina1[0]?.content).toBe('mensagem 8');
    expect(pagina1[4]?.content).toBe('mensagem 12');

    const anterior = await client.inject({
      method: 'GET',
      url: `/api/channels/${canalId}/messages?limit=5&before=${pagina1[0]?.id}`,
      headers: { authorization: `Bearer ${access}` },
    });
    const pagina2 = anterior.json().messages as Array<{ content: string }>;
    expect(pagina2.map((m) => m.content)).toEqual([
      'mensagem 3',
      'mensagem 4',
      'mensagem 5',
      'mensagem 6',
      'mensagem 7',
    ]);
  });

  it('`around` traz metade antes e metade depois', async () => {
    client = createClient(app);
    const { access, id } = await entrar();
    const criadas = [];
    for (let i = 1; i <= 9; i += 1) criadas.push((await escrever(id, `m${i}`)).row);

    const meio = criadas[4];
    const res = await client.inject({
      method: 'GET',
      url: `/api/channels/${canalId}/messages?around=${meio?.id}&limit=6`,
      headers: { authorization: `Bearer ${access}` },
    });
    const conteudos = (res.json().messages as Array<{ content: string }>).map((m) => m.content);
    expect(conteudos).toContain('m5');
    expect(conteudos.indexOf('m5')).toBeGreaterThan(0);
    expect(conteudos.indexOf('m5')).toBeLessThan(conteudos.length - 1);
  });

  it('mensagem apagada vem sem conteúdo, mas continua na lista', async () => {
    client = createClient(app);
    const { access, id } = await entrar();
    const { row } = await escrever(id, 'segredo que será apagado');

    const del = await client.inject({
      method: 'DELETE',
      url: `/api/messages/${row.id}`,
      headers: { authorization: `Bearer ${access}` },
    });
    expect(del.statusCode).toBe(204);

    const res = await client.inject({
      method: 'GET',
      url: `/api/channels/${canalId}/messages`,
      headers: { authorization: `Bearer ${access}` },
    });
    const lista = res.json().messages as Array<{ content: string | null; deletedAt: string | null }>;
    expect(lista).toHaveLength(1);
    expect(lista[0]?.content).toBeNull();
    expect(lista[0]?.deletedAt).not.toBeNull();
    // O conteúdo não pode vazar em lugar nenhum da resposta.
    expect(res.payload).not.toContain('segredo');
  });
});

describe('duplicata', () => {
  it('o mesmo nonce não cria duas linhas', async () => {
    client = createClient(app);
    const { id } = await entrar();
    const nonce = crypto.randomUUID();

    const primeira = await escrever(id, 'oscilou a rede', nonce);
    const segunda = await escrever(id, 'oscilou a rede', nonce);

    expect(primeira.novo).toBe(true);
    expect(segunda.novo).toBe(false);
    expect(segunda.row.id).toBe(primeira.row.id);

    const [total] = await sql<{ count: string }[]>`
      select count(*)::text as count from messages
    `;
    expect(total?.count).toBe('1');
  });

  it('nonces diferentes com o mesmo texto criam duas', async () => {
    client = createClient(app);
    const { id } = await entrar();
    await escrever(id, 'de novo');
    await escrever(id, 'de novo');
    const [total] = await sql<{ count: string }[]>`select count(*)::text as count from messages`;
    expect(total?.count).toBe('2');
  });
});

describe('edição, exclusão e fixar', () => {
  it('só o autor edita — nem o administrador', async () => {
    client = createClient(app);
    const { id } = await entrar('ana');
    const { row } = await escrever(id, 'texto da ana');

    await createUser({ username: 'chefe', roleName: 'Admin' });
    const login = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'chefe', password: SENHA_BOA },
    });

    const res = await client.inject({
      method: 'PATCH',
      url: `/api/messages/${row.id}`,
      headers: { authorization: `Bearer ${login.json().access}` },
      payload: { content: 'texto adulterado' },
    });
    // Editar palavra alheia é diferente de moderar.
    expect(res.statusCode).toBe(404);

    const [linha] = await sql<{ content: string }[]>`
      select content from messages where id = ${row.id}
    `;
    expect(linha?.content).toBe('texto da ana');
  });

  it('quem tem DELETE_ANY_MESSAGE apaga a de outro', async () => {
    client = createClient(app);
    const { id } = await entrar('ana');
    const { row } = await escrever(id, 'mensagem da ana');

    await createUser({ username: 'chefe', roleName: 'Admin' });
    const login = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'chefe', password: SENHA_BOA },
    });

    const res = await client.inject({
      method: 'DELETE',
      url: `/api/messages/${row.id}`,
      headers: { authorization: `Bearer ${login.json().access}` },
    });
    expect(res.statusCode).toBe(204);

    // Soft delete: a linha continua, para não abrir buraco no histórico.
    const [linha] = await sql<{ deleted_at: Date | null }[]>`
      select deleted_at from messages where id = ${row.id}
    `;
    expect(linha?.deleted_at).not.toBeNull();
  });

  it('reação é única por pessoa e emoji', async () => {
    client = createClient(app);
    const { access, id } = await entrar();
    const { row } = await escrever(id, 'reajam aqui');
    const cabecalho = { authorization: `Bearer ${access}` };
    const url = `/api/messages/${row.id}/reactions/${encodeURIComponent('👍')}`;

    expect((await client.inject({ method: 'PUT', url, headers: cabecalho })).statusCode).toBe(204);
    expect((await client.inject({ method: 'PUT', url, headers: cabecalho })).statusCode).toBe(204);

    const [total] = await sql<{ count: string }[]>`select count(*)::text as count from reactions`;
    expect(total?.count).toBe('1');

    await client.inject({ method: 'DELETE', url, headers: cabecalho });
    const [depois] = await sql<{ count: string }[]>`select count(*)::text as count from reactions`;
    expect(depois?.count).toBe('0');
  });
});

describe('busca', () => {
  it('encontra com acento e sem acento', async () => {
    client = createClient(app);
    const { access, id } = await entrar();
    await escrever(id, 'a migração passou no staging sem erro');

    // O `portuguese` do Postgres faz stemming mas não remove acento. Quem
    // digita sem acento não achava nada, e isso é critério de aceite — daí a
    // configuração `pt_unaccent` da migration 012.
    for (const termo of ['migração', 'migracao', 'MIGRAÇÃO', 'Migracao']) {
      const res = await client.inject({
        method: 'GET',
        url: `/api/channels/${canalId}/messages/search?q=${encodeURIComponent(termo)}`,
        headers: { authorization: `Bearer ${access}` },
      });
      expect(res.json().total, `termo "${termo}"`).toBeGreaterThan(0);
    }
  });

  it('o stemmer não casa singular com plural em -ção — e nunca casou', async () => {
    client = createClient(app);
    const { access, id } = await entrar();
    await escrever(id, 'a migração passou no staging');

    // Limitação do Snowball português, não da configuração nova: com o
    // `portuguese` original, "migração" virava 'migraçã' e "migrações",
    // 'migraçõ' — também não se encontravam. Este teste existe para que
    // ninguém "conserte" isso achando que foi a migration 012 que quebrou.
    const res = await client.inject({
      method: 'GET',
      url: `/api/channels/${canalId}/messages/search?q=${encodeURIComponent('migrações')}`,
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.json().total).toBe(0);
  });

  it('não devolve mensagem apagada', async () => {
    client = createClient(app);
    const { access, id } = await entrar();
    const { row } = await escrever(id, 'palavra rara: xilofone');
    await messagesDb.softDelete(row.id);

    const res = await client.inject({
      method: 'GET',
      url: `/api/channels/${canalId}/messages/search?q=xilofone`,
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.json().total).toBe(0);
  });

  it('aceita pontuação sem quebrar', async () => {
    client = createClient(app);
    const { access, id } = await entrar();
    await escrever(id, 'reunião amanhã às 10h');

    // `websearch_to_tsquery` engole aspas e sinais sem lançar.
    for (const termo of ['"reunião amanhã"', 'reunião -ontem', 'reunião!!!']) {
      const res = await client.inject({
        method: 'GET',
        url: `/api/channels/${canalId}/messages/search?q=${encodeURIComponent(termo)}`,
        headers: { authorization: `Bearer ${access}` },
      });
      expect(res.statusCode, `termo ${termo}`).toBe(200);
    }
  });
});

describe('menções e leitura', () => {
  it('menção soma para o citado e não para quem escreveu', async () => {
    client = createClient(app);
    const ana = await entrar('ana');
    await createUser({ username: 'bruno' });

    const citados = await messagesDb.resolveMentions('oi @bruno, e eu @ana também');
    expect(citados).toHaveLength(2);

    await messagesDb.somarMencoes({ channelId: canalId }, citados, ana.id);

    const estados = await messagesDb.listReadState(ana.id);
    expect(estados.find((e) => e.channelId === canalId)?.mentionCount ?? 0).toBe(0);

    const [bruno] = await sql<{ id: string }[]>`select id from users where username = 'bruno'`;
    const dele = await messagesDb.listReadState(bruno?.id ?? '');
    expect(dele[0]?.mentionCount).toBe(1);
  });

  it('`@todos` chama o grupo inteiro, menos quem escreveu', async () => {
    client = createClient(app);
    const ana = await entrar('ana');
    await createUser({ username: 'bruno' });
    await createUser({ username: 'carla' });

    const citados = await messagesDb.resolveMentions('decidido, @todos');
    // Todo mundo, inclusive quem escreveu — quem tira o autor é `somarMencoes`,
    // e é lá que a regra vale para menção nominal também.
    expect(citados).toHaveLength(3);

    await messagesDb.somarMencoes({ channelId: canalId }, citados, ana.id);

    const meus = await messagesDb.listReadState(ana.id);
    expect(meus.find((e) => e.channelId === canalId)?.mentionCount ?? 0).toBe(0);

    const [bruno] = await sql<{ id: string }[]>`select id from users where username = 'bruno'`;
    expect((await messagesDb.listReadState(bruno?.id ?? ''))[0]?.mentionCount).toBe(1);
  });

  it('marcar como lido zera as menções', async () => {
    client = createClient(app);
    const { access, id } = await entrar('ana');
    const { row } = await escrever(id, 'qualquer coisa');
    await messagesDb.somarMencoes({ channelId: canalId }, [id], 'outra-pessoa');

    const res = await client.inject({
      method: 'PUT',
      url: `/api/channels/${canalId}/read`,
      headers: { authorization: `Bearer ${access}` },
      payload: { messageId: row.id },
    });
    expect(res.statusCode).toBe(204);

    const estados = await messagesDb.listReadState(id);
    expect(estados[0]?.mentionCount).toBe(0);
    expect(estados[0]?.lastReadMessageId).toBe(row.id);
  });
});

describe('regras do gateway', () => {
  it('o balde deixa passar a rajada e depois segura', () => {
    resetRateLimit();
    const passou: boolean[] = [];
    for (let i = 0; i < 16; i += 1) passou.push(consumirFicha('u1').ok);

    // 13 fichas: 10 por 10s mais estouro de 3.
    expect(passou.slice(0, 13).every(Boolean)).toBe(true);
    expect(passou.slice(13).some(Boolean)).toBe(false);
  });

  it('fecha só depois de insistir', () => {
    resetRateLimit();
    for (let i = 0; i < 13; i += 1) consumirFicha('u2');

    const respostas = [];
    for (let i = 0; i < 5; i += 1) respostas.push(consumirFicha('u2'));
    const fecharam = respostas.map((r) => (r.ok ? false : r.fechar));

    expect(fecharam[0]).toBe(false);
    expect(fecharam.at(-1)).toBe(true);
  });

  it('baldes de pessoas diferentes não se misturam', () => {
    resetRateLimit();
    for (let i = 0; i < 16; i += 1) consumirFicha('u3');
    expect(consumirFicha('u4').ok).toBe(true);
  });

  it('invisível sai como offline; o resto passa igual', () => {
    // O filtro é no servidor: mandar o status real e deixar o cliente esconder
    // seria confiar no cliente para guardar um segredo da pessoa.
    expect(statusPublico('invisible')).toBe('offline');
    for (const s of ['online', 'idle', 'busy', 'offline'] as const) {
      expect(statusPublico(s)).toBe(s);
    }
  });
});

describe('agrupamento', () => {
  const base = {
    author: { id: 'a' },
    createdAt: '2026-09-04T12:00:00.000Z',
    replyToId: null,
    parentId: null,
  };

  it('agrupa o mesmo autor dentro de cinco minutos', () => {
    expect(mesmaSequencia(base, { ...base, createdAt: '2026-09-04T12:04:00.000Z' })).toBe(true);
  });

  it('quebra em cada uma das cinco condições', () => {
    expect(mesmaSequencia(undefined, base)).toBe(false);
    expect(mesmaSequencia(base, { ...base, author: { id: 'b' } })).toBe(false);
    expect(mesmaSequencia(base, { ...base, createdAt: '2026-09-04T12:06:00.000Z' })).toBe(false);
    expect(mesmaSequencia(base, { ...base, replyToId: 'x' })).toBe(false);
    expect(mesmaSequencia(base, { ...base, parentId: 'x' })).toBe(false);
  });

  it('não agrupa através da virada do dia, mesmo com poucos minutos', () => {
    // Datas montadas em hora **local**: "mesmo dia" é o dia de quem lê, não o
    // dia em UTC. Um par escrito em Z pode ser a mesma data local e agrupar
    // com razão.
    const noite = { ...base, createdAt: new Date(2026, 8, 4, 23, 58).toISOString() };
    const madrugada = { ...base, createdAt: new Date(2026, 8, 5, 0, 1).toISOString() };
    expect(mesmaSequencia(noite, madrugada)).toBe(false);
  });

  it('agrupa dentro do mesmo dia local mesmo cruzando a meia-noite em UTC', () => {
    const antes = { ...base, createdAt: new Date(2026, 8, 4, 20, 58).toISOString() };
    const depois = { ...base, createdAt: new Date(2026, 8, 4, 21, 1).toISOString() };
    expect(mesmaSequencia(antes, depois)).toBe(true);
  });
});

describe('reações agregadas', () => {
  it('conta por emoji e marca a minha', () => {
    const resultado = agregarReacoes(
      [
        { emoji: '👍', userId: 'a' },
        { emoji: '👍', userId: 'b' },
        { emoji: '👀', userId: 'b' },
      ],
      'a',
    );
    expect(resultado).toEqual([
      { emoji: '👍', count: 2, me: true },
      { emoji: '👀', count: 1, me: false },
    ]);
  });
});

describe('guardar (favoritar)', () => {
  async function guardar(access: string, id: string, metodo: 'PUT' | 'DELETE' = 'PUT') {
    return client.inject({
      method: metodo,
      url: `/api/messages/${id}/save`,
      headers: { authorization: `Bearer ${access}` },
    });
  }

  it('guardar é do indivíduo: uma pessoa guarda e a outra não vê nada', async () => {
    client = createClient(app);
    const ana = await entrar('ana');
    const bruno = await entrar('bruno');
    const { row } = await escrever(ana.id, 'decisão importante');

    expect((await guardar(ana.access, row.id)).statusCode).toBe(204);

    const daAna = await client.inject({
      method: 'GET',
      url: `/api/channels/${canalId}/messages`,
      headers: { authorization: `Bearer ${ana.access}` },
    });
    const doBruno = await client.inject({
      method: 'GET',
      url: `/api/channels/${canalId}/messages`,
      headers: { authorization: `Bearer ${bruno.access}` },
    });

    // O mesmo id de mensagem, dois valores de `saved`. É a diferença inteira
    // entre guardar e fixar: fixar mudaria a linha para os dois.
    expect(daAna.json().messages[0].saved).toBe(true);
    expect(doBruno.json().messages[0].saved).toBe(false);

    const lista = await client.inject({
      method: 'GET',
      url: '/api/saved',
      headers: { authorization: `Bearer ${bruno.access}` },
    });
    expect(lista.json().messages).toHaveLength(0);
  });

  it('guardar duas vezes não é erro nem duplica', async () => {
    client = createClient(app);
    const ana = await entrar('ana');
    const { row } = await escrever(ana.id, 'clicada duas vezes');

    expect((await guardar(ana.access, row.id)).statusCode).toBe(204);
    expect((await guardar(ana.access, row.id)).statusCode).toBe(204);

    const lista = await client.inject({
      method: 'GET',
      url: '/api/saved',
      headers: { authorization: `Bearer ${ana.access}` },
    });
    expect(lista.json().messages).toHaveLength(1);

    // Desguardar o que não está guardado também devolve 204: quem clica por
    // engano não merece um erro.
    expect((await guardar(ana.access, row.id, 'DELETE')).statusCode).toBe(204);
    expect((await guardar(ana.access, row.id, 'DELETE')).statusCode).toBe(204);
  });

  it('não exige permissão nenhuma', async () => {
    client = createClient(app);
    const ana = await entrar('ana');
    const { row } = await escrever(ana.id, 'sem cargo nenhum');

    // `entrar` cria a conta sem cargo. Fixar recusaria; guardar não muda nada
    // para ninguém e por isso não tem o que autorizar.
    await sql`delete from user_roles where user_id = ${ana.id}`;

    expect((await guardar(ana.access, row.id)).statusCode).toBe(204);

    const fixar = await client.inject({
      method: 'PUT',
      url: `/api/messages/${row.id}/pin`,
      headers: { authorization: `Bearer ${ana.access}` },
    });
    expect(fixar.statusCode).toBe(403);
  });

  it('a lista atravessa canais e nomeia o de origem', async () => {
    client = createClient(app);
    const ana = await entrar('ana');

    const outros = await sql<{ id: string }[]>`
      insert into channels (slug, name, kind, position)
      values ('produto', 'produto', 'text', 1)
      returning id
    `;
    const outroCanal = outros[0]?.id ?? '';

    const aqui = await escrever(ana.id, 'aqui no geral');
    const ali = await messagesDb.createMessage({
      channelId: outroCanal,
      authorId: ana.id,
      content: 'ali no produto',
      clientNonce: crypto.randomUUID(),
      replyToId: null,
      parentId: null,
    });

    await guardar(ana.access, aqui.row.id);
    await guardar(ana.access, ali.row.id);

    const lista = await client.inject({
      method: 'GET',
      url: '/api/saved',
      headers: { authorization: `Bearer ${ana.access}` },
    });
    const mensagens = lista.json().messages as Array<{
      content: string;
      channel: { slug: string };
    }>;

    // Ordem de quando **guardou**, não de quando foi escrita: a última
    // guardada vem primeiro.
    expect(mensagens.map((m) => m.content)).toEqual(['ali no produto', 'aqui no geral']);
    expect(mensagens.map((m) => m.channel.slug)).toEqual(['produto', 'geral']);
  });

  it('apagar a mensagem a tira da lista, sem lápide', async () => {
    client = createClient(app);
    const ana = await entrar('ana');
    const { row } = await escrever(ana.id, 'vai ser apagada');
    await guardar(ana.access, row.id);

    await messagesDb.softDelete(row.id);

    const lista = await client.inject({
      method: 'GET',
      url: '/api/saved',
      headers: { authorization: `Bearer ${ana.access}` },
    });
    // Guardar é um ponteiro, não uma cópia. Manter o texto aqui seria desfazer
    // o apagar por outro caminho.
    expect(lista.json().messages).toHaveLength(0);
  });

  it('apagar de verdade a linha da mensagem leva a guardada junto', async () => {
    client = createClient(app);
    const ana = await entrar('ana');
    const { row } = await escrever(ana.id, 'some de vez');
    await guardar(ana.access, row.id);

    await sql`delete from messages where id = ${row.id}`;

    const restou = await sql<{ n: string }[]>`
      select count(*)::text as n from saved_messages where message_id = ${row.id}
    `;
    expect(restou[0]?.n).toBe('0');
  });

  it('guardar mensagem que não existe é 404', async () => {
    client = createClient(app);
    const ana = await entrar('ana');
    const res = await guardar(ana.access, '00000000-0000-4000-8000-000000000000');
    expect(res.statusCode).toBe(404);
  });

  it('a lista pagina por `before`', async () => {
    client = createClient(app);
    const ana = await entrar('ana');

    for (let i = 1; i <= 5; i += 1) {
      const { row } = await escrever(ana.id, `guardada ${i}`);
      await guardar(ana.access, row.id);
    }

    const p1 = await client.inject({
      method: 'GET',
      url: '/api/saved?limit=2',
      headers: { authorization: `Bearer ${ana.access}` },
    });
    const pagina1 = p1.json().messages as Array<{ id: string; content: string }>;
    expect(pagina1.map((m) => m.content)).toEqual(['guardada 5', 'guardada 4']);
    expect(p1.json().hasMore).toBe(true);

    const p2 = await client.inject({
      method: 'GET',
      url: `/api/saved?limit=2&before=${pagina1[1]?.id}`,
      headers: { authorization: `Bearer ${ana.access}` },
    });
    expect((p2.json().messages as Array<{ content: string }>).map((m) => m.content)).toEqual([
      'guardada 3',
      'guardada 2',
    ]);
  });
});
