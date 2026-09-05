import { statfs } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { JANELA_DE_ERROS_MS, errosDeServidorRecentes } from '../lib/metricas.js';

/**
 * O alerta.
 *
 * Métrica só serve para quem está olhando. Às três da manhã ninguém está, e o
 * projeto não tem Prometheus: subir Prometheus e Alertmanager para cinco
 * pessoas é uma segunda pilha para manter, atualizar e auditar. Três avisos
 * cobrem o que realmente estraga o dia — disco cheio, erro em série e a API
 * fora — e cabem num webhook.
 *
 * **Nada aqui carrega dado de ninguém.** O destino é um serviço de fora
 * (Discord, Slack, o que for), e o que sai são números e nomes de subsistema:
 * nunca mensagem, nunca usuário, nunca endereço. Ver docs/04-seguranca.md.
 *
 * O que este módulo **não** consegue avisar é a própria morte — processo caído
 * não manda webhook. Esse é o trabalho do `infra/vigia.sh`, que roda fora do
 * contêiner e bate no `/api/health`. Ver docs/08-operacao.md.
 */

export type Assunto = 'disco' | 'erros';

/** Acima disto o disco vira problema antes de virar desastre. */
export const LIMITE_DO_DISCO = 0.85;

/**
 * Cinco pessoas num servidor saudável produzem **zero** 5xx. Dez em cinco
 * minutos nunca é ruído — não precisa de linha de base nem de comparação com a
 * semana passada, que é o tipo de sofisticação que só serve para o alerta
 * chegar tarde.
 */
export const LIMITE_DE_ERROS = 10;

/** De quanto em quanto tempo um problema que continua volta a ser dito. */
export const REPETIR_MS = 6 * 60 * 60 * 1000;

// --- decidir se fala ---------------------------------------------------------

export interface Situacao {
  /** O problema está de pé desde quando (ou `null` se está tudo bem). */
  desde: number | null;
  /** Quando foi o último aviso enviado sobre este assunto. */
  ultimoAviso: number;
}

export type Fala = 'comecou' | 'continua' | 'passou' | null;

/**
 * Um problema, um aviso — e um aviso quando passa.
 *
 * Repetir de cinco em cinco minutos enquanto o disco está em 86% é como se
 * treina uma equipe a ignorar o canal de alertas; e alerta que nunca diz
 * "voltou ao normal" obriga alguém a ir conferir na mão para saber se ainda
 * dói. Fala na virada, repete de seis em seis horas, e fala de novo quando
 * acaba.
 */
export function decidir(situacao: Situacao, ruim: boolean, agora: number): Fala {
  if (ruim) {
    if (situacao.desde === null) return 'comecou';
    return agora - situacao.ultimoAviso >= REPETIR_MS ? 'continua' : null;
  }
  return situacao.desde === null ? null : 'passou';
}

// --- o disco -----------------------------------------------------------------

export interface EspacoEmDisco {
  blocks: number;
  bfree: number;
  bavail: number;
}

/**
 * A fração usada, **do jeito que o `df` conta**.
 *
 * O sistema de arquivos reserva blocos para o root, e por isso `bfree` (livre)
 * é maior que `bavail` (disponível para nós). Contar `1 - bavail/blocks` daria
 * um número diferente do que a pessoa vê quando entra no servidor e roda `df`,
 * e alerta que discorda da ferramenta é alerta que ninguém acredita.
 */
export function usoDoDisco(espaco: EspacoEmDisco): number {
  const usados = espaco.blocks - espaco.bfree;
  const total = usados + espaco.bavail;
  if (total <= 0) return 0;
  return usados / total;
}

// --- o envio -----------------------------------------------------------------

/**
 * O corpo do webhook.
 *
 * `content` é o que o Discord lê; `text` é o que Slack, Mattermost e Rocket.Chat
 * leem. Mandar os dois faz uma URL só funcionar em qualquer um deles sem uma
 * variável de configuração dizendo qual é — e o campo que sobra é ignorado.
 */
export function corpoDoAviso(texto: string): string {
  return JSON.stringify({ content: texto, text: texto });
}

/**
 * Manda, e nunca deixa o erro subir.
 *
 * Um webhook fora do ar não pode derrubar o processo que ele deveria vigiar. O
 * tempo é curto de propósito: isto roda num intervalo, e um destino que pendura
 * a conexão não pode segurar a volta seguinte.
 */
export async function enviarAviso(
  texto: string,
  log: FastifyBaseLogger,
  url = config.ALERTA_WEBHOOK,
): Promise<boolean> {
  if (!url) return false;
  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corpoDoAviso(texto),
      signal: AbortSignal.timeout(5000),
    });
    if (!resposta.ok) {
      log.warn({ status: resposta.status }, 'o webhook de alerta recusou');
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err }, 'não consegui avisar');
    return false;
  }
}

// --- a volta -----------------------------------------------------------------

const situacoes = new Map<Assunto, Situacao>();

function situacaoDe(assunto: Assunto): Situacao {
  const existente = situacoes.get(assunto);
  if (existente) return existente;
  const nova: Situacao = { desde: null, ultimoAviso: 0 };
  situacoes.set(assunto, nova);
  return nova;
}

/** Só para os testes: cada um começa sem herdar o estado do anterior. */
export function esquecerSituacoes(): void {
  situacoes.clear();
}

async function avaliar(
  assunto: Assunto,
  ruim: boolean,
  dizer: (fala: Exclude<Fala, null>) => string,
  log: FastifyBaseLogger,
  agora: number,
  url: string | undefined,
): Promise<Fala> {
  const situacao = situacaoDe(assunto);
  const fala = decidir(situacao, ruim, agora);
  if (!fala) return null;

  situacao.desde = ruim ? (situacao.desde ?? agora) : null;
  situacao.ultimoAviso = agora;
  const texto = dizer(fala);
  log[fala === 'passou' ? 'info' : 'warn']({ assunto }, texto);
  await enviarAviso(texto, log, url);
  return fala;
}

function porcento(fracao: number): string {
  return `${Math.round(fracao * 100)}%`;
}

export interface Volta {
  agora?: number;
  url?: string;
  /**
   * De onde vem o espaço em disco.
   *
   * Existe para o teste poder dizer "o disco está em 91%" sem encher o disco.
   * Em produção é o `statfs` do caminho vigiado.
   */
  disco?: () => Promise<EspacoEmDisco>;
}

/**
 * Uma volta: olha o disco, olha os 5xx, fala o que mudou.
 *
 * Devolve o que falou, para o teste poder afirmar em cima de fato e não de
 * espionagem de chamada.
 */
export async function vigiar(
  log: FastifyBaseLogger,
  { agora = Date.now(), url = config.ALERTA_WEBHOOK, disco }: Volta = {},
): Promise<Partial<Record<Assunto, Fala>>> {
  const dito: Partial<Record<Assunto, Fala>> = {};

  try {
    const espaco = disco ? await disco() : await statfs(config.DISCO_VIGIADO);
    const uso = usoDoDisco(espaco);
    dito.disco = await avaliar(
      'disco',
      uso >= LIMITE_DO_DISCO,
      (fala) =>
        fala === 'passou'
          ? `Disco de volta ao normal: ${porcento(uso)} usado.`
          : `Disco em ${porcento(uso)} — o limite é ${porcento(LIMITE_DO_DISCO)}. Banco, backup e anexos param juntos quando ele enche.`,
      log,
      agora,
      url,
    );
  } catch (err) {
    // Caminho que não existe é erro de configuração, não motivo para a volta
    // inteira parar: os 5xx continuam sendo vigiados.
    log.warn({ err, caminho: config.DISCO_VIGIADO }, 'não consegui medir o disco');
  }

  const erros = errosDeServidorRecentes(agora);
  const minutos = Math.round(JANELA_DE_ERROS_MS / 60_000);
  dito.erros = await avaliar(
    'erros',
    erros >= LIMITE_DE_ERROS,
    (fala) =>
      fala === 'passou'
        ? 'Os erros 5xx pararam.'
        : `${erros} respostas 5xx nos últimos ${minutos} minutos. Olhe os logs da API.`,
    log,
    agora,
    url,
  );

  return dito;
}

/** De cinco em cinco minutos. */
const INTERVALO_MS = 5 * 60 * 1000;

/**
 * Liga a vigilância e devolve como desligá-la.
 *
 * Sem `ALERTA_WEBHOOK` não liga nada: medir o disco de cinco em cinco minutos
 * para não contar a ninguém é trabalho sem destino. A primeira volta sai depois
 * do primeiro intervalo — subir a API não é hora de avisar sobre um disco que
 * está assim há uma semana.
 */
export function agendarVigia(log: FastifyBaseLogger): () => void {
  if (!config.ALERTA_WEBHOOK) {
    log.info('sem ALERTA_WEBHOOK: os alertas ficam desligados');
    return () => {};
  }

  const relogio = setInterval(() => {
    void vigiar(log).catch((err: unknown) => log.error({ err }, 'a vigilância falhou'));
  }, INTERVALO_MS);

  relogio.unref();
  return () => clearInterval(relogio);
}
