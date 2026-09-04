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

- [x] Fase 1 — fundação
- [x] Fase 2 — autenticação
- [x] Fase 3 — design system
- [x] Fase 4 — shell da aplicação
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
- **Hospedagem:** Cloudflare na frente, VPS único atrás.
  - HTTP e WebSocket passam pelo proxy da Cloudflare; o DNS aponta para eles e o
    firewall só aceita 443 vindo dos ranges deles (`docs/04-seguranca.md`).
  - Arquivos em **R2** na produção, **MinIO** no `docker compose` de
    desenvolvimento. Mesma interface S3 nos dois; a escolha é só de variável de
    ambiente. Nunca importe SDK específico da Cloudflare.
  - Upload continua passando pela API (multipart, 8 MB, re-encode obrigatório).
    Não invente URL assinada para o cliente subir direto ao R2 — isso pularia o
    re-encode e violaria a regra de metadado de imagem.
  - **Servidor único.** API, Postgres, coturn e LiveKit no mesmo VPS. Decidido,
    não é provisório: não proponha separar a mídia. **Mídia não passa pela
    Cloudflare** — é UDP, vai direto ao VPS, e o IP do TURN é visível por
    natureza. Isso é aceito. Ainda assim os endereços de coturn e LiveKit são
    variável de ambiente desde a fase 1, nunca literal no código.
- **Desktop:** sim, Tauri na fase 8. A partir de agora, evite APIs de navegador
  que o Tauri trata diferente — notificação, bandeja e atalho global passam por
  uma camada de abstração em `packages/web/src/lib/`, nunca chamadas diretas
  espalhadas pelos componentes.

### Fase 1 — concluída

Aceite percorrido inteiro com Postgres e MinIO no ar: `docker compose ps` com os
dois `healthy`, as 10 migrations aplicadas, desfeitas e refeitas, `db:true` no
health check pela API e pelo proxy do Vite, seeds conferidos no `psql`
(`Membro` 1823, `Admin` 4611686018427387904, `#geral`), `pnpm bootstrap` criando
o admin com Argon2id e recusando a segunda execução com `USERS_EXIST`.
`typecheck`, `lint` e `build` limpos nos três pacotes; log da API sem IP.

Decidido diferente do prompt: Node 24.18 em vez do 20 LTS (`engines: >=20`), por
já estar instalado e ter compilado tudo, inclusive o argon2 nativo. `Channel` e
`Attachment` foram derivados de `docs/03-modelo-de-dados.md` porque o contrato
da API os cita sem definir. Não verificado por mim: a renderização da página em
`localhost:5173` num navegador de verdade — só o build, o transform dos módulos
e a resposta da API por trás dela.

### Fase 2 — concluída

41 testes passando, incluindo reuso de refresh derrubando a família inteira,
TOTP fora da janela, e código de recuperação de uso único. Verificado também
por HTTP real: cookie com HttpOnly/SameSite=Strict/Path restrito, convite de
uso único, 5 erros de senha e 429 no sexto com Retry-After, backoff de
1s/2s/4s/8s, e nenhum `localStorage` no código nem no bundle.

Decidido diferente do prompt: `011_recovery_codes` — o modelo de dados não
previu onde guardar os códigos; as migrations das fases 9 e 10 andam um número
(`polls` vira 012, `conversations` 013, `boards` 014). `tokens.css` foi
adiantado da fase 3 porque as telas não podem ser montadas sem os tokens; falta
dela só os primitivos, a troca de tema e as fontes locais. O zxcvbn ficou em
chunk sob demanda: são 523 kB gzip que não podem descer na tela de entrar.

`ADMINISTRATOR` **não** isenta da hierarquia de cargos. Isentar deixaria a regra
inócua justamente para a conta que causa mais estrago se for tomada.

Não verificado por mim, por falta de navegador: renovação silenciosa do access
token, sessão sobrevivendo ao recarregar a página, e o comportamento das seis
caixas de código (colar, backspace, envio automático, balanço no erro).

### Fase 3 — concluída

Tokens, `globals.css` com as fontes locais, doze primitivos com CSS Module
próprio, `useTheme` em cookie, utilitário de contraste e a galeria em
`/dev/ui`. 18 verificações no navegador, todas passando: os dois temas, troca
sem piscada, foco preso no diálogo, setas no menu, tooltip no foco, toast
empilhando três, `prefers-reduced-motion`, fontes locais e nenhuma requisição
externa.

**Direção visual trocada.** O dono do projeto escolheu, a partir de uma
referência, a estética de interface de comando: quase preto, neon ciano e
magenta, cantos chanfrados, rótulos em caixa alta. `design/00-direcao-visual.md`
e `design/01-tokens.md` foram reescritos para casar com o código — o segundo
agora é gerado a partir do CSS. A regra semântica sobreviveu com outras cores:
ciano é comando, magenta é presença ao vivo e nada mais. Source Serif 4 saiu.

O piso de acessibilidade não cedeu à estética: as cores foram medidas e três
delas ajustadas até passarem em AA sobre as três superfícies, nos dois temas.
A tabela está em `design/01-tokens.md`.

Decidido diferente do prompt: o `Dialog` usa o `<dialog>` nativo em vez do
`FloatingFocusManager`, porque com ele o foco vazava no terceiro Tab. Os
ícones são desenhados à mão em `components/icones.tsx` — instalar a Lucide
inteira para usar nove seria peso morto.

### Fase 4 — concluída

Rail, lista de canais com os quatro estados, painel do elenco, cabeçalho,
painel contextual, menu de servidor, paleta de comandos, atalhos e as três
faixas responsivas. Backend: rotas de canal com `MANAGE_CHANNEL` no servidor e
`GET /users` sem paginação.

25 verificações no navegador e 54 testes de unidade. O elenco sobrevive no
celular como faixa no topo da gaveta.

Três defeitos que só apareceram rodando:
- `getReferenceProps()` do Floating UI **substituía** o `onClick` do gatilho.
  Todo botão com ação própria dentro de Tooltip, Popover ou Menu estava mudo —
  inclusive os de microfone e fone do elenco. Corrigido nos três.
- A alça de arrasto dividia a célula de 20px com o ícone do canal e o espremia
  a poucos pixels. Saiu para fora do fluxo.
- Na gaveta do celular, o elenco herdava uma linha de 48px para 120px de
  conteúdo e cobria o cabeçalho.

Pendente por depender da fase 5: estado de leitura (`unread` e menções vêm de
`withPlaceholderState`, não do banco), faixa de desconexão, presença em tempo
real e a sequência de acender disparada pelo `READY` — hoje ela roda quando as
pessoas carregam.

### Escopo acrescentado em 4 de setembro de 2026

O dono do projeto pediu, a partir de uma referência do Discord, o que o pacote
original não especificava: **escolher microfone, alto-falante e câmera**, medidor
e teste de entrada, perfil de captura, sensibilidade, apertar para falar, e a
câmera na chamada. O pacote citava `camera` no grant do LiveKit e nunca
desenhava a tela.

| Onde entrou | O quê |
|---|---|
| `design/13-dispositivos-e-audio.md` (novo) | listas de dispositivo, ganho, medidor, perfil de entrada, limiar, apertar para falar, sons |
| `design/07-chamada.md` | seção **Câmera** e o 📹 na barra de chamada |
| `design/02-shell-principal.md` | atalhos: de 9 para 27, em cinco grupos, com o que foi recusado e por quê |
| `prompts/fase-05` | foco itinerante na lista e os atalhos de mensagem |
| `prompts/fase-07` | `lib/midia.ts`, `lib/preferencias.ts`, câmera, e 8 critérios de aceite |
| `docs/07-permissoes-do-navegador.md` | por que a lista de dispositivos vem sem rótulo |

**A ordem das fases não mudou.** Quase tudo é da fase 7 e depende do LiveKit; o
que dá para fazer antes é o grupo de teclado, que é da fase 5 porque é a lista
de mensagens que precisa do foco itinerante.

Uma coisa nova de verdade: `lib/midia.ts` é a **única** porta para
`navigator.mediaDevices`. Nenhum componente chama `getUserMedia`,
`enumerateDevices` ou `setSinkId` direto — pela mesma razão que notificação e
atalho global passam por uma camada: o Tauri muda o comportamento embaixo.

### Tokens: nomes antigos corrigidos

A troca de direção visual da fase 3 reescreveu `00-direcao-visual.md` e
`01-tokens.md`, mas os outros documentos ficaram citando tokens que não existem
mais. Corrigido em 4 de setembro de 2026, com nota de revisão em cada arquivo:

| citado | virou | onde |
|---|---|---|
| `--ember` | `--live` | 07-chamada, 11-quadro, fase-07, fase-10 |
| `--ember-soft` | `--magenta-wash` | 07-chamada |
| `--ember-wash` | `--mark-wash` | 04-mensagens, fase-05 |
| `--cobalt-wash` | `--cyan-wash` | 04-mensagens |
| `--rust-wash` | `--crimson-wash` | 06-autenticacao, 07-chamada |
| `--slate-abyss` | `--abyss` / `--void` | 04-mensagens, 07-chamada |
| `--slate-mid` | `--mid` | 05-perfil-e-cargos |

`--mark-wash` e `--mark-line` são **tokens novos**, não renomeados: o destaque
de busca era âmbar, e traduzi-lo direto para magenta roubaria a cor reservada à
presença ao vivo. Medido: 11,8 · 11,1 · 9,6 no escuro, 12,7 · 12,0 · 13,9 no
claro.

`design/01-tokens.md` voltou a bater byte a byte com `tokens.css` nos dois
blocos — `--brand-ink` e `--rail-item` faltavam no documento.

Confira com:

```bash
diff <(sed -n '/^:root {/,/^}/p' packages/web/src/styles/tokens.css)      <(sed -n '/^:root {/,/^}/p' design/01-tokens.md)
```

### Numeração das migrations

O pacote previa 001 a 010 e reservava `011_polls` (fase 9), `012_conversations`
e `013_boards` (fase 10). Duas migrations não previstas entraram no caminho:

| aplicada | por quê |
|---|---|
| `011_recovery_codes` | o modelo de dados não previu onde guardar os códigos que `docs/04-seguranca.md` exige |
| `012_busca_sem_acento` | `to_tsvector('portuguese', …)` não remove acento, e o aceite pede que "migracao" ache "migração" |

**As migrations das fases 9 e 10 andam dois números:** `polls` vira **013**,
`conversations` **014** e `boards` **015**. Migration aplicada não se edita; se
algo estiver errado, crie a próxima.
