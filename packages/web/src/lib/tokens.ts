/**
 * Lê um token de cor já resolvido pelo navegador, no tema em vigor.
 *
 * Existe porque o ajuste de contraste precisa de um valor **numérico** do
 * fundo, e `var(--bg-raised)` só vira cor dentro do CSS. Um hex literal aqui
 * seria a única cor do produto fora de `tokens.css`, e ficaria errado no tema
 * claro no dia seguinte.
 */
export function lerToken(nome: string, padrao = '#ffffff'): string {
  if (typeof window === 'undefined') return padrao;
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return valor || padrao;
}
