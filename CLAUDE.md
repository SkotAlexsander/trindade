# Trindade

Espaço de trabalho privado para uma equipe fixa de 5 pessoas. Conversa em canais,
chamada de voz, compartilhamento de tela e notas de projeto. Auto-hospedado.

Nome definido: **Trindade**. Ele aparece em `packages/web/index.html`, no cabeçalho
da barra lateral, nas telas de autenticação e em `serverName` do contrato da API.

---

## Regras que valem para todo o projeto

**O elenco é fixo.** Cinco pessoas, cadastro fechado por convite. Nunca implemente
paginação, busca de membros, descoberta de servidores, onboarding público ou
qualquer coisa que assuma escala. Se uma decisão de arquitetura só se justifica
acima de mil usuários, ela está errada aqui.

**Servidor decide, cliente exibe.** Toda permissão é verificada no backend a cada
operação. Esconder um botão na UI não é controle de acesso. Se você escrever uma
checagem de permissão no front, escreva a mesma no back.

**Nada de segredo no cliente.** Access token vive em memória do JavaScript.
Refresh token vive em cookie `httpOnly`. `localStorage` nunca guarda credencial.

**IP dos membros não vaza entre membros.** WebRTC sempre com relay forçado
(`iceTransportPolicy: 'relay'`). Isso não é opcional nem otimizável.

**Metadado de imagem é dado pessoal.** Toda imagem enviada é re-encodada antes de
ser gravada. Nenhum byte original de upload chega ao disco.

---

## Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Front | React 18 + Vite + TypeScript | — |
| Estado servidor | TanStack Query | cache e revalidação |
| Estado local | Zustand | sem boilerplate de Redux |
| Estilo | CSS Modules + tokens em `:root` | sem framework de utilitário |
| Back | Node 20 + Fastify + TypeScript | plugins e validação de schema |
| Realtime | `ws` puro | Socket.IO é peso desnecessário aqui |
| Banco | PostgreSQL 16 | `citext`, `tsvector`, `jsonb` |
| Query | `postgres.js` | sem ORM |
| Migrations | `node-pg-migrate` | SQL explícito |
| Arquivos | S3-compatível (R2/MinIO) | |
| Mídia | LiveKit (SFU) + coturn | |
| Desktop | Tauri | fase final |

Sem ORM. Sem Tailwind. Sem framework de componente pronto. As queries e os
componentes são escritos à mão porque o projeto é pequeno o suficiente para isso
e porque a camada extra atrapalha mais do que ajuda nesta escala.

---

## Estrutura

```
packages/
  api/
    src/
      routes/          uma rota por arquivo, plugin Fastify
      services/        regra de negócio, sem saber que HTTP existe
      db/              queries SQL, uma função por operação
      ws/              gateway de WebSocket e eventos
      lib/             auth, permissões, storage, imagem
      plugins/         auth, rate limit, error handler
    migrations/
  web/
    src/
      routes/          páginas
      features/        agrupado por domínio, não por tipo de arquivo
      components/      genéricos, sem regra de negócio
      styles/          tokens.css e globals.css
      lib/             cliente http, cliente ws, hooks
  shared/
    src/               tipos e schemas Zod usados pelos dois lados
```

`shared` é a fonte da verdade dos tipos. Um evento de WebSocket ou um corpo de
requisição se define lá uma vez e se importa nos dois lados.

---

## Convenções

- Tudo em inglês no código; comentário e documentação em português.
- Nome de arquivo em `kebab-case`. Componente React em `PascalCase`.
- Toda rota valida entrada com Zod antes de tocar em qualquer coisa.
- Erro é objeto `{ error: string, code: string }`, nunca string solta.
- Nada de `any`. Se o tipo é difícil, o desenho está errado.
- Migration nunca é editada depois de aplicada; cria-se outra.

---

## O que ler antes de escrever código

- `docs/03-modelo-de-dados.md` antes de qualquer coisa que toque o banco
- `docs/04-seguranca.md` antes de auth, upload ou WebRTC
- `docs/05-contrato-api.md` antes de criar rota
- `design/01-tokens.md` antes de escrever CSS
- O arquivo de design da tela específica antes de montar a tela

---

## Comandos

```bash
pnpm dev              # api + web juntos
pnpm --filter api dev
pnpm --filter web dev
pnpm migrate up
pnpm migrate create nome-da-migration
pnpm test
pnpm typecheck
docker compose up -d  # postgres, minio, livekit, coturn
```

---

## Estado atual

Atualizar esta seção ao fim de cada fase.

- [ ] Fase 1 — fundação
- [ ] Fase 2 — autenticação
- [ ] Fase 3 — design system
- [ ] Fase 4 — shell da aplicação
- [ ] Fase 5 — mensagens em tempo real
- [ ] Fase 6 — perfil e cargos
- [ ] Fase 7 — voz e tela
- [ ] Fase 8 — endurecimento
- [ ] Fase 9 — ferramentas de projeto e notificações
- [ ] Fase 10 — conversas privadas e quadro

---

## Decisões

Tomadas no Passo 0. Não reabrir sem me perguntar.

- **Nome:** Trindade.
- **E-mail no cadastro:** não. Não existe "esqueci minha senha" — recuperação é
  reset manual por um admin, e `pnpm bootstrap` cobre o caso do banco vazio.
  Não crie campo de e-mail, SMTP nem fluxo de verificação.
- **Hospedagem:** a definir. Até decidir, assuma um VPS único com coturn e
  LiveKit no mesmo servidor, mas mantenha os endereços deles em variável de
  ambiente para que separar depois não exija mudar código.
- **Desktop:** sim, Tauri na fase 8. A partir de agora, evite APIs de navegador
  que o Tauri trata diferente — notificação, bandeja e atalho global passam por
  uma camada de abstração em `packages/web/src/lib/`, nunca chamadas diretas
  espalhadas pelos componentes.
