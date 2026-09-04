# Fase 3 — Design system

Tokens, primitivos e tema. Nenhuma tela de produto ainda — o objetivo é a base
que as fases 4 a 7 vão consumir.

Leia antes: `design/00-direcao-visual.md` inteiro, depois `design/01-tokens.md`.

O arquivo de direção visual explica **por que** os tokens são o que são. Sem ele,
as decisões parecem arbitrárias e você vai ser tentado a "melhorar" coisas que
foram escolhidas de propósito.

## Entregar

### `styles/tokens.css`

Exatamente os valores de `design/01-tokens.md`, incluindo o tema claro em
`[data-theme='light']`. Importado uma vez em `main.tsx`, antes de tudo.

### `styles/globals.css`

Reset moderno (box-sizing, margens, `text-size-adjust`), `@font-face` das três
famílias com `font-display: swap`, `font-optical-sizing: auto` na Source Serif 4,
regra de `:focus-visible` e o bloco de `prefers-reduced-motion`.

Fontes locais em `public/fonts/`, não de CDN. Fonte de terceiro é requisição para
fora que entrega o IP de quem lê a cada carregamento — incoerente com o resto do
produto.

### Primitivos em `components/`

Cada um com CSS Module próprio. Todos com `forwardRef`, `aria` correto e foco
visível.

- **Button** — variantes `primary`, `secondary`, `ghost`, `danger`; tamanhos
  `sm`, `md`; estado `loading` que troca o texto para gerúndio e desabilita
- **IconButton** — quadrado, tooltip opcional
- **Input** / **Textarea** — com `label`, `hint`, `error`; erro no blur, não a
  cada tecla
- **Avatar** — 20/24/32/40/64px, com fallback de iniciais sobre cor derivada do
  id, e `status` opcional como anel
- **Dialog** — foco preso, `Escape` fecha, véu, retorno de foco ao elemento que
  abriu
- **Popover** — posicionamento com Floating UI, colisão com a borda tratada
- **Menu** — navegação por setas, `Enter`, `Escape`, `role="menu"`
- **Tooltip** — 300ms de atraso, some no `Escape`
- **Toast** — canto inferior direito, empilha até 3, some em 5s
- **Spinner** — só para carregamento de página inteira, nunca em botão
- **Skeleton** — blocos com a proporção do conteúdo real, `opacity` pulsando em
  1,4s, **sem varredura diagonal**

### Tema

Hook `useTheme` com `'dark' | 'light' | 'system'`. Preferência em **cookie**, não
`localStorage`, para o servidor poder renderizar o atributo certo e não haver
piscada branca no carregamento.

### Utilitário de cor

Função que recebe uma cor de cargo e o fundo, calcula o contraste WCAG e clareia
a cor até atingir 4.5:1 se necessário. Cargo tem cor livre e alguém vai escolher
um azul-marinho ilegível.

### Página de demonstração

Rota `/dev/ui`, só em desenvolvimento, com todos os primitivos em todos os
estados, nos dois temas. É o que você vai usar para revisar sem abrir o produto.

## Não fazer

Nenhum componente de domínio — nada de MessageItem, ChannelList, CastPanel.
Aqueles vêm nas fases seguintes.

## Aceite

- `/dev/ui` mostra todos os primitivos nos dois temas
- Trocar de tema não pisca e persiste ao recarregar
- Todo primitivo é operável só por teclado, com foco visível
- Nenhum valor literal de cor, espaço, raio ou duração fora de `tokens.css`
- `prefers-reduced-motion` desliga as animações
- Contraste AA verificado nos textos sobre todos os fundos
- Nenhuma requisição para domínio externo no carregamento (confira na aba Network)
