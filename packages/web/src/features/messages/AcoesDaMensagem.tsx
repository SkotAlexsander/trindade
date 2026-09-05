import { IconButton, Menu, MenuItem, MenuSeparator, Tooltip } from '../../components';
import { Board, Mark, Notes, Pin, Reply, Smile, Tasks, Trash } from '../../components/icones';
import { SeletorDeEmoji } from './SeletorDeEmoji';
import { RAPIDOS } from './emojis';
import type { MensagemLocal } from './queries';
import styles from './messages.module.css';

/**
 * A barra que aparece no canto superior direito da mensagem.
 *
 * **Sem atraso e sem transição.** Atraso aqui é frustrante, e transição de
 * opacidade a cada movimento do mouse cria cintilação numa lista longa — a
 * barra some e volta dezenas de vezes enquanto o ponteiro atravessa a tela.
 * Ver design/04-mensagens.md.
 *
 * Aparece também quando a mensagem recebe foco por teclado, e é a mesma barra:
 * duas implementações divergiriam.
 */

export interface AcoesDaMensagemProps {
  mensagem: MensagemLocal;
  souOAutor: boolean;
  podeFixar: boolean;
  podeApagar: boolean;
  onReagir: (emoji: string) => void;
  onResponder: () => void;
  onGuardar: () => void;
  onFixar: () => void;
  podeAnotar: boolean;
  onParaNotas: () => void;
  podeTarefa: boolean;
  /** Só faz sentido com imagem: é ela que vai para o quadro. */
  temImagem: boolean;
  onCriarTarefa: () => void;
  onAbrirNoQuadro: () => void;
  onEditar: () => void;
  onApagar: () => void;
  onThread: () => void;
}

export function AcoesDaMensagem({
  mensagem,
  souOAutor,
  podeFixar,
  podeApagar,
  onReagir,
  onResponder,
  onGuardar,
  onFixar,
  podeAnotar,
  onParaNotas,
  podeTarefa,
  temImagem,
  onCriarTarefa,
  onAbrirNoQuadro,
  onEditar,
  onApagar,
  onThread,
}: AcoesDaMensagemProps) {
  const guardada = mensagem.saved;
  const fixada = mensagem.pinnedAt !== null;

  return (
    <div className={styles.acoes} role="toolbar" aria-label="Ações da mensagem">
      {RAPIDOS.slice(0, 3).map((emoji) => (
        <Tooltip key={emoji} label={`Reagir com ${emoji}`}>
          <button
            type="button"
            className={styles.acaoEmoji}
            aria-label={`Reagir com ${emoji}`}
            onClick={() => onReagir(emoji)}
          >
            {emoji}
          </button>
        </Tooltip>
      ))}

      <SeletorDeEmoji
        onEscolher={onReagir}
        trigger={
          <IconButton label="Escolher emoji" size="sm" className={styles.acao}>
            <Smile size={16} />
          </IconButton>
        }
      />

      <Tooltip label="Responder (R)">
        <IconButton label="Responder" size="sm" className={styles.acao} onClick={onResponder}>
          <Reply size={16} />
        </IconButton>
      </Tooltip>

      {/* Guardar e fixar lado a lado de propósito: são vizinhas na intenção, e
          a diferença entre "para mim" e "para todos" se aprende uma vez só. */}
      <Tooltip label={guardada ? 'Tirar das guardadas (S)' : 'Guardar para você (S)'}>
        <IconButton
          label={guardada ? 'Tirar das guardadas' : 'Guardar para você'}
          size="sm"
          className={styles.acao}
          aria-pressed={guardada}
          data-ativa={guardada}
          onClick={onGuardar}
        >
          <Mark size={16} />
        </IconButton>
      </Tooltip>

      {podeFixar ? (
        <Tooltip label={fixada ? 'Desafixar do canal (P)' : 'Fixar no canal (P)'}>
          <IconButton
            label={fixada ? 'Desafixar do canal' : 'Fixar no canal'}
            size="sm"
            className={styles.acao}
            aria-pressed={fixada}
            data-ativa={fixada}
            onClick={onFixar}
          >
            <Pin size={16} />
          </IconButton>
        </Tooltip>
      ) : null}

      <Menu
        label="Mais ações"
        placement="bottom-end"
        trigger={
          <IconButton label="Mais ações" size="sm" className={styles.acao}>
            <span aria-hidden="true" className={styles.reticencias}>
              ···
            </span>
          </IconButton>
        }
      >
        <MenuItem onSelect={onThread}>Abrir thread</MenuItem>
        {souOAutor ? <MenuItem onSelect={onEditar}>Editar mensagem</MenuItem> : null}
        <MenuItem onSelect={() => void navigator.clipboard?.writeText(mensagem.content ?? '')}>
          Copiar texto
        </MenuItem>
        {/* O gesto central das ferramentas de projeto: a decisão tomada aqui
            vira registro na nota do canal, com autor e link de volta. */}
        {podeAnotar ? (
          <MenuItem icon={<Notes size={16} />} onSelect={onParaNotas}>
            Adicionar às notas
          </MenuItem>
        ) : null}
        {/* O título já vem preenchido pela primeira linha: o gesto é levar a
            conversa para o quadro, não preencher um formulário. */}
        {podeTarefa ? (
          <MenuItem icon={<Tasks size={16} />} onSelect={onCriarTarefa}>
            Criar tarefa
          </MenuItem>
        ) : null}
        {/* Só onde há imagem: anotar em cima de uma captura de tela é o que se
            faz com quase toda imagem numa conversa de trabalho. */}
        {podeAnotar && temImagem ? (
          <MenuItem icon={<Board size={16} />} onSelect={onAbrirNoQuadro}>
            Abrir no quadro
          </MenuItem>
        ) : null}
        {podeApagar ? (
          <>
            <MenuSeparator />
            <MenuItem danger icon={<Trash size={16} />} onSelect={onApagar}>
              Apagar mensagem
            </MenuItem>
          </>
        ) : null}
      </Menu>
    </div>
  );
}
