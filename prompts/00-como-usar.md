# Como usar os prompts

## O básico

Um prompt por fase. Copie o arquivo inteiro e cole na sessão do Claude Code.
Deixe rodar até o fim, revise, faça commit, só então passe para o próximo.

Não junte fases. Não pule. Cada prompt assume que o anterior terminou e passou
nos critérios de aceite; rodar a fase 5 sem a 4 gera código que compila e não
funciona.

## Antes de colar

Confira que o `CLAUDE.md` está na raiz do projeto e que `docs/` e `design/`
estão no lugar. O Claude Code lê o `CLAUDE.md` sozinho, mas os documentos de
apoio ele só abre quando o prompt manda.

## Durante

**Deixe terminar.** Interromper no meio de uma fase costuma deixar o projeto num
estado pior do que antes de começar.

**Revise por conta própria.** Rode `pnpm typecheck`, abra no navegador, teste os
casos de erro. Não confie no relatório final da sessão — confie no que você viu
funcionando.

**Se algo saiu errado, aponte o específico.** "O compositor não cresce quando
tem mais de uma linha" funciona. "Melhore a UI" não.

## Depois de cada fase

```
Marque a fase N como concluída no CLAUDE.md. Liste em até 5 linhas o que
ficou pendente ou foi simplificado, para eu decidir se resolvo agora.
```

Depois: `git add -A && git commit -m "fase N: ..."`.

## Quando travar

Se uma fase estiver longa demais e a sessão começar a esquecer o começo:

```
Pare. Escreva em PROGRESSO.md o que já foi feito nesta fase, o que falta,
e quais decisões você tomou que não estavam no prompt. Vou abrir uma sessão
nova a partir daí.
```

Sessão nova, cole o `PROGRESSO.md` e continue. É melhor que insistir num
contexto saturado.

## O que não pedir

Não peça para "implementar tudo de uma vez". Não peça para pular testes de erro.
Não peça para relaxar as regras do `CLAUDE.md` — elas existem porque cada uma
resolve um problema específico descrito em `docs/`.
