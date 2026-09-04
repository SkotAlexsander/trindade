import { defineConfig } from 'vitest/config';

// Banco separado do de desenvolvimento: os testes truncam tabelas entre casos
// e não podem levar junto os dados com que você está mexendo à mão.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://trindade:trindade_dev@127.0.0.1:5432/trindade_test';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test' },
    // Argon2id a 64 MB é lento de propósito; o padrão de 5s não dá.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Um processo só: os casos compartilham o mesmo banco e truncam entre si.
    fileParallelism: false,
  },
});
