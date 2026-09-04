import type { FastifyBaseLogger } from 'fastify';
import * as tasksDb from '../db/tasks.js';
import { toApiTask } from './task-view.js';
import { gateway } from '../ws/index.js';

/**
 * O lembrete das 9h.
 *
 * Uma vez por dia, cada pessoa com tarefa vencendo hoje recebe **um** aviso com
 * a lista — três tarefas no mesmo dia são um lembrete de três linhas, não três
 * interrupções seguidas às nove da manhã.
 *
 * Vai para quem está conectado. Isso não é uma limitação escondida: a
 * notificação é da área de trabalho e depende do produto aberto de qualquer
 * forma, e o quadro continua lá para quem chegar mais tarde. Guardar lembretes
 * para entregar depois transformaria o começo do dia numa pilha de avisos de
 * ontem, que é exatamente o que design/09-notificacoes.md recusa em "ausência
 * longa".
 *
 * O fuso é o do servidor, como pede prompts/fase-09-projeto-notificacoes.md:
 * as cinco pessoas trabalham no mesmo, e converter por pessoa exigiria guardar
 * o fuso de cada uma para ganhar nada.
 */

export const HORA_DO_LEMBRETE = 9;

export async function lembrarPrazos(log: FastifyBaseLogger): Promise<number> {
  try {
    const vencendo = await tasksDb.vencendoHoje();
    if (vencendo.length === 0) return 0;

    const porPessoa = new Map<string, typeof vencendo>();
    for (const tarefa of vencendo) {
      const dono = tarefa.assignee_id;
      if (!dono) continue;
      porPessoa.set(dono, [...(porPessoa.get(dono) ?? []), tarefa]);
    }

    let enviados = 0;
    for (const [userId, tarefas] of porPessoa) {
      if (gateway.sessionsOf(userId).length === 0) continue;
      gateway.sendToUser(userId, {
        op: 'TASK_REMINDER',
        d: { tasks: tarefas.map(toApiTask) },
      });
      enviados += 1;
    }
    return enviados;
  } catch (err) {
    log.error({ err }, 'não consegui mandar os lembretes de prazo');
    return 0;
  }
}

/** Milissegundos até a próxima vez que der 9h. */
export function ateAsNove(agora = new Date()): number {
  const alvo = new Date(agora);
  alvo.setHours(HORA_DO_LEMBRETE, 0, 0, 0);
  if (alvo.getTime() <= agora.getTime()) alvo.setDate(alvo.getDate() + 1);
  return alvo.getTime() - agora.getTime();
}

/**
 * Agenda o próximo lembrete e devolve como cancelar.
 *
 * `setTimeout` até a próxima 9h e reagendamento a cada volta, em vez de um
 * `setInterval` de 24 horas: o intervalo fixo escorrega junto com o horário de
 * verão e com qualquer atraso do processo, e depois de um mês o "lembrete das
 * 9h" chega às 9h40. Sem `node-cron` pelo mesmo motivo da faxina — uma
 * dependência para dizer "todo dia às nove" é uma dependência a mais para
 * atualizar e auditar.
 */
export function agendarLembretes(log: FastifyBaseLogger): () => void {
  let relogio: NodeJS.Timeout;

  const proximo = () => {
    relogio = setTimeout(() => {
      void lembrarPrazos(log).then((quantos) => {
        if (quantos > 0) log.info({ pessoas: quantos }, 'lembretes de prazo');
      });
      proximo();
    }, ateAsNove());
    // Sem `unref`, o processo não termina sozinho enquanto o timer estiver de pé.
    relogio.unref();
  };

  proximo();
  return () => clearTimeout(relogio);
}
