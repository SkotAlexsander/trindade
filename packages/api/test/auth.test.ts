import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  startApp,
  resetDatabase,
  createUser,
  createInvite,
  refreshCookieFrom,
  sql,
  SENHA_BOA,
  createClient,
  type TestApp,
  type TestClient,
} from './helpers.js';

let app: TestApp;
let client: TestClient;

beforeAll(async () => {
  app = await startApp();
  // O registro consulta o Have I Been Pwned. Os testes não falam com a rede:
  // a resposta vazia significa "senha não vazada".
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
});

describe('registro', () => {
  it('cria conta com convite válido e consome o convite', async () => {
    const admin = await createUser({ username: 'admin', roleName: 'Admin' });
    const code = await createInvite({ createdBy: admin.id });

    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { code, username: 'ana', displayName: 'Ana', password: SENHA_BOA },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().user.username).toBe('ana');
    // Registro não faz login automático: não pode vir cookie nem token.
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.json().access).toBeUndefined();

    const [invite] = await sql<{ used_by: string | null }[]>`
      select used_by from invites where code = ${code}
    `;
    expect(invite?.used_by).not.toBeNull();
  });

  it('recusa o mesmo convite na segunda vez', async () => {
    const admin = await createUser({ username: 'admin', roleName: 'Admin' });
    const code = await createInvite({ createdBy: admin.id });

    const primeira = await client.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { code, username: 'ana', displayName: 'Ana', password: SENHA_BOA },
    });
    expect(primeira.statusCode).toBe(201);

    const segunda = await client.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { code, username: 'bruno', displayName: 'Bruno', password: SENHA_BOA },
    });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().code).toBe('INVITE_USED');
  });

  it('recusa convite inexistente e convite expirado', async () => {
    const admin = await createUser({ username: 'admin', roleName: 'Admin' });

    const inexistente = await client.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { code: 'naoexisteaqui', username: 'ana', displayName: 'Ana', password: SENHA_BOA },
    });
    expect(inexistente.json().code).toBe('INVITE_INVALID');

    const expirado = await createInvite({ createdBy: admin.id, expiresInHours: -1 });
    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { code: expirado, username: 'ana', displayName: 'Ana', password: SENHA_BOA },
    });
    expect(res.json().code).toBe('INVITE_EXPIRED');
  });

  it('recusa senha vazada sem deixar a senha sair daqui', async () => {
    const admin = await createUser({ username: 'admin', roleName: 'Admin' });
    const code = await createInvite({ createdBy: admin.id });

    // SHA-1 de 'senha-muito-vazada-1' termina neste sufixo; devolvemos ele
    // com contagem alta, como faria a API real.
    const { createHash } = await import('node:crypto');
    const senha = 'senha-muito-vazada-1';
    const sha1 = createHash('sha1').update(senha).digest('hex').toUpperCase();

    const spy = vi.fn(async (url: string) => {
      // A senha inteira nunca pode ir para a rede: só os 5 primeiros do hash.
      expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
      expect(url).not.toContain(senha);
      return new Response(`${sha1.slice(5)}:42\n`, { status: 200 });
    });
    vi.stubGlobal('fetch', spy);

    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { code, username: 'ana', displayName: 'Ana', password: senha },
    });

    expect(spy).toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PASSWORD_BREACHED');
  });

  it('deixa passar quando o Have I Been Pwned não responde', async () => {
    const admin = await createUser({ username: 'admin', roleName: 'Admin' });
    const code = await createInvite({ createdBy: admin.id });

    // Indisponibilidade de terceiro não bloqueia cadastro.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('rede fora');
      }),
    );

    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { code, username: 'ana', displayName: 'Ana', password: SENHA_BOA },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('login', () => {
  it('devolve access token e grava o cookie rt', async () => {
    await createUser({ username: 'ana' });

    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().access).toEqual(expect.any(String));

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // O Path restrito reduz a superfície de CSRF a uma rota só.
    expect(cookie).toContain('Path=/api/auth/refresh');
  });

  it('não distingue senha errada de usuário inexistente', async () => {
    await createUser({ username: 'ana' });

    const senhaErrada = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: 'senha-errada-demais' },
    });
    const naoExiste = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ninguem', password: 'senha-errada-demais' },
    });

    expect(senhaErrada.statusCode).toBe(401);
    expect(naoExiste.statusCode).toBe(401);
    expect(senhaErrada.json()).toEqual(naoExiste.json());
    expect(senhaErrada.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('recusa conta desativada', async () => {
    await createUser({ username: 'ana' });
    await sql`update users set disabled_at = now() where username = 'ana'`;

    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });
    expect(res.json().code).toBe('ACCOUNT_DISABLED');
  });

  it('bloqueia com 429 na sexta tentativa errada', async () => {
    await createUser({ username: 'ana' });

    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await client.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'ana', password: 'errada-de-proposito' },
      });
      codes.push(res.statusCode);
    }

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });

  it('o balde do rate limit é por usuário, não só por IP', async () => {
    // A chave da tabela de docs/04-seguranca.md é "usuário + hash de IP". Ela
    // depende de o corpo já estar lido quando o limite é avaliado, e o hook
    // padrão do plugin roda antes disso — o que faria a chave virar só o IP,
    // em silêncio. Este teste é o que percebe se isso voltar.
    await createUser({ username: 'ana' });
    await createUser({ username: 'bruno' });

    for (let i = 0; i < 5; i += 1) {
      await client.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'ana', password: 'errada-de-proposito' },
      });
    }

    const anaBloqueada = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: 'errada-de-proposito' },
    });
    expect(anaBloqueada.statusCode).toBe(429);

    // Mesmo cliente, outro usuário: balde próprio, ainda livre.
    const bruno = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'bruno', password: SENHA_BOA },
    });
    expect(bruno.statusCode).toBe(200);
  });
});

describe('rotação de refresh token', () => {
  async function login(): Promise<string> {
    await createUser({ username: 'ana' });
    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });
    return refreshCookieFrom(res.headers);
  }

  it('troca o token e devolve um access novo', async () => {
    const rt = await login();

    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { rt },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().access).toEqual(expect.any(String));

    const novo = refreshCookieFrom(res.headers);
    expect(novo).not.toBe(rt);
  });

  it('reapresentar um token já usado revoga a família inteira', async () => {
    const rt = await login();

    // Uso normal: gera o segundo token da família.
    const primeiro = await client.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { rt } });
    expect(primeiro.statusCode).toBe(200);
    const segundo = refreshCookieFrom(primeiro.headers);

    // O antigo reaparece: alguém tem uma cópia.
    const reuso = await client.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { rt } });
    expect(reuso.statusCode).toBe(401);
    expect(reuso.json().code).toBe('TOKEN_REUSE');

    // E o token que era legítimo cai junto — a família inteira foi revogada.
    const depois = await client.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { rt: segundo },
    });
    expect(depois.statusCode).toBe(401);
    expect(depois.json().code).toBe('TOKEN_REUSE');

    const vivos = await sql<{ count: string }[]>`
      select count(*)::text as count from refresh_tokens where revoked_at is null
    `;
    expect(vivos[0]?.count).toBe('0');
  });

  it('não derruba a sessão de outra família', async () => {
    await createUser({ username: 'ana' });

    const umaJanela = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });
    const outraJanela = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });

    const rtUma = refreshCookieFrom(umaJanela.headers);
    const rtOutra = refreshCookieFrom(outraJanela.headers);

    await client.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { rt: rtUma } });
    const reuso = await client.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { rt: rtUma },
    });
    expect(reuso.json().code).toBe('TOKEN_REUSE');

    // A outra janela é uma família diferente e continua de pé.
    const outra = await client.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { rt: rtOutra },
    });
    expect(outra.statusCode).toBe(200);
  });

  it('recusa token de conta desativada e revoga a família', async () => {
    const rt = await login();
    await sql`update users set disabled_at = now() where username = 'ana'`;

    const res = await client.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { rt } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('ACCOUNT_DISABLED');
  });

  it('logout revoga a família e o token não serve mais', async () => {
    const rt = await login();

    const out = await client.inject({ method: 'POST', url: '/api/auth/logout', cookies: { rt } });
    expect(out.statusCode).toBe(204);

    const depois = await client.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { rt } });
    expect(depois.statusCode).toBe(401);
  });
});

describe('sessão autenticada', () => {
  it('/me devolve permissões como string e sem hash de senha', async () => {
    await createUser({ username: 'ana' });
    const login = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });
    const access = login.json().access as string;

    const res = await client.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${access}` },
    });

    expect(res.statusCode).toBe(200);
    // Permissões do cargo Membro: bits 0–4, 8–10, 12 e 13. Os dois últimos são
    // MANAGE_NOTES e MANAGE_TASKS, que as migrations 017 e 019 acrescentaram —
    // numa equipe de cinco, quem participa da decisão é quem a registra na nota
    // e quem move o cartão.
    expect(res.json().permissions).toBe('14111');
    expect(res.payload).not.toContain('argon2');
    expect(res.payload).not.toContain('password');
  });

  it('recusa requisição sem token e com token adulterado', async () => {
    const semToken = await client.inject({ method: 'GET', url: '/api/me' });
    expect(semToken.statusCode).toBe(401);

    const adulterado = await client.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Bearer nao.e.um.jwt' },
    });
    expect(adulterado.statusCode).toBe(401);
  });

  it('token continua válido mas a conta desativada perde acesso na hora', async () => {
    await createUser({ username: 'ana' });
    const login = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });
    const access = login.json().access as string;

    await sql`update users set disabled_at = now() where username = 'ana'`;

    // As permissões são lidas do banco a cada requisição, não do JWT.
    const res = await client.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('ACCOUNT_DISABLED');
  });
});

describe('forma dos erros', () => {
  it('corpo malformado é erro do cliente, não "falha interna"', async () => {
    // Um JSON quebrado respondendo INTERNAL_ERROR manda quem depura procurar
    // bug no servidor. Isto apareceu de verdade ao chamar a API por HTTP.
    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{isto não é json',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_BODY');
    expect(res.json().error).not.toContain('interna');
  });

  it('tipo de conteúdo não suportado devolve 415 com código próprio', async () => {
    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'username=ana',
    });

    expect(res.statusCode).toBe(415);
    expect(res.json().code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('nenhum erro de cliente se disfarça de falha interna', async () => {
    const casos = [
      { headers: { 'content-type': 'application/json' }, payload: '{quebrado' },
      { headers: { 'content-type': 'application/xml' }, payload: '<a/>' },
      { headers: { 'content-type': 'text/plain' }, payload: 'ana' },
    ];

    for (const caso of casos) {
      const res = await client.inject({ method: 'POST', url: '/api/auth/login', ...caso });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(res.json().code).not.toBe('INTERNAL_ERROR');
    }
  });

  it('erro de validação aponta o campo', async () => {
    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'MAIÚSCULO INVÁLIDO', password: 'x' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_INPUT');
    expect(res.json().field).toBe('username');
  });
});

describe('prévia de convite', () => {
  it('mostra só quem convidou', async () => {
    const admin = await createUser({ username: 'admin', displayName: 'Ana', roleName: 'Admin' });
    const code = await createInvite({ createdBy: admin.id });

    const res = await client.inject({ method: 'GET', url: `/api/invites/${code}/preview` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, serverName: 'Trindade', invitedBy: 'Ana' });
  });

  it('devolve 200 com valid:false para código inválido, não 404', async () => {
    const res = await client.inject({ method: 'GET', url: '/api/invites/naoexisteaqui/preview' });
    // Um 404 confirmaria que o código não existe e facilitaria enumerar.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: false });
  });
});
