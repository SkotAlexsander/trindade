import { useEffect } from 'react';
import { useLeitura } from '../messages/leitura';
import { contarChamados, useMotor } from './motor';

/**
 * Mantém o motor sabendo onde você está, e o título dizendo quanto falta.
 *
 * Montado uma vez no shell. É a única ponte entre o React e o motor, que fora
 * daqui só é chamado pelo gateway. Ver design/09-notificacoes.md.
 */

const TITULO = 'Trindade';

export function useNotificacoes(canalAberto: string | undefined): void {
  const definirFoco = useMotor((s) => s.definirFoco);
  const definirCanalAberto = useMotor((s) => s.definirCanalAberto);
  const porCanal = useLeitura((s) => s.porCanal);

  useEffect(() => {
    definirCanalAberto(canalAberto ?? null);
  }, [canalAberto, definirCanalAberto]);

  /*
   * Foco **e** visibilidade. Uma janela minimizada não dispara `blur`, e uma
   * aba de fundo não dispara nada: sem os dois eventos, a aba esquecida atrás
   * do navegador contaria como "você já está vendo" e as notificações
   * sumiriam justamente quando são necessárias.
   */
  useEffect(() => {
    const atualizar = () => {
      definirFoco(document.visibilityState === 'visible' && document.hasFocus());
    };

    atualizar();
    window.addEventListener('focus', atualizar);
    window.addEventListener('blur', atualizar);
    document.addEventListener('visibilitychange', atualizar);
    return () => {
      window.removeEventListener('focus', atualizar);
      window.removeEventListener('blur', atualizar);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, [definirFoco]);

  // O contador no título. Conta menções e respostas, nunca mensagens de canal.
  useEffect(() => {
    const chamados = contarChamados(porCanal);
    document.title = chamados > 0 ? `(${chamados}) ${TITULO}` : TITULO;
    return () => {
      document.title = TITULO;
    };
  }, [porCanal]);
}
