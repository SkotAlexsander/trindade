# Trindade

Um espaço de trabalho privado para um grupo pequeno: canais de texto, voz com
vídeo e tela compartilhada, notas colaborativas, tarefas, enquetes, conversas
privadas e um quadro branco em tempo real.

Não é um clone de Discord. É a mesma ideia levada a um lugar diferente: cinco
pessoas conhecidas, um servidor que é seu, e um conjunto de decisões de
privacidade que um produto de milhões de usuários não teria como tomar — o IP de
quem lê nunca chega a quem manda o link, a mídia da chamada passa sempre por
relay, nenhuma imagem chega ao disco sem ser re-encodada, e o registro de acesso
não guarda endereço de ninguém.

**Estado: as dez fases estão prontas.** Falta o empacotamento de mesa e a
publicação — ver `prompts/fase-11-desktop-e-publicacao.md`.

---

## As duas formas de usar

**No navegador**, de qualquer computador: é o caminho normal, e não exige
instalar nada. O front é estático e o Caddy o serve.

**Instalado na máquina**, como o Discord: um binário de 8 a 15 MB via Tauri, com
notificação nativa, ícone na bandeja e atalho global de mudo. O código do
produto é o mesmo — muda onde ele roda e o que ele pode fazer a mais. Ainda não
está empacotado; o passo a passo está no prompt da fase 11.

---

## Rodar na sua máquina

Precisa de Node 20+, pnpm 9+ e Docker com o plugin `compose`.

```bash
pnpm install
cp .env.example .env          # e preencha; `pnpm keygen` gera as chaves
docker compose up -d          # Postgres, MinIO, LiveKit, coturn
pnpm migrate up
pnpm dev                      # API na 3000, front na 5173
```

Abra `http://localhost:5173` e crie a primeira conta — ela vira **Admin**
automaticamente.

Para desenvolver com um banco povoado (cinco pessoas fictícias, canais e
histórico), `pnpm dev:seed`. Ele **recusa rodar com `NODE_ENV=production`**: um
servidor publicado começa vazio, sempre.

---

## Pôr no ar

O procedimento completo está em `docs/08-operacao.md` — implantar, reverter,
restaurar backup, adicionar alguém, resetar o segundo fator, e o que fazer
quando as chamadas ficam ruins. O resumo:

1. Um VPS Linux com 4 GB, disco em LUKS, Docker e Tailscale.
2. DNS na Cloudflare com proxy ligado, e **firewall abrindo 443 só para as
   faixas dela** — sem isso, basta escanear a faixa do provedor.
3. `.env` a partir do `.env.example`, com segredos gerados de verdade.
4. `./scripts/implantar.sh` — ele faz backup, aplica migrations com a versão
   antiga ainda no ar, troca a imagem e reverte sozinho se a saúde não vier.
5. Abra o endereço, crie a primeira conta (vira Admin), e depois que o grupo
   entrar ponha `VAGAS=0` no `.env`: daí em diante só se entra por convite.

**A API não roda em Cloudflare Workers.** O `sharp` é binário nativo, o gateway
de WebSocket e os documentos Yjs vivem na memória de um processo longo, o
`postgres.js` fala TCP, e LiveKit e coturn precisam de uma faixa larga de UDP. O
que cabe na Cloudflare é DNS, TLS e proxy — que é exatamente o que o projeto já
espera.

---

## Estrutura

```
packages/
  api/       Fastify 5, WebSocket, Postgres, sharp, LiveKit — um processo só
  web/       React 18 + Vite, CSS Modules, TanStack Query, Zustand
  shared/    tipos e schemas que os dois lados compartilham
infra/       Caddyfile, cabeçalhos, LiveKit, coturn
scripts/     implantar, backup, restaurar, vigia, verificar segredos
e2e/         roteiros Playwright em Python — um por assunto
docs/        o que o sistema faz e por quê
design/      como ele se parece e se comporta
prompts/     o que foi colado no Claude Code, fase por fase
```

Verificação: `pnpm lint`, `pnpm typecheck`, `pnpm test` (245 testes na API, 219
no web) e os roteiros de `e2e/` — que rodam num navegador de verdade e são o
que decide se uma fatia está pronta. Ver `e2e/README.md`.

---

## Como este projeto foi construído

Ele não foi escrito à mão. `docs/` e `design/` são a especificação completa,
`prompts/` são os pedidos colados no Claude Code — um por fase, em ordem — e o
`CLAUDE.md` é o contrato permanente que toda sessão lê: stack, convenções,
regras inegociáveis e o registro do que foi decidido diferente do previsto, com
o porquê.

Se você for continuar de onde parou, leia `prompts/00-como-usar.md` primeiro e
`CLAUDE.md` inteiro depois. O `CLAUDE.md` é longo de propósito: cada seção
existe porque alguma coisa deu errado uma vez e ninguém deveria descobrir de
novo.

### Índice dos documentos

**Técnico**

- `docs/01-visao-e-escopo.md` — o que entra, o que fica de fora e por quê
- `docs/02-arquitetura.md` — desenho geral, processos, fluxo de dados
- `docs/03-modelo-de-dados.md` — schema SQL completo e comentado
- `docs/04-seguranca.md` — auth, upload, privacidade de IP, modelo de ameaça
- `docs/05-contrato-api.md` — todas as rotas HTTP e eventos WebSocket
- `docs/06-realtime-e-webrtc.md` — gateway, presença, LiveKit, coturn
- `docs/07-permissoes-do-navegador.md` — o que pedimos, quando, e o que nunca
- `docs/08-operacao.md` — implantação, backup, restauração, alertas

**Design**

- `design/00-direcao-visual.md` — o conceito, e o que foi rejeitado
- `design/01-tokens.md` — cor, tipografia, espaço, elevação, movimento
- `design/02-shell-principal.md` — a moldura, as colunas, as larguras
- `design/03-menu-e-navegacao.md` — rail, lista de canais, painel do elenco
- `design/04-mensagens.md` — a lista, o compositor, os estados, o vídeo
- `design/05-perfil-e-cargos.md` — cartão, editor, gestão de cargos
- `design/06-autenticacao.md` — convite, cadastro, login, 2FA
- `design/07-chamada.md` — barra de voz, grade de vídeo, tela compartilhada
- `design/08-projeto.md` — notas, tarefas, enquetes, fixadas
- `design/09-notificacoes.md` — o que avisa, quando, e como calar
- `design/10-conversas-privadas.md` — mensagem direta e grupos pequenos
- `design/11-quadro.md` — quadro colaborativo e modo apresentação
- `design/12-compartilhamento-de-tela.md` — presets, simulcast, assistir
- `design/13-dispositivos-e-audio.md` — microfone, alto-falante, câmera, medidor

### As fases

| # | Fase | Entrega |
|---|---|---|
| 1 | Fundação | monorepo, Docker, migrations, health check |
| 2 | Autenticação | convite, cadastro, login, rotação de token, 2FA |
| 3 | Design system | tokens, primitivos, tema |
| 4 | Shell | rail, sidebar, painel do elenco, roteamento |
| 5 | Mensagens | WebSocket, envio, histórico, agrupamento |
| 6 | Perfil e cargos | avatar, cargos, permissões |
| 7 | Voz e tela | LiveKit, coturn, relay forçado |
| 8 | Endurecimento | rate limit, logs, cabeçalhos, backup, alertas |
| 9 | Projeto e notificações | notas, tarefas, enquetes, avisos |
| 10 | Privadas e quadro | mensagem direta, grupos, quadro com apresentação |
| 11 | Desktop e publicação | Tauri e o servidor no ar — **a fazer** |
