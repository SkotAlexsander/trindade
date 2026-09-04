# Fase 5 — Mensagens em tempo real

O coração do produto. Gateway WebSocket, envio, histórico, agrupamento,
compositor, reações, threads e busca.

Leia antes: `docs/06-realtime-e-webrtc.md` (seção do gateway),
`docs/05-contrato-api.md` (mensagens e WebSocket), `design/04-mensagens.md`
inteiro.

Esta é a fase mais longa. Se a sessão saturar, use o procedimento de
`prompts/00-como-usar.md` para dividir.

## Entregar

### Gateway — `src/ws/`

Estado em memória: `connections` por `sessionId` e `byUser` por `userId`. Uma
pessoa pode ter várias conexões abertas.

Ciclo de vida conforme o documento. Dois pontos que precisam estar certos:

**Revalidação a cada 60s.** Se `disabled_at` não é nulo, feche com 4001. Se as
permissões mudaram, envie `PERMISSIONS_UPDATE`. Sem isso, remover alguém do grupo
não tem efeito até ela fechar o navegador.

**Offline só quando a última conexão cai.** Fechar uma aba não deve marcar a
pessoa como offline.

Heartbeat de 30s do cliente, servidor fecha aos 90s. Não confie no ping/pong do
protocolo — proxies interferem.

Rate limit em token bucket por usuário: 10 mensagens por 10s, estouro de 3.
Estourar manda `ERROR`, não fecha. Fecha com 4003 só se insistir.

Todos os eventos das duas tabelas de `docs/05-contrato-api.md`.

### Envio otimista

Cliente gera `clientNonce` (UUID), insere na lista com `status: 'sending'`, envia.
Servidor grava, faz broadcast devolvendo o nonce, cliente casa e substitui.

O índice único `(author_id, client_nonce)` é a barreira final contra duplicata
quando a rede oscila.

**A substituição não anima nada.** A mensagem já está no lugar certo.

### Histórico

`GET /channels/:id/messages` com `before`, `after`, `around`, `limit`. Paginação
por **id**, nunca por offset — mensagens novas mudam os índices e offset duplica
ou pula linhas.

Cache com `staleTime: Infinity`. Novidade entra por `setQueryData` a partir do
WebSocket. **Nada de polling.**

### Lista

Agrupamento conforme as cinco condições de `design/04-mensagens.md`. Espaçamento
de 2px dentro do bloco e 12px entre blocos — é o ritmo que faz a leitura
funcionar sem borda nenhuma.

Corpo em `--font-read` (serifa) a 15,5px com `--leading-read`, limitado a
`--measure`.

Divisor de dia com `position: sticky`.

**Rolagem** — a parte que a maioria erra:
- gruda no fim só se estiver a menos de 100px do fim
- se rolou para cima, **não mova nada**; mostre o botão "N mensagens novas"
- ao carregar histórico antigo, meça `scrollHeight` antes e depois e compense o
  `scrollTop`, senão a tela salta a cada página
- carregue mais faltando 600px para o topo
- virtualize só acima de 200 mensagens renderizadas

### Conteúdo

Markdown com a lista de suporte do documento — **sem título, tabela ou imagem por
URL**. Sanitize com DOMPurify depois de renderizar.

Código com Shiki, barra de linguagem, botão de copiar que vira "Copiado" por 1,5s
sem toast, colapso acima de 15 linhas.

Menção troca para `--font-ui` no meio da serifa. Mensagem que menciona você ganha
fundo e borda esquerda.

Prévia de link **buscada pelo servidor**, com validação contra ranges internos
(SSRF) e limite de tamanho. Se o cliente buscasse, abrir uma mensagem entregaria
o IP de todos os leitores a quem mandou o link.

### Compositor

`--bg-live`, `--r-field` de 2px. `textarea` que cresce de 40px a 240px ajustando
`style.height` por `scrollHeight` — **não use `contenteditable`**.

Teclas da tabela, incluindo `↑` no campo vazio para editar a última mensagem.

Autocompletar de `@`, `#` e `:` acima do campo. Com `@` sozinho já liste as cinco
pessoas, sem exigir letra.

Upload começa ao anexar, não ao enviar.

### Reações, ações, thread

Chips conforme o CSS do documento, sem animação de entrada.

Barra de ações no hover, sem atraso e **sem transição** — transição de opacidade
a cada movimento do mouse cintila numa lista longa.

Thread no painel direito, com contador no canal.

### Busca

`websearch_to_tsquery('portuguese', q)` ordenado por `ts_rank_cd`. Painel direito,
não tela cheia. Termo destacado em `--ember-wash`. Clique carrega com `?around=`
e pisca a mensagem por 800ms.

### Reconexão

Backoff exponencial com jitter, teto de 30s. Ao voltar, busca o que passou desde
o último id conhecido. Faixa de aviso só depois de 2s de queda, empurrando o
conteúdo, **não sobrepondo**. Compositor continua aceitando texto e enfileira.

## Aceite

- Mensagem aparece instantaneamente e confirma sem piscar
- Duas abas da mesma conta recebem tudo
- Rede oscilando não duplica mensagem
- Agrupamento respeita as cinco condições
- Rolar para cima e receber mensagem não move a tela
- Carregar histórico antigo não salta
- Editar, apagar, reagir e responder propagam em tempo real
- Busca encontra com acento e sem acento
- Derrubar a API e subir de novo reconecta sozinho e recupera o que passou
- Digitar offline enfileira e envia ao voltar
- Mudar o cargo de alguém reflete sem reconectar
- Desativar alguém derruba a conexão em até 60s
