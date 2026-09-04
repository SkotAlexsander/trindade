import type { ReactNode } from 'react';
import { IconButton, Tooltip } from '../../components';
import { ChevronLeft, Hash, Notes, Pin, Search, Tasks, Volume } from '../../components/icones';
import type { ChannelWithState } from '../channels/canais';
import styles from './shell.module.css';

export type PainelAberto = 'busca' | 'fixadas' | 'notas' | 'tarefas' | null;

const BOTOES: Array<{ id: Exclude<PainelAberto, null>; rotulo: string; icone: ReactNode }> = [
  { id: 'busca', rotulo: 'Buscar no canal', icone: <Search size={18} /> },
  { id: 'fixadas', rotulo: 'Fixadas', icone: <Pin size={18} /> },
  { id: 'notas', rotulo: 'Notas', icone: <Notes size={18} /> },
  { id: 'tarefas', rotulo: 'Tarefas', icone: <Tasks size={18} /> },
];

export interface ChannelHeaderProps {
  canal: ChannelWithState | undefined;
  painel: PainelAberto;
  onPainel: (qual: Exclude<PainelAberto, null>) => void;
  /** Só aparece abaixo de 900px, onde a navegação vira pilha. */
  onAbrirGaveta?: () => void;
  mostrarGaveta?: boolean;
  children: ReactNode;
}

export function ChannelHeader({
  canal,
  painel,
  onPainel,
  onAbrirGaveta,
  mostrarGaveta = false,
  children,
}: ChannelHeaderProps) {
  return (
    <div className={styles.conversa}>
      {/* A faixa de desconexão ocupa a primeira linha da grade quando existe;
          empurra o conteúdo em vez de sobrepor. Ligada na fase 5. */}
      <div />

      <header className={styles.cabecalho}>
        {mostrarGaveta ? (
          <IconButton label="Abrir canais" size="sm" onClick={onAbrirGaveta}>
            <ChevronLeft size={18} />
          </IconButton>
        ) : null}

        {canal ? (
          <>
            <span className={styles.hash} aria-hidden="true">
              {canal.kind === 'voice' ? <Volume size={18} /> : <Hash size={18} />}
            </span>
            <h1 className={styles.nomeCanal}>{canal.name}</h1>
            {canal.topic ? (
              <>
                {/* Linha, não ponto médio: meta juntada com `·` é um tique. */}
                <span className={styles.separador} aria-hidden="true" />
                <p className={styles.topico}>{canal.topic}</p>
              </>
            ) : null}
          </>
        ) : (
          <h1 className={styles.nomeCanal}>Trindade</h1>
        )}

        <div className={styles.acoes}>
          {BOTOES.map((botao) => (
            <Tooltip key={botao.id} label={botao.rotulo}>
              <IconButton
                label={botao.rotulo}
                size="sm"
                aria-pressed={painel === botao.id}
                className={painel === botao.id ? styles.acaoAtiva : undefined}
                onClick={() => onPainel(botao.id)}
              >
                {botao.icone}
              </IconButton>
            </Tooltip>
          ))}
        </div>
      </header>

      {/* `role="log"` com `aria-live="polite"`, nunca `assertive`: mensagem
          nova não deve interromper quem está lendo outra coisa. */}
      <div className={styles.historico} role="log" aria-live="polite" aria-label="Mensagens">
        {children}
      </div>

      <div className={styles.compositor} id="compositor">
        {canal ? `escreva em #${canal.name}` : 'escolha um canal'}
      </div>
    </div>
  );
}
