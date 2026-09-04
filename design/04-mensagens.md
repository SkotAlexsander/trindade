# Mensagens

A tela onde as pessoas passam 95% do tempo. Cada decisão aqui é multiplicada por
milhares de repetições diárias, então densidade e ritmo importam mais do que em
qualquer outra parte.

> Revisão de 4 de setembro de 2026: `--cobalt-wash` virou `--cyan-wash`,
> `--slate-abyss` virou `--abyss` e o destaque de busca ganhou token próprio,
> `--mark-wash` — antes era âmbar, que hoje seria magenta e roubaria a cor
> reservada à presença ao vivo. Ver `00-direcao-visual.md`.

---

## Anatomia

```
                                                        ← 62px gutter
┌─────────┬──────────────────────────────────────────────────┐
│         │                                                  │
│  ◉      │  Ana Silva   Produto        14:32                │  cabeça
│         │  A migração passou no staging sem erro. Vou      │
│         │  subir para produção amanhã de manhã.            │
│  14:35  │  Confirmando: alguém precisa de rollback?        │  continuação
│         │  👍 3   👀 1                                     │  reações
└─────────┴──────────────────────────────────────────────────┘
```

```css
.message {
  display: grid;
  grid-template-columns: var(--gutter-w) minmax(0, 1fr);
  padding: 2px var(--s-5) 2px 0;
}
.message__body {
  font: var(--weight-normal) var(--text-body) / var(--leading-read) var(--font-read);
  color: var(--text-primary);
  max-width: var(--measure);
  overflow-wrap: break-word;
}
```

O corpo em serifa é a escolha tipográfica que define o produto. Aqui as pessoas
escrevem em prosa sobre trabalho; serifa faz isso ser lido como correspondência,
não como chat de jogo. `--measure` de 72ch impede que uma tela larga estique a
linha até a ilegibilidade.

---

## Agrupamento

Mensagens do mesmo autor viram um bloco quando **todas** as condições valem:

- mesmo autor
- menos de 5 minutos desde a anterior
- mesmo dia
- nenhuma das duas é resposta a outra mensagem
- nenhuma das duas está numa thread

A primeira do bloco tem avatar, nome, cargo e horário. As seguintes têm só o
corpo, com o horário aparecendo no gutter apenas no hover.

Repetir avatar e nome a cada linha é o maior desperdício vertical do design de
chat. Numa conversa real, agrupar recupera cerca de um terço da tela.

Espaçamento: 2px entre mensagens do mesmo bloco, 12px entre blocos. A diferença
de ritmo é o que faz a leitura funcionar sem borda nenhuma.

### Cabeçalho do bloco

Nome em `--font-ui`, 15px, peso 600, colorido pelo cargo de maior `position` que
tenha cor. Cargo em 11px `--text-tertiary` — só o de maior posição, não todos.
Horário em 11px `--text-tertiary` com `tabular-nums`.

Nome e cargo separados por 8px, sem ponto médio. Meta em cadeia com `·` é tique.

---

## Divisor de dia

```
─────────────────  quinta, 4 de setembro  ─────────────────
```

Linha de 1px em `--border-soft`, texto de 11px em `--text-tertiary` centralizado
sobre `--bg-app`. Margem de 20px acima e abaixo.

Hoje e ontem por extenso; antes disso, data. Fica grudado no topo ao rolar
(`position: sticky`) — você sempre sabe em que dia está lendo.

Este é um caso legítimo de divisória: ela codifica informação real, não separa
por estética.

---

## Conteúdo

### Markdown

Suportado: `**negrito**`, `*itálico*`, `~~riscado~~`, `` `código` ``, blocos de
código com linguagem, `> citação`, listas, links, `||spoiler||`.

Não suportado: título, tabela, imagem por URL. Numa mensagem de chat, `# Título`
quase sempre é acidente de quem quis escrever uma hashtag.

Sanitize com DOMPurify **depois** de renderizar, com whitelist de tags. Nunca
`dangerouslySetInnerHTML` sem essa passagem.

### Bloco de código

`--font-mono`, 13px, fundo `--abyss`, `--r-control`, padding de 12px,
`border: 1px solid var(--border-soft)`. Realce com Shiki, tema alinhado à paleta.

Barra superior de 24px com a linguagem em 11px `--text-tertiary` à esquerda e um
botão de copiar à direita, visível só no hover. Ao copiar, o botão vira "Copiado"
por 1,5s — sem toast. Toast para uma cópia de código é excesso.

Acima de 15 linhas, colapse com um degradê e "Mostrar tudo".

### Menção

```css
.mention {
  color: var(--accent);
  background: var(--cyan-wash);
  padding: 0 3px;
  border-radius: 3px;
  font-family: var(--font-ui);
  font-size: 0.94em;
  font-weight: var(--weight-medium);
}
```

Menção troca para `--font-ui`: no meio do corpo, ela vira interface, porque é
isso que ela é — um objeto clicável, não texto.

> **Nota de 4 de setembro de 2026.** Esta regra foi escrita quando o corpo era
> Source Serif 4, e a troca de serifa para sem-serifa era o sinal principal. A
> mudança de direção visual tirou a serifa: `--font-read` e `--font-ui` são
> hoje a mesma família, e o `font-family` na menção não muda nada visualmente.
>
> A regra fica — o dia em que o corpo voltar a ter uma família própria, a
> menção já está do lado certo. Mas **o que distingue a menção hoje é o par
> fundo + peso**, e é isso que precisa sobreviver a qualquer ajuste de cor.
> Um teste que só olhasse a família passaria sem verificar nada.

Mensagem que menciona **você** ganha fundo `--cyan-wash` na linha inteira e uma
borda esquerda de 2px em `--accent`.

### Link

`--accent`, sublinhado com `text-underline-offset: 2px`. Prévia abaixo do corpo:
cartão de 380px, `--r-media`, `border: 1px solid var(--border-soft)`, com título,
descrição de duas linhas e miniatura à direita.

**A prévia é buscada pelo servidor**, nunca pelo navegador de quem lê. Se o
cliente buscasse, abrir a mensagem entregaria o IP de todos os leitores a quem
mandou o link. É o mesmo princípio de privacidade das chamadas, aplicado ao texto.

Isso vale para a **miniatura** também: ela é baixada, re-encodada e servida do
nosso domínio. Um `<img>` apontando para o site de origem devolveria o mesmo
vazamento pela porta dos fundos, depois de todo o cuidado com o HTML.

**Um cartão por mensagem, e só o primeiro link.** Cinco links colados não podem
virar cinco cartões de 380px empurrando a conversa para fora da tela. URL
dentro de crase ou de bloco de código não conta: ali ela é exemplo, e o
servidor nem vai buscá-la.

Quando a mensagem tem anexo, o cartão não aparece — o anexo é o que a pessoa
escolheu mandar.

### Anexo

Imagem: máximo de 400×300, `--r-media`, com blurhash enquanto carrega. Clique
abre em lightbox com setas para navegar entre as imagens da mesma mensagem.

Arquivo: linha de 56px com ícone por tipo, nome, tamanho e botão de baixar.

Múltiplas imagens: grade de 2 colunas, `gap: 4px`. Acima de 4, mostre as 4
primeiras com "+N" na última.

A ordem é a **em que a pessoa escolheu os arquivos**, não a em que os uploads
terminaram — os uploads correm em paralelo e o menor chega primeiro. É o que a
coluna `sort_order` guarda.

Imagem chega com `width`/`height` do servidor e o espaço já reservado antes de
carregar. Sem isso a conversa pula para baixo a cada imagem que chega, e quem
está lendo perde a linha.

SVG **não** conta como imagem: é um formato de imagem que também é um documento
com script. Ele cai como arquivo comum, com linha de download — ver
docs/04-seguranca.md.

### Resposta

```
  ┌ ◉ Bruno  Vou revisar agora
  │
  ◉ Ana Silva                    14:40
    Obrigada, avisa quando terminar.
```

A citação fica acima, 12px, `--text-secondary`, truncada em uma linha, com uma
guia em L de 1px em `--border`. Clique rola até a original e pisca-a com
`--cyan-wash` por 800ms.

---

## Reações

Chips de 22px em linha, 4px de espaço, 4px abaixo do corpo.

```css
.reaction {
  display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 7px;
  border-radius: var(--r-full);
  border: 1px solid var(--border-soft);
  background: transparent;
  font: var(--weight-medium) 11px var(--font-ui);
  font-variant-numeric: tabular-nums;
}
.reaction[data-mine='true'] {
  background: var(--cyan-wash);
  border-color: var(--accent);
  color: var(--accent);
}
```

O botão de adicionar aparece só no hover da mensagem, como chip fantasma. Hover
no chip mostra quem reagiu, em tooltip.

Sem animação de entrada. Reações acontecem dezenas de vezes por minuto e animar
cada uma vira poluição.

---

## Fixar e guardar

> Acrescentado em 4 de setembro de 2026, a pedido do dono do projeto. São duas
> coisas, e confundi-las é o erro que faz uma delas virar inútil.

|  | Fixar | Guardar |
|---|---|---|
| de quem | do **canal** | de **você** |
| quem vê | todo mundo | ninguém, nem quem escreveu |
| permissão | `PIN_MESSAGE` | nenhuma |
| onde aparece | mural do canal | sua lista, atravessando canais |
| limite | 25 por canal | nenhum |
| ícone | alfinete | marcador |

Fixar responde "isto vale para o grupo". Guardar responde "quero achar isto
depois". A primeira é um ato público e por isso tem permissão e limite; a
segunda não muda nada para ninguém e por isso não tem nem uma coisa nem outra.

**Marcador, não estrela.** Estrela é avaliação — diz que a mensagem é boa.
Marcador diz "volto aqui", que é o que a ação realmente faz. E o alfinete já
está ocupado por fixar; usar dois objetos parecidos para ações opostas em
alcance seria o pior dos dois mundos.

### Na mensagem

Guardada, a mensagem **não muda de aparência no histórico**. Só o botão da
barra de ações fica aceso, em `--accent`.

Isso é de propósito. Uma marca visível na linha faria a conversa parecer
diferente para cada pessoa, e alguém acabaria perguntando "por que a sua tela
está diferente da minha". Fixada, sim, muda para todos — porque é para todos.

### O painel

Guardadas abre no painel direito, com o cabeçalho dizendo o que ele é:

```
┌──────────────────────────┐
│  Guardadas               │
│  todas as conversas   ✕  │
├──────────────────────────┤
│  # produto · 4 set       │
│  ◉ Ana                   │
│  A migração passou no    │
│  staging sem erro…       │
│  ─────────────────────   │
│  # bugs · 2 set          │
│  ◉ Bruno                 │
│  O erro só acontece…     │
└──────────────────────────┘
```

Cada linha nomeia o **canal de origem** antes de tudo. Sem isso a lista é um
amontoado de frases sem lugar, e a metade do valor de guardar — voltar ao
contexto — se perde. Clique carrega o canal centrado na mensagem (`?around=`) e
a pisca por 800ms, igual à busca.

O gatilho não fica no cabeçalho do canal, junto de busca e fixadas: aqueles
quatro são do canal em que você está, e este atravessa todos. Fica no menu do
seu próprio nome, no rodapé da barra lateral, que é onde moram as coisas que
são suas. Também na paleta de comandos, e em `Ctrl/⌘ ⇧ B`.

### Vazio

> Nada guardado ainda.
> Passe o mouse numa mensagem e clique no marcador para voltar nela depois.

O texto ensina o gesto. "Nenhum item" não ensina nada.

### Apagada

Mensagem apagada some da lista, sem lápide. Guardar não é uma cópia — é um
ponteiro, e o ponteiro morre com o alvo. Manter o texto ali seria desfazer o
apagar por outro caminho.

## Ações no hover

Barra flutuante no canto superior direito, `--bg-raised`, `--r-control`,
`--shadow-pop`, sobrepondo levemente a mensagem.

```
                                    ┌──────────────────┐
                                    │ 😊  ↩  📌  ✏  ⋯ │
                                    └──────────────────┘
```

Reagir, responder, guardar, fixar, editar (só autor), mais. 28px cada, ícones
de 16px. Guardar e fixar lado a lado de propósito: são vizinhas na intenção e a
diferença entre elas precisa ser aprendida uma vez só.

Fixar só aparece com `PIN_MESSAGE`. Guardar aparece sempre.

Aparece sem atraso e sem transição — atraso aqui é frustrante e transição de
opacidade a cada movimento do mouse cria cintilação numa lista longa.

Também aparece quando a mensagem recebe foco por teclado. Mensagem é `tabbable`
com setas ↑↓ quando o foco está na lista.

---

## Compositor

Fundo `--bg-live`, `border-top: 1px solid var(--border)`, margem de 16px nas
laterais e embaixo.

```
┌────────────────────────────────────────────────────┐
│  📎  escreva em # produto                    😊 ⏎ │
└────────────────────────────────────────────────────┘
```

```css
.composer {
  background: var(--bg-live);
  border: 1px solid var(--border);
  border-radius: var(--r-field);
  padding: var(--s-2) var(--s-3);
}
.composer:focus-within { border-color: var(--border-strong); }
```

Raio quase reto (2px) de propósito: campo de texto muito arredondado parece
"bolha de mensagem", que é vocabulário de aplicativo pessoal, não de trabalho.

`textarea` que cresce de 40px até 240px, depois rola. Redimensione ajustando
`style.height` a partir de `scrollHeight`, não com `contenteditable` — este último
traz uma classe inteira de bugs de colagem e desfazer que não valem a pena.

O placeholder nomeia o canal: "escreva em # produto". Confirma onde você está.

### Teclas

| Tecla | Ação |
|---|---|
| `Enter` | enviar |
| `Shift Enter` | quebra de linha |
| `↑` (campo vazio) | editar sua última mensagem |
| `Esc` | cancelar edição ou limpar resposta |
| `Ctrl/⌘ B` `I` `E` | negrito, itálico, código |

### Autocompletar

`@` para pessoa, `#` para canal, `:` para emoji. Popover **acima** do campo,
máximo de 8 itens, primeiro já selecionado, setas e `Enter` para escolher.

Com cinco pessoas, `@` sem nenhum caractere já lista as cinco. Não exija digitar.

### Anexo pendente

Faixa acima do campo com miniaturas de 56px, `--r-control`, botão de remover no
canto. Barra de progresso de 2px em `--accent` na base de cada miniatura.

O upload começa ao anexar, não ao enviar. Quando a pessoa terminar de escrever, o
arquivo já está lá.

O botão de enviar espera o upload terminar: enviar no meio perderia o arquivo.
E **anexo sem legenda é uma mensagem inteira** — uma foto sozinha se envia.

Colar uma imagem anexa (é assim que a captura de tela chega); colar texto
continua sendo colar texto. Arrastar para cima do compositor também anexa.

Remover um pendente **não** avisa o servidor: o arquivo fica lá, e a varredura
de órfãos o recolhe depois de uma hora. Um `DELETE` aqui só adiantaria a
limpeza, e falharia exatamente quando mais importa — com a rede ruim.

### Barra de resposta

Acima do campo, 32px, `--bg-raised`: "Respondendo a **Bruno**" com um `✕`. O
`Escape` cancela.

---

## Estados da mensagem

| Estado | Aparência |
|---|---|
| enviando | corpo em `opacity: 0.5` |
| na fila | `opacity: 0.5` + relógio de 12px no gutter |
| falhou | borda esquerda `--danger` + "Não enviou. Tentar de novo" |
| editada | "(editado)" em 11px `--text-tertiary` após o corpo |
| apagada | "Mensagem apagada" em itálico `--text-tertiary`, sem hover |

O envio otimista aparece **instantaneamente**, antes da confirmação do servidor.
A troca pela versão real, quando chega, não anima nada — a mensagem já está no
lugar certo e qualquer transição aqui vira piscada.

Falha oferece "Tentar de novo" na própria linha. Nunca um toast: o erro pertence
ao lugar onde a mensagem está, não a um canto da tela.

---

## Rolagem

O ponto onde a maioria dos clones de chat erra.

**Grude no fim** se o usuário está a menos de 100px do fim. Se ele rolou para
cima, **não mova nada** quando chegar mensagem nova — mostre um botão flutuante:

```
        ┌────────────────────────┐
        │  ↓  3 mensagens novas  │
        └────────────────────────┘
```

Rolar a lista sob os olhos de quem está lendo o histórico é a agressão clássica
desse tipo de interface.

**Preserve a posição ao carregar histórico.** Ao buscar mensagens antigas, meça
`scrollHeight` antes e depois e compense a diferença no `scrollTop`. Sem isso, a
tela salta a cada página carregada.

Carregue mais quando faltarem 600px para o topo, não 0. E ancore em `id`, não em
deslocamento — mensagens novas mudam os índices e a paginação por offset duplica
ou pula linhas.

Virtualize só acima de 200 mensagens renderizadas. Abaixo disso, o custo do
virtualizador em complexidade e em bugs de altura variável é maior que o ganho.

---

## Busca

Abre no painel direito, não em tela cheia — você quer ver o resultado sem perder
a conversa.

```
┌──────────────────────────┐
│  🔍 migração             │
│  De: todos  ⌄            │
├──────────────────────────┤
│  12 resultados           │
│                          │
│  ◉ Ana        4 set      │
│  A migração passou no    │
│  staging sem erro…       │
│  ─────────────────────   │
└──────────────────────────┘
```

O termo encontrado ganha fundo `--mark-wash`, e o destaque **compara sem
acento**, como a busca do Postgres: quem digita "migracao" acha "migração" e
precisa ver a palavra acesa. Isso exige guardar de onde veio cada caractere —
"migração" tem nove e a versão dobrada tem oito, então casar índices direto
acenderia o pedaço errado justamente nas palavras acentuadas.

O termo encontrado ganha fundo `--mark-wash`. Este é o único uso de âmbar fora
de presença ao vivo, e a justificativa é a mesma metáfora: é o que está aceso
agora, o que você procurou.

Clique carrega o canal centrado naquela mensagem (`?around=`) e a pisca por 800ms.

Filtros: de quem, com anexo, com link, período. Todos como chips abaixo do campo,
removíveis.

Sem resultado:

> Nada encontrado para "migração".
> Tente menos palavras, ou remova os filtros.

---

## Thread

Abre no painel direito. A mensagem original fixa no topo, respostas abaixo, com
compositor próprio.

No canal, a mensagem que virou thread ganha um rodapé de 24px: "3 respostas ·
última há 2 h", em 11px `--accent`, clicável.

O contador e o instante da última vêm **junto do histórico**, em `threadCount`
e `threadLastReplyAt` de cada mensagem, e não de uma consulta por linha: o
histórico traz cinquenta de cada vez e quase nenhuma tem thread.

**A resposta de thread não volta para o canal.** O histórico filtra
`parent_id is null`, e o cliente respeita a mesma regra ao receber o evento
pelo socket — deixá-la entrar criaria uma linha que some no primeiro
recarregamento. Quem tirou a conversa da linha principal não quer vê-la lá.

O tempo é grosso — "agora", "há 2 h", "há 3 d". Precisão de minuto num rodapé
obrigaria a redesenhar a lista por relógio, e ninguém lê aquilo com essa
atenção.

Este é o único ponto do projeto onde `·` aparece como separador de meta — porque
aqui são dois fatos da mesma coisa e não uma cadeia de rótulos.
