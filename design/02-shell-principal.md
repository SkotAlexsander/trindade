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

| Tecla | Ação |
|---|---|
| `Ctrl/⌘ K` | paleta de comandos |
| `Ctrl/⌘ F` | buscar no canal |
| `Alt ↑` / `Alt ↓` | canal anterior / próximo |
| `Alt ⇧ ↑` / `Alt ⇧ ↓` | canal não lido anterior / próximo |
| `Esc` | fechar painel, cancelar edição, limpar resposta |
| `Ctrl/⌘ ⇧ M` | ligar e desligar microfone |
| `Ctrl/⌘ ⇧ D` | entrar e sair da chamada |
| `⇧ Esc` | marcar tudo como lido |
| `?` | lista de atalhos |

`Ctrl/⌘ K` é o único que precisa estar visível na interface — uma dica discreta
no campo de busca. Os demais moram na tela de ajuda.

---

## Acessibilidade

- `role="navigation"` no rail e na coluna de canais, com `aria-label` distinto.
- `role="log"` e `aria-live="polite"` no histórico. Não `assertive`: mensagem
  nova não deve interromper quem está lendo outra coisa.
- Ordem de tabulação segue a ordem visual das colunas.
- Um link "pular para o compositor" como primeiro elemento focável.
- Nome de canal não usa só cor para indicar não lido; usa peso 600 e o ponto.
- Contraste mínimo AA na interface, AAA no corpo das mensagens.
