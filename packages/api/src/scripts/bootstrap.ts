import { usernameSchema, displayNameSchema, passwordSchema } from '@trindade/shared';
import { anyUserExists, createUserWithRole } from '../db/users.js';
import { closePool } from '../db/index.js';
import { hashPassword } from '../lib/auth/password.js';
import { createPrompter } from '../lib/prompt.js';

/**
 * Cria o primeiro admin. O cadastro exige convite e convite exige alguém
 * logado — com o banco vazio, ninguém entra. Esta é a única forma de criar
 * conta sem convite, e só funciona uma vez.
 *
 * O mesmo script serve para o disaster recovery da fase 8.
 */
const prompter = createPrompter();

async function main(): Promise<number> {
  if (await anyUserExists()) {
    console.error('USERS_EXIST — já existe alguém no banco. O bootstrap roda uma vez só.');
    return 1;
  }

  const usernameRaw = (await prompter.ask('usuário (3-24, a-z 0-9 _): ')).trim().toLowerCase();
  const username = usernameSchema.safeParse(usernameRaw);
  if (!username.success) {
    console.error(username.error.issues[0]?.message ?? 'usuário inválido');
    return 1;
  }

  const displayNameRaw = (await prompter.ask('nome de exibição: ')).trim();
  const displayName = displayNameSchema.safeParse(displayNameRaw);
  if (!displayName.success) {
    console.error('nome de exibição: 1 a 32 caracteres');
    return 1;
  }

  const passwordRaw = await prompter.askHidden('senha (mínimo 12): ');
  const password = passwordSchema.safeParse(passwordRaw);
  if (!password.success) {
    console.error(password.error.issues[0]?.message ?? 'senha inválida');
    return 1;
  }

  const confirm = await prompter.askHidden('repita a senha: ');
  if (confirm !== password.data) {
    console.error('as senhas não conferem');
    return 1;
  }

  const passwordHash = await hashPassword(password.data);
  const user = await createUserWithRole({
    username: username.data,
    displayName: displayName.data,
    passwordHash,
    roleName: 'Admin',
  });

  console.log(`\nAdmin criado: ${user.username} (${user.id})`);
  console.log('Ative o 2FA no primeiro login. Sem e-mail no sistema, os códigos');
  console.log('de recuperação são a única saída se você perder o telefone.');
  return 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  prompter.close();
  await closePool();
}
process.exit(exitCode);
