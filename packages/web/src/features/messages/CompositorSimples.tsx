import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components';
import { Send } from '../../components/icones';
import { useEnviarMensagem } from './useEnviar';
import styles from './messages.module.css';

/**
 * Compositor do painel: thread hoje, notas e tarefas depois.
 *
 * Não é o compositor do canal com props a mais. Aquele carrega barra de
 * resposta, edição por `↑`, indicador de digitação, anexo e seletor de emoji —
 * nada disso pertence a uma caixa de 40px num painel de 320px, e enfiar tudo
 * atrás de condicionais faria dois componentes fingirem ser um.
 */

const ALTURA_MIN = 36;
const ALTURA_MAX = 140;

export interface CompositorSimplesProps {
  channelId: string;
  parentId: string;
  rotulo: string;
}

export function CompositorSimples({ channelId, parentId, rotulo }: CompositorSimplesProps) {
  const { enviar } = useEnviarMensagem();
  const campo = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState('');

  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(ALTURA_MAX, Math.max(ALTURA_MIN, el.scrollHeight))}px`;
  }, [texto]);

  useEffect(() => {
    setTexto('');
  }, [parentId]);

  const submeter = useCallback(() => {
    const conteudo = texto.trim();
    if (!conteudo) return;
    enviar({ channelId, content: conteudo, parentId });
    setTexto('');
  }, [texto, enviar, channelId, parentId]);

  return (
    <div className={styles.compositorPainel}>
      <textarea
        ref={campo}
        className={styles.campoPainel}
        rows={1}
        value={texto}
        placeholder={rotulo}
        aria-label={rotulo}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submeter();
          }
        }}
      />
      <IconButton
        label="Enviar"
        size="sm"
        disabled={texto.trim().length === 0}
        onClick={submeter}
      >
        <Send size={16} />
      </IconButton>
    </div>
  );
}
