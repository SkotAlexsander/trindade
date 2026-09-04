import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Poll } from '@trindade/shared';
import { api } from '../../lib/http';

/**
 * As enquetes de um canal.
 *
 * Uma consulta por canal, indexada pela mensagem: a enquete **é** uma mensagem,
 * e é a linha da conversa que a desenha. O `POLL_UPDATE` escreve direto no
 * cache — o voto de alguém muda a barra na tela dos outros sem recarregar nada.
 * Ver design/08-projeto.md.
 */

export const chaveDasEnquetes = (channelId: string) => ['polls', channelId] as const;

export function useEnquetes(channelId: string | undefined) {
  return useQuery({
    queryKey: chaveDasEnquetes(channelId ?? ''),
    enabled: Boolean(channelId),
    queryFn: () => api<{ polls: Poll[] }>(`/channels/${channelId}/polls`).then((r) => r.polls),
    staleTime: 30_000,
  });
}

/** Chega pelo gateway, já montado do ponto de vista de quem recebe. */
export function receberEnquete(qc: QueryClient, poll: Poll): void {
  qc.setQueryData<Poll[]>(chaveDasEnquetes(poll.channelId), (atuais) => [
    ...(atuais ?? []).filter((p) => p.id !== poll.id),
    poll,
  ]);
}

export interface NovaEnquete {
  question: string;
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  closesAt: string | null;
  clientNonce: string;
}

export function useCriarEnquete(channelId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: NovaEnquete) =>
      api<{ poll: Poll }>(`/channels/${channelId}/polls`, { method: 'POST', body: entrada }),
    onSuccess: ({ poll }) => receberEnquete(qc, poll),
  });
}

export function useVotar() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: { pollId: string; optionIds: string[] }) =>
      api<{ poll: Poll }>(`/polls/${entrada.pollId}/vote`, {
        method: 'PUT',
        body: { optionIds: entrada.optionIds },
      }),
    /*
     * Otimista: clicar numa opção tem de mover a barra na hora. O servidor
     * confirma pelo mesmo `POLL_UPDATE` que os outros recebem — e, se recusar,
     * o estado anterior volta inteiro.
     */
    onMutate: ({ pollId, optionIds }) => {
      const chaves = qc.getQueriesData<Poll[]>({ queryKey: ['polls'] });
      for (const [chave, enquetes] of chaves) {
        if (!enquetes?.some((p) => p.id === pollId)) continue;
        qc.setQueryData<Poll[]>(chave, (atuais) =>
          (atuais ?? []).map((p) => (p.id === pollId ? comMeuVoto(p, optionIds) : p)),
        );
      }
      return { chaves };
    },
    onError: (_erro, _entrada, contexto) => {
      for (const [chave, antes] of contexto?.chaves ?? []) qc.setQueryData(chave, antes);
    },
    onSuccess: ({ poll }) => receberEnquete(qc, poll),
  });
}

export function useFecharEnquete() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (pollId: string) =>
      api<{ poll: Poll }>(`/polls/${pollId}/close`, { method: 'POST' }),
    onSuccess: ({ poll }) => receberEnquete(qc, poll),
  });
}

/** "Adicionar o resultado às notas" — só depois de encerrada. */
export function useResultadoParaNotas() {
  return useMutation({
    mutationFn: (pollId: string) => api(`/polls/${pollId}/para-notas`, { method: 'POST' }),
  });
}

/**
 * A enquete como ela fica depois do meu voto, antes de o servidor responder.
 *
 * Tira o voto antigo e põe o novo — inclusive na contagem de pessoas, que não
 * é a soma dos votos: no múltiplo, quem marca três opções continua sendo uma.
 */
export function comMeuVoto(poll: Poll, optionIds: readonly string[]): Poll {
  const antes = poll.myVotes;
  const jaVotava = antes.length > 0;
  const votaAgora = optionIds.length > 0;

  return {
    ...poll,
    options: poll.options.map((o) => {
      const tinha = antes.includes(o.id);
      const tem = optionIds.includes(o.id);
      if (tinha === tem) return o;
      return { ...o, count: o.count + (tem ? 1 : -1) };
    }),
    myVotes: [...optionIds],
    voterCount: poll.voterCount + (votaAgora ? 1 : 0) - (jaVotava ? 1 : 0),
  };
}

/** "fecha em 2 dias", "fecha hoje", "encerrada". */
export function prazoDaEnquete(poll: Poll, agora = Date.now()): string | null {
  if (poll.closedAt) return 'encerrada';
  if (!poll.closesAt) return null;

  const faltam = Date.parse(poll.closesAt) - agora;
  if (faltam <= 0) return 'encerrada';

  const horas = Math.round(faltam / 3_600_000);
  if (horas < 1) return 'fecha em minutos';
  if (horas < 24) return `fecha em ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'fecha amanhã' : `fecha em ${dias} dias`;
}
