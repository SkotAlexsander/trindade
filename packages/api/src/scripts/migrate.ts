import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

/**
 * Casca fina sobre o CLI do node-pg-migrate. Existe só para carregar o .env da
 * raiz do monorepo antes de chamar a ferramenta.
 *
 *   pnpm migrate up
 *   pnpm migrate down
 *   pnpm migrate create nome-da-migration
 *
 * O CLI exige a ação como primeiro argumento; as opções vêm depois.
 */
const ACTIONS = ['up', 'down', 'create', 'redo'] as const;
type Action = (typeof ACTIONS)[number];

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [action, ...rest] = process.argv.slice(2);

if (!action || !ACTIONS.includes(action as Action)) {
  console.error('uso: pnpm migrate <up|down|create|redo> [args]');
  process.exit(1);
}

// `down` sem contagem desfaz uma só. As 10 de uma vez pedem `--count Infinity`.
const hasCount = rest.some((a) => a === '-c' || a === '--count');
const options = action === 'down' && !hasCount ? [...rest, '--count', 'Infinity'] : rest;

const result = spawnSync(
  'node-pg-migrate',
  [action, ...options, '--migrations-dir', resolve(packageRoot, 'migrations')],
  {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
  },
);

process.exit(result.status ?? 1);
