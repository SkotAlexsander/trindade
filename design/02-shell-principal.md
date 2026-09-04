# Shell principal

A moldura que existe em toda tela autenticada. Componente:
`packages/web/src/components/AppShell.tsx`.

> Revisão de 4 de setembro de 2026: as citações de `--ember` viraram `--live`
> na troca de direção visual. A cor de presença ao vivo passou de âmbar a
> magenta; o papel dela não mudou. Ver `00-direcao-visual.md`.

---

## Estrutura

```
┌────┬──────────────┬───────────────────────────────┬──────────────┐
│    │ Trindade     │ # produto            🔍 📌 ⋯  │  Notas    ✕  │ 48px
│ ▪  ├──────────────┼───────────────────────────────┼──────────────┤
│    │ CONVERSA     │                               │              │
│ ▪  │  # geral     │   histórico de mensagens      │  conteúdo    │
│    │  # produto  ●│   (rola)                      │  do painel   │
│ ▪  │  # bugs     ³│                               │  (rola)      │
│    │              │                               │              │
│ ⚙  │ VOZ          │                               │              │
│    │  🔊 sala     │                               │              │
│    │              ├───────────────────────────────┤              │
│    ├──────────────┤  ┌─────────────────────────┐  │              │
│    │  ●●○●◐       │  │ escreva em # produto    │  │              │
│    │  ELENCO      │  └─────────────────────────┘  │              │
└────┴──────────────┴───────────────────────────────┴──────────────┘
 56px     232px                flexível               320px
```

```css
.shell {
  display: grid;
  grid-template-columns: var(--rail-w) var(--sidebar-w) minmax(0, 1fr) auto;
  height: 100dvh;
  background: var(--bg-app);
  overflow: hidden;
}
```

`100dvh`, não `100vh` — no iOS a barra do navegador some e volta, e `vh` produz
um salto de layout. `minmax(0, 1fr)` na coluna central impede que uma mensagem
longa force a grade a crescer, que é o bug de layout mais comum aqui.

A ordem das colunas segue estabilidade: o rail quase nunca muda, os canais mudam
raramente, as mensagens mudam sempre, o painel abre e fecha.

---

## Coluna 1 — rail

56px, fundo `--bg-app`, sem borda à direita — a diferença de fundo com a coluna
seguinte já separa.

Conteúdo, de cima para baixo:

- **Marca**, 28px, no topo com 12px de margem. Não escreva o nome do produto por
  extenso aqui: é um símbolo só. O nome aparece no cabeçalho da coluna 2.
- **Espaços de projeto**, 32px cada, empilhados com 8px entre eles. Na v1 existe
  um. A estrutura já suporta mais para não precisar refatorar depois.
- **Espaçador flexível.**
- **Configurações**, ícone de 20px, colado no rodapé.

O espaço ativo ganha um marcador vertical de 3px, colado na borda esquerda,
altura 24px, cor `--accent`, cantos arredondados só do lado direito. Transição de
`--dur-quick` na altura.

Sem tooltip com atraso longo. 300ms, posicionado à direita.

---

## Coluna 2 — canais e elenco

232px, `--bg-panel`, `border-right: 1px solid var(--border-soft)`.

Três zonas verticais:

```
┌──────────────┐
│ Trindade  ⌄  │  48px, fixo
├──────────────┤
│ CONVERSA     │
│  # geral     │  rola
│  # produto   │
│  ...         │
├──────────────┤
│ elenco       │  88px, fixo no rodapé
└──────────────┘
```

```css
.sidebar {
  display: grid;
  grid-template-rows: var(--header-h) minmax(0, 1fr) var(--cast-h);
}
```

O elenco **nunca rola com a lista**. É o ponto do desenho inteiro: ele está
sempre lá. Detalhes em `03-menu-e-navegacao.md`.

O cabeçalho tem o nome do servidor e um chevron que abre o menu de servidor
(convites, cargos, configurações). Ele fica em `--bg-panel` mesmo, sem elevação;
o que separa é a borda inferior.

---

## Coluna 3 — conversa

`minmax(0, 1fr)`, fundo `--bg-app`.

```css
.conversation {
  display: grid;
  grid-template-rows: var(--header-h) minmax(0, 1fr) auto;
}
```

**Cabeçalho** — 48px, `border-bottom: 1px solid var(--border-soft)`.

À esquerda: `#` em `--text-tertiary`, nome do canal em `--text-ui` peso 500 e,
depois de um separador vertical de 1px com 12px de margem, o tópico em
`--text-secondary` truncado com reticências.

O separador é uma linha, não um ponto médio. Meta juntada com `·` é um tique
reconhecível.

À direita: busca, fixadas, notas, tarefas, mais. Ícones de 18px, `--text-secondary`,
que passam a `--text-primary` no hover. O botão do painel aberto fica com fundo
`--bg-active`.

**Histórico** — rola. Detalhes em `04-mensagens.md`.

**Compositor** — altura automática. Fundo `--bg-live`. É a primeira aparição da
superfície quente e ela marca onde você age.

---

## Coluna 4 — painel contextual

320px, `--bg-panel`, `border-left: 1px solid var(--border-soft)`. Fechado por
padrão, `width: 0` sem renderizar o conteúdo.

Abriga notas, tarefas, thread, fixadas e resultados de busca — um por vez, nunca
empilhados. Abrir um fecha o outro.

Animar `width` causa reflow em toda a grade. Anime `transform` num contêiner de
largura fixa:

```css
.panel {
  width: var(--panel-w);
  transform: translateX(100%);
  transition: transform var(--dur-normal) var(--ease-out);
}
.panel[data-open='true'] { transform: translateX(0); }
```

Abre com a tecla correspondente ou pelo ícone. Fecha com `Escape` **se o foco
estiver dentro dele** — senão `Escape` limparia o painel de quem só queria sair
do compositor.

---

## Estados globais

### Desconectado

Faixa de 28px no topo da coluna 3, empurrando o conteúdo para baixo (não
sobrepondo — sobrepor esconde a mensagem mais recente, que é justamente a que
importa). Fundo `--magenta-wash`, texto `--text-primary`.

> Sem conexão. Tentando reconectar…

Só apareça depois de **2 segundos** de queda. Uma oscilação de 300ms que pisca
uma faixa vermelha é pior que a oscilação.

Enquanto isso o compositor continua aceitando texto. As mensagens ficam na fila
com `status: 'queued'` e saem quando a conexão volta.

### Carregando

Nada de spinner no shell. As colunas 1 e 2 renderizam imediatamente com dados do
cache; só o histórico mostra esqueleto — seis blocos com a proporção real de
mensagem, animação `opacity` de 1,4s, sem varredura diagonal.

### Vazio

Canal sem mensagem não mostra ilustração. Mostra, centralizado na vertical:

> **# produto**
> Este canal ainda não tem mensagens. Escreva a primeira.

Tela vazia é convite para agir, não momento decorativo.

---

## Responsivo

Três faixas, e a lógica é sempre **remover coluna, nunca empilhar**.

### ≥ 1280px — completo

As quatro colunas. O painel abre sem comprimir a conversa abaixo de 560px; se
comprimiria, ele vira sobreposição.

### 900–1279px — sem painel fixo

Rail, canais e conversa. O painel vira sobreposição de 320px pela direita, com
véu `rgba(0,0,0,0.4)` sobre a conversa. Fecha com `Escape` ou clique no véu.

### < 900px — uma coluna por vez

Navegação em pilha, como aplicativo móvel.

```
┌──────────────────────┐
│ ‹  # produto      ⋯  │  56px
├──────────────────────┤
│  mensagens           │
├──────────────────────┤
│  compositor          │
└──────────────────────┘
```

- O rail e os canais viram uma gaveta pela esquerda, aberta pelo botão de voltar
  ou por arrasto da borda.
- **O elenco vira uma faixa horizontal fixa no topo da gaveta**, não some. É o
  elemento identitário do produto; se ele desaparece no celular, o produto no
  celular vira outro produto.
- Alvos de toque com no mínimo 44px.
- O compositor gruda acima do teclado virtual usando
  `env(safe-area-inset-bottom)` e `interactive-widget=resizes-content` no
  viewport.

---

## Atalhos

> Ampliado em 4 de setembro de 2026 a partir de uma referência do Discord. A
> tabela original tinha nove atalhos; o que entrou está marcado com **novo**, e
> o que foi recusado está listado no fim, com o motivo.

Nada dispara enquanto o foco está num campo de texto — com uma exceção
deliberada, a última linha da tabela de conversa.

### Navegação

| Tecla | Ação | |
|---|---|---|
| `Ctrl/⌘ K` | paleta de comandos | |
| `Alt ↑` / `Alt ↓` | canal anterior / próximo | |
| `Alt ⇧ ↑` / `Alt ⇧ ↓` | canal não lido anterior / próximo | |
| `Alt ←` / `Alt →` | voltar / avançar no histórico | **novo** |
| `Alt ⇧ C` | ir para a chamada em andamento | **novo** |

`Alt ⇧ C` só existe quando há chamada. Achar de volta o canal onde a chamada
está, depois de vagar por outros, é uma micro-frustração que se repete.

### Conversa e painéis

| Tecla | Ação | |
|---|---|---|
| `Ctrl/⌘ F` | buscar no canal | |
| `Ctrl/⌘ P` | painel de fixadas do canal | **novo** |
| `Ctrl/⌘ ⇧ B` | suas guardadas, de todas as conversas | **novo** |
| `Ctrl/⌘ U` | mostrar e esconder o elenco | **novo** |
| `Ctrl/⌘ E` | seletor de emoji | **novo** |
| `Ctrl/⌘ ⇧ U` | anexar arquivo | **novo** |
| `⇧ PageUp` | ir à primeira mensagem não lida | **novo** |
| `⇧ Esc` | marcar tudo como lido | |
| `Esc` | fechar painel, cancelar edição, limpar resposta | |
| qualquer caractere | foca o compositor e digita a tecla | **novo** |

A última é a melhor da lista e a que mais dá trabalho. Começar a escrever com o
foco em qualquer lugar da conversa leva o texto ao compositor **incluindo o
primeiro caractere** — perder a primeira letra transforma o atalho em defeito.
Não vale para `Ctrl`, `Alt`, `⌘`, teclas de função nem navegação.

### Mensagem em foco

`↑` e `↓` com o compositor vazio movem o foco pela lista. A mensagem focada
ganha o anel de foco e responde a:

| Tecla | Ação |
|---|---|
| `E` | editar — só as suas |
| `R` | responder |
| `T` | abrir a thread |
| `S` | guardar e desguardar — só para você |
| `P` | fixar e desafixar — para todo mundo |
| `+` | abre o seletor de reação |
| `Delete` | apagar, com confirmação |
| `Alt Enter` | marcar como não lida a partir dela |
| `⇧ F10` | menu de contexto |
| `Esc` | devolve o foco ao compositor |

Este grupo inteiro depende de foco itinerante na lista (`roving tabindex`), que
é a mesma coisa de que a navegação por teclado precisa para ser acessível. Sai
de graça junto: implementar um é implementar o outro.

`↑` com o compositor **cheio** continua sendo "editar a última mensagem". O
compositor vazio é a condição que separa os dois comportamentos.

### Voz e vídeo

| Tecla | Ação | |
|---|---|---|
| `Ctrl/⌘ ⇧ M` | microfone | |
| `Ctrl/⌘ ⇧ D` | entrar e sair da chamada | |
| `Ctrl/⌘ ⇧ A` | ensurdecer — cala tudo, inclusive você | **novo** |
| `Ctrl/⌘ ⇧ V` | câmera | **novo** |
| `Ctrl/⌘ ⇧ E` | compartilhar tela | **novo** |

A referência usa `Ctrl ⇧ D` para ensurdecer; aqui `D` já era entrar e sair da
chamada desde a fase 4, e trocar o significado de um atalho existente custa mais
do que ganha. Ensurdecer ficou em `A`.

### Diversos

| Tecla | Ação |
|---|---|
| `?` | lista de atalhos |
| `⇧ F10` | menu de contexto do que estiver em foco |

`Ctrl/⌘ K` é o único que precisa estar visível na interface — uma dica discreta
no campo de busca. Os demais moram na tela de ajuda, que `?` abre.

### O que o navegador não deixa

Combinação que o navegador toma para si não é atalho, é armadilha. Ficaram de
fora por isso, e a tela de ajuda não as menciona:

`Ctrl ⇧ C`, `Ctrl ⇧ I`, `Ctrl ⇧ J` (ferramentas de desenvolvedor), `Ctrl ⇧ S`
(captura no Firefox), `Ctrl ⇧ N` e `Ctrl ⇧ P` (janela anônima), `Ctrl W`,
`Ctrl T`, `Ctrl N`.

No aplicativo de mesa (fase 8) várias se libertam. **Não aproveite isso.** Um
atalho que existe no Tauri e não no navegador é uma diferença que a pessoa
descobre errando.

### O que foi recusado da referência

| Atalho | Motivo |
|---|---|
| navegar entre servidores, criar servidor | existe um servidor, e é este |
| encaminhar mensagem | não há para onde encaminhar |
| ler mensagem em voz alta | fora de escopo |
| seletor de GIF, de figurinha | não existem |
| `Esc` marca o canal como lido | `Esc` já fecha painel e cancela edição; empilhar uma ação destrutiva de estado numa tecla de "cancelar" é como se perde mensagem sem querer |
| painel de som | não existe |
| atender e recusar chamada | ninguém liga para ninguém: entra-se num canal (fase 10 reabre isto para as diretas) |

---

## Acessibilidade

- `role="navigation"` no rail e na coluna de canais, com `aria-label` distinto.
- `role="log"` e `aria-live="polite"` no histórico. Não `assertive`: mensagem
  nova não deve interromper quem está lendo outra coisa.
- Ordem de tabulação segue a ordem visual das colunas.
- Um link "pular para o compositor" como primeiro elemento focável.
- Nome de canal não usa só cor para indicar não lido; usa peso 600 e o ponto.
- Contraste mínimo AA na interface, AAA no corpo das mensagens.
