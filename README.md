# Pacote de construção — Trindade

Especificação completa e prompts sequenciais para construir o aplicativo com
Claude Code dentro do VS Code.

---

## Como usar

**1. Crie a pasta do projeto e jogue este pacote dentro.**

```bash
mkdir cinco && cd cinco
# copie CLAUDE.md, docs/ , design/ e prompts/ para cá
git init && git add -A && git commit -m "specs"
```

O commit inicial importa: você vai querer comparar o que o Claude escreveu contra
um ponto limpo.

**2. Abra no VS Code e rode `claude` no terminal integrado.**

O `CLAUDE.md` na raiz é lido automaticamente em toda sessão. É o contrato
permanente — stack, convenções e regras inegociáveis.

**3. Execute uma fase por vez.**

Abra `prompts/fase-01-fundacao.md`, copie o conteúdo inteiro e cole na sessão.
Deixe rodar até o fim. Revise o resultado. Faça commit. Só então passe para a
fase seguinte.

**Não pule fases e não rode duas de uma vez.** Cada prompt assume que o anterior
terminou e passou nos critérios de aceite. Rodar a fase 5 sem a 4 produz código
que compila e não funciona.

**4. Ao fim de cada fase, atualize o checklist no `CLAUDE.md`.**

Peça: *"marque a fase N como concluída no CLAUDE.md e resuma em 5 linhas o que
ficou pendente"*. Isso mantém o contexto entre sessões.

---

## Ordem das fases

| # | Fase | Entrega | Tempo estimado |
|---|---|---|---|
| 1 | Fundação | monorepo, Docker, migrations, health check | 1 sessão |
| 2 | Autenticação | convite, registro, login, rotação de token, 2FA | 2 sessões |
| 3 | Design system | tokens, primitivos, tema | 1 sessão |
| 4 | Shell | rail, sidebar, painel do elenco, roteamento | 2 sessões |
| 5 | Mensagens | WebSocket, envio, histórico, agrupamento | 2–3 sessões |
| 6 | Perfil e cargos | avatar, cargos, permissões na UI | 2 sessões |
| 7 | Voz e tela | LiveKit, coturn, relay forçado | 3 sessões |
| 8 | Endurecimento | rate limit, logs, headers, testes | 2 sessões |
| 9 | Projeto e notificações | notas, tarefas, enquetes, avisos | 3 sessões |
| 10 | Privadas e quadro | mensagem direta, grupos, quadro com apresentação | 3 sessões |

"Sessão" é uma conversa longa com o Claude Code, não um comando único. Espere
iterar dentro de cada fase.

---

## Índice dos documentos

**Técnico** — o que o sistema faz e como.

- `docs/01-visao-e-escopo.md` — o que entra, o que fica de fora e por quê
- `docs/02-arquitetura.md` — desenho geral, processos, fluxo de dados
- `docs/03-modelo-de-dados.md` — schema SQL completo e comentado
- `docs/04-seguranca.md` — auth, upload, privacidade de IP, modelo de ameaça
- `docs/05-contrato-api.md` — todas as rotas HTTP e eventos WebSocket
- `docs/06-realtime-e-webrtc.md` — gateway, presença, LiveKit, coturn
- `docs/07-permissoes-do-navegador.md` — o que pedimos, quando, e o que nunca pedimos
- `docs/08-operacao.md` — implantação, backup e restauração (criado na fase 8)

**Design** — como o sistema se parece e se comporta.

- `design/00-direcao-visual.md` — o conceito, e o que foi rejeitado
- `design/01-tokens.md` — cor, tipografia, espaço, elevação, movimento
- `design/02-shell-principal.md` — a moldura, as quatro colunas, responsivo
- `design/03-menu-e-navegacao.md` — rail, lista de canais, painel do elenco
- `design/04-mensagens.md` — a lista, o compositor, os estados
- `design/05-perfil-e-cargos.md` — cartão, editor, gestão de cargos
- `design/06-autenticacao.md` — convite, registro, login, 2FA
- `design/07-chamada.md` — barra de voz, grade de vídeo, tela compartilhada
- `design/08-projeto.md` — notas, tarefas, enquetes, fixadas
- `design/09-notificacoes.md` — o que avisa, quando, e como calar
- `design/10-conversas-privadas.md` — mensagem direta e grupos pequenos
- `design/11-quadro.md` — quadro colaborativo e modo apresentação
- `design/12-compartilhamento-de-tela.md` — presets, simulcast, assistir opcional

**Prompts** — o que colar no Claude Code.

- `prompts/00-como-usar.md` — leia antes de começar
- `prompts/fase-01` a `fase-10`

---

## Antes de começar

Três decisões que mudam o código gerado. Responda no `CLAUDE.md` antes da fase 2:

**E-mail no cadastro?** Sem e-mail o sistema é mais privado e mais simples, mas
não existe "esqueci minha senha" — recuperação vira reset manual por um admin.
Com 5 pessoas, isso normalmente é aceitável. O pacote assume **sem e-mail**.

**Onde hospedar?** VPS único (Hetzner CX22, ~€4/mês) cobre tudo exceto o relay
de mídia sob carga. Se as chamadas com tela forem frequentes, separe o coturn e
o LiveKit num segundo servidor com franquia de tráfego generosa.

**Vai virar app desktop?** Se sim, evite APIs de navegador que o Tauri trata
diferente — notificação, bandeja, atalho global. A fase 8 cobre o empacotamento.
