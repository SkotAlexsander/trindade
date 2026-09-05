/**
 * As larguras em que a interface muda de forma.
 *
 * Quatro, e cada uma existe por um motivo que se vê na tela — não por ser um
 * número redondo de tabela de framework:
 *
 * | Até     | O que muda                                                    |
 * |---------|---------------------------------------------------------------|
 * | 599px   | telefone: o cabeçalho recolhe os painéis num menu, a linha de pessoa empilha, o alvo de toque cresce |
 * | 899px   | o rail e a coluna de canais viram gaveta, e o elenco vira faixa no topo dela |
 * | 1279px  | o painel de contexto deixa de dividir espaço e passa a sobrepor |
 * | acima   | as quatro colunas, e a conversa para de crescer na medida de leitura |
 *
 * **Os valores vivem aqui e no CSS, e não há como o CSS lê-los.** Media query
 * não aceita `var()` — é uma limitação da linguagem, não uma escolha. O que dá
 * para fazer é ter um lugar onde eles estão escritos com o nome, para quem
 * mexer num saber que existe o outro. Todo `@media` do produto usa um destes
 * quatro números; qualquer outro é um breakpoint órfão e provavelmente um
 * engano.
 *
 * `packages/web/test/telas.test.ts` confere isso: se aparecer um `@media` com
 * largura fora desta lista, ele falha.
 */

export const TELAS = {
  telefone: 599,
  gaveta: 899,
  painelSobrepoe: 1279,
} as const;

/** Para `useMediaQuery`. */
export const ATE = {
  telefone: `(max-width: ${TELAS.telefone}px)`,
  gaveta: `(max-width: ${TELAS.gaveta}px)`,
  painelSobrepoe: `(max-width: ${TELAS.painelSobrepoe}px)`,
} as const;
