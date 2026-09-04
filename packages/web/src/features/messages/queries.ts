import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { Message } from '@trindade/shared';
import { api } from '../../lib/http';

/**
 * Cache do histórico.
 *
 * A lista é **plana e crescente**, não páginas: mensagem otimista, evento do
 * socket, edição, remoção e reação mexem todas no mesmo array, e um
 * `useInfiniteQuery` obrigaria a achar em qual página cada uma caiu antes de
 * mudar qualquer coisa.
 *
 * `staleTime: Infinity` e nenhum refetch automático: novidade chega pelo
 * WebSocket, e não por consulta repetida. Ver prompts/fase-05-realtime-mensagens.md.
 */

export type EstadoLocal = 'enviando' | 'na-fila' | 'falhou';

export interface MensagemLocal extends Message {
  /** Só existe enquanto a mensagem não foi confirmada pelo servidor. */
  local?: EstadoLocal;
}

export interface CacheCanal {
  mensagens: MensagemLocal[];
  temMaisAntigas: boolean;
}

interface RespostaHistorico {
  messages: Message[];
  hasMore: boolean;
}

export const PAGINA = 50;

export function chaveDoCanal(channelId: string): [string, string] {
  return ['messages', channelId];
}

export function chaveDaThread(parentId: string): [string, string] {
  return ['thread', parentId];
}

export interface CacheDeThread {
  parent: MensagemLocal;
  replies: MensagemLocal[];
}

export function useMessages(channelId: string | undefined) {
  return useQuery({
    queryKey: chaveDoCanal(channelId ?? ''),
    enabled: Boolean(channelId),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    queryFn: async (): Promise<CacheCanal> => {
      const r = await api<RespostaHistorico>(`/channels/${channelId}/messages?limit=${PAGINA}`);
      return { mensagens: r.messages, temMaisAntigas: r.hasMore };
    },
  });
}

/** Carrega a página anterior e devolve quantas entraram, para compensar a rolagem. */
export function useCarregarAntigas(channelId: string | undefined) {
  const qc = useQueryClient();
  const [carregando, setCarregando] = useState(false);
  // Guarda contra duas chamadas no mesmo quadro: o gatilho é a rolagem, que
  // dispara muitas vezes por segundo enquanto a lista está perto do topo.
  const emVoo = useRef(false);

  const carregar = useCallback(async (): Promise<number> => {
    if (!channelId || emVoo.current) return 0;

    const atual = qc.getQueryData<CacheCanal>(chaveDoCanal(channelId));
    const maisAntiga = atual?.mensagens.find((m) => !m.local);
    if (!atual?.temMaisAntigas || !maisAntiga) return 0;

    emVoo.current = true;
    setCarregando(true);
    try {
      const r = await api<RespostaHistorico>(
        `/channels/${channelId}/messages?limit=${PAGINA}&before=${maisAntiga.id}`,
      );
      qc.setQueryData<CacheCanal>(chaveDoCanal(channelId), (anterior) => {
        if (!anterior) return anterior;
        const conhecidas = new Set(anterior.mensagens.map((m) => m.id));
        const novas = r.messages.filter((m) => !conhecidas.has(m.id));
        return { mensagens: [...novas, ...anterior.mensagens], temMaisAntigas: r.hasMore };
      });
      return r.messages.length;
    } finally {
      emVoo.current = false;
      setCarregando(false);
    }
  }, [channelId, qc]);

  return { carregar, carregando };
}

// --- escritas no cache -----------------------------------------------------

function mexer(
  qc: QueryClient,
  channelId: string,
  fn: (cache: CacheCanal) => CacheCanal,
): void {
  qc.setQueryData<CacheCanal>(chaveDoCanal(channelId), (atual) =>
    atual ? fn(atual) : atual,
  );
}

/**
 * Insere ou substitui.
 *
 * Se a mensagem carrega um `clientNonce` que existe na lista, ela **toma o
 * lugar** da otimista — mesmo índice, sem remover e reinserir. É o que faz a
 * confirmação não piscar: para o DOM, nada se moveu.
 *
 * Resposta de thread **não entra na lista do canal**: o histórico filtra
 * `parent_id is null`, então deixá-la entrar pelo socket criaria uma linha que
 * some no primeiro recarregamento. Ela vai para a thread e soma no rodapé da
 * mensagem-mãe.
 */
export function receberMensagem(qc: QueryClient, mensagem: Message): void {
  if (mensagem.parentId) {
    receberNaThread(qc, mensagem);
    somarNaThread(qc, mensagem);
    return;
  }

  mexer(qc, mensagem.channelId, (cache) => {
    if (mensagem.clientNonce) {
      const i = cache.mensagens.findIndex((m) => m.clientNonce === mensagem.clientNonce);
      if (i >= 0) {
        const copia = [...cache.mensagens];
        copia[i] = mensagem;
        return { ...cache, mensagens: copia };
      }
    }

    // Reenvio do servidor ou evento duplicado: nunca duplique por id.
    if (cache.mensagens.some((m) => m.id === mensagem.id)) return cache;

    return { ...cache, mensagens: [...cache.mensagens, mensagem] };
  });
}

export function atualizarMensagem(qc: QueryClient, mensagem: Message): void {
  mexer(qc, mensagem.channelId, (cache) => ({
    ...cache,
    mensagens: cache.mensagens.map((m) => (m.id === mensagem.id ? mensagem : m)),
  }));
}

/**
 * Apagar é marcar, não remover.
 *
 * A linha continua na lista com `deletedAt`, mostrando "Mensagem apagada". Se
 * ela sumisse, o histórico se fecharia sob os olhos de quem está lendo e o
 * agrupamento das vizinhas mudaria sozinho.
 */
export function removerMensagem(qc: QueryClient, id: string, channelId: string): void {
  mexer(qc, channelId, (cache) => ({
    ...cache,
    mensagens: cache.mensagens.map((m) =>
      m.id === id ? { ...m, content: null, deletedAt: new Date().toISOString(), reactions: [] } : m,
    ),
  }));
}

export function mexerNaReacao(
  qc: QueryClient,
  d: { messageId: string; channelId: string; userId: string; emoji: string },
  meuId: string,
  adicionar: boolean,
): void {
  mexer(qc, d.channelId, (cache) => ({
    ...cache,
    mensagens: cache.mensagens.map((m) => {
      if (m.id !== d.messageId) return m;
      const reacoes = [...m.reactions];
      const i = reacoes.findIndex((r) => r.emoji === d.emoji);
      const eu = d.userId === meuId;

      if (adicionar) {
        const atual = reacoes[i];
        if (atual) reacoes[i] = { ...atual, count: atual.count + 1, me: atual.me || eu };
        else reacoes.push({ emoji: d.emoji, count: 1, me: eu });
      } else if (i >= 0) {
        const atual = reacoes[i];
        if (atual && atual.count <= 1) reacoes.splice(i, 1);
        else if (atual) reacoes[i] = { ...atual, count: atual.count - 1, me: atual.me && !eu };
      }

      return { ...m, reactions: reacoes };
    }),
  }));
}

export function inserirOtimista(qc: QueryClient, mensagem: MensagemLocal): void {
  mexer(qc, mensagem.channelId, (cache) => ({
    ...cache,
    mensagens: [...cache.mensagens, mensagem],
  }));
}

export function marcarLocal(
  qc: QueryClient,
  channelId: string,
  clientNonce: string,
  estado: EstadoLocal | undefined,
): void {
  mexer(qc, channelId, (cache) => ({
    ...cache,
    mensagens: cache.mensagens.map((m) => {
      if (m.clientNonce !== clientNonce || !m.local) return m;
      const { local: _, ...resto } = m;
      return estado ? { ...resto, local: estado } : resto;
    }),
  }));
}

export function descartarOtimista(qc: QueryClient, channelId: string, clientNonce: string): void {
  mexer(qc, channelId, (cache) => ({
    ...cache,
    mensagens: cache.mensagens.filter((m) => !(m.local && m.clientNonce === clientNonce)),
  }));
}

/**
 * Depois de reconectar, busca o que passou desde a última mensagem conhecida.
 *
 * Recarregar o canal inteiro seria mais simples e jogaria fora a posição de
 * rolagem de quem estava lendo o histórico. Aqui só o rabo da lista muda.
 */
export async function recuperarDesdeAUltima(qc: QueryClient, channelId: string): Promise<void> {
  const cache = qc.getQueryData<CacheCanal>(chaveDoCanal(channelId));
  if (!cache) return;

  const ultima = [...cache.mensagens].reverse().find((m) => !m.local);
  if (!ultima) {
    await qc.invalidateQueries({ queryKey: chaveDoCanal(channelId) });
    return;
  }

  const r = await api<RespostaHistorico>(
    `/channels/${channelId}/messages?limit=${PAGINA}&after=${ultima.id}`,
  );
  for (const mensagem of r.messages) receberMensagem(qc, mensagem);

  // Mais de uma página perdida: o buraco no meio não se fecha adicionando o
  // fim. Recomeça do zero, que é o único jeito honesto.
  if (r.hasMore) await qc.invalidateQueries({ queryKey: chaveDoCanal(channelId) });
}

// --- threads ---------------------------------------------------------------

function receberNaThread(qc: QueryClient, mensagem: Message): void {
  const parentId = mensagem.parentId;
  if (!parentId) return;

  qc.setQueryData<CacheDeThread>(chaveDaThread(parentId), (atual) => {
    if (!atual) return atual;

    if (mensagem.clientNonce) {
      const i = atual.replies.findIndex((m) => m.clientNonce === mensagem.clientNonce);
      if (i >= 0) {
        const copia = [...atual.replies];
        copia[i] = mensagem;
        return { ...atual, replies: copia };
      }
    }
    if (atual.replies.some((m) => m.id === mensagem.id)) return atual;
    return { ...atual, replies: [...atual.replies, mensagem] };
  });
}

/** O rodapé "3 respostas · há 2 h" da mensagem-mãe, sem ir ao servidor. */
function somarNaThread(qc: QueryClient, resposta: Message): void {
  const parentId = resposta.parentId;
  if (!parentId) return;

  mexer(qc, resposta.channelId, (cache) => ({
    ...cache,
    mensagens: cache.mensagens.map((m) =>
      m.id === parentId
        ? { ...m, threadCount: m.threadCount + 1, threadLastReplyAt: resposta.createdAt }
        : m,
    ),
  }));
}

export function inserirOtimistaNaThread(qc: QueryClient, mensagem: MensagemLocal): void {
  const parentId = mensagem.parentId;
  if (!parentId) return;
  qc.setQueryData<CacheDeThread>(chaveDaThread(parentId), (atual) =>
    atual ? { ...atual, replies: [...atual.replies, mensagem] } : atual,
  );
}
