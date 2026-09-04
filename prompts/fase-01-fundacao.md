# Fase 1 — Fundação

Monte a base do projeto. Nada de funcionalidade ainda: o objetivo é que
`pnpm dev` suba tudo e um health check responda.

Leia antes: `CLAUDE.md`, `docs/02-arquitetura.md`, `docs/03-modelo-de-dados.md`.

## Entregar

**Monorepo pnpm** com `packages/api`, `packages/web`, `packages/shared`.
TypeScript em modo estrito nos três, com `noUncheckedIndexedAccess` ligado.
`shared` compila para `dist` e é importado pelos outros por workspace.

**docker-compose.yml** com Postgres 16 e MinIO. Volumes nomeados, healthcheck em
ambos, portas só em `127.0.0.1` — não exponha banco na rede.

**API Fastify** ouvindo em 3000, com:
- plugin de erro que converte erro tipado em `{ error, code }` com o status certo
- validação por Zod nas rotas, usando o type provider
- `GET /api/health` devolvendo `{ ok: true, db: true }` depois de tocar o banco
- log estruturado com Pino, **sem registrar IP** (ver `docs/04-seguranca.md`)
- CORS restrito à origem do front em dev
- desligamento gracioso: fecha o pool e o servidor no SIGTERM

**Migrations** com `node-pg-migrate`, arquivos 001 a 010 exatamente como estão em
`docs/03-modelo-de-dados.md`. Cada migration com `up` e `down`. Seeds:
- cargo `Membro` com `is_default = true` e permissões 0–4, 8–10
- cargo `Admin` com `ADMINISTRATOR` e `position = 100`
- canal `#geral`

**Camada de banco** em `src/db/`: pool com `postgres.js`, uma função por
operação. Nesta fase só o que o health check e o bootstrap precisam.

**Bootstrap do primeiro admin.** O cadastro exige convite e convite exige alguém
logado — com o banco vazio, ninguém entra. Crie `pnpm bootstrap`, um script de
linha de comando que:
- recusa rodar se já existir qualquer usuário (`USERS_EXIST`)
- pede usuário, nome de exibição e senha interativamente, sem eco na senha
- aplica as mesmas validações do registro (regex de usuário, 12+ caracteres)
- faz o hash com Argon2id nos parâmetros de `docs/04-seguranca.md`
- cria a pessoa e atribui o cargo `Admin`
- imprime um aviso para ativar 2FA no primeiro login

É a única forma de criar conta sem convite, e só funciona uma vez. Mesmo script
serve para o disaster recovery documentado na fase 8.

**Front Vite + React 18 + TypeScript** com React Router, TanStack Query e
Zustand configurados. Uma rota `/` que chama `/api/health` e mostra o resultado.
Proxy do Vite para `/api` e `/ws`.

**Tipos compartilhados** em `packages/shared/src/`: as interfaces `User`, `Role`,
`Message`, `Channel`, `Attachment` de `docs/05-contrato-api.md`, mais os schemas
Zod correspondentes. Uma constante `Perm` com o bitfield completo, usando
`BigInt`.

**Ferramental**: ESLint com `@typescript-eslint`, Prettier, e um script
`pnpm typecheck` que roda `tsc --noEmit` nos três pacotes.

**`.env.example`** com todas as chaves de `docs/04-seguranca.md`, valores vazios.
`.gitignore` cobrindo `.env`, `node_modules`, `dist`.

## Não fazer nesta fase

Autenticação, WebSocket, componentes visuais, CSS além do reset.

## Aceite

- `docker compose up -d` sobe Postgres e MinIO saudáveis
- `pnpm migrate up` aplica as 10 migrations sem erro
- `pnpm migrate down` desfaz todas sem erro
- `pnpm dev` sobe API e web juntos
- `curl localhost:3000/api/health` devolve `{"ok":true,"db":true}`
- a página em `localhost:5173` mostra o resultado do health check
- `pnpm typecheck` passa limpo
- `psql` mostra os dois cargos e o canal `#geral` criados
- `pnpm bootstrap` cria o primeiro admin e recusa rodar uma segunda vez
