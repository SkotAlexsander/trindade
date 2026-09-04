# Testes de navegador

Roteiros que percorrem os testes à mão do `COMECE-AQUI.md` num Chrome de
verdade, em vez de você repetir tudo com a mão a cada fase.

Não fazem parte do build nem do `pnpm test` — são uma ferramenta de conferência.
Estão em Python porque o Playwright já roda assim aqui e não exigem acrescentar
mais nada ao monorepo.

## Rodar

Uma vez:

```bash
python -m pip install playwright
```

Usa o Chrome já instalado (`channel='chrome'`), sem baixar navegador.

Com o `docker compose up -d` e o `pnpm dev` no ar:

```bash
python e2e/fase-02-autenticacao.py .capturas
python e2e/fase-02-dois-fatores.py .capturas
```

As capturas de tela vão para a pasta passada como argumento.

## O que cada um cobre

**`fase-02-autenticacao.py`** — 23 verificações: prévia de convite, convite
inválido e já usado, medidor de senha, registro sem login automático, erro de
credencial que não distingue usuário de senha, cookie `rt` com `HttpOnly` e
`Path` restrito, ausência de token em `localStorage`, sessão sobrevivendo ao
recarregar, renovação pelo cookie, reuso de token derrubando a sessão, `Tab`,
`Enter`, e nenhuma requisição a domínio externo.

**`fase-02-dois-fatores.py`** — 12 verificações: ativação do 2FA, as seis caixas
(foco inicial, avanço ao digitar, backspace voltando, setas, envio automático no
sexto dígito, balanço e limpeza no erro), código de recuperação de uso único, e o
anel de foco envolvendo o campo inteiro.

**`fase-03-design-system.py`** — 18 verificações dos primitivos e dos dois temas.

**`fase-04-shell.py`** — 25 verificações do shell: colunas, elenco, atalhos,
painel contextual e as três faixas responsivas.

**`fase-05-mensagens.py`** — 30 verificações da conversa, com duas janelas
abertas ao mesmo tempo: envio otimista, agrupamento, ritmo de 2px e 12px,
divisor de dia grudado sem sobrepor o do dia seguinte, as regras de rolagem
(colar no fim, não mover quem está lendo, compensar a prepend), editar pelo `↑`,
`Shift Enter`, indicador de digitação, faixa de desconexão, fila de quem
escreveu fora do ar e recuperação do que passou.

Antes de rodar, semeie o histórico — sem isso a paginação não tem o que paginar
e três verificações passam sem exercitar nada:

```bash
docker compose exec -T postgres psql -U trindade -d trindade < e2e/semear-historico.sql
```

O roteiro fala com `#geral` explicitamente, que é o canal semeado. O destino
automático depende do estado de leitura, que ainda é de espaço reservado.

### Derrubar a conexão de verdade

Duas maneiras óbvias não funcionam, e as duas custaram uma corrida inteira para
descobrir:

- **`context.set_offline(True)`** bloqueia HTTP e conexões novas, mas **não
  fecha o WebSocket já aberto**. A suíte inteira passa sem nunca ter caído.
- **`route_web_socket`** trava a API síncrona do Playwright: cada quadro do
  socket volta pelo driver, e se isso coincidir com um `evaluate` bloqueante o
  roteiro fica pendurado para sempre.

O que funciona é as duas coisas juntas: `set_offline(True)` para impedir a
reconexão, e `touch packages/api/src/app.ts` para o `tsx watch` reiniciar a API
e fechar o socket. Reiniciar sozinho às vezes volta rápido demais para a faixa
de 2s aparecer — e um teste que passa ou falha conforme a velocidade do watcher
não testa nada.

As regras de **tempo** da reconexão — backoff, jitter, teto, fila — não estão
aqui. Estão em `packages/web/test/ws.test.ts`, contra um servidor WebSocket de
verdade em Node, onde o relógio é nosso.

Cada roteiro cria um usuário novo a cada corrida. Isso não é capricho: a chave do
rate limit do login inclui o nome do usuário, e reaproveitar a mesma conta faz a
segunda execução travar em 429.

## Se a suíte travar em "Timeout ... waiting for navigation"

Quase sempre é o rate limit do login: cinco tentativas por 15 minutos por
usuário, e cada corrida gasta uma. Rodar a suíte várias vezes seguidas esgota.

Não é bug — é o controle funcionando. O contador vive na memória do processo da
API, então reiniciar zera:

```bash
touch packages/api/src/app.ts   # o tsx watch reinicia sozinho
```

Os roteiros da fase 4 em diante reaproveitam o cookie `rt` entre janelas em vez
de logar de novo, justamente para gastar o mínimo. Cada retomada rotaciona o
token, então o estado tem de ser encadeado: reapresentar o anterior é o que a
detecção de reuso derruba.
