import type { FastifyBaseLogger } from 'fastify';
import { sql } from '../db/index.js';
import { varrerAnexosOrfaos } from './varredura-de-anexos.js';
import { fecharVencidas } from './enquete.js';

/**
 * A faxina periódica.
 *
 * Quatro coisas que crescem para sempre se ninguém as varrer: arquivo que
 * ninguém enviou, nonce de deduplicação que já cumpriu o prazo, token de
 * atualização vencido e trilha de auditoria antiga. Mais uma que não cresce mas
 * vence: a enquete com prazo.
 *
 * Cada uma é uma função sozinha, e por isso testável sem esperar uma hora. O
 * agendador só as chama. Ver prompts/fase-08-endurecimento.md.
 */

/**
 * O `client_nonce` deduplica o reenvio de uma mensagem: se a resposta se perdeu
 * e o cliente tentou de novo, o índice único recusa a segunda cópia. Passadas
 * 24 horas não há mais reenvio possível — o cliente já desistiu há muito —, e
 * guardar o valor só ocupa espaço no índice.
 */
export async function limparNonces(): Promise<number> {
  const linhas = await sql<{ id: string }[]>`
    update messages
       set client_nonce = null
     where client_nonce is not null
       and created_at < now() - interval '24 hours'
    returning id
  `;
  return linhas.length;
}

/**
 * Token vencido não autentica mais ninguém, mas a linha ainda serve para
 * detectar reuso — alguém apresentando um token antigo é sinal de roubo. Trinta
 * dias é o prazo em que essa detecção ainda diz alguma coisa; depois, é só
 * peso.
 */
export async function limparRefreshVencidos(): Promise<number> {
  const linhas = await sql<{ id: string }[]>`
    delete from refresh_tokens
     where expires_at < now() - interval '30 days'
    returning id
  `;
  return linhas.length;
}

/**
 * A auditoria responde "quem fez isto?" — e essa pergunta tem prazo. Seis meses
 * cobre qualquer investigação real numa equipe de cinco; guardar mais é acumular
 * um histórico de quem fez o quê sem ninguém para consultá-lo, o que é risco sem
 * contrapartida.
 */
export async function limparAuditoriaAntiga(): Promise<number> {
  const linhas = await sql<{ id: string }[]>`
    delete from audit_log
     where created_at < now() - interval '180 days'
    returning id
  `;
  return linhas.length;
}

export interface ResultadoDaFaxina {
  anexos: number;
  nonces: number;
  refresh: number;
  auditoria: number;
  enquetes: number;
}

/**
 * Uma volta inteira.
 *
 * Cada tarefa é isolada: a que falhar não impede as outras, e a volta seguinte
 * tenta de novo. Uma faxina que aborta na primeira pedra deixa o resto crescendo.
 */
export async function faxinar(log: FastifyBaseLogger): Promise<ResultadoDaFaxina> {
  const resultado: ResultadoDaFaxina = {
    anexos: 0,
    nonces: 0,
    refresh: 0,
    auditoria: 0,
    enquetes: 0,
  };

  const tarefas: [keyof ResultadoDaFaxina, () => Promise<number>][] = [
    ['anexos', () => varrerAnexosOrfaos(log)],
    ['nonces', limparNonces],
    ['refresh', limparRefreshVencidos],
    ['auditoria', limparAuditoriaAntiga],
    // A única que não é limpeza: ela **fecha** o que venceu. Está aqui porque
    // é a mesma volta de hora em hora, e ligar um segundo relógio para uma
    // varredura de dezenas de linhas seria peso sem motivo.
    ['enquetes', fecharVencidas],
  ];

  for (const [nome, tarefa] of tarefas) {
    try {
      resultado[nome] = await tarefa();
    } catch (err) {
      log.error({ err, tarefa: nome }, 'a faxina falhou numa tarefa');
    }
  }

  const total = Object.values(resultado).reduce((a, b) => a + b, 0);
  if (total > 0) log.info(resultado, 'faxina');
  return resultado;
}

/** De hora em hora. Nada aqui tem pressa, e nada aqui pode ficar sem acontecer. */
const INTERVALO_MS = 60 * 60 * 1000;

/**
 * Liga a faxina periódica e devolve como desligá-la.
 *
 * Sem `node-cron`: o intervalo é de uma hora e não há regra de calendário
 * envolvida — uma dependência para dizer "de hora em hora" é uma dependência a
 * mais para atualizar e auditar. A primeira volta sai depois do primeiro
 * intervalo, e não na subida: reiniciar a API dez vezes seguidas não deve
 * disparar dez faxinas.
 */
export function agendarFaxina(log: FastifyBaseLogger): () => void {
  const relogio = setInterval(() => {
    void faxinar(log).catch((err: unknown) => log.error({ err }, 'a faxina falhou'));
  }, INTERVALO_MS);

  // Sem `unref`, o processo não termina sozinho enquanto o timer estiver de pé.
  relogio.unref();
  return () => clearInterval(relogio);
}
