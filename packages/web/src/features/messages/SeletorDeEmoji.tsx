import { useMemo, useRef, useState, type ReactElement } from 'react';
import { Popover } from '../../components';
import { buscarEmojis } from './emojis';
import styles from './messages.module.css';

/**
 * Seletor de emoji.
 *
 * Oito por linha, busca por prefixo em português, setas e `Enter`. Sem
 * biblioteca: a lista está em `emojis.ts` e é escrita à mão, porque trazer o
 * conjunto Unicode inteiro para cinco pessoas usarem trinta é peso morto.
 */

const POR_LINHA = 8;

export interface SeletorDeEmojiProps {
  trigger: ReactElement;
  onEscolher: (emoji: string) => void;
}

export function SeletorDeEmoji({ trigger, onEscolher }: SeletorDeEmojiProps) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [ativo, setAtivo] = useState(0);
  const grade = useRef<HTMLDivElement>(null);

  const encontrados = useMemo(() => buscarEmojis(termo), [termo]);

  function escolher(emoji: string): void {
    onEscolher(emoji);
    setAberto(false);
    setTermo('');
    setAtivo(0);
  }

  function aoTeclar(e: React.KeyboardEvent): void {
    const passos: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: POR_LINHA,
      ArrowUp: -POR_LINHA,
    };
    const passo = passos[e.key];

    if (passo !== undefined) {
      e.preventDefault();
      setAtivo((i) => Math.min(encontrados.length - 1, Math.max(0, i + passo)));
      // O foco fica no campo de busca o tempo todo: tirá-lo obrigaria a voltar
      // com a mão para continuar filtrando.
      grade.current?.children[ativo]?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const escolhido = encontrados[ativo];
      if (escolhido) escolher(escolhido.char);
    }
  }

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) {
          setTermo('');
          setAtivo(0);
        }
      }}
      trigger={trigger}
      placement="top-end"
    >
      <div className={styles.seletor}>
        <input
          className={styles.buscaEmoji}
          type="text"
          value={termo}
          placeholder="buscar emoji"
          aria-label="Buscar emoji"
          autoFocus
          onChange={(e) => {
            setTermo(e.target.value);
            setAtivo(0);
          }}
          onKeyDown={aoTeclar}
        />

        {encontrados.length === 0 ? (
          <p className={styles.semEmoji}>Nada com “{termo}”.</p>
        ) : (
          <div className={styles.gradeEmoji} ref={grade} role="listbox" aria-label="Emojis">
            {encontrados.map((emoji, i) => (
              <button
                key={emoji.char}
                type="button"
                role="option"
                aria-selected={i === ativo}
                aria-label={emoji.nomes[0]}
                title={emoji.nomes[0]}
                className={styles.itemEmoji}
                data-ativo={i === ativo}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(emoji.char)}
              >
                {emoji.char}
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}
