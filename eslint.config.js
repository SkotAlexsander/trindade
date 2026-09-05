import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'packages/api/migrations/**',
      // Artefato do cargo: 1,5 GB, com JavaScript gerado pelo Tauri dentro. O
      // git já o ignora; o eslint precisa ouvir a mesma coisa em separado.
      'packages/desktop/src-tauri/target/**',
      // O bundle temporário do `wrangler dev`, pelo mesmo motivo.
      '**/.wrangler/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // A sala roda no runtime de Workers, que não é navegador nem Node: tem
  // `Request` e `Response` como o primeiro, e nada do segundo. O TypeScript já
  // sabe disso por `@cloudflare/workers-types`; o eslint precisa ouvir à parte.
  {
    files: ['packages/sala/src/**/*.ts'],
    languageOptions: {
      globals: {
        crypto: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        WebSocketPair: 'readonly',
        DurableObjectNamespace: 'readonly',
        DurableObjectState: 'readonly',
        Fetcher: 'readonly',
        ExportedHandler: 'readonly',
      },
    },
    rules: {
      // `catch {}` com comentário dentro é resposta deliberada a um erro que
      // não tem tratamento — e nesta base o comentário diz por quê.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Dois ambientes que o TypeScript não cobre: o script de operação, que roda em
  // Node solto, e o carimbo de tema, que roda no navegador antes de tudo.
  {
    files: ['packages/api/scripts/**/*.mjs', 'packages/web/scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  // O roteiro de carga roda dentro do k6, que tem globais próprias; o de tokens
  // roda em Node solto. Nenhum dos dois passa pelo bundler.
  {
    files: ['e2e/**/*.js', 'e2e/**/*.mjs'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['packages/web/public/**/*.js'],
    languageOptions: {
      globals: { document: 'readonly', window: 'readonly' },
    },
  },
  {
    rules: {
      // "Nada de any. Se o tipo é difícil, o desenho está errado." — CLAUDE.md
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
