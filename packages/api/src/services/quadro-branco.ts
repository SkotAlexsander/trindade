import * as Y from 'yjs';
import type { FastifyBaseLogger } from 'fastify';
import { ELEMENTOS_POR_QUADRO } from '@trindade/shared';
import * as boardsDb from '../db/boards.js';

/**
 * O quadro branco vivo, em memória enquanto alguém o tem aberto.
 *
 * Mesmo desenho das notas (`services/notas.ts`), com uma diferença que muda
 * tudo: a chave é o **quadro**, não o canal. Um canal tem vários quadros, e
 * dois abertos ao mesmo tempo não podem receber o traço um do outro — foi o
 * critério de aceite "dois quadros no mesmo canal não se misturam" que ditou
 * essa chave.
 *
 * Os elementos vivem num `Y.Map` indexado pelo id do elemento. Não é uma lista:
 * duas pessoas movendo formas diferentes ao mesmo tempo escrevem em chaves
 * diferentes e convergem sem disputa; numa lista, cada movimento seria uma
 * inserção e uma remoção brigando por posição.
 *
 * Ver design/11-quadro.md.
 */

/** O nome do mapa tem de casar com o do cliente. */
export const MAPA = 'elementos';

interface QuadroVivo {
  doc: Y.Doc;
  /** Quem está com ele aberto — sai da memória quando esvazia. */
  leitores: Set<string>;
  gravacao: ReturnType<typeof setTimeout> | null;
  ultimoAutor: string | null;
  /** Há algo por gravar? Sem isto, fechar um quadro só lido reescreve a linha. */
  sujo: boolean;
}

const vivos = new Map<string, QuadroVivo>();
const abrindo = new Map<string, Promise<QuadroVivo>>();

/**
 * Abre o quadro, carregando do banco na primeira vez.
 *
 * A entrada no mapa é criada **antes** do `await`, e quem chegar no meio espera
 * a mesma promessa: duas pessoas entrando ao mesmo tempo não podem criar dois
 * documentos e perder um.
 */
export async function abrirQuadro(boardId: string, userId: string): Promise<QuadroVivo> {
  const existente = vivos.get(boardId);
  if (existente) {
    existente.leitores.add(userId);
    return existente;
  }

  const emAndamento = abrindo.get(boardId);
  if (emAndamento) {
    const quadro = await emAndamento;
    quadro.leitores.add(userId);
    return quadro;
  }

  const promessa = (async () => {
    const guardado = await boardsDb.estado(boardId);

    const doc = new Y.Doc();
    if (guardado && guardado.length > 0) Y.applyUpdate(doc, new Uint8Array(guardado));

    const quadro: QuadroVivo = {
      doc,
      leitores: new Set(),
      gravacao: null,
      ultimoAutor: null,
      sujo: false,
    };
    vivos.set(boardId, quadro);
    return quadro;
  })();

  abrindo.set(boardId, promessa);
  try {
    const quadro = await promessa;
    quadro.leitores.add(userId);
    return quadro;
  } finally {
    abrindo.delete(boardId);
  }
}

/** O documento inteiro, para quem acabou de abrir. */
export function estadoDoQuadro(quadro: QuadroVivo): Uint8Array {
  return Y.encodeStateAsUpdate(quadro.doc);
}

/**
 * Quantos elementos o quadro tem de verdade.
 *
 * O Excalidraw não remove o que se apaga: marca `isDeleted` e mantém o
 * elemento, que é como o desfazer de uma pessoa não ressuscita o traço de
 * outra. Contar as chaves do mapa daria um quadro "cheio" depois de apagar
 * tudo — o que conta é o que está desenhado.
 */
export function contarElementos(quadro: QuadroVivo): number {
  let total = 0;
  for (const valor of quadro.doc.getMap<unknown>(MAPA).values()) {
    if ((valor as { isDeleted?: boolean } | null)?.isDeleted !== true) total += 1;
  }
  return total;
}

export function estaCheio(quadro: QuadroVivo): boolean {
  return contarElementos(quadro) >= ELEMENTOS_POR_QUADRO;
}

/**
 * Aplica um delta de alguém.
 *
 * O delta é sempre aplicado, mesmo com o quadro no teto. Recusar metade de um
 * delta de CRDT é como se perde a convergência: os documentos passam a divergir
 * em silêncio, e ninguém descobre até dois desenhos diferentes aparecerem na
 * mesma tela. O limite é imposto onde os elementos nascem — no cliente, que
 * recebe a contagem em todo `BOARD_UPDATE` e bloqueia as ferramentas.
 */
export function aplicar(
  boardId: string,
  quadro: QuadroVivo,
  update: Uint8Array,
  userId: string,
  log: FastifyBaseLogger,
): void {
  Y.applyUpdate(quadro.doc, update);
  quadro.ultimoAutor = userId;
  quadro.sujo = true;
  agendarGravacao(boardId, quadro, log);
}

/** Grava 2 segundos depois da última alteração. O mesmo intervalo das notas. */
function agendarGravacao(boardId: string, quadro: QuadroVivo, log: FastifyBaseLogger): void {
  if (quadro.gravacao) clearTimeout(quadro.gravacao);
  quadro.gravacao = setTimeout(() => {
    quadro.gravacao = null;
    void gravar(boardId, quadro).catch((err: unknown) => {
      log.error({ err, boardId }, 'não consegui gravar o quadro');
    });
  }, 2000);
  quadro.gravacao.unref?.();
}

export async function gravar(boardId: string, quadro: QuadroVivo): Promise<void> {
  if (!quadro.sujo) return;
  const estado = Buffer.from(Y.encodeStateAsUpdate(quadro.doc));
  await boardsDb.gravarEstado(boardId, estado, quadro.ultimoAutor);
  quadro.sujo = false;
}

/**
 * Alguém fechou o quadro ou caiu.
 *
 * Ao sair o último, grava **na hora**: esperar os 2 segundos do debounce
 * deixaria uma janela em que fechar a aba perde o último traço — e num quadro
 * o último traço costuma ser justamente o que a pessoa acabou de explicar.
 */
export async function fecharQuadro(boardId: string, userId: string): Promise<void> {
  const quadro = vivos.get(boardId);
  if (!quadro) return;

  quadro.leitores.delete(userId);
  if (quadro.leitores.size > 0) return;

  if (quadro.gravacao) {
    clearTimeout(quadro.gravacao);
    quadro.gravacao = null;
  }
  await gravar(boardId, quadro);
  vivos.delete(boardId);
}

/** Quem está com o quadro aberto agora — os avatares da barra. */
export function quemEsta(boardId: string): string[] {
  return [...(vivos.get(boardId)?.leitores ?? [])];
}

/** Desligamento e testes: grava tudo o que está em memória. */
export async function gravarTudo(): Promise<void> {
  for (const [boardId, quadro] of vivos) {
    if (quadro.gravacao) clearTimeout(quadro.gravacao);
    await gravar(boardId, quadro);
  }
  vivos.clear();
}
