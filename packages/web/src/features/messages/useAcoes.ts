import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message } from '@trindade/shared';
import { useToast } from '../../components';
import { api } from '../../lib/http';
import { useAuth } from '../auth/store';
import { atualizarMensagem, mexerNaReacao, type MensagemLocal } from './queries';

/**
 * As ações de uma mensagem.
 *
 * Todas otimistas e todas com desfazer no erro: a barra de ações é usada em
 * sequência rápida, e esperar a resposta a cada clique faria a barra parecer
 * travada. O evento do socket confirma; se a chamada falhar, o estado volta.
 */
export function useAcoesDaMensagem() {
  const qc = useQueryClient();
  const { show } = useToast();
  const eu = useAuth((s) => s.user);

  const reagir = useCallback(
    (mensagem: Message, emoji: string, tirar: boolean) => {
      if (!eu) return;
      const d = { messageId: mensagem.id, channelId: mensagem.channelId, userId: eu.id, emoji };
      mexerNaReacao(qc, d, eu.id, !tirar);

      const caminho = `/messages/${mensagem.id}/reactions/${encodeURIComponent(emoji)}`;
      void api(caminho, { method: tirar ? 'DELETE' : 'PUT' }).catch(() => {
        mexerNaReacao(qc, d, eu.id, tirar);
        show('Não foi possível reagir.', 'danger');
      });
    },
    [qc, eu, show],
  );

  /**
   * Guardar não avisa ninguém e não muda a linha para mais ninguém — por isso
   * a atualização é local e não vem por broadcast. Ver design/04-mensagens.md.
   */
  const guardar = useCallback(
    (mensagem: Message, guardando: boolean) => {
      atualizarMensagem(qc, { ...mensagem, saved: guardando });
      void qc.invalidateQueries({ queryKey: ['guardadas'] });

      void api(`/messages/${mensagem.id}/save`, { method: guardando ? 'PUT' : 'DELETE' }).catch(
        () => {
          atualizarMensagem(qc, { ...mensagem, saved: !guardando });
          show('Não foi possível guardar.', 'danger');
        },
      );
    },
    [qc, show],
  );

  /** Fixar é do canal: a confirmação vem por `MESSAGE_UPDATE` para todo mundo. */
  const fixar = useCallback(
    (mensagem: Message, fixando: boolean) => {
      void api<{ message: Message }>(`/messages/${mensagem.id}/pin`, {
        method: fixando ? 'PUT' : 'DELETE',
      })
        .then((r) => {
          atualizarMensagem(qc, r.message);
          void qc.invalidateQueries({ queryKey: ['fixadas', mensagem.channelId] });
        })
        .catch(() => show('Não foi possível fixar.', 'danger'));
    },
    [qc, show],
  );

  const apagar = useCallback(
    (mensagem: MensagemLocal) => {
      // O `MESSAGE_DELETE` do socket é que remove de verdade, para todos ao
      // mesmo tempo. Aqui só se dispara.
      void api(`/messages/${mensagem.id}`, { method: 'DELETE' }).catch(() =>
        show('Não foi possível apagar.', 'danger'),
      );
    },
    [show],
  );

  return { reagir, guardar, fixar, apagar };
}
