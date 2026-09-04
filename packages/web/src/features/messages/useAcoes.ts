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

  /**
   * "Adicionar às notas".
   *
   * Sem estado otimista: quem clica pode nem estar com o painel de notas
   * aberto, e o aviso é a confirmação. Quem estiver com ele aberto vê a citação
   * aparecer sozinha, pelo mesmo caminho de qualquer outra edição.
   */
  const paraNotas = useCallback(
    (mensagem: Message) => {
      void api(`/messages/${mensagem.id}/para-notas`, { method: 'POST' })
        .then(() => show('Adicionado às notas do canal.'))
        .catch(() => show('Não foi possível adicionar às notas.', 'danger'));
    },
    [show],
  );

  /**
   * "Criar tarefa".
   *
   * O título é a **primeira linha** da mensagem, cortada em 200: quase toda
   * mensagem que vira tarefa começa pelo que precisa ser feito, e abrir um
   * formulário para confirmar isso é a fricção que faz ninguém usar o quadro.
   * O que sobrou continua na mensagem, a um clique de distância pelo elo de
   * volta. Ver design/08-projeto.md.
   */
  const virarTarefa = useCallback(
    (mensagem: Message) => {
      const titulo = (mensagem.content ?? '').split('\n')[0]?.trim().slice(0, 200);
      if (!titulo) {
        show('Esta mensagem não tem texto para virar tarefa.', 'danger');
        return;
      }

      // Sem escrita otimista: o cartão chega pelo `TASK_UPDATE`, o mesmo
      // caminho que leva a tarefa para as outras quatro telas.
      void api(`/channels/${mensagem.channelId}/tasks`, {
        method: 'POST',
        body: { title: titulo, sourceMessageId: mensagem.id },
      })
        .then(() => show('Tarefa criada em A fazer.'))
        .catch(() => show('Não foi possível criar a tarefa.', 'danger'));
    },
    [show],
  );

  return { reagir, guardar, fixar, apagar, paraNotas, virarTarefa };
}
