import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  startApp,
  resetDatabase,
  createUser,
  sql,
  SENHA_BOA,
  createClient,
  type TestApp,
  type TestClient,
} from './helpers.js';
import {
  generateCode,
  verifyCode,
  generateSecret,
  encryptSecret,
  decryptSecret,
  TOTP_STEP_SECONDS,
} from '../src/lib/auth/totp.js';

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
});

describe('TOTP', () => {
  const AGORA = 1_760_000_000_000;

  it('aceita o código do período atual', () => {
    const secret = generateSecret();
    expect(verifyCode(secret, generateCode(secret, AGORA), AGORA)).toBe(true);
  });

  it('aceita um período para cada lado, tolerando relógio dessincronizado', () => {
    const secret = generateSecret();
    const passo = TOTP_STEP_SECONDS * 1000;

    expect(verifyCode(secret, generateCode(secret, AGORA - passo), AGORA)).toBe(true);
    expect(verifyCode(secret, generateCode(secret, AGORA + passo), AGORA)).toBe(true);
  });

  it('recusa código de fora da janela', () => {
    const secret = generateSecret();
    const passo = TOTP_STEP_SECONDS * 1000;

    expect(verifyCode(secret, generateCode(secret, AGORA - 2 * passo), AGORA)).toBe(false);
    expect(verifyCode(secret, generateCode(secret, AGORA + 2 * passo), AGORA)).toBe(false);
  });

  it('recusa código errado e lixo', () => {
    const secret = generateSecret();
    expect(verifyCode(secret, '000000', AGORA)).toBe(false);
    expect(verifyCode(secret, 'abcdef', AGORA)).toBe(false);
    expect(verifyCode(secret, '12345', AGORA)).toBe(false);
  });

  it('cifra o segredo antes de gravar e volta igual', () => {
    const secret = generateSecret();
    const guardado = encryptSecret(secret);

    // Se o banco vazar, o segundo fator ainda vale alguma coisa.
    expect(guardado).not.toContain(secret);
    expect(decryptSecret(guardado)).toBe(secret);
    // Cada cifragem usa IV novo: dois segredos iguais não viram texto igual.
    expect(encryptSecret(secret)).not.toBe(guardado);
  });

  it('recusa segredo adulterado — o GCM detecta', () => {
    const guardado = encryptSecret(generateSecret());
    const [iv, tag, dados] = guardado.split('.');
    const mexido = [iv, tag, `${(dados ?? '').slice(0, -2)}AA`].join('.');
    expect(() => decryptSecret(mexido)).toThrow();
  });
});

describe('ciclo de 2FA pela API', () => {
  async function loginComoAna(): Promise<string> {
    await createUser({ username: 'ana' });
    const res = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });
    return res.json().access as string;
  }

  async function ativar2fa(access: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    const setup = await client.inject({
      method: 'POST',
      url: '/api/me/totp/setup',
      headers: { authorization: `Bearer ${access}` },
    });
    const secret = setup.json().secret as string;

    const enable = await client.inject({
      method: 'POST',
      url: '/api/me/totp/enable',
      headers: { authorization: `Bearer ${access}` },
      payload: { code: generateCode(secret) },
    });
    return { secret, recoveryCodes: enable.json().recoveryCodes as string[] };
  }

  it('setup entrega QR mas não ativa sozinho', async () => {
    const access = await loginComoAna();

    const setup = await client.inject({
      method: 'POST',
      url: '/api/me/totp/setup',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(setup.statusCode).toBe(200);
    expect(setup.json().qrSvg).toContain('<svg');
    expect(setup.json().otpauthUrl).toContain('otpauth://totp/');

    // Um setup abandonado não pode deixar a conta exigindo código.
    const [row] = await sql<{ totp_enabled_at: Date | null }[]>`
      select totp_enabled_at from users where username = 'ana'
    `;
    expect(row?.totp_enabled_at).toBeNull();

    const login = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });
    expect(login.json().mfaRequired).toBeUndefined();
  });

  it('enable com código errado não ativa', async () => {
    const access = await loginComoAna();
    await client.inject({
      method: 'POST',
      url: '/api/me/totp/setup',
      headers: { authorization: `Bearer ${access}` },
    });

    const res = await client.inject({
      method: 'POST',
      url: '/api/me/totp/enable',
      headers: { authorization: `Bearer ${access}` },
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_CODE');
  });

  it('com 2FA ativo, o login pede o código antes de dar sessão', async () => {
    const access = await loginComoAna();
    const { secret, recoveryCodes } = await ativar2fa(access);
    expect(recoveryCodes).toHaveLength(10);

    const login = await client.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: SENHA_BOA },
    });
    expect(login.json().mfaRequired).toBe(true);
    expect(login.json().access).toBeUndefined();
    // Nenhuma sessão antes do segundo fator.
    expect(login.headers['set-cookie']).toBeUndefined();

    const mfaToken = login.json().mfaToken as string;

    const errado = await client.inject({
      method: 'POST',
      url: '/api/auth/totp',
      payload: { mfaToken, code: '000000' },
    });
    expect(errado.statusCode).toBe(401);

    const certo = await client.inject({
      method: 'POST',
      url: '/api/auth/totp',
      payload: { mfaToken, code: generateCode(secret) },
    });
    expect(certo.statusCode).toBe(200);
    expect(certo.json().access).toEqual(expect.any(String));
    expect(String(certo.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('código de recuperação funciona uma vez e só uma', async () => {
    const access = await loginComoAna();
    const { recoveryCodes } = await ativar2fa(access);
    const codigo = recoveryCodes[0];
    expect(codigo).toBeDefined();

    async function entrarComRecuperacao() {
      const login = await client.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'ana', password: SENHA_BOA },
      });
      return client.inject({
        method: 'POST',
        url: '/api/auth/totp',
        payload: { mfaToken: login.json().mfaToken, recoveryCode: codigo },
      });
    }

    const primeira = await entrarComRecuperacao();
    expect(primeira.statusCode).toBe(200);

    const segunda = await entrarComRecuperacao();
    expect(segunda.statusCode).toBe(401);
    expect(segunda.json().code).toBe('INVALID_RECOVERY_CODE');

    const [restantes] = await sql<{ count: string }[]>`
      select count(*)::text as count from recovery_codes where used_at is null
    `;
    expect(restantes?.count).toBe('9');
  });

  it('os códigos de recuperação são guardados com hash, nunca em claro', async () => {
    const access = await loginComoAna();
    const { recoveryCodes } = await ativar2fa(access);

    const linhas = await sql<{ code_hash: string }[]>`select code_hash from recovery_codes`;
    for (const linha of linhas) {
      expect(linha.code_hash).toMatch(/^\$argon2id\$/);
      for (const codigo of recoveryCodes) expect(linha.code_hash).not.toContain(codigo);
    }
  });

  it('desligar o 2FA exige senha e código, e apaga os de recuperação', async () => {
    const access = await loginComoAna();
    const { secret } = await ativar2fa(access);

    const semSenha = await client.inject({
      method: 'POST',
      url: '/api/me/totp/disable',
      headers: { authorization: `Bearer ${access}` },
      payload: { password: 'senha-errada-demais', code: generateCode(secret) },
    });
    expect(semSenha.statusCode).toBe(401);

    const ok = await client.inject({
      method: 'POST',
      url: '/api/me/totp/disable',
      headers: { authorization: `Bearer ${access}` },
      payload: { password: SENHA_BOA, code: generateCode(secret) },
    });
    expect(ok.statusCode).toBe(204);

    const [restantes] = await sql<{ count: string }[]>`
      select count(*)::text as count from recovery_codes
    `;
    expect(restantes?.count).toBe('0');
  });
});
