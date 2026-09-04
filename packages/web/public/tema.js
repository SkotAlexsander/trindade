/* Carimba o tema antes da primeira pintura.
 *
 * Sem isto a página nasce no tema padrão e troca quando o React monta — a
 * piscada branca que design/01-tokens.md manda evitar. Lê o mesmo cookie que
 * lib/tema.ts escreve.
 *
 * Vive num arquivo, e não numa tag inline, por causa da CSP: `script-src
 * 'self'` recusa script inline, e a alternativa seria abrir `unsafe-inline` —
 * que anula o benefício inteiro da política. Um arquivo de 400 bytes na mesma
 * origem custa menos que isso. Ver docs/04-seguranca.md.
 *
 * Sem `defer` nem `async` de propósito: ele precisa rodar antes de a página
 * pintar, que é a razão de existir.
 */
(function () {
  try {
    var m = document.cookie.match(/(?:^|; )tema=(dark|light|system)/);
    var t = m ? m[1] : 'system';
    if (t === 'system') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = t;
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
})();
