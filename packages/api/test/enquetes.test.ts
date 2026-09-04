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
 * Enquetes.
 *
 * O requisito que não pode falhar é o anonimato: numa enquete anônima o
 * servidor **não manda** quem votou em quê, para ninguém — nem para quem
 * criou. Esconder na interface e mandar na resposta seria prometer segredo e
 * entregar um `F12`. O resto são regras de urna: fechada não recebe voto, voto
 * único não aceita dois, e votar de novo substitui.
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

interface Enquete {
  id: string;
  messageId: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  closedAt: string | null;
  options: { id: string; label: string; count: number; voters: string[] }[];
  myVotes: string[];
  voterCount: number;
}

describe('enquetes', () => {
  let ana: TestClient;
  let tokenDaAna: string;
  let bruno: TestClient;
  let tokenDoBruno: string;
  let idDaAna: string;
  let idDoBruno: string;
  let canal: string;

  beforeEach(async () => {
    await resetDatabase();
    ana = createClient(app);
    bruno = createClient(app);
    idDaAna = (await createUser({ username: 'ana' })).id;
    idDoBruno = (await createUser({ username: 'bruno' })).id;
    tokenDaAna = await entrar(ana, 'ana');
    tokenDoBruno = await entrar(bruno, 'bruno');
    canal = await canalDeTexto(`enquete-${Date.now()}`);
  });

  const comoAna = () => ({ authorization: `Bearer ${tokenDaAna}` });
  const comoBruno = () => ({ authorization: `Bearer ${tokenDoBruno}` });

  async function criar(payload: Record<string, unknown>): Promise<Enquete> {
    const res = await ana.inject({
      method: 'POST',
      url: `/api/channels/${canal}/polls`,
      headers: comoAna(),
      payload: { clientNonce: randomUUID(), ...payload },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { poll: Enquete }).poll;
  }

  function votar(cliente: TestClient, headers: object, pollId: string, optionIds: string[]) {
    return cliente.inject({
      method: 'PUT',
      url: `/api/polls/${pollId}/vote`,
      headers,
      payload: { optionIds },
    });
  }

  const PADRAO = { question: 'Janela de deploy?', options: ['Terça, 9h', 'Quinta, 22h'] };

  it('nasce como mensagem do canal, com a pergunta no corpo', async () => {
    const enquete = await criar(PADRAO);

    const linhas = await sql<{ kind: string; content: string; id: string }[]>`
      select id, kind, content from messages where channel_id = ${canal}
    `;
    expect(linhas).toHaveLength(1);
    // A enquete no fluxo, e não numa tabela paralela de "itens especiais": é
    // assim que ela entra na busca e no histórico.
    expect(linhas[0]?.kind).toBe('poll');
    expect(linhas[0]?.content).toBe('Janela de deploy?');
    expect(enquete.messageId).toBe(linhas[0]?.id);
    expect(enquete.options.map((o) => o.label)).toEqual(['Terça, 9h', 'Quinta, 22h']);
  });

  it('votar de novo substitui o voto, sem "desfazer" separado', async () => {
    const enquete = await criar(PADRAO);
    const [primeira, segunda] = enquete.options;

    await votar(ana, comoAna(), enquete.id, [primeira!.id]);
    const trocou = await votar(ana, comoAna(), enquete.id, [segunda!.id]);
    const depois = (trocou.json() as { poll: Enquete }).poll;

    expect(depois.options[0]?.count).toBe(0);
    expect(depois.options[1]?.count).toBe(1);
    expect(depois.myVotes).toEqual([segunda!.id]);

    // Lista vazia é como se tira o voto.
    const tirou = await votar(ana, comoAna(), enquete.id, []);
    expect((tirou.json() as { poll: Enquete }).poll.voterCount).toBe(0);
  });

  it('conta pessoas e não votos quando é múltipla', async () => {
    const enquete = await criar({ ...PADRAO, multiple: true });
    const ids = enquete.options.map((o) => o.id);

    const res = await votar(ana, comoAna(), enquete.id, ids);
    const depois = (res.json() as { poll: Enquete }).poll;

    expect(depois.options[0]?.count).toBe(1);
    expect(depois.options[1]?.count).toBe(1);
    // "4 de 5 votaram" tem de bater com o elenco: quem marca duas opções
    // continua sendo uma pessoa.
    expect(depois.voterCount).toBe(1);
  });

  it('recusa dois votos numa enquete de voto único', async () => {
    const enquete = await criar(PADRAO);
    const res = await votar(
      ana,
      comoAna(),
      enquete.id,
      enquete.options.map((o) => o.id),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code ?? res.json().code).toBe('POLL_SINGLE_CHOICE');
  });

  it('a enquete anônima não entrega quem votou — nem para quem criou', async () => {
    const enquete = await criar({ ...PADRAO, anonymous: true });
    const opcao = enquete.options[0]!.id;

    await votar(bruno, comoBruno(), enquete.id, [opcao]);

    // A autora da enquete é quem mais teria motivo para receber os nomes, e é
    // justamente para ela que a promessa precisa valer.
    const vistaPelaAna = await ana.inject({
      method: 'GET',
      url: `/api/channels/${canal}/polls`,
      headers: comoAna(),
    });
    const primeira = (vistaPelaAna.json() as { polls: Enquete[] }).polls[0]!;

    expect(primeira.options[0]?.count).toBe(1);
    expect(primeira.options[0]?.voters).toEqual([]);
    // Nem o id de quem votou, em canto nenhum da resposta. `createdBy` é da
    // própria Ana e não é segredo: quem perguntou aparece assinado.
    expect(vistaPelaAna.payload).not.toContain(idDoBruno);
    // Do seu próprio voto você sempre sabe — a Ana não votou.
    expect(primeira.myVotes).toEqual([]);
  });

  it('a enquete aberta mostra quem votou em cada opção', async () => {
    const enquete = await criar(PADRAO);
    const opcao = enquete.options[0]!.id;

    await votar(ana, comoAna(), enquete.id, [opcao]);
    const res = await bruno.inject({
      method: 'GET',
      url: `/api/channels/${canal}/polls`,
      headers: comoBruno(),
    });
    const vista = (res.json() as { polls: Enquete[] }).polls[0]!;

    expect(vista.options[0]?.voters).toEqual([idDaAna]);
    expect(vista.myVotes).toEqual([]);
  });

  it('só quem criou encerra, e encerrada não recebe mais voto', async () => {
    const enquete = await criar(PADRAO);

    const tentativaDoBruno = await bruno.inject({
      method: 'POST',
      url: `/api/polls/${enquete.id}/close`,
      headers: comoBruno(),
    });
    expect(tentativaDoBruno.statusCode).toBe(403);

    const fechou = await ana.inject({
      method: 'POST',
      url: `/api/polls/${enquete.id}/close`,
      headers: comoAna(),
    });
    expect(fechou.statusCode, fechou.body).toBe(200);
    expect((fechou.json() as { poll: Enquete }).poll.closedAt).not.toBeNull();

    const tarde = await votar(bruno, comoBruno(), enquete.id, [enquete.options[0]!.id]);
    expect(tarde.statusCode).toBe(400);
    expect(tarde.json().error?.code ?? tarde.json().code).toBe('POLL_CLOSED');
  });

  it('o prazo vale na hora, sem esperar o worker passar', async () => {
    const enquete = await criar(PADRAO);
    // Vencida há um minuto e ainda com `closed_at` nulo: é o estado em que a
    // enquete fica entre o prazo e a próxima volta da faxina.
    await sql`update polls set closes_at = now() - interval '1 minute' where id = ${enquete.id}`;

    const res = await votar(bruno, comoBruno(), enquete.id, [enquete.options[0]!.id]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code ?? res.json().code).toBe('POLL_CLOSED');
  });

  it('recusa opção de outra enquete, opção repetida e menos de duas', async () => {
    const enquete = await criar(PADRAO);
    const outra = await criar({ question: 'Outra?', options: ['Sim', 'Não'] });

    const invasora = await votar(ana, comoAna(), enquete.id, [outra.options[0]!.id]);
    expect(invasora.statusCode).toBe(400);
    expect(invasora.json().error?.code ?? invasora.json().code).toBe('POLL_BAD_OPTION');

    const repetida = await ana.inject({
      method: 'POST',
      url: `/api/channels/${canal}/polls`,
      headers: comoAna(),
      payload: { clientNonce: randomUUID(), question: 'Q?', options: ['Sim', 'Sim'] },
    });
    expect(repetida.statusCode).toBe(400);
    expect(repetida.json().error?.code ?? repetida.json().code).toBe('POLL_DUPLICATE_OPTION');

    const curta = await ana.inject({
      method: 'POST',
      url: `/api/channels/${canal}/polls`,
      headers: comoAna(),
      payload: { clientNonce: randomUUID(), question: 'Q?', options: ['Só uma'] },
    });
    expect(curta.statusCode).toBe(400);
  });

  it('o mesmo nonce não cria duas enquetes', async () => {
    const nonce = randomUUID();
    const primeira = await criar({ ...PADRAO, clientNonce: nonce });
    const segunda = await criar({ ...PADRAO, clientNonce: nonce });

    expect(segunda.id).toBe(primeira.id);
    expect(await sql`select id from polls`).toHaveLength(1);
  });
});
