# Direção visual

Leia este arquivo antes de qualquer outro de design. Ele explica de onde vêm as
decisões dos demais. Sem ele, os tokens parecem arbitrários.

> **Revisão de 4 de setembro de 2026.** A direção anterior era ardósia fria com
> cobalto e âmbar, deliberadamente quieta. Foi trocada por decisão do dono do
> projeto a partir de uma referência visual: interface de comando, quase preta,
> com neon e cantos chanfrados. As seções de cor e tipografia foram reescritas.
> A estrutura, a densidade e a regra de reserva de cor sobreviveram — elas não
> dependiam da paleta. O que foi descartado está registrado no fim do arquivo,
> para que ninguém reabra a discussão sem saber o que já se decidiu.

---

## O que estamos desenhando

Um lugar de trabalho para cinco pessoas que se conhecem, aberto o dia inteiro,
usado para decidir coisas.

A referência é a interface de comando de ficção científica: superfície escura,
linhas finas que brilham, cantos cortados em diagonal, informação densa e
sempre visível. O produto não finge ser um documento nem uma sala de reunião —
ele se parece com um painel que fica ligado.

Isso continua eliminando duas estéticas: o roxo saturado e os cantos muito
arredondados do Discord, e o cinza sem opinião do Slack. A diferença é que
agora a alternativa não é o recuo — é o compromisso com uma linguagem forte.

## O conceito: elenco fixo

A restrição do produto é também a sua identidade. **São cinco pessoas, sempre as
mesmas.** Nenhuma interface de chat conhecida é desenhada para isso.

O Discord mostra membros numa lista lateral que rola, porque pode haver mil. O
Slack esconde as pessoas atrás de uma busca. Ambos tratam "quem está aqui" como
informação secundária, recuperável sob demanda.

Aqui é o contrário. Cinco pessoas cabem numa faixa permanente, sempre visível,
mostrando de relance quem está online, quem está em chamada, quem está digitando
e quem se ausentou. **O elenco não é uma lista: é um painel de instrumentos.**

Essa faixa é o elemento memorável da interface, e a nova direção a favorece: é
justamente ali que o brilho e o chanfro fazem sentido literal.

## A regra de cor: ciano é comando, magenta é presença

Uma segunda ideia organiza a paleta inteira. Ela sobreviveu à troca de estética
porque nunca dependeu de quais cores eram.

O que você **opera** — botão, link, foco, seleção, canal ativo — é **ciano**.
O que está **vivo** — alguém falando, alguém digitando, uma chamada em curso,
uma tela sendo compartilhada — é **magenta**.

Não é decoração. É uma regra semântica que o usuário aprende sem ler nada: se
tem magenta na tela, tem gente ali neste instante. E ela dá à interface um
comportamento que muda ao longo do dia, ficando monocromática quando ninguém
está e acendendo quando o grupo se junta.

Consequência prática: magenta é reservado para presença humana ao vivo. Nunca
use magenta para aviso, destaque de marca, botão primário ou qualquer outra
coisa. **No momento em que magenta significar duas coisas, a regra morre** — e
numa paleta neon, onde tudo já brilha, ela é a única coisa que impede a tela de
virar sopa luminosa.

---

## Plano de design

### Cor

O fundo é `#05070E`: quase preto, mas com azul real. Ao lado de um `#000` a
diferença é evidente, e é ela que impede o neon de parecer colado sobre o vazio.

```
--void        #05070E   fundo da aplicação
--abyss       #080D18   superfície: colunas laterais
--mid         #101A2E   superfície elevada: cartões, menus, diálogos
--ice         #E8F3FA   texto principal
--ice-dim     #9DB3CA   texto secundário

--cyan        #22D3EE   comando: link, foco, botão primário, canal ativo
--magenta     #E879F9   presença ao vivo, e nada mais
--crimson     #FB5A68   destrutivo e erro
```

Contornos não são cinza: são ciano com pouca opacidade
(`rgba(34, 211, 238, 0.14)`). É o que faz a linha parecer emitir luz em vez de
dividir espaço.

O tema claro é de primeira classe, não uma consideração posterior, e **não é
inversão**. O neon vira tinta sobre papel frio (`#EEF3F7`): os acentos escurecem
o bastante para manter contraste e o brilho quase some — brilho sobre branco lê
como borrão, não como luz. O chanfro permanece, porque a forma é o que
sobrevive à troca de tema.

### Brilho

Brilho é o caráter desta interface, e por isso é **medido**. Existem três
intensidades, definidas em `01-tokens.md`, e nada além delas:

- `--glow-edge` — contorno de painel e de elemento selecionado
- `--glow-accent` — botão primário e foco
- `--glow-live` — só no que tem gente ao vivo

Se você precisou de uma quarta, provavelmente está brilhando algo que devia
ficar quieto.

### Chanfro

Painéis têm o canto superior esquerdo e o inferior direito cortados em
diagonal, 12px. **Um valor só.** Chanfro variando por componente vira ruído, e
foi assim que a referência original errou.

O chanfro é a assinatura da forma; o raio continua variando por função — 2px em
campo de entrada, 4px em botão, 6px em diálogo, 50% em avatar.

### Tipografia

Uma família para tudo o que é interface e prosa, uma para código.

**Instrument Sans** para a interface inteira e para o corpo das mensagens. É
levemente estreita, o que ajuda numa coluna de 232px, e não tem a neutralidade
genérica de Inter.

**JetBrains Mono** apenas para código dentro de mensagem, e para o horário no
gutter, onde números tabulares importam. Nunca como enfeite.

Rótulos de seção — `SPACES`, `ELENCO`, `TAREFAS` — usam caixa alta com
`letter-spacing` de 0.12em, 11px, peso 500. Isto é uma reversão consciente: a
direção anterior proibia caixa alta espaçada por ser tique de interface gerada.
Nesta linguagem ela é estrutural, não decorativa, e sua ausência é que soaria
errada.

Escala em terça menor (1,2), ancorada em 15px:

```
 11px  metadado denso e rótulo de seção em caixa alta
 13px  rótulo de interface
 15px  interface padrão, nome de canal
 15.5px corpo da mensagem                (altura de linha 1.55)
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

**Um lugar para a ousadia.** A faixa do elenco é o elemento memorável. O resto
da tela é denso mas contido. Se algo mais competir por atenção, corte.

**Densidade é respeito.** Muitas horas por dia significa que espaço em branco
excessivo cansa mais do que ajuda. Mensagens agrupadas por autor, sem avatar
repetido, sem cartão em volta de cada bloco.

**Estrutura carrega informação.** Uma divisória separa dois dias; ela não existe
para "quebrar visualmente". Um contorno que brilha indica algo selecionável ou
ao vivo — nunca é enfeite.

**Movimento responde a ação.** Abrir menu, confirmar envio, alguém começar a
falar: animar. Entrada de seção, transição em hover de cada elemento, fade ao
carregar: não. Um único momento orquestrado — o painel do elenco acendendo
quando a conexão estabelece — vale mais que trinta transições espalhadas.

**Piso de qualidade sem anunciar.** Responsivo até 380px, foco de teclado
visível, `prefers-reduced-motion` respeitado, contraste AA em todo texto. Este
piso não é negociável pela estética: os valores da paleta foram **medidos** e
ajustados até passarem, não escolhidos no olho. Ver a tabela em `01-tokens.md`.

---

## O que foi descartado, e por quê

**A paleta ardósia com cobalto e âmbar.** Era a direção original, escolhida por
ser quieta e por evitar o near-black com neon, que é uma assinatura visual
comum. Foi trocada por decisão do dono do projeto. O argumento contra ela
continua registrado aqui para honestidade: uma interface quieta cansa menos em
uso de muitas horas. Se o grupo reclamar de fadiga visual depois de um mês de
uso, este é o primeiro lugar a olhar.

**Source Serif 4 no corpo das mensagens.** A ideia era que serifa faz o texto
ser lido como correspondência e não como chat de jogo. Numa interface de
comando a serifa destoa, então saiu. Os arquivos foram removidos de
`public/fonts/`; voltar é baixar de novo e trocar `--font-read`.

**Barra de XP e nível no cartão de perfil.** Estava na referência visual e não
entrou: este não é um jogo, e gamificar presença entre cinco pessoas que se
conhecem produz ansiedade, não engajamento.

**Lista de membros com seções "Online" e "Offline".** Estava na referência e não
entrou. É exatamente o que Discord e Slack fazem porque precisam escalar para
mil pessoas. Aqui são cinco, e a faixa do elenco existe justamente para não
haver lista.

**Ciano e magenta usados livremente.** Na referência os dois neons aparecem em
qualquer lugar. Aqui cada um tem um papel e só ele. Sem essa disciplina, a
regra de presença deixa de comunicar qualquer coisa.

---

## O que não fazer

- Avatar repetido em cada mensagem do mesmo autor em sequência
- Sombra sob elemento que não flutua
- Gradiente como decoração de fundo — brilho é de borda, não de área
- Uma quarta intensidade de brilho
- Chanfro com valor diferente do token
- Emoji como ícone de interface
- Magenta em qualquer coisa que não seja presença humana ao vivo
- Seta `→` colada no texto de botão
- Barra de rolagem customizada que esconde a posição
- Animação de entrada em elemento que aparece muitas vezes por minuto
- Baixar contraste abaixo de AA para a cor "ficar mais bonita"

---

## A marca

A triquetra — o nó da Trindade. Arte original em `design/marca/`, fornecida
pelo dono do projeto. `3.png` é a versão de referência: silhueta chapada em
preto sobre transparência, com a palavra abaixo.

Os caminhos em `packages/web/src/components/Logo.tsx` foram **traçados** desse
arquivo, não redesenhados: um contorno por marching squares, simplificado por
Douglas–Peucker e convertido em cúbicas. Por isso batem com a arte.

Vetor e não raster por dois motivos que valem para o produto inteiro: a
`currentColor` deixa a marca seguir o tema — o PNG é preto e sumiria no fundo
escuro — e a 24px um raster fica borrado.

Três formas, e cada uma tem um lugar:

| Componente | Onde | Observação |
|---|---|---|
| `Marca` | rail, favicon, qualquer uso ≤ 40px | sem os sete pontos decorativos: abaixo de 40px eles viram sujeira |
| `MarcaCheia` | telas de autenticação | arte completa, só a partir de 40px |
| `Palavra` | telas de autenticação | a palavra no desenho da logo, no lugar do texto em Instrument Sans |

O `fill-rule="evenodd"` é o que abre os vazios do entrelaçado. Sem ela o nó
vira um triângulo cheio.
