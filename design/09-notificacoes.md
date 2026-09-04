# Notificações

O que avisa, quando, e como calar.

Com cinco pessoas o problema não é falta de aviso, é excesso. Cada regra aqui
existe para que uma notificação, quando chegar, signifique alguma coisa.

---

## O que gera notificação

| Evento | Som | Desktop | Badge |
|---|---|---|---|
| menção a você | sim | sim | sim |
| `@aqui` | sim | sim | sim |
| resposta à sua mensagem | sim | sim | sim |
| mensagem em thread que você participa | não | sim | sim |
| mensagem em canal | não | não | ponto na lista |
| tarefa atribuída a você | sim | sim | sim |
| prazo de tarefa sua vence hoje | não | sim, às 9h | — |
| enquete nova | não | não | ponto na lista |
| alguém entrou na chamada | não | não | avatar no canal |

A última linha é decisão firme: **entrada em chamada nunca notifica**. Numa
equipe de cinco isso dispararia o dia inteiro e ensinaria todo mundo a
ignorar tudo.

---

## Canais de aviso

### Som

Dois sons no produto inteiro, ambos curtos e graves. Um para "alguém falou com
você" (menção, resposta, tarefa) e um mais discreto para "aconteceu algo que
te envolve" (thread). Distintos o bastante para reconhecer sem olhar — o de
chamado sobe duas notas, o de thread é uma só e mais grave.

**Sintetizados, não gravados**, pelo mesmo `lib/bipe.ts` que os sons da chamada
usam: são três notas ao todo, e um arquivo de áudio para cada uma seria mais
bytes e mais uma coisa a versionar. Foi o que fez `public/sounds/` não existir.

Nunca toca se a janela está em foco e o canal da mensagem está aberto — você já
está vendo.

Volume: o mesmo controle mestre dos sons da chamada, sem um segundo controle
próprio. Dois volumes para a mesma saída é a configuração que ninguém entende.

### Desktop

`Notification` API no navegador, nativa no Tauri. Pede permissão **na primeira
menção recebida**, não no primeiro acesso — pedir antes de haver motivo gera
recusa.

Conteúdo: nome de quem mandou, canal, e o texto truncado em 120 caracteres.
Clique abre o canal na mensagem.

Se o produto está em foco, não mostra. Se a pessoa está em chamada com tela
compartilhada, não mostra — a notificação apareceria na tela de todo mundo.

### Badge

Contador no título da aba: `(3) Trindade`. No Tauri, no ícone do dock ou da
barra. Conta só o que chama você — menção, `@aqui`, resposta à sua mensagem,
thread que você acompanha, tarefa atribuída — e nunca mensagem de canal.

O número é o mesmo `mention_count` do estado de leitura, não um contador
paralelo: dois números para a mesma coisa terminam no dia em que o título diz 3
e a lista diz 1. O servidor conta as menções no `READY` e isso é o piso; daí em
diante quem soma é o cliente, contando **exatamente o que a regra marcou como
badge**. Na reconexão, o servidor volta a ser a verdade.

Zera ao focar a janela e abrir o canal, não ao focar apenas.

### Ponto na lista

O canal não lido na barra lateral. Já especificado em `03-menu-e-navegacao.md`.
É o nível mais baixo de aviso: existe algo, veja quando quiser.

---

## Silenciar

Por canal, pelo sino no cabeçalho: 1 hora, 8 horas, até eu ligar. Três opções e
nenhum campo de duração — quem silencia quer parar de ser interrompido agora,
não configurar uma política.

"Até eu ligar" é gravado como um prazo de dez anos, e não como "sem prazo":
`muted_until` nulo já significa "não silenciado", e usar o mesmo valor para as
duas coisas apagaria a diferença entre calado para sempre e nunca calado.

O silêncio é **de conta, não de máquina**: mora em `read_state` e vale em todo
lugar onde você entrar. Ler um canal silenciado não o dessilencia — parece
óbvio, e foi um defeito de verdade: o evento de leitura mandava `mutedUntil:
null` e desligava o silêncio na outra aba.

Silenciado remove som, desktop e badge. **Menção direta ainda passa.** Silenciar
um canal significa "não me interrompa com o fluxo", não "me esconda quando
alguém fala comigo pelo nome".

Canal silenciado aparece na lista em `--text-tertiary` com um ícone de sino
cortado de 12px à direita. Continua marcando não lido, mas em peso 400 em vez
de 600 — você vê que houve movimento sem que ele grite.

### Não perturbe

Status "Ocupado" desliga som e desktop globalmente, mantém badge e pontos.
É a única ligação entre o estado de presença e as notificações, e é deliberada:
quem está ocupado deve poder saber depois o que perdeu.

Agendamento de não perturbe (ex.: 22h às 8h) nas configurações. Um horário,
todos os dias. Sem calendário semanal — para cinco pessoas é excesso.

---

## Configurações

Uma tela. Curta. Vive como aba do diálogo de perfil, e não como página em
`/config`: ali moram lista longa e hierarquia, e ajustar dois interruptores não
merece tirar a pessoa da conversa. Abre pela engrenagem ao lado do microfone e
do fone — que era um botão sem ação desde a fase 4 — e pelo menu do seu nome.

```
   Notificações

   Som
   [ ● ] Tocar som em menções e respostas
   [ ● ] Tocar som em threads que participo

   Área de trabalho
   [ ● ] Mostrar notificação na área de trabalho
         Permitido pelo navegador ✓

   Não perturbe
   [ ○ ] Todos os dias, das  [ 22:00 ]  às  [ 08:00 ]

   Canais silenciados
   # bugs · até você ligar         [ Reativar ]
```

Sem "notificar em todas as mensagens" como opção. Isso existe no Discord porque
servidores grandes têm canais que valem seguir de perto; aqui todo canal é
importante o suficiente para o ponto, e nenhum é importante o suficiente para
interromper.

---

## Regras que evitam ruído

**Agrupamento.** Cinco mensagens seguidas da mesma pessoa no mesmo canal em um
minuto geram uma notificação, não cinco. A segunda em diante atualiza a
primeira.

**Cooldown por canal.** Depois de uma notificação de canal, o mesmo canal não
gera outra por 5 minutos, exceto menção direta.

**Ausência longa.** Voltando depois de mais de 8 horas, sem badge acumulado
nem enxurrada de desktop — apenas a barra de "Novas" no lugar certo de cada
canal. O que passou está lá para ler; não precisa ser anunciado de novo.

**Você mesmo.** Nada que você fez gera notificação para você. Parece óbvio e
é o bug mais comum: responder na própria thread e receber aviso disso.

---

## Onde isso mora

A tabela inteira é uma **função pura** em `features/notifications/regras.ts`:
entra o que aconteceu e o contexto (foco, canal aberto, ocupado, silêncio,
último aviso do canal), sai `{ som, desktop, badge, agrupa }`. Sem `window`,
sem `Audio`, sem `Notification` — o teste roda as dezenove regras sem navegador
nenhum, e o navegador só executa o que ela decidiu.

Nada é decidido no servidor além de `mention_count` em `read_state`. O contador
do título sai da soma desse campo, e não de um contador próprio do cliente:
dois números para a mesma coisa acabam no dia em que o título diz 3 e a lista
diz 1.

O lembrete de prazo é a exceção que confirma: o servidor acorda às 9h e manda
`TASK_REMINDER` para quem tem tarefa vencendo, com a lista inteira num evento
só. **A decisão de mostrar continua sendo do cliente** — o servidor só diz o
que venceu.

---

## Sem notificação

- E-mail: não existe no sistema
- Push no celular: fora da v1. O web app no celular usa `Notification` como no
  desktop; push de verdade exige Service Worker com VAPID, e é a fase 10 se um
  dia fizer sentido
- Resumo diário: não. É o tipo de coisa que parece útil e ninguém lê
