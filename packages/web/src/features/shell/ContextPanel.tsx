import { forwardRef } from 'react';
import { IconButton } from '../../components';
import { X } from '../../components/icones';
import type { PainelAberto } from './ChannelHeader';
import styles from './shell.module.css';

const TITULOS: Record<Exclude<PainelAberto, null>, string> = {
  busca: 'Buscar',
  fixadas: 'Fixadas',
  notas: 'Notas',
  tarefas: 'Tarefas',
};

export interface ContextPanelProps {
  aberto: PainelAberto;
  onFechar: () => void;
}

/**
 * Um painel por vez, nunca empilhados: abrir um fecha o outro.
 *
 * O slot tem largura animada e o painel de dentro tem largura fixa com
 * `translateX`. Animar a largura do painel causaria reflow na grade inteira a
 * cada quadro. Ver design/02-shell-principal.md.
 */
export const ContextPanel = forwardRef<HTMLDivElement, ContextPanelProps>(function ContextPanel(
  { aberto, onFechar },
  ref,
) {
  return (
    <div className={styles.painelSlot} data-open={aberto !== null} aria-hidden={aberto === null}>
      <aside className={styles.painel} ref={ref} aria-label={aberto ? TITULOS[aberto] : undefined}>
        <div className={styles.painelHead}>
          <span className="section-label">{aberto ? TITULOS[aberto] : ''}</span>
          <IconButton label="Fechar painel" size="sm" onClick={onFechar}>
            <X size={16} />
          </IconButton>
        </div>
        <div className={styles.painelCorpo}>
          {aberto ? 'Entra na fase em que este painel é implementado.' : null}
        </div>
      </aside>
    </div>
  );
});
