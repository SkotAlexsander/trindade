# Sem servidor alugado

> 5 de setembro de 2026. Pedido do dono do projeto: "quero que o programa rode
> nas nossas máquinas localmente enquanto estiverem ligadas... e quando
> desligarmos tudo para, só volta quando ligarmos".
>
> E, antes disso: "o objetivo principal é poder compartilhar nossos rosto, tela
> e conversar. Não precisa salvar o que fazemos — apenas ter a opção de salvar
> localmente na máquina, se precisar. Não precisa de banco de dados."

Este documento estrutura essa ideia. Ele não descreve o que existe hoje.

---

## O que muda de premissa

O Trindade foi desenhado para um servidor Linux ligado 24 horas: Postgres com
backup, LiveKit e coturn relaying a mídia, tudo atrás da Cloudflare. Isso custa
de R$ 30 a R$ 200 por mês, para sempre.

A conta vem de duas coisas, e só duas:

1. **Uma máquina que não pode dormir**, porque o gateway e os documentos Yjs
   vivem na memória de um processo longo.
2. **Banda de mídia no Brasil**, porque com `iceTransportPolicy: 'relay'` toda a
   voz e todo o vídeo dos cinco passam pelo servidor — 7 a 9 GB por hora.

O pedido derruba a primeira: se pode parar quando todo mundo desliga, não
precisa de máquina alugada. E existe uma peça que derruba a segunda.

---

## A peça que muda tudo: a mídia não precisa passar por nós

**Cloudflare Realtime** é um SFU e um serviço de TURN operados pela Cloudflare,
com **1.000 GB por mês grátis** cobrindo os dois. Pela nossa própria estimativa
de 7 a 9 GB/h, isso é **110 a 140 horas de chamada em grupo por mês**.

O cliente fala WebRTC direto com o edge da Cloudflare — que tem presença em São
Paulo. Três consequências, e todas importam:

- **A banda cara sai da conta.** Nenhum byte de vídeo passa pela nossa máquina.
- **A latência melhora**, e o requisito "servidor em São Paulo" desaparece: a
  distância que conta agora é até o edge, não até nós.
- **O link de casa deixa de ser problema.** Uma máquina doméstica jamais
  aguentaria retransmitir vídeo de cinco pessoas — precisaria de uns 20 Mbps de
  subida sustentados. Com o Realtime, ela não retransmite nada.

Essa última é a que torna "hospedar em casa" possível. Sem ela, a ideia não
fecha.

A privacidade que o projeto protege continua de pé: nenhum membro vê o IP do
outro, porque a mídia passa por relay como sempre passou. O que muda é quem
opera o relay. E há caminho para fechar até isso — a Cloudflare mantém o
[Orange Meets](https://github.com/cloudflare/orange) aberto, com criptografia
ponta a ponta por MLS, em que o SFU encaminha sem conseguir ler.

---

## Duas formas de não ter servidor alugado

Elas resolvem o mesmo problema por caminhos opostos, e a escolha entre as duas
não é técnica.

### A — Sem dono: a sala mora num Durable Object

Ninguém hospeda. Enquanto houver gente na sala, o estado dela vive num Durable
Object da Cloudflare — presença, chat, e os documentos Yjs do quadro e das
notas. Quando o último sai, o objeto hiberna: **não roda nada e não custa
nada**.

- **Sempre no ar.** Ninguém precisa ligar máquina nenhuma para o grupo
  conversar.
- **Custo zero de verdade**, nos limites do plano grátis: 100 mil requisições
  por dia.
- "Quando desligarmos, tudo para" continua verdade — sala vazia é objeto
  hibernado.
- **O que se perde:** o estado mora na infraestrutura da Cloudflare enquanto a
  sala existe. Não é seu disco.

### B — Com dono: a máquina de alguém é o servidor

O aplicativo de mesa ganha um modo **hospedar**. Quem abre primeiro sobe a
aplicação na própria máquina, e um túnel da Cloudflare — **gratuito e sem limite
de banda desde julho de 2026** — publica aquilo num endereço fixo. Os outros
abrem o mesmo endereço e caem no computador de quem está hospedando.

Quando o dono fecha, acabou. Volta quando alguém abrir de novo.

- **O que fica é seu.** Histórico, notas, quadro: no disco de quem hospedou.
- **É o Trindade inteiro**, não uma versão reduzida.
- **O que se perde:** o espaço só existe quando alguém está ligado. Se ninguém
  abriu, ninguém conversa.

### A pergunta que decide

Não é sobre custo — as duas são grátis. É esta:

> **O espaço precisa existir quando você não está?**

Se sim, A. Se não, B.

---

## Como B funciona, em detalhe

Porque é o caminho pedido, e é o que tem partes difíceis.

### Quem hospeda

**Quem abrir primeiro.** O aplicativo tenta o endereço conhecido; se ninguém
responder em poucos segundos, ele se oferece para hospedar.

Um túnel só pode apontar para uma máquina por vez — duas instâncias com a mesma
credencial recebem tráfego em paralelo, e aí seriam dois servidores diferentes
respondendo alternadamente, o que é pior que não funcionar. Então: **um túnel
por pessoa que pode hospedar**, cada um com seu subdomínio, e o aplicativo tenta
os conhecidos em ordem até achar um de pé.

É mais simples do que parece: são cinco nomes num arquivo de configuração.

### O que acontece quando o dono desliga

Acaba a sessão para todos, e é isso que foi pedido. O que estava em memória se
perde; o que estava no disco dele continua lá para a próxima vez que **ele**
hospedar.

**Consequência que precisa estar escrita:** o histórico fica fragmentado por
quem hospedou. Se o Alex hospedou terça e o Rogério hospedou quinta, são dois
históricos. Isso é aceitável quando "não precisa salvar o que fazemos" — e é
inaceitável se um dia alguém quiser buscar uma decisão antiga.

### A chamada não morre com o host

Se o dono da máquina sai da chamada, ela continua: a mídia está no Realtime, não
nele. O que morre com ele é a sala — o chat, o quadro, a presença.

Vale considerar mover a sala também para o Durable Object, mesmo no caminho B.
Aí o host serve só o que é durável, e a conversa sobrevive à queda dele. É o
híbrido de verdade.

### O que o host precisa ter instalado

Hoje: Docker, Postgres, MinIO. É muito para pedir de um computador pessoal.

O alvo é o aplicativo de mesa carregar tudo: a API como *sidecar* do Tauri, o
`cloudflared` como segundo sidecar, e **SQLite no lugar do Postgres**. Aí
hospedar é abrir o programa.

Isso é trabalho de verdade, e o esquema atual usa coisas que o SQLite não tem —
`jsonb`, busca com `tsvector`, `interval`, índices parciais,
`pg_advisory_xact_lock`.

---

## A ordem de fazer

A primeira fatia é a mesma nos dois caminhos, e é a que destrava tudo:

**1. Trocar LiveKit e coturn pelo Cloudflare Realtime.**
Tira a mídia de qualquer máquina nossa, elimina a banda cara, dispensa São
Paulo, e é o que permite hospedar em casa. Depois dela, o Trindade já roda com
um túnel a partir do seu PC — sem alugar nada, e com a chamada boa.

**2. O modo hospedar no aplicativo de mesa.**
Um botão, o túnel embutido, e o endereço fixo.

**3. Tirar o Postgres do caminho do host.**
SQLite ou Durable Object, conforme a escolha entre A e B.

Depois da 1, já dá para usar. As outras duas são conforto.
