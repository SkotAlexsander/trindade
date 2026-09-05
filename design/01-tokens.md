# Tokens

Arquivo real: `packages/web/src/styles/tokens.css`, importado uma vez em
`main.tsx` antes de qualquer outro CSS.

**Nenhum valor literal de cor, espaço, raio ou duração fora deste arquivo.** Se
você escreveu `#22D3EE` ou `12px` num componente, existe um token faltando ou
sendo ignorado.

> **Revisão de 4 de setembro de 2026.** Reescrito junto com
> `00-direcao-visual.md` na troca para a direção de interface de comando. A
> estrutura de papéis semânticos, a escala de espaço, o raio por função e a
> escala de movimento não mudaram — só a paleta, a tipografia e os dois grupos
> novos: brilho e chanfro.

---

## Contraste, medido

Os valores da paleta foram ajustados até passarem em AA (4.5:1) sobre as três
superfícies, nos dois temas. Não foram escolhidos no olho.

| token | escuro: app / painel / elevado | claro: app / painel / elevado |
|---|---|---|
| `--text-primary`   | 17.9 · 17.2 · 15.4 | 16.1 · 14.9 · 17.9 |
| `--text-secondary` |  9.3 ·  9.0 ·  8.1 |  5.9 ·  5.5 ·  6.6 |
| `--text-tertiary`  |  5.6 ·  5.4 ·  4.8 |  5.0 ·  4.6 ·  5.5 |
| `--accent`         | 11.1 · 10.8 ·  9.6 |  5.1 ·  4.7 ·  5.7 |
| `--live`           |  8.2 ·  7.9 ·  7.1 |  5.7 ·  5.3 ·  6.3 |
| `--danger`         |  6.5 ·  6.3 ·  5.6 |  5.1 ·  4.8 ·  5.7 |
| `--status-offline` |  5.4 ·  5.2 ·  4.7 |  5.0 ·  4.7 ·  5.6 |

`--mark-wash` é fundo, não texto, então entra por outra conta: o que foi medido
é `--text-primary` **sobre o destaque composto**, que é onde o trecho achado
pela busca é lido. Dá 11,8 · 11,1 · 9,6 no escuro e 12,7 · 12,0 · 13,9 no
claro — o realce não custa legibilidade em nenhuma superfície.

Ao mexer em qualquer cor, refaça a conta. Três valores desta tabela só passaram
depois de serem escurecidos ou clareados de propósito.

---

## O arquivo

Abaixo, o conteúdo real. Não edite este documento à mão: edite o CSS e regenere.

```css
/* Tokens de design/01-tokens.md.
 *
 * Nenhum valor literal de cor, espaço, raio ou duração fora deste arquivo. Se
 * você escreveu #22D3EE ou 12px num componente, existe um token faltando ou
 * sendo ignorado. */

:root {
  /* base — quase preto com azul real, nunca cinza neutro */
  --void: #05070e;
  --abyss: #080d18;
  --deep: #0b1120;
  --mid: #101a2e;
  --high: #16233c;

  /* contornos: linha fina de ciano com pouca opacidade, não cinza */
  --line: rgba(34, 211, 238, 0.14);
  --line-soft: rgba(34, 211, 238, 0.07);
  --line-strong: rgba(34, 211, 238, 0.34);

  /* texto */
  --ice: #e8f3fa;
  --ice-dim: #9db3ca;
  --ice-faint: #7189a4;

  /* interação — ciano */
  --cyan: #22d3ee;
  --cyan-hover: #67e8f9;
  --cyan-press: #06b6d4;
  --cyan-wash: rgba(34, 211, 238, 0.12);
  --cyan-glow: rgba(34, 211, 238, 0.4);

  /* presença ao vivo — magenta. só isso. */
  --magenta: #e879f9;
  --magenta-soft: #c026d3;
  --magenta-wash: rgba(232, 121, 249, 0.1);
  --magenta-glow: rgba(232, 121, 249, 0.36);

  /* destrutivo */
  --crimson: #fb5a68;
  --crimson-hover: #ff7b86;
  --crimson-wash: rgba(251, 90, 104, 0.13);

  /* status de presença */
  --status-online: #34d97f;
  --status-idle: #f5b83d;
  --status-busy: #fb5a68;
  /* Claro o bastante para o texto "offline" passar em AA sobre as três
     superfícies. O valor foi medido, não escolhido no olho. */
  --status-offline: #6c87a4;

  /* --- papéis semânticos --------------------------------------------------
     Componente nunca usa a paleta bruta. Usa isto. */

  --bg-app: var(--void);
  --bg-panel: var(--abyss);
  --bg-raised: var(--mid);
  --bg-hover: rgba(34, 211, 238, 0.06);
  --bg-active: rgba(34, 211, 238, 0.1);
  --bg-selected: var(--cyan-wash);

  /* superfície viva: onde a pessoa age agora */
  --bg-live: var(--deep);

  /* Superfície **rebaixada**: trilho de interruptor, caixa de link, moldura de
     mídia, chip. Mais escura que aquilo em que se apoia, é o que faz parecer
     escavada em vez de colada. Existia sem nome — onze lugares escreviam
     `var(--bg-base)`, que nunca foi definido, e por isso ficavam transparentes. */
  --bg-inset: var(--void);

  /* O topo da pilha de superfícies. Estava na paleta e sem papel: é a cor de
     quem flutua acima de um diálogo — item de menu em foco, cartão arrastado. */
  --bg-float: var(--high);

  --text-primary: var(--ice);
  --text-secondary: var(--ice-dim);
  --text-tertiary: var(--ice-faint);
  --text-on-accent: #03080f;

  --border: var(--line);
  --border-soft: var(--line-soft);
  --border-strong: var(--line-strong);

  --accent: var(--cyan);
  --live: var(--magenta);
  --danger: var(--crimson);

  /* Destaque de termo encontrado na busca. Existe como token próprio porque
     ciano é comando e magenta é presença ao vivo: o trecho achado não é nem um
     nem outro, e pintá-lo com qualquer um dos dois desmancha a regra. É o
     único âmbar da interface fora dos pontos de status. */
  --mark-wash: rgba(245, 184, 61, 0.22);
  --mark-line: rgba(245, 184, 61, 0.55);

  --focus-ring: 0 0 0 2px var(--bg-app), 0 0 0 4px var(--cyan);

  /* --- bloco de código ----------------------------------------------------
     O bloco de código é superfície de terminal e **não acompanha o tema**. O
     realce vem de um tema escuro do Shiki; clarear o fundo exigiria carregar
     um segundo tema inteiro para ganhar pouco, e um bloco escuro sobre papel
     é convenção antiga o bastante para não surpreender ninguém. Sem estes
     tokens, `--text-primary` no tema claro pinta texto quase preto sobre
     fundo quase preto. */

  --code-bg: var(--abyss);
  --code-ink: var(--ice);
  --code-line: rgba(34, 211, 238, 0.12);

  /* Cor da marca. Ciano no escuro, preto no claro: no fundo quase preto o
     ciano é a assinatura; sobre papel a mesma cor perde presença e a versão
     preta lê melhor. Um token para a regra viver num lugar só. */
  --brand-ink: var(--accent);

  /* --- sobre mídia --------------------------------------------------------
     Estes **não** acompanham o tema, e é de propósito: uma foto é a mesma foto
     no claro e no escuro, e um horário branco sobre a imagem continua branco
     porque quem está atrás dele é a imagem, não a interface.

     Eram vinte e poucos literais espalhados por `anexos`, `grade`, `flutuante`
     e `perfil` — `#fff` e `rgba(0,0,0,...)` escritos à mão, cada um com uma
     opacidade ligeiramente diferente da do vizinho. */

  --media-ink: #ffffff;
  /* Véu curto no pé da imagem, para a legenda ter contraste. */
  --media-scrim: rgba(0, 0, 0, 0.6);
  /* O fundo do visualizador em tela cheia: quase opaco, para a imagem ser a
     única coisa na tela. */
  --media-veil: rgba(0, 0, 0, 0.86);
  --media-control: rgba(255, 255, 255, 0.1);
  --media-control-hover: rgba(255, 255, 255, 0.2);

  /* --- brilho -------------------------------------------------------------
     O brilho é o que dá o caráter da interface, e por isso é medido: três
     intensidades e nada mais. Espalhar brilho em tudo faz a tela virar sopa. */

  --glow-edge: 0 0 0 1px var(--line-strong), 0 0 12px -2px var(--cyan-glow);
  --glow-accent: 0 0 16px -4px var(--cyan-glow);
  --glow-live: 0 0 18px -4px var(--magenta-glow);

  /* --- chanfro ------------------------------------------------------------
     O canto cortado dos painéis. Um valor só: chanfro variando por componente
     vira ruído. */

  --chamfer: 12px;
  --chamfer-sm: 7px;

  /* --- tipografia --------------------------------------------------------- */

  --font-ui: 'Instrument Sans', system-ui, -apple-system, sans-serif;
  --font-read: 'Instrument Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --text-meta: 0.6875rem; /* 11px  horário no gutter */
  --text-label: 0.8125rem; /* 13px  rótulo de interface */
  --text-ui: 0.9375rem; /* 15px  padrão da interface */
  --text-body: 0.96875rem; /* 15.5px corpo de mensagem */
  --text-section: 1.125rem; /* 18px */
  --text-title: 1.375rem; /* 22px */
  --text-display: 1.875rem; /* 30px  só em autenticação */

  --leading-tight: 1.25;
  --leading-ui: 1.4;
  --leading-read: 1.55;

  --weight-normal: 400;
  --weight-medium: 500;
  --weight-semi: 600;

  /* Caixa alta espaçada nos rótulos de seção — parte da assinatura desta
     direção. Vive aqui para não virar literal espalhado. */
  --tracking-label: 0.12em;

  --measure: 72ch;

  /* --- espaço — escala de 4px, sem valores intermediários ------------------ */

  --s-1: 0.25rem;
  --s-2: 0.5rem;
  --s-3: 0.75rem;
  --s-4: 1rem;
  --s-5: 1.5rem;
  --s-6: 2rem;
  --s-7: 3rem;
  --s-8: 4rem;

  /* medidas do layout */
  --rail-w: 56px;
  --rail-item: 32px;
  --sidebar-w: 232px;
  --panel-w: 320px;
  --cast-h: 88px;
  --header-h: 48px;
  --gutter-w: 62px;

  /* --- raio — varia por função -------------------------------------------- */

  --r-field: 2px; /* campo de entrada: quase reto, sinaliza "escreva aqui" */
  --r-control: 4px; /* botão, chip, item de menu */
  --r-surface: 6px; /* diálogo, popover, cartão de perfil */
  --r-media: 8px; /* prévia de imagem, vídeo */
  --r-full: 999px; /* avatar, indicador de status */

  /* --- elevação ------------------------------------------------------------
     Sombra só em elemento que flutua sobre outro. Nunca sob bloco estático.

     Num fundo quase preto a sombra sozinha quase não trabalha — não há sobre o
     que projetar. A profundidade aqui vem de **luz de borda**: uma linha clara
     de 1px no topo, como se a fonte de luz estivesse acima, e o escuro fechando
     embaixo. É a mesma física que faz um botão físico parecer botão.

     Cada degrau é um par: sombra de **contato** (curta, densa, logo abaixo) e
     sombra **ambiente** (larga, difusa). Uma sombra só, com um blur médio,
     é o que faz interface parecer adesivo colado na tela.

     Isto não é uma quarta intensidade de brilho — brilho continua sendo três,
     e continua sendo cor. Luz de borda é valor, não cor, e some no tema claro,
     onde a sombra passa a ter sobre o que cair. */

  --luz-topo: inset 0 1px 0 rgba(232, 243, 250, 0.07);
  --luz-topo-forte: inset 0 1px 0 rgba(232, 243, 250, 0.12);

  /* Rebaixado: a luz vem de dentro para baixo, e o escuro fecha em cima. */
  --e-inset:
    inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 0 rgba(232, 243, 250, 0.04);

  /* Preenchido com cor saturada — botão primário, destrutivo, distintivo.
     Aqui a luz de borda de 7% some: sobre ciano claro ela não desenha nada. O
     que dá relevo a uma superfície clara é o **contrário** — uma aresta viva
     em cima e uma sombra fechando embaixo, dentro da própria cor. */
  --e-cheio:
    inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(0, 0, 0, 0.2),
    0 1px 2px rgba(0, 0, 0, 0.4), 0 2px 8px -2px rgba(0, 0, 0, 0.3);

  /* Apoiado na superfície de baixo: cartão, faixa, painel de conteúdo. */
  --e-raised:
    var(--luz-topo), 0 1px 2px rgba(0, 0, 0, 0.4), 0 2px 8px -2px rgba(0, 0, 0, 0.3);

  /* Solto sobre o conteúdo: popover, menu, dica. */
  --e-pop:
    var(--luz-topo-forte), 0 2px 4px rgba(0, 0, 0, 0.4), 0 12px 28px -6px rgba(0, 0, 0, 0.55);

  /* Diálogo: a página inteira ficou atrás. */
  --e-modal:
    var(--luz-topo-forte), 0 4px 8px rgba(0, 0, 0, 0.45), 0 24px 64px -12px rgba(0, 0, 0, 0.7);

  /* Na mão: janela flutuante, cartão sendo arrastado. Sombra mais longa porque
     está mais alto. */
  --e-float:
    var(--luz-topo-forte), 0 6px 12px rgba(0, 0, 0, 0.45), 0 32px 72px -16px rgba(0, 0, 0, 0.75);

  /* Direções que a escada não cobre.

     Uma coluna de altura inteira não tem "embaixo": ela projeta para o lado.
     Um rodapé fixo projeta para cima, contra o que rola por trás dele. E o
     que está sendo arrastado está mais alto que qualquer coisa parada. Os
     três são casos de direção, não de altura — por isso nome próprio em vez
     de mais um degrau. */
  /* A linha escura de 1px sob uma barra apoiada. Não é borda: borda divide,
     esta fecha o degrau que a luz do topo abriu. */
  --sombra-linha: rgba(0, 0, 0, 0.35);
  --e-coluna: 6px 0 24px -12px rgba(0, 0, 0, 0.8);
  --e-rodape: 0 -6px 20px -8px rgba(0, 0, 0, 0.7);
  --e-arrasto: 0 40px 80px -20px rgba(0, 0, 0, 0.8);

  /* Os dois nomes antigos continuam, apontando para os degraus novos: eram
     usados em dezenas de lugares, e trocar tudo de uma vez é como se perde a
     capacidade de dizer o que mudou. */
  --shadow-pop: var(--e-pop);
  --shadow-modal: var(--e-modal);

  /* Desfoque atrás do que flutua. Separa a camada do que está embaixo sem
     escurecer nada — e sem ele, um menu sobre uma conversa densa fica difícil
     de ler mesmo com sombra. */
  --blur-pop: blur(12px) saturate(1.1);
  --blur-veil: blur(3px);

  /* --- movimento ---------------------------------------------------------- */

  --dur-instant: 80ms;
  --dur-quick: 140ms;
  --dur-normal: 220ms;
  --dur-slow: 400ms;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  /* --- medidas próprias das telas de autenticação -------------------------- */

  --auth-col-w: 400px;
  --auth-top: 20vh;
  --field-h: 44px;
  --code-box: 48px;

  /* --- primitivos ---------------------------------------------------------- */

  --control-h-sm: 28px;
  --control-h-md: 36px;

  --avatar-xs: 20px;
  --avatar-sm: 24px;
  --avatar-md: 32px;
  --avatar-lg: 40px;
  --avatar-xl: 64px;
  --avatar-ring: 2px;

  --menu-w: 200px;
  --toast-w: 320px;
  --veil: rgba(2, 4, 10, 0.72);

  /* camadas. Uma escala só, para não haver disputa de z-index entre
     componentes que nunca se viram. */
  --z-popover: 100;
  --z-menu: 200;
  --z-tooltip: 300;
  --z-modal: 400;
  --z-toast: 500;
}

/* --- tema claro -----------------------------------------------------------
 *
 * Não é inversão. O neon vira tinta sobre papel frio: os acentos escurecem o
 * bastante para manter contraste, o brilho quase some — brilho sobre branco
 * lê como borrão, não como luz — e o chanfro permanece, porque a forma é o
 * que sobrevive à troca de tema. */

[data-theme='light'] {
  --bg-app: #eef3f7;
  --bg-panel: #e4ebf1;
  --bg-raised: #ffffff;
  --bg-live: #f3f7fa;
  --bg-hover: rgba(6, 24, 44, 0.05);
  --bg-active: rgba(6, 24, 44, 0.09);
  --bg-selected: rgba(8, 145, 178, 0.12);

  --text-primary: #0a1826;
  --text-secondary: #44607a;
  --text-tertiary: #536b81;
  --text-on-accent: #ffffff;

  --border: rgba(8, 145, 178, 0.26);
  --border-soft: rgba(8, 145, 178, 0.14);
  --border-strong: rgba(8, 145, 178, 0.5);

  --accent: #0e708b;
  --live: #a21caf;
  --danger: #be2f3c;

  --mark-wash: rgba(214, 138, 8, 0.26);
  --mark-line: rgba(161, 98, 7, 0.6);

  --cyan-hover: #0891b2;
  --cyan-press: #155e75;
  --cyan-wash: rgba(14, 116, 144, 0.1);
  --crimson-hover: #9f1f2b;
  --magenta-wash: rgba(162, 28, 175, 0.09);

  --status-offline: #536a7e;

  --brand-ink: var(--text-primary);

  --glow-edge: 0 0 0 1px var(--border-strong);
  --glow-accent: none;
  --glow-live: none;

  /* Sobre papel a sombra volta a ter sobre o que cair, e é ela que carrega a
     profundidade: a luz de borda vira quase nada, porque uma linha branca
     sobre branco não desenha aresta nenhuma. O par contato + ambiente
     permanece — é ele que separa "apoiado" de "flutuando". */
  --luz-topo: inset 0 1px 0 rgba(255, 255, 255, 0.6);
  --luz-topo-forte: inset 0 1px 0 rgba(255, 255, 255, 0.85);

  --e-inset:
    inset 0 1px 2px rgba(10, 24, 38, 0.1), inset 0 -1px 0 rgba(255, 255, 255, 0.5);
  --e-cheio:
    inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -1px 0 rgba(0, 0, 0, 0.14),
    0 1px 2px rgba(10, 24, 38, 0.12), 0 2px 8px -2px rgba(10, 24, 38, 0.14);
  --e-raised:
    var(--luz-topo), 0 1px 2px rgba(10, 24, 38, 0.07), 0 2px 8px -2px rgba(10, 24, 38, 0.08);
  --e-pop:
    var(--luz-topo-forte), 0 2px 4px rgba(10, 24, 38, 0.08), 0 12px 28px -6px rgba(10, 24, 38, 0.16);
  --e-modal:
    var(--luz-topo-forte), 0 4px 8px rgba(10, 24, 38, 0.1), 0 24px 64px -12px rgba(10, 24, 38, 0.2);
  --e-float:
    var(--luz-topo-forte), 0 6px 12px rgba(10, 24, 38, 0.12), 0 32px 72px -16px rgba(10, 24, 38, 0.24);

  --sombra-linha: rgba(10, 24, 38, 0.08);
  --e-coluna: 6px 0 24px -12px rgba(10, 24, 38, 0.16);
  --e-rodape: 0 -6px 20px -8px rgba(10, 24, 38, 0.12);
  --e-arrasto: 0 40px 80px -20px rgba(10, 24, 38, 0.24);

  --shadow-pop: var(--e-pop);
  --shadow-modal: var(--e-modal);

  /* No claro o rebaixado é papel um tom mais frio que a superfície, não um
     buraco preto: `--bg-app` já é o papel de baixo. */
  --bg-inset: #dfe7ee;
  --bg-float: #ffffff;

  --veil: rgba(10, 24, 38, 0.4);
}

/* :focus-visible, nunca :focus — senão o anel aparece em clique de mouse. */
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--r-control);
}

/* Painel com canto cortado. Aplicado por classe, não por componente, para o
   chanfro ser o mesmo em toda a interface. */
.chamfer {
  clip-path: polygon(
    var(--chamfer) 0,
    100% 0,
    100% calc(100% - var(--chamfer)),
    calc(100% - var(--chamfer)) 100%,
    0 100%,
    0 var(--chamfer)
  );
}

.chamfer-sm {
  clip-path: polygon(
    var(--chamfer-sm) 0,
    100% 0,
    100% calc(100% - var(--chamfer-sm)),
    calc(100% - var(--chamfer-sm)) 100%,
    0 100%,
    0 var(--chamfer-sm)
  );
}

/* Rótulo de seção: caixa alta espaçada, 11px, peso 500. */
.section-label {
  font-size: var(--text-meta);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--text-secondary);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Profundidade

> Acrescentada em 5 de setembro de 2026, a pedido do dono do projeto: "quero
> mais profundidade, efeitos e melhorar a proporção das coisas".

Num fundo quase preto a sombra sozinha quase não trabalha — não há sobre o que
projetar. A profundidade aqui vem de **luz de borda**: uma linha clara de 1px no
topo, como se a fonte de luz estivesse acima, e o escuro fechando embaixo. É a
mesma física que faz um botão físico parecer um botão.

Cada degrau é um **par**: sombra de contato (curta, densa, logo abaixo) e sombra
ambiente (larga, difusa). Uma sombra só, com um blur médio, é o que faz interface
parecer adesivo colado na tela.

| Degrau | Onde |
|---|---|
| `--e-inset` | escavado: campo, trilho do interruptor, moldura de mídia, esqueleto |
| `--e-cheio` | preenchido com cor saturada: botão primário, destrutivo |
| `--e-raised` | apoiado: cartão, enquete, compositor, botão secundário |
| `--e-pop` | solto sobre o conteúdo: popover, menu, dica, cartão de perfil |
| `--e-modal` | diálogo e paleta de comandos |
| `--e-float` | na mão: janela flutuante da chamada, toast |

Mais três de **direção**, que a escada não cobre: `--e-coluna` (uma coluna de
altura inteira projeta para o lado, não para baixo), `--e-rodape` (o painel do
elenco projeta para cima, contra o que rola atrás) e `--e-arrasto` (o que está
sendo arrastado está mais alto que qualquer coisa parada).

**Isto não é uma quarta intensidade de brilho.** Brilho continua sendo três, e
continua sendo **cor** — a assinatura ciano e magenta da direção visual. Luz de
borda é **valor**, e some no tema claro, onde a sombra passa a ter sobre o que
cair. As duas coisas se somam no mesmo `box-shadow` sem competir: o botão
primário tem `--glow-accent` e `--e-cheio` juntos, e cada um faz um trabalho.

O que **não** mudou: nada estático ganhou sombra. Cartão dentro da conversa é
`--e-raised` porque ele se apoia; parágrafo, divisória e rótulo continuam sem
nada.

### Desfoque

`--blur-pop` atrás de menu e popover, `--blur-veil` atrás do véu de diálogo e da
paleta. Não é enfeite: um menu de 200px sobre uma conversa densa compete com o
texto que passa por baixo, e sombra sozinha não resolve isso. Onde o navegador
não suporta `backdrop-filter`, o fundo continua opaco e nada se perde — a regra
está num `@supports`.

---

## Sobre mídia

`--media-ink`, `--media-scrim`, `--media-veil`, `--media-control`. Estes **não**
acompanham o tema, e é de propósito: uma foto é a mesma foto no claro e no
escuro, e um horário branco sobre a imagem continua branco porque quem está
atrás dele é a imagem, não a interface.

Eram vinte e poucos literais espalhados por quatro arquivos — `#fff` e
`rgba(0,0,0,…)` escritos à mão, cada um com uma opacidade ligeiramente diferente
da do vizinho.

---

## O teste que fecha a porta

`packages/web/test/tokens.test.ts` percorre todo o CSS e falha se:

1. alguma `var(--x)` apontar para um token que não existe, sem valor de reserva;
2. sobrar literal de cor fora deste arquivo.

O primeiro item nasceu de um apagão silencioso. Seis arquivos usavam
`--weight-regular`, `--weight-semibold`, `--bg-base` e `--dur-fast`, que nunca
existiram — os nomes certos são `--weight-normal`, `--weight-semi`, `--bg-inset`
e `--dur-quick`. Eram **64 usos**.

O que torna isso pior que um erro comum é o silêncio: uma `var()` que não resolve
deixa a declaração inválida no tempo de cálculo, e a propriedade cai para o valor
herdado. Como quase todas estavam num `font:` abreviado — e `font` é herdada —,
meia dúzia de telas simplesmente usava a tipografia do elemento pai. Nenhum erro
no console, nenhum aviso do compilador, nenhuma tela obviamente quebrada: só
tamanhos errados que ninguém sabia que estavam errados.

Por isso o `font:` abreviado saiu de todo lugar: agora são `font-family`,
`font-size`, `font-weight` e `line-height` separados. Um token errado apaga uma
linha, não a tipografia inteira do bloco.

---

## Cor de cargo

Cargo tem cor livre escolhida por quem administra, o que cria um risco de
contraste. Ao renderizar, calcule a luminância relativa e, se o contraste contra
o fundo for menor que 4.5:1, clareie a cor até atingir. Guarde o valor original
no banco; ajuste só na exibição.

A função está em `packages/web/src/lib/contraste.ts` — `ensureContrast`.

---

## Fontes

Locais em `public/fonts/`, nunca CDN. Fonte de terceiro é uma requisição para
fora que entrega o IP de quem lê a cada carregamento, o que seria incoerente num
produto que força relay no WebRTC para esconder exatamente isso.

Só os subconjuntos `latin` e `latin-ext`, em woff2 variável — um arquivo cobre
toda a faixa de peso. As licenças estão em `public/fonts/LICENCAS.md`.

Pré-carregue apenas o que aparece acima da dobra: Instrument Sans latin.

---

## Ícones

Lucide, traço de 1.5px, tamanhos 16 / 18 / 20. `currentColor` sempre, nunca cor
fixa. Emoji nunca faz papel de ícone de interface — só aparece como reação ou
dentro do texto que a pessoa escreveu.
