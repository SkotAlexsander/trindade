import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import postgres from 'postgres';
import dotenv from 'dotenv';

/**
 * Cria o banco de teste do zero e aplica as migrations antes da suíte.
 *
 * Recriar em vez de reaproveitar: uma migration nova entra sem ninguém
 * lembrar de rodar nada, e um teste nunca herda tabela em estado estranho de
 * uma execução anterior que quebrou no meio.
 */
export default async function setup(): Promise<void> {
  dotenv.config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      'postgres://trindade:trindade_dev@127.0.0.1:5432/trindade_test',
  );
  const dbName = url.pathname.slice(1);

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    // `force` derruba conexões penduradas de uma execução anterior.
    await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const result = spawnSync('node-pg-migrate', ['up'], {
    cwd: resolve(import.meta.dirname, '..'),
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, DATABASE_URL: url.toString() },
  });

  if (result.status !== 0) {
    throw new Error(`migrations falharam no banco de teste:\n${result.stderr?.toString() ?? ''}`);
  }
}
