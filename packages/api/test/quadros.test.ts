import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import * as Y from 'yjs';
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
import * as quadros from '../src/services/quadro-branco.js';
import * as boardsDb from '../src/db/boards.js';
import * as apresentacao from '../src/services/apresentacao.js';

/**
 * Os quadros brancos.
 *
 * Três coisas aqui são regra de produto e não detalhe: **dois quadros no mesmo
 * canal não se misturam** (a chave do CRDT é o quadro, não o canal), quadro se
 * arquiva e não se apaga, e a miniatura passa pelo `sharp` como toda imagem —
 * inclusive uma que já nasceu no navegador. Ver design/11-quadro.md.
 */

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await quadros.gravarTudo();
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

/** Um cargo sem MANAGE_NOTES: o servidor é quem decide quem desenha. */
async function criarCargoSemQuadro(nome: string): Promise<void> {
  // Um cargo próprio, e não o padrão alterado: `roles` sobrevive ao
  // `resetDatabase`, e mexer no cargo padrão vazaria para os testes seguintes.
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

/** Um PNG com EXIF dentro, como o que sai de um `exportToBlob` adulterado. */
async function desenhoComExif(): Promise<Buffer> {
  const base = await sharp({
    create: { width: 900, height: 700, channels: 3, background: '#2d6cdf' },
  })
    .jpeg()
    .toBuffer();

  return sharp(base)
    .withExif({ IFD0: { ImageDescription: 'descricao-secreta' } })
    .jpeg()
    .toBuffer();
}

/**
 * Desenha como o gateway desenha: um delta de fora, aplicado pelo serviço.
 *
 * Escrever direto no `doc` do serviço passaria por cima de `aplicar`, que é
 * quem marca o quadro como sujo e agenda a gravação — e o teste passaria sem
 * exercitar o caminho que existe de verdade.
 */
function desenhar(
  boardId: string,
  vivo: Awaited<ReturnType<typeof quadros.abrirQuadro>>,
  userId: string,
  ...elementos: { id: string; version: number; versionNonce: number; isDeleted?: boolean }[]
): void {
  const rascunho = new Y.Doc();
  Y.applyUpdate(rascunho, Y.encodeStateAsUpdate(vivo.doc));
  const mapa = rascunho.getMap(quadros.MAPA);
  rascunho.transact(() => {
    for (const elemento of elementos) mapa.set(elemento.id, elemento);
  });

  quadros.aplicar(boardId, vivo, Y.encodeStateAsUpdate(rascunho), userId, {
    error: () => undefined,
  } as never);
}

interface QuadroApi {
  id: string;
  channelId: string;
  name: string;
  thumbnailUrl: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

describe('quadros', () => {
  let cliente: TestClient;
  let token: string;
  let canal: string;
  let eu: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    await quadros.gravarTudo();
    cliente = createClient(app);
    eu = await createUser({ username: 'ana' });
    token = await entrar(cliente, 'ana');
    canal = await canalDeTexto('produto');
  });

  const cab = () => ({ authorization: `Bearer ${token}` });

  async function criar(name: string): Promise<QuadroApi> {
    const res = await cliente.inject({
      method: 'POST',
      url: `/api/channels/${canal}/boards`,
      headers: cab(),
      payload: { name },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { board: QuadroApi }).board;
  }

  async function listar(): Promise<QuadroApi[]> {
    const res = await cliente.inject({
      method: 'GET',
      url: `/api/channels/${canal}/boards`,
      headers: cab(),
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { boards: QuadroApi[] }).boards;
  }

  it('cria, lista e renomeia', async () => {
    const quadro = await criar('Fluxo de onboarding');
    expect(quadro.name).toBe('Fluxo de onboarding');
    expect(quadro.thumbnailUrl).toBeNull();

    const res = await cliente.inject({
      method: 'PATCH',
      url: `/api/boards/${quadro.id}`,
      headers: cab(),
      payload: { name: 'Fluxo de entrada' },
    });
    expect(res.statusCode, res.body).toBe(200);

    const lista = await listar();
    expect(lista).toHaveLength(1);
    expect(lista[0]?.name).toBe('Fluxo de entrada');
  });

  it('sem MANAGE_NOTES não cria nem renomeia', async () => {
    await criarCargoSemQuadro('So escreve');

    const outro = createClient(app);
    await createUser({ username: 'bruno', roleName: 'So escreve' });
    const tokenDele = await entrar(outro, 'bruno');

    const res = await outro.inject({
      method: 'POST',
      url: `/api/channels/${canal}/boards`,
      headers: { authorization: `Bearer ${tokenDele}` },
      payload: { name: 'meu quadro' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'MISSING_PERMISSION' });

    // Ler continua valendo: um desenho que só alguns podem ver não é registro.
    const lendo = await outro.inject({
      method: 'GET',
      url: `/api/channels/${canal}/boards`,
      headers: { authorization: `Bearer ${tokenDele}` },
    });
    expect(lendo.statusCode).toBe(200);
  });

  it('arquiva em vez de apagar: sai da lista e o desenho continua', async () => {
    const quadro = await criar('Arquitetura v2');
    const vivo = await quadros.abrirQuadro(quadro.id, eu.id);
    desenhar(quadro.id, vivo, eu.id, { id: 'r1', version: 1, versionNonce: 1 });
    await quadros.fecharQuadro(quadro.id, eu.id);

    const res = await cliente.inject({
      method: 'POST',
      url: `/api/boards/${quadro.id}/archive`,
      headers: cab(),
    });
    expect(res.statusCode, res.body).toBe(200);

    expect(await listar()).toHaveLength(0);

    // A linha continua no banco, com o desenho inteiro.
    const guardado = await boardsDb.estado(quadro.id);
    expect(guardado).not.toBeNull();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(guardado as Buffer));
    expect(doc.getMap(quadros.MAPA).size).toBe(1);
  });

  it('renomear não faz o quadro pular para o topo da lista', async () => {
    const primeiro = await criar('Primeiro');
    // Um instante depois, para as duas datas não empatarem.
    await new Promise((r) => setTimeout(r, 15));
    await criar('Segundo');

    await cliente.inject({
      method: 'PATCH',
      url: `/api/boards/${primeiro.id}`,
      headers: cab(),
      payload: { name: 'Primeiro, com outro nome' },
    });

    // A lista está ordenada por onde a coisa está acontecendo, e trocar o nome
    // não é acontecer nada.
    const lista = await listar();
    expect(lista[0]?.name).toBe('Segundo');
  });

  it('a miniatura passa pelo sharp e chega sem EXIF', async () => {
    const quadro = await criar('Com miniatura');
    const { payload, contentType } = multipart(
      'quadro.png',
      await desenhoComExif(),
      'image/png',
    );

    const res = await cliente.inject({
      method: 'POST',
      url: `/api/boards/${quadro.id}/thumbnail`,
      headers: { ...cab(), 'content-type': contentType },
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);

    const { board } = res.json() as { board: QuadroApi };
    expect(board.thumbnailUrl).toMatch(/^\/api\/files\/quadros\//);
    // A chave é aleatória: o nome enviado nunca vira caminho.
    expect(board.thumbnailUrl).not.toContain('quadro.png');

    const arquivo = await cliente.inject({ method: 'GET', url: board.thumbnailUrl as string });
    expect(arquivo.statusCode).toBe(200);
    expect(arquivo.headers['content-type']).toBe('image/webp');

    const bytes = arquivo.rawPayload;
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
    expect(meta.exif).toBeUndefined();
    expect(bytes.includes(Buffer.from('descricao-secreta'))).toBe(false);
  });

  it('recusa como miniatura o que não é imagem', async () => {
    const quadro = await criar('Sem miniatura');
    const { payload, contentType } = multipart(
      'quadro.png',
      Buffer.from('isto não é um desenho'),
      'image/png',
    );

    const res = await cliente.inject({
      method: 'POST',
      url: `/api/boards/${quadro.id}/thumbnail`,
      headers: { ...cab(), 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });
});

describe('o quadro vivo', () => {
  let canal: string;
  let ana: { id: string };
  let bruno: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    await quadros.gravarTudo();
    ana = await createUser({ username: 'ana' });
    bruno = await createUser({ username: 'bruno' });
    canal = await canalDeTexto('desenho');
  });

  async function novoQuadro(nome: string): Promise<string> {
    const linha = await boardsDb.criar({ channelId: canal, name: nome, createdBy: ana.id });
    return linha.id;
  }

  it('dois quadros no mesmo canal não se misturam', async () => {
    const a = await novoQuadro('A');
    const b = await novoQuadro('B');

    const vivoA = await quadros.abrirQuadro(a, ana.id);
    const vivoB = await quadros.abrirQuadro(b, ana.id);

    desenhar(a, vivoA, ana.id, { id: 'e1', version: 1, versionNonce: 1 });

    expect(quadros.contarElementos(vivoA)).toBe(1);
    // O aceite da fase, na sua forma mais curta.
    expect(quadros.contarElementos(vivoB)).toBe(0);

    await quadros.fecharQuadro(a, ana.id);
    await quadros.fecharQuadro(b, ana.id);
  });

  it('o que foi apagado não conta para o limite', async () => {
    const id = await novoQuadro('Contagem');
    const vivo = await quadros.abrirQuadro(id, ana.id);

    desenhar(
      id,
      vivo,
      ana.id,
      { id: 'e1', version: 1, versionNonce: 1 },
      { id: 'e2', version: 1, versionNonce: 2 },
    );
    expect(quadros.contarElementos(vivo)).toBe(2);

    // O Excalidraw não remove: marca. Contar as chaves diria 2 para sempre.
    desenhar(id, vivo, ana.id, { id: 'e2', version: 2, versionNonce: 3, isDeleted: true });
    expect(quadros.contarElementos(vivo)).toBe(1);

    await quadros.fecharQuadro(id, ana.id);
  });

  it('o último a sair grava na hora, e o desenho volta na abertura seguinte', async () => {
    const id = await novoQuadro('Persistente');

    const vivo = await quadros.abrirQuadro(id, ana.id);
    desenhar(id, vivo, ana.id, { id: 'e1', version: 1, versionNonce: 1 });

    // Duas pessoas dentro: sair uma não solta a memória nem grava.
    await quadros.abrirQuadro(id, bruno.id);
    await quadros.fecharQuadro(id, bruno.id);
    expect(await boardsDb.estado(id)).toBeNull();

    await quadros.fecharQuadro(id, ana.id);

    const guardado = await boardsDb.estado(id);
    expect(guardado).not.toBeNull();

    const devolta = await quadros.abrirQuadro(id, ana.id);
    expect(quadros.contarElementos(devolta)).toBe(1);
    await quadros.fecharQuadro(id, ana.id);
  });
});

describe('apresentar um quadro', () => {
  let canal: string;
  let ana: { id: string };
  let bruno: { id: string };
  const log = { error: () => undefined } as never;

  beforeEach(async () => {
    await resetDatabase();
    await quadros.gravarTudo();
    apresentacao.limparApresentacoes();
    ana = await createUser({ username: 'ana' });
    bruno = await createUser({ username: 'bruno' });
    canal = await canalDeTexto('palco');
  });

  async function novoQuadro(nome: string): Promise<string> {
    const linha = await boardsDb.criar({ channelId: canal, name: nome, createdBy: ana.id });
    return linha.id;
  }

  /** As linhas de sistema que o canal recebeu, na ordem. */
  async function linhasDeSistema(): Promise<string[]> {
    const linhas = await sql<{ content: string }[]>`
      select content from messages
       where channel_id = ${canal} and kind = 'system'
       order by created_at
    `;
    return linhas.map((l) => l.content);
  }

  it('anuncia no canal, com link para o quadro', async () => {
    const id = await novoQuadro('Arquitetura');
    const inicio = await apresentacao.comecar({ boardId: id, userId: ana.id, log });
    expect(inicio.ok).toBe(true);

    const [comeco] = await linhasDeSistema();
    expect(comeco).toContain('está apresentando');
    // O nome do quadro é um link de verdade: quem lê a linha depois quer entrar.
    expect(comeco).toContain(`?quadro=${id}`);
    expect(comeco).toContain('[Arquitetura]');

    await apresentacao.terminar(id, ana.id, log);
    const linhas = await linhasDeSistema();
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toContain('encerrou a apresentação');
  });

  it('uma apresentação por quadro', async () => {
    const id = await novoQuadro('Disputado');
    await apresentacao.comecar({ boardId: id, userId: ana.id, log });

    // Dois conduzindo o mesmo quadro é o mesmo que ninguém conduzir: cada
    // espectador seguiria uma viewport diferente.
    const segundo = await apresentacao.comecar({ boardId: id, userId: bruno.id, log });
    expect(segundo).toEqual({ ok: false, motivo: 'ALREADY_PRESENTING' });
    expect(apresentacao.apresentacaoDoQuadro(id)?.userId).toBe(ana.id);

    // E quem já está apresentando pode clicar de novo sem duplicar a linha.
    const denovo = await apresentacao.comecar({ boardId: id, userId: ana.id, log });
    expect(denovo.ok).toBe(true);
    expect(await linhasDeSistema()).toHaveLength(1);
  });

  it('quem não está apresentando não encerra a apresentação de outra pessoa', async () => {
    const id = await novoQuadro('Meu');
    await apresentacao.comecar({ boardId: id, userId: ana.id, log });

    await apresentacao.terminar(id, bruno.id, log);
    expect(apresentacao.apresentacaoDoQuadro(id)?.userId).toBe(ana.id);

    await apresentacao.terminar(id, ana.id, log);
    expect(apresentacao.apresentacaoDoQuadro(id)).toBeUndefined();
  });

  it('a queda da conexão encerra o que estava em curso', async () => {
    const id = await novoQuadro('Abandonado');
    await apresentacao.comecar({ boardId: id, userId: ana.id, log });

    // Sem isto, uma aba fechada deixaria o quadro travado em "Ana
    // apresentando" para sempre.
    await apresentacao.esquecerApresentador(ana.id, log);
    expect(apresentacao.apresentacoes()).toHaveLength(0);
    expect(await linhasDeSistema()).toHaveLength(2);
  });

  it('quadro arquivado não vira palco', async () => {
    const id = await novoQuadro('Guardado');
    await boardsDb.arquivar(id);

    const tentativa = await apresentacao.comecar({ boardId: id, userId: ana.id, log });
    expect(tentativa).toEqual({ ok: false, motivo: 'BOARD_NOT_FOUND' });
  });
});
