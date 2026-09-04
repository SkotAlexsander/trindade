import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

/**
 * Casca fina sobre o CLI do node-pg-migrate. Existe só para carregar o .env da
 * raiz do monorepo antes de chamar a ferramenta.
 *
 *   pnpm migrate up
 *   pnpm migrate down          desfaz todas
 *   pnpm migrate down 3        desfaz três
 *   pnpm migrate create nome-da-migration
 *
 * Dois detalhes do CLI que não são óbvios:
 *
 * 1. A ação vem antes das opções, e a contagem é argumento **posicional** —
 *    não existe `--count`. Passar `--count` não dá erro: o yargs engole o
 *    valor e o padrão de 1 migration continua valendo, em silêncio.
 * 2. A pasta fica no padrão (`migrations`, relativo ao cwd) de propósito: o
 *    caminho absoluto do projeto pode ter espaço, e `shell: true` — necessário
 *    no Windows para resolver o `.cmd` — quebraria o argumento ao meio.
 */
const ACTIONS = ['up', 'down', 'create', 'redo'] as const;
type Action = (typeof ACTIONS)[number];

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [action, ...rest] = process.argv.slice(2);

if (!action || !ACTIONS.includes(action as Action)) {
  console.error('uso: pnpm migrate <up|down|create|redo> [args]');
  process.exit(1);
}

function countMigrationFiles(): number {
  return readdirSync(resolve(packageRoot, 'migrations')).filter((f) => /^\d+_.*\.cjs$/.test(f))
    .length;
}

// `down` sem contagem desfaz uma só. Aqui o padrão é desfazer tudo, que é o
// que o aceite da fase 1 pede e o que se espera de `pnpm migrate down`.
const givesCount = rest.length > 0 && /^\d+$/.test(rest[0] ?? '');
const args =
  action === 'down' && !givesCount ? [action, String(countMigrationFiles()), ...rest] : [action, ...rest];

// Sob `shell: true` os argumentos vão para a linha de comando crua.
const quote = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

const result = spawnSync('node-pg-migrate', args.map(quote), {
  cwd: packageRoot,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
});

process.exit(result.status ?? 1);
