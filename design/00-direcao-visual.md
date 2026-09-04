# Direção visual

Leia este arquivo antes de qualquer outro de design. Ele explica de onde vêm as
decisões dos demais. Sem ele, os tokens parecem arbitrários.

---

## O que estamos desenhando

Um lugar de trabalho para cinco pessoas que se conhecem, aberto o dia inteiro,
usado para decidir coisas. Não é uma plataforma social, não é um jogo, não é uma
ferramenta corporativa.

Isso já elimina três estéticas: o roxo saturado e os cantos muito arredondados do
Discord, que existem para parecer divertido a uma audiência adolescente; o azul
neutro e as bordas duras do Teams, que existem para parecer inofensivo a um
departamento de TI; e o cinza sem opinião do Slack.

## O conceito: elenco fixo

A restrição do produto é também a sua identidade. **São cinco pessoas, sempre as
mesmas.** Nenhuma interface de chat conhecida é desenhada para isso.

O Discord mostra membros numa lista lateral que rola, porque pode haver mil. O
Slack esconde as pessoas atrás de uma busca. Ambos tratam "quem está aqui" como
informação secundária, recuperável sob demanda.

Aqui é o contrário. Cinco pessoas cabem numa faixa permanente, sempre visível,
mostrando de relance quem está online, quem está em chamada, quem está digitando
e quem se ausentou. **O elenco não é uma lista: é um painel de instrumentos.**

Essa faixa é o elemento memorável da interface. Tudo em volta dela é quieto.

## A regra de cor: frio é registro, quente é presença

Uma segunda ideia organiza a paleta inteira, e ela vem do assunto.

O que já aconteceu — histórico, mensagens gravadas, arquivos, o registro — é
**frio**. O que está acontecendo agora — alguém falando, alguém digitando, uma
tela sendo compartilhada, o campo onde você está escrevendo — é **quente**.

Não é decoração. É uma regra semântica que o usuário aprende sem ler nada: se
tem calor na tela, tem gente ali neste instante. E ela dá à interface um
comportamento que muda ao longo do dia, ficando fria quando ninguém está e
acendendo quando o grupo se junta.

Consequência prática: âmbar é reservado para presença humana ao vivo. Nunca use
âmbar para aviso, destaque de marca, botão primário ou qualquer outra coisa. No
momento em que âmbar significar duas coisas, a regra morre.

---

## Plano de design

### Cor

Seis valores nomeados formam a base. O tema escuro é o padrão porque o uso é de
muitas horas seguidas, mas o tema claro é de primeira classe, não uma
consideração posterior.

```
--slate-abyss    #0E1419   fundo da aplicação
--slate-deep     #151F26   superfície: colunas laterais
--slate-mid      #1D2A33   superfície elevada: cartões, menus
--slate-line     #26353F   divisórias e contornos
--porcelain      #E6EDF1   texto principal
--porcelain-dim  #8497A3   texto secundário

--cobalt         #5C9CE6   interação: link, foco, botão primário
--ember          #E4A24A   presença ao vivo, e nada mais
--rust           #DE5D52   destrutivo e erro
```

O fundo não é preto tingido. `#0E1419` tem azul e verde perceptíveis; ao lado de
um `#111` real a diferença é evidente. Isso é deliberado — near-black com um
acento neon é a assinatura visual mais gasta do momento.

O tema claro não inverte a escala. Ele troca a base por um cinza-papel frio
(`#EDF1F3`) e escurece os acentos para manter contraste, mantendo a mesma regra
frio/quente.

### Tipografia

Duas famílias, com papéis nitidamente distintos.

**Instrument Sans** para toda a interface — nomes de canal, botões, rótulos,
menus. É levemente estreita, o que ajuda numa coluna de 232px, e não tem a
neutralidade genérica de Inter, que hoje é sinônimo de "produto de software".

**Source Serif 4** para o corpo das mensagens. Essa é a escolha arriscada do
projeto e ela é justificada pelo assunto: aqui as pessoas discutem projetos em
prosa, não trocam figurinhas. Serifa faz o texto ser lido como correspondência,
não como chat de jogo, e sinaliza sem palavra nenhuma que o que se escreve aqui
tem peso. Source Serif 4 foi desenhada para tela e aguenta 15,5px sem embaçar.

**JetBrains Mono** apenas para código dentro de mensagem. Nunca para rótulo,
número ou metadado — monoespaçada usada como enfeite é um tique reconhecível.

Escala em terça menor (1,2), ancorada em 15,5px:

```
 11px  metadado denso (horário no gutter)
 13px  rótulo de interface
 15px  interface padrão, nome de canal
 15.5px corpo da mensagem       (serifa, altura de linha 1.62)
 18px  título de seção
 22px  título de tela
 30px  display, só em telas de autenticação
```

Corpo de mensagem tem largura máxima de 72 caracteres. Numa tela ultrawide, uma
mensagem que atravessa 200 caracteres é ilegível, e "usar o espaço disponível"
não é razão suficiente.

### Layout

Quatro colunas, da mais estável à mais volátil, esquerda para direita.

```
┌────┬──────────────┬────────────────────────────┬──────────────┐
│    │  # geral     │  ▸ Ana                     │              │
│ ▪  │  # produto   │    A migração passou       │   NOTAS      │
│    │  # bugs      │    no staging.             │              │
│ ▪  │              │                            │   ─────      │
│    │  ─────────   │  ▸ Bruno                   │              │
│ ▪  │  🔊 sala     │    Vou revisar agora.      │   TAREFAS    │
│    │              │                            │              │
│    ├──────────────┤  ┌──────────────────────┐  │              │
│    │ ●●○●◐  ELENCO│  │ escreva…             │  │              │
└────┴──────────────┴──┴──────────────────────┴──┴──────────────┘
 56px    232px              flexível              320px, recolhe
```

Alinhamento à esquerda em tudo. Nenhum texto centralizado fora das telas de
autenticação e dos estados vazios.

A faixa do elenco fica **fixa no rodapé da coluna de canais**, nunca rola com a
lista. Cinco espaços, sempre os cinco, mesmo quem está offline.

### Princípios

**Um lugar para a ousadia.** A faixa do elenco é o elemento memorável. Todo o
resto é disciplinado e quieto. Se algo mais competir por atenção, corte.

**Densidade é respeito.** Muitas horas por dia significa que espaço em branco
excessivo cansa mais do que ajuda. Mensagens agrupadas por autor, sem avatar
repetido, sem cartão em volta de cada bloco.

**Estrutura carrega informação.** Uma divisória separa dois dias; ela não existe
para "quebrar visualmente". Um contorno indica algo selecionável. Marcadores
numerados só onde há sequência real — o que, neste produto, é quase lugar nenhum.

**Movimento responde a ação.** Abrir menu, confirmar envio, alguém começar a
falar: animar. Entrada de seção, transição em hover de cada elemento, fade ao
carregar: não. Um único momento orquestrado — o painel do elenco acendendo quando
a conexão estabelece — vale mais que trinta transições espalhadas.

**Piso de qualidade sem anunciar.** Responsivo até 380px, foco de teclado
visível, `prefers-reduced-motion` respeitado, contraste AA no texto e AAA no
corpo das mensagens.

---

## Revisão do plano contra os defaults

O processo pede que o plano seja conferido contra o que sairia por padrão. Três
pontos foram revisados antes de virar código.

**O fundo escuro com um acento.** É o segundo default mais comum. Foi mantido
porque uso prolongado justifica tema escuro, mas mudou em duas frentes: o fundo
tem croma real em vez de ser preto tingido, e existem dois acentos com papéis
semânticos separados — frio para controle, quente para presença — em vez de um
neon solitário. A regra frio/quente é o que tira a paleta do território genérico;
sem ela, seria mais um tema escuro qualquer.

**Rótulos em caixa alta espaçada.** O primeiro rascunho tinha `ELENCO`,
`NOTAS`, `TAREFAS` em versalete tracked-out. Foi retirado: é o tique tipográfico
mais reconhecível de interface gerada. Os cabeçalhos de seção agora usam caixa
normal em 13px com peso 500 e cor `--porcelain-dim`. Nos wireframes deste
documento a caixa alta permanece só por legibilidade de ASCII.

**Cartões arredondados uniformes.** O primeiro rascunho envolvia cada mensagem
num cartão com o mesmo raio e a mesma sombra. Foi retirado inteiro. Mensagem não
é cartão — é linha de texto num fluxo contínuo. O raio agora varia por função:
2px em campo de entrada, 6px em menu e diálogo, 50% em avatar. Sombra existe
apenas em elemento que flutua de verdade sobre outro; nunca sob um bloco estático.

**Terracota.** Considerada e descartada para o papel de presença. `#D97757` e
vizinhos são hoje uma assinatura reconhecível. O âmbar `#E4A24A` é mais amarelo,
mais luminoso e lê melhor como "luz acesa" — que é exatamente a metáfora.

---

## O que não fazer

- Avatar repetido em cada mensagem do mesmo autor em sequência
- Sombra sob elemento que não flutua
- Gradiente como decoração de fundo
- Caixa alta espaçada em rótulo
- Emoji como ícone de interface
- Âmbar em qualquer coisa que não seja presença humana ao vivo
- Seta `→` colada no texto de botão
- Barra de rolagem customizada que esconde a posição
- Animação de entrada em elemento que aparece muitas vezes por minuto
