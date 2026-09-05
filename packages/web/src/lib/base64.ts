/**
 * Bytes para texto e de volta, para o que trafega no WebSocket.
 *
 * Os deltas do Yjs são binários e o gateway fala JSON. Esta conversão nasceu no
 * provedor das notas e saiu para cá quando o quadro passou a precisar dela — a
 * mesma razão do `lib/bipe.ts`: duas cópias divergem no primeiro ajuste, e o
 * ajuste aqui é o tamanho do bloco, que existe por um motivo nada óbvio.
 */

export function paraBase64(bytes: Uint8Array): string {
  let texto = '';
  // Em blocos: `String.fromCharCode(...bytes)` com um documento grande estoura
  // o limite de argumentos da função — e um quadro cheio é grande.
  for (let i = 0; i < bytes.length; i += 8192) {
    texto += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(texto);
}

export function deBase64(texto: string): Uint8Array {
  return Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));
}
