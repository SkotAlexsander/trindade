/**
 * Navegar de fora de um componente.
 *
 * O clique numa notificação da área de trabalho chega ao motor, que não é
 * React e não tem `useNavigate`. Sem isto o jeito seria `location.assign`, que
 * recarrega o produto inteiro — reconectando o socket e perdendo a chamada em
 * andamento — para trocar de canal.
 *
 * O shell registra o navegador do React ao montar. Antes disso, e num teste, o
 * fallback é a navegação do navegador mesmo: melhor ir com recarga do que não
 * ir.
 */

type Navegador = (para: string) => void;

let navegador: Navegador | null = null;

export function definirNavegador(fn: Navegador | null): void {
  navegador = fn;
}

export function irPara(para: string): void {
  if (navegador) {
    navegador(para);
    return;
  }
  if (typeof window !== 'undefined') window.location.assign(para);
}
