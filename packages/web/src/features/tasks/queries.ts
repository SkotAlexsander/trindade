import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ColunaDoQuadro, Task } from '@trindade/shared';
import { api } from '../../lib/http';

/**
 * O quadro do canal.
 *
 * Uma consulta por canal, e o `TASK_UPDATE` do WebSocket escreve direto no
 * cache — arrastar um cartão numa aba move na outra sem ninguém recarregar
 * nada. Ver design/08-projeto.md.
 */

export const chaveDoQuadro = (channelId: string) => ['tasks', channelId] as const;

export function useTarefas(channelId: string | undefined) {
  return useQuery({
    queryKey: chaveDoQuadro(channelId ?? ''),
    enabled: Boolean(channelId),
    queryFn: () => api<{ tasks: Task[] }>(`/channels/${channelId}/tasks`).then((r) => r.tasks),
    staleTime: 30_000,
  });
}

/** Chega pelo gateway: uma tarefa nasceu, mudou ou saiu. */
export function receberTarefa(qc: QueryClient, task: Task, removida = false): void {
  qc.setQueryData<Task[]>(chaveDoQuadro(task.channelId), (atuais) => {
    const lista = atuais ?? [];
    const sem = lista.filter((t) => t.id !== task.id);
    return removida ? sem : [...sem, task];
  });
}

export interface Movimento {
  id: string;
  columnKey: ColunaDoQuadro;
  position: number;
}

export function useMoverTarefa(channelId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (m: Movimento) =>
      api<{ task: Task }>(`/tasks/${m.id}`, {
        method: 'PATCH',
        body: { columnKey: m.columnKey, position: m.position },
      }),
    // Otimista: arrastar tem de parecer instantâneo, e o servidor confirma
    // pelo mesmo `TASK_UPDATE` que os outros recebem.
    onMutate: (m) => {
      const antes = qc.getQueryData<Task[]>(chaveDoQuadro(channelId));
      qc.setQueryData<Task[]>(chaveDoQuadro(channelId), (atuais) =>
        (atuais ?? []).map((t) =>
          t.id === m.id ? { ...t, columnKey: m.columnKey, position: m.position } : t,
        ),
      );
      return { antes };
    },
    onError: (_erro, _m, contexto) => {
      if (contexto?.antes) qc.setQueryData(chaveDoQuadro(channelId), contexto.antes);
    },
  });
}

export function useCriarTarefa(channelId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: {
      title: string;
      assigneeId?: string | null;
      dueAt?: string | null;
      sourceMessageId?: string | null;
    }) => api<{ task: Task }>(`/channels/${channelId}/tasks`, { method: 'POST', body: entrada }),
    onSuccess: ({ task }) => receberTarefa(qc, task),
  });
}

/**
 * Dono e prazo, os dois únicos campos do cartão além do título.
 *
 * Sem `channelId`: a tarefa que volta diz a que canal pertence, e é dela que
 * sai a chave do cache.
 */
export function useAtribuirTarefa() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: { id: string; assigneeId?: string | null; dueAt?: string | null }) => {
      const { id, ...campos } = entrada;
      return api<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body: campos });
    },
    onSuccess: ({ task }) => receberTarefa(qc, task),
  });
}

export function useConcluirTarefa() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (entrada: { id: string; concluida: boolean }) =>
      api<{ task: Task }>(`/tasks/${entrada.id}`, {
        method: 'PATCH',
        body: {
          concluida: entrada.concluida,
          // Concluir move para "Feito"; desfazer devolve para "A fazer". As
          // duas coisas juntas porque a coluna e o estado são a mesma
          // informação vista de dois lados.
          columnKey: entrada.concluida ? 'done' : 'todo',
        },
      }),
    onSuccess: ({ task }) => receberTarefa(qc, task),
  });
}

/**
 * A posição de quem cai entre dois cartões: a média das vizinhas.
 *
 * Uma linha atualizada, sem reindexar a coluna — com índices inteiros, mover o
 * primeiro cartão reescreveria todos, e duas pessoas arrastando ao mesmo tempo
 * viraria corrida.
 */
export function posicaoEntre(anterior: Task | undefined, proxima: Task | undefined): number {
  if (!anterior && !proxima) return 1000;
  if (!anterior) return (proxima as Task).position - 1000;
  if (!proxima) return anterior.position + 1000;
  return (anterior.position + proxima.position) / 2;
}
