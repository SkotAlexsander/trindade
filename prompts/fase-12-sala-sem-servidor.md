# Fase 12 — A sala, sem servidor alugado

## O objetivo

**Cinco pessoas compartilhando rosto, tela e voz. De graça, para sempre, sem
nenhuma máquina alugada e sem banco de dados.**

Quem quiser guardar a conversa baixa um arquivo no próprio computador. Nada mais
é salvo em lugar nenhum.

Este é o objetivo principal do produto dito pelo dono do projeto, em 5 de
setembro de 2026, depois de receber a conta do que a arquitetura atual custaria:

> "O objetivo principal é poder compartilhar nossos rosto, tela e conversar. Não
> precisa necessariamente salvar o que fazemos — apenas ter a opção de salvar
> localmente na máquina a conversa, se precisar. Mas não precisa de banco de
> dados."

E, sobre disponibilidade, ele escolheu que a sala exista mesmo com todo mundo
desligado — em vez de depender da máquina de alguém estar ligada.

---

## Por que isto existe

O Trindade que já está pronto foi desenhado para um servidor Linux ligado 24
horas. Ele funciona, está testado e é bom. Mas custa **de R$ 30 a R$ 200 por
mês, para sempre** — e a conta vem de duas coisas, só duas:

1. **Uma máquina que não pode dormir.** O gateway de WebSocket e os documentos
   Yjs vivem na memória de um processo longo. Função que hiberna perde os dois.
2. **Banda de mídia no Brasil.** Com `iceTransportPolicy: 'relay'`, toda a voz e
   todo o vídeo dos cinco passam pelo servidor: 7 a 9 GB por hora, num país onde
   banda custa 5 a 10× o que custa nos Estados Unidos. É isso que obriga a
   máquina a estar em São Paulo, e é isso que elimina os VPS baratos de fora.

**As duas são removíveis, e cada uma tem uma peça exata que a remove:**

**Durable Objects removem a primeira.** Ao contrário de um Worker, um Durable
Object segura conexões WebSocket **através da hibernação** — a sala continua
existindo, ninguém cai, e não há cobrança de duração enquanto ele dorme. É o
primitivo que a Cloudflare construiu para exatamente este caso. No plano grátis:
100 mil requisições por dia.

**Cloudflare Realtime remove a segunda.** É um SFU e um TURN operados pela
Cloudflare, com **1.000 GB por mês grátis** cobrindo os dois. O cliente fala
WebRTC direto com o edge — que tem presença em São Paulo. Pela nossa própria
estimativa de 7 a 9 GB/h, o teto grátis dá **110 a 140 horas de chamada em grupo
por mês**.

Nenhum byte de vídeo passa por máquina nossa. A latência melhora em vez de
piorar. E o requisito "servidor em São Paulo" desaparece, porque não há
servidor.

A privacidade que o produto protege continua de pé: nenhum membro vê o IP do
outro, porque a mídia passa por relay como sempre passou. O que muda é quem
opera o relay. A própria Cloudflare mantém o [Orange Meets](https://github.com/cloudflare/orange)
aberto — um app de chamada sobre esta mesma arquitetura, com criptografia ponta
a ponta por MLS, em que o SFU encaminha sem conseguir ler. É o caminho para
fechar até essa brecha, se um dia importar.

Leia `design/15-sem-servidor-alugado.md` antes de tocar em qualquer coisa. Ele
tem o raciocínio inteiro e as duas alternativas que foram consideradas.

---

## O que **não** fazer

**Não mexa em `packages/api` nem em `packages/web`.** O Trindade completo
continua existindo e continua valendo — canais, histórico, tarefas, enquetes,
cargos, 2FA, anexos, quadro. Ele volta a ser útil no dia em que houver um
servidor.

Isto é um pacote novo, `packages/sala`, que vive ao lado. Nada é descartado.

**Não invente banco de dados.** Se você se pegar querendo persistir alguma
coisa, pare e releia o objetivo. A sala é efêmera de propósito: é o que a torna
gratuita e é o que foi pedido.

**Não copie o Orange Meets.** Leia para entender a API e conferir decisões; o
código é deles.

---

## O que já está feito

`packages/sala/src/sala.ts` — o Durable Object da sala, com presença, chat que
passa sem ficar, e a API de hibernação.

Duas decisões dentro dele que você precisa entender antes de mexer:

**O estado mora nos próprios WebSockets**, via `serializeAttachment`. Guardar a
lista de participantes num `Map` de instância pareceria mais simples e seria
errado: o objeto hiberna entre uma mensagem e outra, e o `Map` voltaria vazio com
as pessoas ainda conectadas.

**`ctx.acceptWebSocket()`, e nunca `ws.accept()`.** O segundo mantém o objeto
acordado — e cobrado — enquanto alguém estiver na sala, mesmo em silêncio. É a
diferença entre custo zero e uma conta no fim do mês.

---

## O que entregar

### Fatia 1 — O Worker e a sala vazia

`packages/sala/src/index.ts`: serve o front estático, e encaminha
`/sala/:nome/ws` para o Durable Object correspondente.

Duas pessoas abrem o mesmo endereço, digitam um nome, e **veem uma à outra na
lista**. Sem mídia ainda.

Testável inteiro com `wrangler dev`, que roda Worker e Durable Object na sua
máquina — não precisa de conta na Cloudflare para esta fatia.

### Fatia 2 — Rosto e voz

O segredo do app do Realtime fica no Worker, **nunca no cliente**: o navegador
pede ao nosso Worker, que fala com o SFU. `wrangler secret put REALTIME_APP_SECRET`.

O fluxo do SFU é HTTPS puro sobre WebRTC:

1. `POST /apps/{appId}/sessions/new` — cria a sessão
2. `POST /apps/{appId}/sessions/{id}/tracks/new` — publica ou assina trilhas
3. `PUT  /apps/{appId}/sessions/{id}/renegotiate` — quando o SDP muda

Cada pessoa publica câmera e microfone uma vez, avisa a sala pelo Durable Object
quais trilhas publicou, e assina as dos outros. O Durable Object é o quadro de
avisos; ele não toca em mídia.

### Fatia 3 — Tela

`getDisplayMedia` vira mais uma trilha publicada, do tipo `tela`. A grade já
sabe destacar quem está compartilhando — reaproveite o desenho de
`design/07-chamada.md` e `design/12-compartilhamento-de-tela.md`.

### Fatia 4 — O chat e o salvar

O chat lateral que já passa pelo Durable Object, e um botão **Salvar conversa**
que baixa um arquivo com o que aconteceu na sessão. É a única forma de guardar
qualquer coisa, e é intencional.

O arquivo é do navegador de quem clicou: `Blob` e `<a download>`. Nada volta
para o servidor.

### Fatia 5 — A aparência

Reaproveite os tokens e os primitivos de `packages/web/src/styles` e
`packages/web/src/components`. A sala deve parecer o Trindade, não um exemplo de
documentação. `design/00-direcao-visual.md` e `design/01-tokens.md` continuam
valendo.

---

## O que vai te morder

**`ws.accept()` custa dinheiro.** Repetido aqui porque é o erro mais fácil de
cometer e o mais caro: ele desliga a hibernação, e a sala passa a ser cobrada
por duração enquanto alguém estiver conectado.

**O segredo do Realtime não pode chegar ao cliente.** Se o navegador falar
direto com `rtc.live.cloudflare.com`, o segredo do app está no bundle. Todo
pedido ao SFU passa pelo Worker.

**Renegociação de WebRTC é a parte chata.** Publicar e assinar trilhas muda o
SDP, e a ordem importa. Vá devagar: duas pessoas com só áudio primeiro, e só
então vídeo, e só então tela.

**Autoplay.** O navegador bloqueia áudio que começa sem gesto. O primeiro clique
de "entrar" é o gesto — use-o, e não descubra isso depois com o silêncio
inexplicável de uma pessoa só.

**A câmera precisa de permissão, e a permissão pode estar negada.** O produto já
tem `estadoDaPermissao()` em `packages/web/src/lib/midia.ts` justamente para não
deixar ninguém olhando um "conectando" que nunca sai. Reaproveite.

**100 mil requisições por dia** é o teto grátis do Durable Object. Cinco pessoas
não chegam perto — mas um `setInterval` mal colocado chega em uma tarde.

---

## Aceite

- Duas pessoas em abas diferentes se veem na lista de participantes
- Cada uma vê o rosto e ouve a voz da outra
- Uma compartilha a tela e a outra vê
- O chat aparece nos dois lados
- "Salvar conversa" baixa um arquivo com o que foi dito
- Sair da sala e voltar funciona, e a sala vazia não guarda nada
- Nada de segredo do Realtime no bundle do cliente: procure por ele no `dist`
- `wrangler dev` sobe tudo sem conta na Cloudflare, menos a mídia
- O custo permanece zero: nenhum recurso fora do plano grátis

---

## Como pedir isto ao Claude Code

```
Leia o CLAUDE.md, depois design/15-sem-servidor-alugado.md, e então
prompts/fase-12-sala-sem-servidor.md.

Faça a fatia 1. Verifique com duas abas de verdade antes de dizer que
terminou, e faça commit explicando o porquê, não o quê.
```

Uma fatia por vez. A fatia 2 é a mais difícil das cinco e não deve ser começada
na mesma sessão que a 1.
