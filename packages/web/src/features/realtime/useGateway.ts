import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Channel, User } from '@trindade/shared';
import { useToast } from '../../components';
import * as ws from '../../lib/ws';
import { useAuth } from '../auth/store';
import {
  atualizarMensagem,
  chaveDoCanal,
  mexerNaReacao,
  receberMensagem,
  recuperarDesdeAUltima,
  removerMensagem,
} from '../messages/queries';
import { confirmarNonce } from '../messages/useEnviar';
import { useLeitura } from '../messages/leitura';
import { analisarMarkdown, mencionados } from '../messages/markdown';
import { receberTarefa } from '../tasks/queries';
import { useVoz } from '../voice/store';
import { tocar } from '../voice/sons';
import { ATRASO_DA_FAIXA_MS, useConexao, useDigitando, usePresenca } from './store';

/**
 * Liga o gateway ao resto do aplicativo.
 *
 * Um hook só, montado uma vez no shell. Espalhar assinaturas de socket pelos
 * componentes produz o clássico "chegou duas vezes porque dois componentes
 * ouviam o mesmo evento".
 */
export function useGateway(): void {
  const qc = useQueryClient();
  const { show } = useToast();
  const meuId = useAuth((s) => s.user?.id);
  const meuUsername = useAuth((s) => s.user?.username);
  const autenticado = useAuth((s) => s.status === 'authenticated');

  const setEstado = useConexao((s) => s.setEstado);
  const setMostrarFaixa = useConexao((s) => s.setMostrarFaixa);

  // --- conexão -------------------------------------------------------------
  useEffect(() => {
    if (!autenticado) return;
    ws.conectar();
    return () => ws.desconectar();
  }, [autenticado]);

  // --- estado e faixa de desconexão ---------------------------------------
  useEffect(() => {
    let atraso: ReturnType<typeof setTimeout> | null = null;

    const parar = ws.onEstado((estado) => {
      setEstado(estado);

      if (estado === 'aberto') {
        if (atraso) clearTimeout(atraso);
        atraso = null;
        setMostrarFaixa(false);
        return;
      }

      // A faixa só aparece depois de 2s. Uma queda de meio segundo, que o
      // backoff resolve sozinho, não merece mexer no layout da tela.
      if (estado === 'caido' && !atraso) {
        atraso = setTimeout(() => {
          atraso = null;
          setMostrarFaixa(true);
        }, ATRASO_DA_FAIXA_MS);
      }
    });

    return () => {
      if (atraso) clearTimeout(atraso);
      parar();
    };
  }, [setEstado, setMostrarFaixa]);

  // --- eventos -------------------------------------------------------------
  useEffect(() => {
    if (!autenticado || !meuId) return;

    const inscricoes = [
      ws.on('READY', (d) => {
        qc.setQueryData<User[]>(['users'], d.users);
        qc.setQueryData<Channel[]>(['channels'], d.channels);
        usePresenca.getState().substituir(
          Object.fromEntries(
            d.users.map((u) => [u.id, { status: u.status, customStatus: u.customStatus }]),
          ),
        );
        useLeitura.getState().substituir(d.readState);
        // Quem entra depois recebe as chamadas em andamento no READY: sem
        // isto, abrir o aplicativo com gente numa sala mostraria a sala vazia
        // até alguém mexer.
        useVoz.getState().substituirEstados(d.voiceStates);
      }),

      ws.on('VOICE_STATE_UPDATE', (d) => {
        const voz = useVoz.getState();
        const antes = voz.estados[d.userId];
        voz.aplicarEstado(d);

        // Som só de quem chega e sai da **sua** chamada, e desligado por
        // padrão: com cinco pessoas entrando o dia inteiro, ligado vira ruído
        // que se aprende a ignorar. Nunca há notificação de entrada.
        if (d.userId === meuId || voz.fase !== 'conectado' || !voz.channelId) return;
        if (d.connected && !antes && d.channelId === voz.channelId) tocar('alguemEntrou');
        if (!d.connected && antes?.channelId === voz.channelId) tocar('alguemSaiu');
      }),

      ws.on('MESSAGE_CREATE', (d) => {
        if (d.clientNonce) confirmarNonce(d.clientNonce);
        receberMensagem(qc, d);
        // Quem mandou parou de digitar por definição.
        useDigitando.getState().esquecer(d.channelId, d.author.id);

        // O que você mesmo escreveu nunca conta como não lido, e resposta de
        // thread não muda o estado da linha principal.
        if (d.author.id === meuId || d.parentId) return;
        const citou = Boolean(
          meuUsername && mencionados(analisarMarkdown(d.content ?? '')).has(meuUsername),
        );
        useLeitura.getState().somar(d.channelId, citou);
      }),

      ws.on('MESSAGE_UPDATE', (d) => atualizarMensagem(qc, d)),
      ws.on('MESSAGE_DELETE', (d) => removerMensagem(qc, d.id, d.channelId)),
      ws.on('REACTION_ADD', (d) => mexerNaReacao(qc, d, meuId, true)),
      ws.on('REACTION_REMOVE', (d) => mexerNaReacao(qc, d, meuId, false)),

      ws.on('TYPING_START', (d) => {
        if (d.userId === meuId) return;
        useDigitando.getState().marcar(d.channelId, d.userId);
      }),

      ws.on('PRESENCE_UPDATE', (d) => {
        usePresenca.getState().definir(d.userId, {
          status: d.status,
          customStatus: d.customStatus,
        });
      }),

      ws.on('USER_UPDATE', (d) => {
        qc.setQueryData<User[]>(['users'], (atuais) =>
          atuais?.map((u) => (u.id === d.id ? d : u)),
        );
      }),

      ws.on('CHANNEL_CREATE', (d) => {
        qc.setQueryData<Channel[]>(['channels'], (atuais) =>
          atuais ? [...atuais.filter((c) => c.id !== d.id), d] : [d],
        );
      }),
      ws.on('CHANNEL_UPDATE', (d) => {
        qc.setQueryData<Channel[]>(['channels'], (atuais) =>
          atuais?.map((c) => (c.id === d.id ? d : c)),
        );
      }),
      ws.on('CHANNEL_DELETE', (d) => {
        qc.setQueryData<Channel[]>(['channels'], (atuais) =>
          atuais?.filter((c) => c.id !== d.id),
        );
        qc.removeQueries({ queryKey: chaveDoCanal(d.id) });
      }),

      // Cargo mudou sem reconectar: a interface obedece na hora, e o servidor
      // já obedecia antes — a checagem que vale é a de lá.
      ws.on('PERMISSIONS_UPDATE', (d) => {
        useAuth.setState({ permissions: BigInt(d.permissions) });
      }),

      ws.on('TASK_UPDATE', (d) => {
        receberTarefa(qc, d.task, d.removida ?? false);
      }),

      ws.on('READ_STATE_UPDATE', (d) => {
        useLeitura.getState().zerar(d.channelId, d.lastReadMessageId);
      }),

      ws.on('ERROR', (d) => {
        show(d.message, 'danger');
      }),
    ];

    return () => {
      for (const cancelar of inscricoes) cancelar();
    };
  }, [autenticado, meuId, meuUsername, qc, show]);

  // --- recuperação depois de reconectar ------------------------------------
  useEffect(() => {
    if (!autenticado) return;

    return ws.onAbertura(({ reconexao }) => {
      if (!reconexao) return;

      // Só os canais que já estão no cache: buscar histórico de canal que
      // ninguém abriu é trabalho para ninguém ver.
      const canais = qc
        .getQueryCache()
        .findAll({ queryKey: ['messages'] })
        .map((q) => q.queryKey[1])
        .filter((id): id is string => typeof id === 'string');

      for (const channelId of canais) {
        void recuperarDesdeAUltima(qc, channelId).catch(() => {
          void qc.invalidateQueries({ queryKey: chaveDoCanal(channelId) });
        });
      }
    });
  }, [autenticado, qc]);
}
