import { forwardRef } from 'react';
import type { Channel, User } from '@trindade/shared';
import { IconButton } from '../../components';
import { X } from '../../components/icones';
import { PainelBusca } from '../messages/PainelBusca';
import { PainelFixadas, PainelGuardadas } from '../messages/Paineis';
import { PainelThread } from '../messages/PainelThread';
import type { PainelAberto } from './ChannelHeader';
import styles from './shell.module.css';
import { PainelDeNotas } from '../notes/PainelDeNotas';

const TITULOS: Record<Exclude<PainelAberto, null>, string> = {
  busca: 'Buscar',
  fixadas: 'Fixadas',
  guardadas: 'Guardadas',
  thread: 'Thread',
  notas: 'Notas',
  tarefas: 'Tarefas',
};

/**
 * Guardadas atravessa canais e os outros não. O subtítulo existe para essa
 * diferença ficar dita, e não deduzida: sem ele, uma lista com mensagens de
 * três canais dentro do painel de um canal parece defeito.
 */
const SUBTITULOS: Partial<Record<Exclude<PainelAberto, null>, string>> = {
  guardadas: 'todas as conversas',
  fixadas: 'neste canal',
  thread: 'fora da linha principal',
};

export interface ContextPanelProps {
  aberto: PainelAberto;
  canal: Channel | undefined;
  canais: readonly Channel[];
  pessoas: readonly User[];
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
  { aberto, canal, canais, pessoas, onFechar },
  ref,
) {
  const subtitulo = aberto ? SUBTITULOS[aberto] : undefined;
  return (
    <div className={styles.painelSlot} data-open={aberto !== null} aria-hidden={aberto === null}>
      <aside className={styles.painel} ref={ref} aria-label={aberto ? TITULOS[aberto] : undefined}>
        <div className={styles.painelHead}>
          <span className="section-label">{aberto ? TITULOS[aberto] : ''}</span>
          {subtitulo ? <span className={styles.painelSub}>{subtitulo}</span> : null}
          <IconButton label="Fechar painel" size="sm" onClick={onFechar}>
            <X size={16} />
          </IconButton>
        </div>
        <div className={styles.painelCorpo} data-sem-espaco={aberto === 'thread'}>
          {aberto === 'fixadas' ? <PainelFixadas canal={canal} /> : null}
          {aberto === 'guardadas' ? <PainelGuardadas /> : null}
          {aberto === 'busca' ? <PainelBusca canal={canal} pessoas={pessoas} /> : null}
          {aberto === 'thread' ? <PainelThread pessoas={pessoas} canais={canais} /> : null}
          {aberto === 'notas' && canal ? (
            <PainelDeNotas canal={canal} pessoas={pessoas} />
          ) : null}
          {aberto === 'tarefas' ? 'Entra na fase em que este painel é implementado.' : null}
        </div>
      </aside>
    </div>
  );
});
