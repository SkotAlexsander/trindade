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
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('uso: pnpm migrate <up|down|create|redo> [args]');
  process.exit(1);
}

// `down` sem contagem desfaz uma só. As 10 de uma vez pedem `--count Infinity`.
const command = args[0];
const passthrough =
  command === 'down' && !args.some((a) => a === '-c' || a === '--count')
    ? [...args, '--count', 'Infinity']
    : args;

const result = spawnSync(
  'node-pg-migrate',
  ['--migrations-dir', resolve(packageRoot, 'migrations'), ...passthrough],
  {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
  },
);

process.exit(result.status ?? 1);
