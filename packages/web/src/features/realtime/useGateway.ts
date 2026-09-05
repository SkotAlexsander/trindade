import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Channel, Message, Task, User } from '@trindade/shared';
import { useToast } from '../../components';
import { irPara } from '../../lib/navegacao';
import * as ws from '../../lib/ws';
import { useAuth } from '../auth/store';
import {
  atualizarMensagem,
  chaveDoCanal,
  mexerNaReacao,
  receberMensagem,
  recuperarDesdeAUltima,
  removerMensagem,
  type CacheCanal,
} from '../messages/queries';
import { confirmarNonce } from '../messages/useEnviar';
import { useLeitura } from '../messages/leitura';
import { analisarMarkdown, citaVoce, mencionados } from '../messages/markdown';
import { alvoDaMensagem, canal, idDoAlvo, type Alvo } from '../messages/alvo';
import { mensagemNaConversa, receberConversa } from '../conversations/queries';
import { avisar } from '../notifications/motor';
import type { Motivo } from '../notifications/regras';
import { receberEnquete } from '../polls/queries';
import { receberTarefa } from '../tasks/queries';
import { receberQuadro } from '../boards/queries';
import { useApresentacoes } from '../boards/apresentacoes';
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
        // E as apresentações, pela mesma razão: entrar no meio de uma e não
        // ver nada seria pior que não ter a funcionalidade.
        useApresentacoes.getState().substituir(d.presentations);
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

        const alvoId = idDoAlvo(d);
        // A conversa sobe para o topo da lista, e uma direta que ainda não
        // tinha mensagem passa a aparecer nela.
        mensagemNaConversa(qc, d);
        // Quem mandou parou de digitar por definição.
        useDigitando.getState().esquecer(alvoId, d.author.id);

        if (d.author.id === meuId) return;

        const blocos = analisarMarkdown(d.content ?? '');
        /* A mesma regra que pinta a linha da mensagem, em `Message.tsx`: uma
           pergunta, uma resposta, um lugar. Quem escreveu já saiu duas linhas
           acima, então aqui nunca somos o autor. */
        const citou = citaVoce(blocos, meuUsername);
        // `@aqui` é outro assunto: ele não chama você, chama quem está online.
        const citados = mencionados(blocos);

        const canal = qc
          .getQueryData<Channel[]>(['channels'])
          ?.find((c) => c.id === d.channelId);

        /* Conversa privada **notifica como menção**: alguém falou diretamente
           com você. É a exceção da tabela de design/09-notificacoes.md, e ela
           cabe aqui porque é o motivo que muda, não a regra. */
        const motivo = d.conversationId
          ? ('mencao' as const)
          : motivoDaMensagem(d, {
              citou,
              aqui: citados.has('aqui'),
              respondeuVoce: respondeuVoce(qc, d, meuId),
            });

        const decisao = avisar({
          motivo,
          channelId: alvoId,
          autorId: d.author.id,
          titulo: d.conversationId
            ? d.author.displayName
            : `${d.author.displayName}${canal ? ` em #${canal.name}` : ''}`,
          corpo: d.content ?? '(anexo)',
          ir: () => {
            if (d.conversationId) irPara(`/d/${d.conversationId}?m=${d.id}`);
            else if (canal) irPara(`/c/${canal.slug}?m=${d.id}`);
          },
        });

        /* O contador conta o que a regra chamou de `badge`, e não "tinha `@`":
           resposta à sua mensagem e movimento na thread também chamam você.
           Resposta de thread não conta como não lida, porém — ela não muda o
           estado da linha principal do canal. */
        useLeitura.getState().somar(alvoId, decisao.badge, !d.parentId);
      }),

      ws.on('MESSAGE_UPDATE', (d) => atualizarMensagem(qc, d)),
      ws.on('MESSAGE_DELETE', (d) => removerMensagem(qc, d.id, d.conversationId ?? d.channelId ?? '')),
      ws.on('REACTION_ADD', (d) => mexerNaReacao(qc, d, meuId, true)),
      ws.on('REACTION_REMOVE', (d) => mexerNaReacao(qc, d, meuId, false)),

      ws.on('TYPING_START', (d) => {
        if (d.userId === meuId) return;
        useDigitando.getState().marcar(d.conversationId ?? d.channelId ?? '', d.userId);
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

      ws.on('TASK_REMINDER', (d) => {
        if (d.tasks.length === 0) return;
        const primeira = d.tasks[0];
        if (!primeira) return;

        const canal = qc
          .getQueryData<Channel[]>(['channels'])
          ?.find((c) => c.id === primeira.channelId);

        // Um aviso com a lista, e não um por tarefa: três prazos no mesmo dia
        // são um lembrete de três linhas, não três interrupções às nove.
        avisar({
          motivo: 'prazo',
          channelId: primeira.channelId,
          autorId: null,
          titulo: d.tasks.length === 1 ? 'Vence hoje' : `${d.tasks.length} tarefas vencem hoje`,
          corpo: d.tasks.map((t) => t.title).join(' · '),
          ir: () => {
            if (canal) irPara(`/c/${canal.slug}`);
          },
        });
      }),

      ws.on('CONVERSATION_UPDATE', (d) => {
        receberConversa(qc, d.conversation);
      }),

      ws.on('BOARD_LIST_UPDATE', (d) => {
        receberQuadro(qc, d.board, d.removido ?? false);
      }),

      ws.on('PRESENTATION_UPDATE', (d) => {
        useApresentacoes.getState().aplicar(d.presentation, d.ativo);
      }),

      ws.on('POLL_UPDATE', (d) => {
        receberEnquete(qc, d.poll);
      }),

      ws.on('TASK_UPDATE', (d) => {
        const antes = qc
          .getQueryData<Task[]>(['tasks', d.task.channelId])
          ?.find((t) => t.id === d.task.id);
        receberTarefa(qc, d.task, d.removida ?? false);

        /* Só a **passagem** para você notifica. Sem comparar com o estado
           anterior, arrastar um cartão que já é seu avisaria de novo a cada
           movimento — e quem move é quase sempre o dono. */
        if (d.removida || d.task.assigneeId !== meuId) return;
        if (antes?.assigneeId === meuId) return;

        const canal = qc
          .getQueryData<Channel[]>(['channels'])
          ?.find((c) => c.id === d.task.channelId);
        avisar({
          motivo: 'tarefa',
          channelId: d.task.channelId,
          autorId: d.task.createdBy,
          titulo: `Tarefa para você${canal ? ` em #${canal.name}` : ''}`,
          corpo: d.task.title,
          ir: () => {
            if (canal) irPara(`/c/${canal.slug}`);
          },
        });
      }),

      ws.on('READ_STATE_UPDATE', (d) => {
        // `aplicar` e não `zerar`: o evento também é como o silêncio do canal
        // chega às outras abas, e zerar perderia justamente esse campo.
        useLeitura.getState().aplicar(d);
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

      // Só o que já está no cache — canal ou conversa: buscar histórico de
      // lugar que ninguém abriu é trabalho para ninguém ver.
      const abertos = qc
        .getQueryCache()
        .findAll({ queryKey: ['messages'] })
        .map((q) => q.queryKey[1])
        .filter((id): id is string => typeof id === 'string');

      for (const alvoId of abertos) {
        void recuperarDesdeAUltima(qc, alvoDoCache(qc, alvoId)).catch(() => {
          void qc.invalidateQueries({ queryKey: chaveDoCanal(alvoId) });
        });
      }
    });
  }, [autenticado, qc]);
}

/**
 * Por que esta mensagem notificaria.
 *
 * A ordem é a da tabela de design/09-notificacoes.md: menção direta ganha de
 * `@aqui`, que ganha de resposta, que ganha de thread. Sem ordem, uma menção
 * dentro de uma thread viraria só "thread" e perderia o som de chamado.
 */
function motivoDaMensagem(
  d: { replyToId: string | null; parentId: string | null },
  ctx: { citou: boolean; aqui: boolean; respondeuVoce: boolean },
): Motivo {
  if (ctx.citou) return 'mencao';
  if (ctx.aqui) return 'aqui';
  if (ctx.respondeuVoce) return 'resposta';
  if (d.parentId) return 'thread';
  return 'canal';
}

/**
 * A mensagem responde uma sua?
 *
 * Só dá para saber se a citada estiver no cache — e ela quase sempre está,
 * porque responder é responder a algo que acabou de passar. Fora do cache, a
 * mensagem cai em "canal" e o ponto na lista dá conta: notificar por engano é
 * pior que não notificar.
 */
function respondeuVoce(
  qc: QueryClient,
  d: Pick<Message, 'channelId' | 'conversationId' | 'replyToId'>,
  meuId: string,
): boolean {
  if (!d.replyToId) return false;
  const cache = qc.getQueryData<CacheCanal>(chaveDoCanal(idDoAlvo(d)));
  return cache?.mensagens.some((m) => m.id === d.replyToId && m.author.id === meuId) ?? false;
}

/**
 * Canal ou conversa, a partir do que já está no cache.
 *
 * A chave do cache é só o id, e ele não diz de que tipo é. A primeira mensagem
 * guardada diz — e quando não há nenhuma, `recuperarDesdeAUltima` não tem de
 * onde continuar e sai sozinha, então o palpite de canal não custa nada.
 */
function alvoDoCache(qc: QueryClient, alvoId: string): Alvo {
  const cache = qc.getQueryData<CacheCanal>(chaveDoCanal(alvoId));
  const primeira = cache?.mensagens.find((m) => !m.local);
  return primeira ? alvoDaMensagem(primeira) : canal(alvoId);
}
