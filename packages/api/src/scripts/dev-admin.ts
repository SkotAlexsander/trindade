import { sql } from '../db/index.js';
import { hashPassword } from '../lib/auth/password.js';
import { isProduction } from '../config.js';

/**
 * Conta de administrador para desenvolvimento.
 *
 * `pnpm dev:admin` cria (ou redefine) `admin` com uma senha fixa, para não ser
 * preciso passar pelo convite a cada banco recriado.
 *
 * **Escreve o hash direto no banco de propósito**, sem passar pela rota: a
 * senha pedida tem menos que os 12 caracteres do `passwordSchema`, e é essa a
 * diferença entre uma conveniência de desenvolvimento e um buraco no produto.
 * A regra continua valendo em toda porta de entrada real.
 *
 * Recusa rodar em produção. Isto não é zelo excessivo — é o script inteiro.
 */

const USUARIO = process.env.DEV_ADMIN_USER ?? 'admin';
const SENHA = process.env.DEV_ADMIN_PASSWORD ?? '010623';
const NOME = process.env.DEV_ADMIN_NAME ?? 'Admin';

async function main(): Promise<void> {
  if (isProduction) {
    console.error('dev:admin não roda com NODE_ENV=production. Use `pnpm bootstrap`.');
    process.exit(1);
  }

  const hash = await hashPassword(SENHA);

  const linhas = await sql<{ id: string }[]>`
    insert into users (username, display_name, password_hash)
    values (${USUARIO}, ${NOME}, ${hash})
    on conflict (username) do update
      set password_hash = ${hash}, display_name = ${NOME}, disabled_at = null
    returning id
  `;
  const id = linhas[0]?.id;
  if (!id) throw new Error('não consegui criar a conta');

  const cargos = await sql<{ id: string }[]>`select id from roles where name = 'Admin'`;
  const admin = cargos[0]?.id;
  if (admin) {
    await sql`
      insert into user_roles (user_id, role_id) values (${id}, ${admin})
      on conflict do nothing
    `;
  }

  // O 2FA fica de fora: exigir o código a cada recarregamento durante o
  // desenvolvimento é atrito sem contrapartida.
  await sql`update users set totp_secret = null, totp_enabled_at = null where id = ${id}`;

  console.log(`\n  usuário: ${USUARIO}\n  senha:   ${SENHA}\n`);
  console.log('  Só em desenvolvimento. Em produção, `pnpm bootstrap`.\n');
  await sql.end({ timeout: 5 });
}

void main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
