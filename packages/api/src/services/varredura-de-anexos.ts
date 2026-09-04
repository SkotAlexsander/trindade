import type { FastifyBaseLogger } from 'fastify';
import * as attachmentsDb from '../db/attachments.js';
import * as storage from '../lib/storage.js';

/**
 * Anexo que ninguém enviou.
 *
 * O upload começa ao anexar; quem desiste de escrever deixa o arquivo no
 * disco. O contrato dá uma hora de folga — tempo de sobra para alguém arrastar
 * um PDF, atender ao telefone e voltar — e depois o arquivo sai.
 *
 * A ordem é deliberada: **primeiro o objeto, depois a linha**. Se o processo
 * cair no meio, sobra uma linha apontando para um objeto que já não existe, e
 * a varredura seguinte a remove. Na ordem inversa sobraria um arquivo sem
 * nenhuma linha que o mencione — invisível, e para sempre.
 */

const IDADE_EM_MINUTOS = 60;
const INTERVALO_MS = 15 * 60 * 1000;

export async function varrerAnexosOrfaos(log: FastifyBaseLogger): Promise<number> {
  if (!storage.storageConfigurado()) return 0;

  const soltos = await attachmentsDb.orfaos(IDADE_EM_MINUTOS);
  if (soltos.length === 0) return 0;

  const apagados: string[] = [];
  for (const anexo of soltos) {
    try {
      await storage.apagar(anexo.storage_key);
      apagados.push(anexo.id);
    } catch (err) {
      // Um arquivo que resistiu não pode impedir os outros de saírem; a
      // próxima volta tenta de novo.
      log.warn({ err, anexo: anexo.id }, 'não consegui apagar anexo órfão');
    }
  }

  const n = await attachmentsDb.apagarPorIds(apagados);
  if (n > 0) log.info({ anexos: n }, 'anexos órfãos removidos');
  return n;
}

/** Liga a varredura periódica. Devolve como desligá-la. */
export function iniciarVarredura(log: FastifyBaseLogger): () => void {
  const timer = setInterval(() => {
    void varrerAnexosOrfaos(log).catch((err: unknown) => {
      log.error({ err }, 'a varredura de anexos falhou');
    });
  }, INTERVALO_MS);
  // Sem `unref`, o processo não termina sozinho enquanto o timer estiver de pé.
  timer.unref();
  return () => clearInterval(timer);
}
