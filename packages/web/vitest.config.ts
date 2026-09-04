import { defineConfig } from 'vitest/config';

// Só as funções puras da interface: agrupamento, rótulo de dia, presença.
// Componente com DOM fica para o Playwright, que roda no navegador de verdade
// e pega o que jsdom não pega — rolagem, altura, foco.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // O backoff de reconexão é 1s, 2s, 4s: medir três esperas leva mais que os
    // 5s padrão, e encurtar a escala só para o teste caber testaria outra
    // coisa.
    testTimeout: 25_000,
  },
});
