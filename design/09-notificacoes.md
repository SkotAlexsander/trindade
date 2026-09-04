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
te envolve" (thread). Distintos o bastante para reconhecer sem olhar.

Nunca toca se a janela está em foco e o canal da mensagem está aberto — você já
está vendo.

Volume respeita a configuração do sistema. Sem controle próprio de volume.

### Desktop

`Notification` API no navegador, nativa no Tauri. Pede permissão **na primeira
menção recebida**, não no primeiro acesso — pedir antes de haver motivo gera
recusa.

Conteúdo: nome de quem mandou, canal, e o texto truncado em 120 caracteres.
Clique abre o canal na mensagem.

Se o produto está em foco, não mostra. Se a pessoa está em chamada com tela
compartilhada, não mostra — a notificação apareceria na tela de todo mundo.

### Badge

Contador no título da aba: `(3) Cinco`. No Tauri, no ícone do dock ou da
barra. Conta só menções e respostas, não mensagens de canal.

Zera ao focar a janela e abrir o canal, não ao focar apenas.

### Ponto na lista

O canal não lido na barra lateral. Já especificado em `03-menu-e-navegacao.md`.
É o nível mais baixo de aviso: existe algo, veja quando quiser.

---

## Silenciar

Por canal, pelo menu contextual: 1 hora, 8 horas, até eu ligar.

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

Uma tela. Curta.

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

## Sem notificação

- E-mail: não existe no sistema
- Push no celular: fora da v1. O web app no celular usa `Notification` como no
  desktop; push de verdade exige Service Worker com VAPID, e é a fase 10 se um
  dia fizer sentido
- Resumo diário: não. É o tipo de coisa que parece útil e ninguém lê
