import { sql } from '../db/index.js';
import { hashPassword } from '../lib/auth/password.js';
import { isProduction } from '../config.js';

/**
 * O elenco e os canais de desenvolvimento.
 *
 * `pnpm dev:seed` recria as cinco pessoas e os canais, para que recriar o banco
 * não custe meia hora de cliques. Idempotente: rodar de novo só atualiza.
 *
 * Existe por um motivo concreto: `pnpm migrate down` desfaz **todas** as
 * migrations, e quem roda isso para conferir se a última é reversível leva
 * junto o banco inteiro. Com este script, o custo do engano é um comando.
 *
 * Recusa rodar em produção.
 */

const SENHA = process.env.DEV_SEED_PASSWORD ?? 'cavalo-bateria-grampo-9';

const ELENCO = [
  { username: 'alex', displayName: 'Alex Souza', admin: true },
  { username: 'bruno', displayName: 'Bruno Lima', admin: false },
  { username: 'carla', displayName: 'Carla Nunes', admin: false },
  { username: 'daniel', displayName: 'Daniel Prado', admin: false },
  { username: 'eva', displayName: 'Eva Marques', admin: false },
] as const;

const CANAIS = [
  { slug: 'geral', name: 'geral', kind: 'text', categoria: 'conversa', posicao: 0, topico: null },
  {
    slug: 'produto',
    name: 'produto',
    kind: 'text',
    categoria: 'conversa',
    posicao: 1,
    topico: 'o que estamos construindo e por quê',
  },
  { slug: 'bugs', name: 'bugs', kind: 'text', categoria: 'conversa', posicao: 2, topico: null },
  { slug: 'sala', name: 'sala', kind: 'voice', categoria: 'voz', posicao: 3, topico: null },
] as const;

async function main(): Promise<void> {
  if (isProduction) {
    console.error('dev:seed não roda com NODE_ENV=production.');
    process.exit(1);
  }

  const cargos = await sql<{ id: string; name: string; is_default: boolean }[]>`
    select id, name, is_default from roles
  `;
  const admin = cargos.find((c) => c.name === 'Admin')?.id;
  const membro = cargos.find((c) => c.is_default)?.id;

  // Um azul-marinho de propósito: é escuro demais para o tema escuro, e o
  // ajuste de contraste tem de clareá-lo até o nome do cargo ficar legível.
  // Sem uma cor difícil no banco de desenvolvimento, esse caminho nunca é
  // exercitado por ninguém olhando a tela.
  if (admin) await sql`update roles set color = '#0b1d5c' where id = ${admin}`;

  const hash = await hashPassword(SENHA);

  for (const pessoa of ELENCO) {
    const linhas = await sql<{ id: string }[]>`
      insert into users (username, display_name, password_hash)
      values (${pessoa.username}, ${pessoa.displayName}, ${hash})
      on conflict (username) do update
        set display_name = ${pessoa.displayName}, password_hash = ${hash}, disabled_at = null
      returning id
    `;
    const id = linhas[0]?.id;
    if (!id) continue;

    for (const cargo of [membro, pessoa.admin ? admin : null]) {
      if (!cargo) continue;
      await sql`
        insert into user_roles (user_id, role_id) values (${id}, ${cargo})
        on conflict do nothing
      `;
    }
  }

  for (const canal of CANAIS) {
    await sql`
      insert into channels (slug, name, kind, position, category, topic)
      values (${canal.slug}, ${canal.name}, ${canal.kind}, ${canal.posicao},
              ${canal.categoria}, ${canal.topico})
      on conflict (slug) do update
        set name = ${canal.name}, kind = ${canal.kind}, position = ${canal.posicao},
            category = ${canal.categoria}, topic = ${canal.topico}, archived_at = null
    `;
  }

  console.log(`\n  ${ELENCO.length} pessoas e ${CANAIS.length} canais prontos.`);
  console.log(`  senha de todas: ${SENHA}\n`);
  console.log('  Para o histórico de teste:');
  console.log('    docker compose exec -T postgres psql -U trindade -d trindade \\');
  console.log('      < e2e/semear-historico.sql\n');
  await sql.end({ timeout: 5 });
}

void main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
