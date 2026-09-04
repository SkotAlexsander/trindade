import { tentarAgora } from '../../lib/ws';
import { useConexao } from './store';
import styles from '../shell/shell.module.css';

/**
 * A faixa de desconexão.
 *
 * Ocupa a primeira linha da grade da conversa: **empurra** o conteúdo em vez
 * de sobrepor. Sobrepondo, ela cobriria a mensagem mais recente, que é
 * justamente a que a pessoa quer ver. E só aparece depois de 2s fora do ar —
 * queda de meio segundo, que o backoff resolve sozinho, não merece mexer no
 * layout. Ver design/02-shell-principal.md.
 */
export function FaixaConexao() {
  const mostrar = useConexao((s) => s.mostrarFaixa);
  if (!mostrar) return <div />;

  return (
    <div className={styles.faixaOffline} role="status">
      <span>Sem conexão. Reconectando…</span>
      <button type="button" className={styles.faixaBotao} onClick={tentarAgora}>
        Tentar agora
      </button>
    </div>
  );
}
