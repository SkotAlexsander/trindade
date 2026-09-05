# Notas, tarefas e enquetes

As ferramentas de projeto. Vivem no painel direito e são o que separa este
produto de um chat genérico.

Princípio que rege as três: **a conversa é a origem, a ferramenta é a
consequência.** Uma tarefa nasce de uma mensagem; uma nota consolida uma
discussão; uma enquete resolve um impasse que apareceu no canal. Nada aqui
existe isolado da conversa.

---

## Notas

Uma nota por canal. Não uma wiki, não uma árvore de páginas — um documento só,
o "estado atual" daquele assunto.

```
┌──────────────────────────────┐
│  Notas · # produto      ⋯ ✕  │
├──────────────────────────────┤
│  ◉ ◉  Ana e Bruno editando   │
├──────────────────────────────┤
│                              │
│  Decisões                    │
│  Migração sobe dia 12.       │
│  Rollback fica com a Carla.  │
│                              │
│  Pendências                  │
│  - definir janela de deploy  │
│  - avisar o cliente          │
│                              │
├──────────────────────────────┤
│  Editado por Ana há 4 min    │
└──────────────────────────────┘
```

### Edição simultânea

Yjs com o estado CRDT em `notes.ydoc` e o texto achatado em `notes.content`.
Transporte pelo mesmo WebSocket, em `NOTE_UPDATE` com o delta binário em base64.

Cursor dos outros visível como uma barra vertical de 2px na cor de destaque da
pessoa, com o primeiro nome numa etiqueta de 11px que aparece só quando o cursor
se move e some depois de 2s. Etiqueta permanente é poluição.

A faixa "Ana e Bruno editando" só aparece com alguém além de você. Sozinho, não
há nada a dizer.

### Editor

Corpo em `--font-read` a 15,5px, mesma medida das mensagens. É deliberado: nota
e mensagem são a mesma tipografia porque são o mesmo tipo de conteúdo, só que um
é fluxo e o outro é estado.

Markdown suportado igual ao das mensagens, **mais títulos** — aqui eles fazem
sentido. Renderização ao vivo, sem modo de prévia separado: o texto formata
enquanto você digita, e a sintaxe aparece só na linha onde o cursor está.

Sem barra de ferramentas. Atalhos de teclado e a sintaxe bastam para cinco
pessoas que sabem escrever Markdown.

### Da conversa para a nota

No menu de ações de uma mensagem: "Adicionar às notas". Anexa o conteúdo ao fim
da nota como citação, com o nome do autor e um link de volta para a mensagem.

É o gesto central: uma decisão tomada no chat vira registro em um clique, sem
copiar e colar.

### Histórico

Sem versões navegáveis na v1. O Yjs preserva o histórico internamente; uma
funcionalidade de "ver como estava em" é um dia de trabalho quando alguém
pedir. Não antes.

---

## Tarefas

Um quadro por canal, três colunas fixas: A fazer, Fazendo, Feito. Colunas
configuráveis são a primeira coisa que todo mundo pede e a última que alguém
usa; com cinco pessoas, três bastam.

```
┌──────────────────────────────┐
│  Tarefas · # produto    + ✕  │
├──────────────────────────────┤
│  A fazer                  2  │
│  ┌──────────────────────────┐│
│  │ Avisar o cliente         ││
│  │ ◉ Carla    até sex       ││
│  └──────────────────────────┘│
│  ┌──────────────────────────┐│
│  │ Definir janela de deploy ││
│  │ ○ sem dono               ││
│  └──────────────────────────┘│
│                              │
│  Fazendo                  1  │
│  ┌──────────────────────────┐│
│  │ Revisar a migração       ││
│  │ ◉ Bruno                  ││
│  └──────────────────────────┘│
│                              │
│  Feito                    4  │
│  ────── mostrar ──────       │
└──────────────────────────────┘
```

Colunas empilhadas na vertical, não lado a lado — o painel tem 320px e três
colunas horizontais nele viram cartões de 90px ilegíveis. Um botão "expandir"
abre o quadro em tela cheia sobre a conversa, aí sim com as colunas lado a lado.

### Cartão

Título, dono (avatar de 20px e primeiro nome), prazo se houver. Só isso. Tags,
prioridade, estimativa e o resto ficam de fora — cada campo a mais é uma
decisão que alguém precisa tomar ao criar, e a fricção mata o uso.

Prazo em linguagem relativa: "hoje", "amanhã", "até sex", "há 2 dias" em
`--danger` quando passou. O campo de data fica por baixo desse texto e aparece
sozinho no hover quando não há prazo — um "dd/mm/aaaa" vazio em cada cartão
pesaria mais que o título.

Cartão sem dono mostra um círculo vazio e "sem dono" em `--text-tertiary`. É
um convite visível para alguém assumir, e o mesmo lugar que mostra quem assumiu
é onde se assume: clicar abre a lista das cinco pessoas. Convite que não dá
para aceitar é decoração.

### Da mensagem para a tarefa

No menu de ações: "Criar tarefa". **Um clique, sem formulário** — a primeira
linha da mensagem vira o título e o cartão nasce em "A fazer". O popover com o
campo de dono focado estava previsto aqui e foi descartado ao rodar: dono e
prazo se definem no próprio cartão, que é onde a informação já está, e cada
campo a mais na criação é uma decisão a tomar. A fricção é o que mata o uso de
um quadro.

O resto do texto continua na mensagem, a um clique de distância pelo elo de
volta — o título é um recorte, não um resumo.

A tarefa guarda `source_message_id`. No cartão, um ícone de balão de 14px leva
de volta à mensagem de origem, e a mensagem ganha um rodapé de 24px:
"Virou tarefa · Fazendo", clicável — abre o quadro.

Esse elo bidirecional é a funcionalidade. Sem ele, o quadro é um Trello pior.

### Arrastar

Entre colunas e dentro delas. A posição é `double precision`: soltar entre duas
tarefas grava a média das vizinhas, uma linha atualizada, sem reindexar.

Feedback ao arrastar: o cartão original fica em `opacity: 0.4`, uma linha de
2px em `--accent` marca o destino. Sem rearranjo animado dos vizinhos.

Mover para "Feito" grava `completed_at` e manda uma mensagem curta no canal
como sistema: "Bruno concluiu **Revisar a migração**". Uma linha alinhada ao
gutter das mensagens, sem avatar, sem barra de ações, em `--text-tertiary`. É
como o grupo fica sabendo sem abrir o quadro — e, sendo mensagem, entra na
busca e no histórico como qualquer outra coisa que aconteceu ali.

A linha sai **só na transição** para concluída. Sem essa checagem, arrastar um
cartão dentro de "Feito" anunciaria a mesma conclusão de novo, e o canal viraria
eco do quadro. Ela também não entra em bloco com nenhuma mensagem vizinha: é o
canal falando, e herdar o avatar de alguém a faria parecer uma frase escrita
por essa pessoa.

A coluna e o estado de concluída são a mesma informação vista de dois lados —
tirar o cartão de "Feito" desfaz a conclusão. Sem isso, ele sairia de lá
continuando marcado como concluído, e a lista do que o grupo fez mentiria.

### Coluna Feito

Recolhida por padrão, mostrando só a contagem. Expandir lista as concluídas nos
últimos 14 dias; antes disso, "ver todas".

Tarefa concluída não é apagada nunca. É o registro do que o grupo fez.

---

## Enquetes

Nascem no compositor, com `/enquete`. Renderizam como mensagem, dentro do fluxo.

O que vier depois do comando já entra como pergunta: quem digita
`/enquete janela de deploy?` acabou de escrever a pergunta, e pedir que a
digite de novo seria cobrar duas vezes pelo mesmo gesto. O formulário é inline,
acima do compositor — um modal por cima da conversa esconderia justamente o que
se está perguntando.

```
  ◉ Ana Silva                              14:32
    Janela de deploy?

    ┌────────────────────────────────────────┐
    │ ● Terça, 9h        ▓▓▓▓▓▓▓▓▓▓▓░░  3   │
    │ ○ Quinta, 22h      ▓▓▓▓░░░░░░░░░  1   │
    │ ○ Sábado, 8h       ░░░░░░░░░░░░░  0   │
    └────────────────────────────────────────┘
    4 de 5 votaram · fecha em 2 dias
```

### Regras

- Duas a seis opções. Uma pergunta com sete alternativas é um problema de
  escopo, não de enquete.
- Voto único por padrão, múltiplo como opção ao criar.
- Aberta ou anônima, escolhido ao criar e imutável depois. Aberta mostra quem
  votou em cada opção no hover; anônima mostra só o número.
- Prazo opcional. Sem prazo, fecha quando o autor fechar.
- Votar de novo troca o voto. Não há "desfazer" separado — votar na opção que
  já está marcada tira o voto.

O anonimato é uma regra do **servidor**: numa enquete anônima a lista de quem
votou não sai na resposta da API, nem para quem criou. Esconder na interface e
mandar no JSON seria prometer segredo e entregar um `F12`.

O prazo também vale no servidor, e vale **na hora**: o voto que chega um minuto
depois do fim é recusado, tenha o worker de fechamento passado ou não. Ele roda
junto da faxina, de hora em hora, e serve para a tela dizer "encerrada" a quem
está com ela aberta.

### Visual

A pergunta fica **no corpo da mensagem**, e a caixa abaixo tem as opções e nada
mais. Repeti-la dentro da caixa seria dizer a mesma coisa duas vezes na mesma
linha; e é por estar no corpo que a enquete aparece na busca, na citação e no
painel de fixadas como qualquer outra frase.

A barra é a informação. Preenchida em `--cyan-wash` para a opção líder, em
`--bg-active` para as demais, atrás do texto e não abaixo dele. A largura é a
proporção **sobre a líder**, não sobre o total: com o total, três empates
viram três barras curtas e o empate some.

A sua escolha tem a marca preenchida — círculo no voto único, quadrado no
múltiplo. A forma diz a regra antes de qualquer texto explicar.

Contagem em `tabular-nums`. "3 pessoas votaram" é mais útil que porcentagem —
com cinco pessoas, o número absoluto é o que importa, e "60%" de cinco é uma
precisão inventada. **Pessoas, não votos**: no múltiplo, quem marca três opções
continua sendo uma.

Enquete fechada perde a interação, mantém o resultado, e ganha "Encerrada" no
rodapé. A opção vencedora fica em peso 600.

### Resultado

Quando fecha, o autor recebe uma sugestão discreta: "Adicionar o resultado às
notas". Um clique grava "Janela de deploy: terça, 9h (3 votos)" no fim da nota
do canal.

É a mesma ideia das outras duas ferramentas: decisão tomada vira registro sem
esforço.

---

## Fixadas

Já existe no contrato. Vive no mesmo painel, lista simples das mensagens
fixadas em ordem cronológica inversa, cada uma com o link de volta.

Limite de 25 por canal. Acima disso, o painel avisa: "Muita coisa fixada. Vale
mover as decisões antigas para as notas." A sugestão empurra para a ferramenta
certa em vez de acumular.

---

## O que não entra

- Subtarefas, dependências, sprints, pontos
- Múltiplos quadros por canal
- Páginas de nota aninhadas
- Enquete com imagem
- Integração com Trello, Jira, Notion

Cada um desses é uma pergunta que vai aparecer. A resposta é a mesma: com cinco
pessoas, a ferramenta que exige menos decisões para usar é a que vai ser usada.

---

## A coluna vazia precisa de onde soltar

> 5 de setembro de 2026.

O `<section>` de uma coluna sem cartões encolhia até a altura do cabeçalho —
dezoito pixels. Mover o primeiro cartão para "Fazendo", que é o arrasto mais
comum que existe num quadro, simplesmente não funcionava: não havia área para
soltar.

A área de pouso aparece **enquanto há um cartão no ar** e some depois. É a
mesma regra da moldura da coluna, que já dizia: em repouso, uma caixa em volta
de cada coluna é ruído. Durante o arrasto ela deixa de ser ruído e passa a ser
a única coisa que importa.
