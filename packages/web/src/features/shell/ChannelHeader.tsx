import { useCallback, useRef, useState, type ReactNode } from 'react';
import { IconButton, Tooltip } from '../../components';
import { FaixaConexao } from '../realtime/FaixaConexao';
import { ChevronLeft, Hash, Notes, Pin, Search, Tasks, Volume } from '../../components/icones';
import type { ChannelWithState } from '../channels/canais';
import { lerPreferencias, salvarPreferencias } from '../../lib/preferencias';
import styles from './shell.module.css';

/**
 * `guardadas` está nesta união mas **não** na barra de botões do cabeçalho:
 * aqueles quatro são do canal em que você está, e guardadas atravessa todos.
 * O gatilho dela mora no menu do seu próprio nome e em `Ctrl/⌘ ⇧ B`.
 */
export type PainelAberto =
  | 'busca'
  | 'fixadas'
  | 'guardadas'
  | 'thread'
  | 'notas'
  | 'tarefas'
  | null;

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
  /**
   * A chamada, que divide esta coluna com a conversa.
   *
   * Não é outra rota, e em `ambos` também não é sobreposição: as duas coisas
   * ficam na tela ao mesmo tempo, porque numa chamada há gente falando e gente
   * escrevendo ao mesmo tempo. Ver design/07-chamada.md.
   */
  chamada?: ReactNode;
  modoDaSala?: 'mensagens' | 'ambos' | 'chamada';
  children: ReactNode;
}

export function ChannelHeader({
  canal,
  painel,
  onPainel,
  onAbrirGaveta,
  mostrarGaveta = false,
  chamada,
  modoDaSala = 'mensagens',
  children,
}: ChannelHeaderProps) {
  const coluna = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(() => lerPreferencias().larguraDaConversa);

  /**
   * Arrastar a divisa entre a chamada e a conversa.
   *
   * `setPointerCapture` em vez de ouvintes no documento: o ponteiro continua
   * pertencendo à alça mesmo quando o cursor passa por cima do vídeo, que é
   * justamente onde um arrasto costuma se perder.
   */
  const arrastar = useCallback((evento: React.PointerEvent<HTMLButtonElement>) => {
    const caixa = coluna.current?.getBoundingClientRect();
    if (!caixa) return;

    /* A alça é guardada numa variável **antes** de qualquer coisa assíncrona.
       O React zera `currentTarget` quando o handler retorna, e os ouvintes
       abaixo rodam depois disso: lê-lo lá dentro dava `null`, o `pointerup`
       explodia e o arrasto ficava grudado no cursor até o próximo clique. */
    const alca = evento.currentTarget;
    alca.setPointerCapture(evento.pointerId);

    const mover = (e: PointerEvent) => {
      // A conversa não pode sumir nem engolir a chamada: abaixo de 260px não
      // cabe uma mensagem, e acima de 760 não sobra chamada.
      const proposta = Math.min(760, Math.max(260, Math.round(caixa.right - e.clientX)));
      larguraAtual.current = proposta;
      setLargura(proposta);
    };

    const soltar = () => {
      alca.removeEventListener('pointermove', mover);
      alca.removeEventListener('pointerup', soltar);
      alca.removeEventListener('pointercancel', soltar);
      salvarPreferencias({ larguraDaConversa: larguraAtual.current });
    };

    alca.addEventListener('pointermove', mover);
    alca.addEventListener('pointerup', soltar);
    // O ponteiro pode ser cancelado pelo sistema — sem isto, o arrasto continua
    // depois de a mão ter saído da mesa.
    alca.addEventListener('pointercancel', soltar);
  }, []);

  // O valor no instante de soltar, sem reassinar os ouvintes a cada pixel.
  const larguraAtual = useRef(largura);
  larguraAtual.current = largura;

  return (
    <div
      ref={coluna}
      className={styles.conversa}
      data-chamada={modoDaSala}
      style={{ '--conversa-w': `${largura}px` } as React.CSSProperties}
    >
      {/* Primeira linha da grade: empurra o conteúdo, não sobrepõe. */}
      <FaixaConexao />

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

      {/* A rolagem e o compositor pertencem à rota, não à moldura: `/config`
          usa este mesmo cabeçalho e não tem onde escrever. */}
      <div className={styles.historico}>{children}</div>

      <div className={styles.chamadaSlot}>{chamada}</div>

      {/* Um separador de verdade: as setas do teclado também movem, porque
          arrastar com o mouse não pode ser a única forma. */}
      <button
        type="button"
        className={styles.divisor}
        role="separator"
        aria-label="Ajustar a largura da conversa"
        aria-orientation="vertical"
        aria-valuenow={largura}
        aria-valuemin={260}
        aria-valuemax={760}
        onPointerDown={arrastar}
        onKeyDown={(e) => {
          const passo = e.key === 'ArrowLeft' ? 24 : e.key === 'ArrowRight' ? -24 : 0;
          if (!passo) return;
          e.preventDefault();
          const proximo = Math.min(760, Math.max(260, largura + passo));
          setLargura(proximo);
          salvarPreferencias({ larguraDaConversa: proximo });
        }}
      />
    </div>
  );
}
