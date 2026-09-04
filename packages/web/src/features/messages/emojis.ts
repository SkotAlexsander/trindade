/**
 * A lista de emojis.
 *
 * Escrita à mão, não importada. Uma biblioteca de emoji traz o conjunto
 * Unicode inteiro — mais de três mil entradas com nomes em inglês — para uma
 * equipe de cinco pessoas usar trinta. Os nomes aqui estão em português
 * porque a busca é digitada em português. Ver CLAUDE.md, "o elenco é fixo".
 *
 * Quando faltar algum, acrescente aqui. Quando faltarem trinta, aí sim vale
 * discutir uma biblioteca.
 */

export interface Emoji {
  char: string;
  /** Palavras que encontram este emoji. A primeira é o nome exibido. */
  nomes: readonly string[];
}

export const EMOJIS: readonly Emoji[] = [
  { char: '👍', nomes: ['joia', 'positivo', 'ok', 'concordo', 'legal'] },
  { char: '👎', nomes: ['negativo', 'ruim', 'discordo'] },
  { char: '✅', nomes: ['feito', 'pronto', 'ok', 'certo', 'check'] },
  { char: '❌', nomes: ['errado', 'nao', 'x', 'cancelado'] },
  { char: '👀', nomes: ['olhos', 'vendo', 'olhando', 'atencao'] },
  { char: '🔥', nomes: ['fogo', 'top', 'bom', 'incendio'] },
  { char: '🎉', nomes: ['festa', 'comemorar', 'parabens'] },
  { char: '🚀', nomes: ['foguete', 'subiu', 'deploy', 'lancamento'] },
  { char: '❤️', nomes: ['coracao', 'amor', 'amei'] },
  { char: '😂', nomes: ['rindo', 'risada', 'engracado', 'kkk'] },
  { char: '😅', nomes: ['alivio', 'suor', 'ufa'] },
  { char: '🙏', nomes: ['obrigado', 'por favor', 'gratidao'] },
  { char: '🤔', nomes: ['pensando', 'duvida', 'hmm'] },
  { char: '😱', nomes: ['susto', 'medo', 'assustado'] },
  { char: '🤯', nomes: ['explodindo', 'mente', 'chocado'] },
  { char: '😴', nomes: ['dormindo', 'sono', 'cansado'] },
  { char: '🥲', nomes: ['sorriso triste', 'dor'] },
  { char: '😍', nomes: ['apaixonado', 'amei', 'lindo'] },
  { char: '🙂', nomes: ['sorriso', 'ok', 'tudo bem'] },
  { char: '😬', nomes: ['constrangido', 'eita', 'careta'] },
  { char: '🫠', nomes: ['derretendo', 'exausto'] },
  { char: '🤝', nomes: ['acordo', 'combinado', 'aperto de mao'] },
  { char: '💪', nomes: ['forca', 'vamos', 'musculo'] },
  { char: '👏', nomes: ['palmas', 'aplauso', 'bravo'] },
  { char: '🫶', nomes: ['coracao com as maos', 'carinho'] },
  { char: '🤞', nomes: ['torcendo', 'dedos cruzados', 'sorte'] },
  { char: '🐛', nomes: ['bug', 'erro', 'inseto'] },
  { char: '🔧', nomes: ['conserto', 'ferramenta', 'chave'] },
  { char: '⚙️', nomes: ['engrenagem', 'configuracao'] },
  { char: '📌', nomes: ['alfinete', 'fixar', 'importante'] },
  { char: '📝', nomes: ['nota', 'anotar', 'escrever'] },
  { char: '📎', nomes: ['anexo', 'clipe'] },
  { char: '🔍', nomes: ['busca', 'procurar', 'lupa'] },
  { char: '⏰', nomes: ['prazo', 'hora', 'despertador'] },
  { char: '⚡', nomes: ['rapido', 'raio', 'energia'] },
  { char: '💡', nomes: ['ideia', 'lampada', 'sugestao'] },
  { char: '⚠️', nomes: ['atencao', 'cuidado', 'aviso'] },
  { char: '🛑', nomes: ['pare', 'parar', 'bloqueado'] },
  { char: '🟢', nomes: ['verde', 'ok', 'liberado'] },
  { char: '🟡', nomes: ['amarelo', 'atencao', 'talvez'] },
  { char: '🔴', nomes: ['vermelho', 'problema', 'parado'] },
  { char: '☕', nomes: ['cafe', 'pausa'] },
  { char: '🍕', nomes: ['pizza', 'comida', 'almoco'] },
  { char: '🎯', nomes: ['alvo', 'meta', 'objetivo'] },
  { char: '📈', nomes: ['subindo', 'grafico', 'crescimento'] },
  { char: '📉', nomes: ['caindo', 'grafico', 'queda'] },
  { char: '🧠', nomes: ['cerebro', 'pensar', 'inteligente'] },
  { char: '🪄', nomes: ['magia', 'varinha', 'resolvido'] },
];

/** As que aparecem direto na barra de ações, sem abrir o seletor. */
export const RAPIDOS = ['👍', '✅', '👀', '🔥', '🎉', '😂'] as const;

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Busca por prefixo de palavra, sem acento.
 *
 * Prefixo e não trecho no meio: "ok" tem de trazer "ok" e não "bloqueado".
 */
export function buscarEmojis(termo: string, limite = 24): readonly Emoji[] {
  const t = semAcento(termo.trim());
  if (!t) return EMOJIS.slice(0, limite);

  return EMOJIS.filter((e) => e.nomes.some((n) => semAcento(n).startsWith(t))).slice(0, limite);
}
