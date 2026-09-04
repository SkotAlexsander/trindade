import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TYPING_THROTTLE_MS, type Channel, type Message } from '@trindade/shared';
import { IconButton, Tooltip, useToast } from '../../components';
import { Paperclip, Send, X } from '../../components/icones';
import { api } from '../../lib/http';
import { enviar as enviarPeloSocket } from '../../lib/ws';
import { useAuth } from '../auth/store';
import { atualizarMensagem, chaveDoCanal, type CacheCanal } from './queries';
import { useEnviarMensagem } from './useEnviar';
import styles from './messages.module.css';

/**
 * O compositor.
 *
 * `textarea` que cresce de 40px a 240px ajustando `style.height` a partir do
 * `scrollHeight`. **Não é `contenteditable`** — este último traz uma classe
 * inteira de bugs de colagem e de desfazer que não compensam.
 * Ver design/04-mensagens.md.
 */

const ALTURA_MIN = 40;
const ALTURA_MAX = 240;

export interface ComposerProps {
  canal: Channel;
}

export function Composer({ canal }: ComposerProps) {
  const qc = useQueryClient();
  const { show } = useToast();
  const meuId = useAuth((s) => s.user?.id);
  const { enviar } = useEnviarMensagem();

  const campo = useRef<HTMLTextAreaElement>(null);
  const ultimoTyping = useRef(0);
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState<Message | null>(null);

  const ajustarAltura = useCallback(() => {
    const el = campo.current;
    if (!el) return;
    // `auto` primeiro: sem isso o `scrollHeight` nunca diminui e o campo só
    // cresce, mesmo quando a pessoa apaga o que escreveu.
    el.style.height = 'auto';
    el.style.height = `${Math.min(ALTURA_MAX, Math.max(ALTURA_MIN, el.scrollHeight))}px`;
  }, []);

  useEffect(() => {
    ajustarAltura();
  }, [texto, ajustarAltura]);

  // Trocar de canal limpa o que estava escrito para outro lugar.
  useEffect(() => {
    setTexto('');
    setEditando(null);
  }, [canal.id]);

  const sinalizarDigitacao = useCallback(() => {
    const agora = Date.now();
    if (agora - ultimoTyping.current < TYPING_THROTTLE_MS) return;
    ultimoTyping.current = agora;
    enviarPeloSocket({ op: 'TYPING_START', d: { channelId: canal.id } });
  }, [canal.id]);

  const cancelarEdicao = useCallback(() => {
    setEditando(null);
    setTexto('');
  }, []);

  const submeter = useCallback(() => {
    const conteudo = texto.trim();
    if (!conteudo) return;

    if (editando) {
      const alvo = editando;
      setEditando(null);
      setTexto('');
      void api<{ message: Message }>(`/messages/${alvo.id}`, {
        method: 'PATCH',
        body: { content: conteudo },
      })
        .then((r) => atualizarMensagem(qc, r.message))
        .catch(() => show('Não foi possível editar a mensagem.', 'danger'));
      return;
    }

    enviar({ channelId: canal.id, content: conteudo });
    setTexto('');
    // O envio é otimista: quem escreveu já vê a mensagem, então o campo pode
    // esvaziar sem esperar resposta nenhuma.
  }, [texto, editando, enviar, canal.id, qc, show]);

  /** `↑` no campo vazio traz a sua última mensagem para edição. */
  const editarUltima = useCallback(() => {
    const cache = qc.getQueryData<CacheCanal>(chaveDoCanal(canal.id));
    const minha = [...(cache?.mensagens ?? [])]
      .reverse()
      .find((m) => m.author.id === meuId && !m.local && !m.deletedAt && m.content);
    if (!minha) return;
    setEditando(minha);
    setTexto(minha.content ?? '');
    requestAnimationFrame(() => campo.current?.focus());
  }, [qc, canal.id, meuId]);

  const aoTeclar = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enquanto o IME está montando um caractere, `Enter` confirma a
      // composição — enviar aqui cortaria a palavra no meio.
      if (e.nativeEvent.isComposing) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submeter();
        return;
      }
      if (e.key === 'Escape' && editando) {
        e.preventDefault();
        cancelarEdicao();
        return;
      }
      if (e.key === 'ArrowUp' && texto === '' && !editando) {
        e.preventDefault();
        editarUltima();
      }
    },
    [submeter, editando, cancelarEdicao, texto, editarUltima],
  );

  return (
    <div className={styles.compositorArea}>
      {editando ? (
        <div className={styles.barraEdicao}>
          <span>Editando mensagem</span>
          <span className={styles.dica}>Esc para cancelar</span>
          <IconButton label="Cancelar edição" size="sm" onClick={cancelarEdicao}>
            <X size={16} />
          </IconButton>
        </div>
      ) : null}

      <div className={styles.compositor}>
        <Tooltip label="Anexar arquivo">
          <IconButton label="Anexar arquivo" size="sm" disabled>
            <Paperclip size={18} />
          </IconButton>
        </Tooltip>

        <textarea
          ref={campo}
          id="compositor"
          className={styles.campo}
          rows={1}
          value={texto}
          placeholder={`escreva em #${canal.name}`}
          aria-label={`Escrever em ${canal.name}`}
          onChange={(e) => {
            setTexto(e.target.value);
            if (e.target.value) sinalizarDigitacao();
          }}
          onKeyDown={aoTeclar}
        />

        <Tooltip label={editando ? 'Salvar' : 'Enviar'}>
          <IconButton
            label={editando ? 'Salvar' : 'Enviar'}
            size="sm"
            disabled={texto.trim().length === 0}
            onClick={submeter}
          >
            <Send size={18} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
