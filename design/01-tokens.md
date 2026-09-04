# Tokens

Arquivo real: `packages/web/src/styles/tokens.css`, importado uma vez em
`main.tsx` antes de qualquer outro CSS.

**Nenhum valor literal de cor, espaço, raio ou duração fora deste arquivo.** Se
você escreveu `#5C9CE6` ou `12px` num componente, existe um token faltando ou
sendo ignorado.

---

## Cor

```css
:root {
  /* base — frio, o registro */
  --slate-abyss:   #0E1419;
  --slate-deep:    #151F26;
  --slate-mid:     #1D2A33;
  --slate-high:    #24333D;
  --slate-line:    #26353F;
  --slate-line-soft: #1E2C35;

  /* texto */
  --porcelain:     #E6EDF1;
  --porcelain-dim: #8497A3;
  --porcelain-faint: #5A6B77;

  /* interação — frio */
  --cobalt:        #5C9CE6;
  --cobalt-hover:  #7BB0EC;
  --cobalt-press:  #4A87CE;
  --cobalt-wash:   rgba(92, 156, 230, 0.12);

  /* presença ao vivo — quente. só isso. */
  --ember:         #E4A24A;
  --ember-soft:    #C98A38;
  --ember-wash:    rgba(228, 162, 74, 0.10);
  --ember-glow:    rgba(228, 162, 74, 0.22);

  /* destrutivo */
  --rust:          #DE5D52;
  --rust-hover:    #E8746A;
  --rust-wash:     rgba(222, 93, 82, 0.12);

  /* status de presença */
  --status-online:  #4FB477;
  --status-idle:    #D8A64A;
  --status-busy:    #DE5D52;
  --status-offline: #4A5A66;
}
```

### Papéis semânticos

Componente nunca usa a paleta bruta. Usa isto:

```css
:root {
  --bg-app:        var(--slate-abyss);
  --bg-panel:      var(--slate-deep);
  --bg-raised:     var(--slate-mid);
  --bg-hover:      rgba(255, 255, 255, 0.035);
  --bg-active:     rgba(255, 255, 255, 0.06);
  --bg-selected:   var(--cobalt-wash);

  /* superfície viva: onde a pessoa age agora. desloca 3° para o quente. */
  --bg-live:       #1A2229;

  --text-primary:   var(--porcelain);
  --text-secondary: var(--porcelain-dim);
  --text-tertiary:  var(--porcelain-faint);
  --text-on-accent: #0B1116;

  --border:        var(--slate-line);
  --border-soft:   var(--slate-line-soft);
  --border-strong: #33454F;

  --accent:        var(--cobalt);
  --live:          var(--ember);
  --danger:        var(--rust);

  --focus-ring:    0 0 0 2px var(--bg-app), 0 0 0 4px var(--cobalt);
}
```

`--bg-live` é a superfície do compositor e do painel do elenco. A diferença com
`--bg-panel` é sutil de propósito: ela não é para ser notada conscientemente, é
para fazer a parte de baixo da tela parecer mais próxima.

### Tema claro

```css
[data-theme='light'] {
  --bg-app:      #EDF1F3;
  --bg-panel:    #E3E9EC;
  --bg-raised:   #FFFFFF;
  --bg-live:     #F2F0EC;          /* desloca para o quente, como no escuro */
  --bg-hover:    rgba(14, 20, 25, 0.04);
  --bg-active:   rgba(14, 20, 25, 0.07);

  --text-primary:   #16212A;
  --text-secondary: #4E626F;
  --text-tertiary:  #7B8D99;
  --text-on-accent: #FFFFFF;

  --border:        #C9D4DA;
  --border-soft:   #DAE2E6;
  --border-strong: #AFBEC7;

  --accent: #2C6FBF;               /* escurecido: contraste sobre claro */
  --live:   #A96A15;
  --danger: #B93A30;
}
```

A troca não é inversão. A base clara é um cinza-papel frio e `--bg-live`
continua deslocando para o quente — a regra sobrevive nos dois temas.

Guarde a preferência em cookie, não `localStorage`, para o servidor renderizar
o atributo certo e não haver piscada branca no carregamento.

### Cor de cargo

Cargo tem cor livre escolhida por quem administra, o que cria um risco de
contraste. Ao renderizar, calcule a luminância relativa e, se o contraste contra
`--bg-panel` for menor que 4.5:1, clareie a cor até atingir. Guarde o valor
original no banco; ajuste só na exibição.

---

## Tipografia

```css
:root {
  --font-ui:    'Instrument Sans', system-ui, -apple-system, sans-serif;
  --font-read:  'Source Serif 4', Georgia, serif;
  --font-mono:  'JetBrains Mono', ui-monospace, monospace;

  --text-meta:    0.6875rem;   /* 11px  horário no gutter */
  --text-label:   0.8125rem;   /* 13px  rótulo de interface */
  --text-ui:      0.9375rem;   /* 15px  padrão da interface */
  --text-body:    0.96875rem;  /* 15.5px corpo de mensagem */
  --text-section: 1.125rem;    /* 18px */
  --text-title:   1.375rem;    /* 22px */
  --text-display: 1.875rem;    /* 30px  só em autenticação */

  --leading-tight: 1.25;
  --leading-ui:    1.4;
  --leading-read:  1.62;       /* serifa pede mais respiro */

  --weight-normal: 400;
  --weight-medium: 500;
  --weight-semi:   600;

  --measure: 72ch;             /* largura máxima do corpo de mensagem */
}
```

Carregue as fontes com `font-display: swap` e pré-carregue apenas os pesos que
aparecem acima da dobra: Instrument Sans 400 e 500, Source Serif 4 400.

Source Serif 4 tem eixo óptico variável. Use `font-optical-sizing: auto` — ela
ajusta o contraste dos traços no tamanho pequeno e ganha legibilidade de graça.

Ative ligaduras e números tabulares onde há coluna de números:

```css
.timestamp { font-variant-numeric: tabular-nums; }
```

---

## Espaço

Escala de 4px. Não invente valores intermediários.

```css
:root {
  --s-1: 0.25rem;   /*  4px */
  --s-2: 0.5rem;    /*  8px */
  --s-3: 0.75rem;   /* 12px */
  --s-4: 1rem;      /* 16px */
  --s-5: 1.5rem;    /* 24px */
  --s-6: 2rem;      /* 32px */
  --s-7: 3rem;      /* 48px */
  --s-8: 4rem;      /* 64px */

  /* medidas do layout */
  --rail-w:      56px;
  --sidebar-w:   232px;
  --panel-w:     320px;
  --cast-h:      88px;    /* faixa do elenco */
  --header-h:    48px;
  --gutter-w:    62px;    /* coluna do horário nas mensagens */
}
```

---

## Raio

O raio varia por função. Um raio único em tudo é o tique número quatro da lista
de defaults.

```css
:root {
  --r-field:  2px;    /* campo de entrada: quase reto, sinaliza "escreva aqui" */
  --r-control: 4px;   /* botão, chip, item de menu */
  --r-surface: 6px;   /* diálogo, popover, cartão de perfil */
  --r-media:  8px;    /* prévia de imagem, vídeo */
  --r-full:   999px;  /* avatar, indicador de status */
}
```

---

## Elevação

Sombra existe apenas em elemento que flutua sobre outro. Nunca sob bloco estático.

```css
:root {
  --shadow-pop:   0 4px 16px rgba(0, 0, 0, 0.36);   /* menu, tooltip */
  --shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.48);  /* diálogo */
}
```

Duas sombras no projeto inteiro. Se você precisou de uma terceira, provavelmente
está empilhando camadas demais.

Separação entre painéis é feita com `border`, não com sombra.

---

## Movimento

```css
:root {
  --dur-instant: 80ms;    /* estado de botão */
  --dur-quick:   140ms;   /* abrir menu, hover */
  --dur-normal:  220ms;   /* painel, diálogo */
  --dur-slow:    400ms;   /* saída do destaque de fala */

  --ease-out:  cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

A assimetria entre `--dur-quick` para entrar e `--dur-slow` para sair vale
sobretudo no indicador de fala: entrar rápido acompanha a voz, sair devagar evita
o efeito estroboscópico de quem fala com pausas curtas.

---

## Foco

```css
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--r-control);
}
```

`:focus-visible`, nunca `:focus` — senão o anel aparece em clique de mouse. E
jamais `outline: none` sem substituto; navegar por teclado precisa funcionar.

---

## Ícones

Lucide, traço de 1.5px, tamanhos 16 / 18 / 20. `currentColor` sempre, nunca cor
fixa. Emoji nunca faz papel de ícone de interface — só aparece como reação ou
dentro do texto que a pessoa escreveu.

---

## Utilitário

```css
.visually-hidden {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}
```
