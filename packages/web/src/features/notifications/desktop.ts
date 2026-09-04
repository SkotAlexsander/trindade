/**
 * A notificação da área de trabalho.
 *
 * Toda a conversa com a API `Notification` mora aqui: é o único lugar do
 * produto que pede permissão, e concentrar isso é o que garante que o pedido
 * aconteça **na primeira menção recebida** e não no primeiro acesso. Pedir
 * antes de haver motivo é o jeito mais rápido de tomar um "bloquear" para
 * sempre. Ver design/09-notificacoes.md.
 */

export type EstadoDaPermissao = 'concedida' | 'negada' | 'nao-pedida' | 'indisponivel';

export function estadoDaPermissao(): EstadoDaPermissao {
  if (typeof Notification === 'undefined') return 'indisponivel';
  if (Notification.permission === 'granted') return 'concedida';
  if (Notification.permission === 'denied') return 'negada';
  return 'nao-pedida';
}

/**
 * Pede a permissão, no máximo uma vez por sessão.
 *
 * O navegador só abre o pedido a partir de um gesto ou de um evento real; a
 * chamada repetida não custa nada, mas guardar a promessa evita duas caixas
 * abertas quando duas menções chegam juntas.
 */
let pedido: Promise<EstadoDaPermissao> | null = null;

export async function pedirPermissao(): Promise<EstadoDaPermissao> {
  const atual = estadoDaPermissao();
  if (atual !== 'nao-pedida') return atual;

  pedido ??= Notification.requestPermission().then(() => estadoDaPermissao());
  return pedido;
}

export interface Aviso {
  titulo: string;
  corpo: string;
  /** Mesma `tag` substitui a notificação anterior em vez de empilhar. */
  tag: string;
  /** Para onde o clique leva. */
  ir: () => void;
}

/**
 * Mostra, se der.
 *
 * Nunca lança: navegador sem suporte, permissão negada ou o `Notification`
 * lançando dentro de um iframe são todos "não deu", e nenhum deles pode
 * derrubar o fluxo de uma mensagem chegando.
 */
export function mostrar(aviso: Aviso): void {
  if (estadoDaPermissao() !== 'concedida') return;

  try {
    const n = new Notification(aviso.titulo, {
      body: aviso.corpo,
      tag: aviso.tag,
      // `renotify` sem `tag` é erro; com `tag`, é o que faz a segunda de uma
      // sequência chamar atenção de novo em vez de trocar em silêncio.
      renotify: false,
      icon: '/icone-192.png',
    } as NotificationOptions);

    n.onclick = () => {
      window.focus();
      aviso.ir();
      n.close();
    };
  } catch {
    /* Sem notificação de sistema, o badge e o ponto na lista continuam. */
  }
}

/** O texto do corpo: 120 caracteres, com reticências de verdade. */
export function resumir(texto: string, limite = 120): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1)}…`;
}
