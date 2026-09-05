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
import { config } from '../src/config.js';

/**
 * Cadastro aberto: nome e senha, e nada mais.
 *
 * O convite continua existindo — as duas portas servem a momentos diferentes:
 * abrir o produto para o grupo entrar, e convidar alguém pontualmente depois
 * que as vagas fecharam.
 *
 * O que estes testes protegem é o que não se vê na tela: quem é o dono do
 * espaço quando ninguém foi promovido, e o que acontece quando a sexta pessoa
 * tenta entrar num produto que reserva cinco espaços.
 */

let app: TestApp;
let client: TestClient;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await resetDatabase();
  client = createClient(app);
});

function cadastrar(username: string, password = SENHA_BOA) {
  return client.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password },
  });
}

async function cargosDe(username: string): Promise<string[]> {
  const linhas = await sql<{ name: string }[]>`
    select r.name from roles r
      join user_roles ur on ur.role_id = r.id
      join users u on u.id = ur.user_id
     where u.username = ${username}
  `;
  return linhas.map((l) => l.name);
}

describe('cadastro sem convite', () => {
  it('cria a conta com nome e senha, e mais nada', async () => {
    const res = await cadastrar('ana');

    expect(res.statusCode).toBe(201);
    expect(res.json().user.username).toBe('ana');
    // Sem `displayName` no corpo, ele vira o próprio nome de usuário: pedir
    // duas versões do mesmo nome numa tela de cadastro é uma pergunta a mais.
    expect(res.json().user.displayName).toBe('ana');
    // Registro não faz login automático, aqui como no caminho do convite.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('a primeira conta é Admin, e a segunda não', async () => {
    // Sem isto, com cadastro aberto ninguém administraria nada: todos entram
    // como Membro e não há quem crie canal, cargo ou convite.
    await cadastrar('ana');
    expect(await cargosDe('ana')).toEqual(['Admin']);

    await cadastrar('bia');
    const cargos = await cargosDe('bia');
    expect(cargos).not.toContain('Admin');
    expect(cargos).toHaveLength(1);
  });

  it('recusa nome já usado, sem dizer nada além disso', async () => {
    await cadastrar('ana');
    const res = await cadastrar('ana');

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('USERNAME_TAKEN');
  });

  it('as vagas acabam, e a porta fecha sozinha', async () => {
    // O produto reserva cinco espaços no painel do elenco. O cadastro conta as
    // mesmas cinco vagas, para que a porta não fique aberta depois que o grupo
    // terminou de entrar.
    for (let i = 0; i < config.VAGAS; i += 1) {
      const res = await cadastrar(`pessoa${i}`);
      expect(res.statusCode).toBe(201);
    }

    const sobra = await cadastrar('tarde');
    expect(sobra.statusCode).toBe(403);
    expect(sobra.json().code).toBe('SEM_VAGAS');
  });

  it('conta quem já existe, não só quem se cadastrou', async () => {
    // As vagas são do espaço inteiro. Quem entrou por convite ou pelo
    // bootstrap ocupa uma delas — senão o limite não limita nada.
    for (let i = 0; i < config.VAGAS; i += 1) {
      await createUser({ username: `existente${i}` });
    }

    const res = await cadastrar('tarde');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('SEM_VAGAS');
  });

  it('senha curta não passa, como em qualquer outro caminho', async () => {
    const res = await cadastrar('ana', 'curta');
    expect(res.statusCode).toBe(400);
  });
});
