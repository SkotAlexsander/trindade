import * as Y from 'yjs';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from '../db/index.js';

/**
 * A nota de cada canal, em memória enquanto alguém edita.
 *
 * O estado é um CRDT do Yjs: duas pessoas escrevendo no mesmo parágrafo ao
 * mesmo tempo convergem sem conflito e sem ninguém perder texto. O servidor não
 * arbitra nada — ele guarda o documento, repassa os deltas e persiste. É por
 * isso que "quem editou por último ganha" não existe aqui.
 *
 * O que fica no banco são duas coisas com propósitos diferentes: `ydoc` é o
 * estado de verdade, binário, que reabre a nota exatamente como estava; e
 * `content` é o texto achatado, que existe para a busca e para a prévia. Um sem
 * o outro deixaria a nota ilegível de fora ou irrecuperável por dentro.
 *
 * Ver design/08-projeto.md e docs/03-modelo-de-dados.md.
 */

interface NotaViva {
  doc: Y.Doc;
  /** Quem está com ela aberta agora — a nota sai da memória quando esvazia. */
  leitores: Set<string>;
  /** Persistência com folga: 2s depois da última tecla. */
  gravacao: ReturnType<typeof setTimeout> | null;
  ultimoAutor: string | null;
}

const vivas = new Map<string, NotaViva>();

/** O nome do fragmento tem de casar com o do editor no cliente. */
const FRAGMENTO = 'nota';

/**
 * Abre a nota, carregando do banco na primeira vez.
 *
 * Concorrência importa aqui: duas pessoas entrando ao mesmo tempo não podem
 * criar dois documentos e perder um. Por isso a entrada no mapa é criada
 * **antes** do `await`, e quem chegar depois espera a mesma promessa.
 */
const abrindo = new Map<string, Promise<NotaViva>>();

export async function abrirNota(channelId: string, userId: string): Promise<NotaViva> {
  const existente = vivas.get(channelId);
  if (existente) {
    existente.leitores.add(userId);
    return existente;
  }

  const emAndamento = abrindo.get(channelId);
  if (emAndamento) {
    const nota = await emAndamento;
    nota.leitores.add(userId);
    return nota;
  }

  const promessa = (async () => {
    const linhas = await sql<{ ydoc: Buffer | null }[]>`
      select ydoc from notes where channel_id = ${channelId}
    `;

    const doc = new Y.Doc();
    const guardado = linhas[0]?.ydoc;
    if (guardado && guardado.length > 0) Y.applyUpdate(doc, new Uint8Array(guardado));

    const nota: NotaViva = { doc, leitores: new Set(), gravacao: null, ultimoAutor: null };
    vivas.set(channelId, nota);
    return nota;
  })();

  abrindo.set(channelId, promessa);
  try {
    const nota = await promessa;
    nota.leitores.add(userId);
    return nota;
  } finally {
    abrindo.delete(channelId);
  }
}

/** O documento inteiro, para quem acabou de abrir o painel. */
export function estadoDaNota(nota: NotaViva): Uint8Array {
  return Y.encodeStateAsUpdate(nota.doc);
}

/**
 * Aplica um delta de alguém.
 *
 * Aplicar no documento do servidor **e** repassar aos outros são coisas
 * separadas: quem repassa é o gateway, porque só ele sabe quem está com a nota
 * aberta. Aqui só se guarda.
 */
export function aplicar(
  channelId: string,
  nota: NotaViva,
  update: Uint8Array,
  userId: string,
  log: FastifyBaseLogger,
): void {
  Y.applyUpdate(nota.doc, update);
  nota.ultimoAutor = userId;
  agendarGravacao(channelId, nota, log);
}

/**
 * Grava 2 segundos depois da última alteração.
 *
 * Sem a folga, escrever um parágrafo seriam cinquenta gravações; com folga
 * demais, fechar o navegador perde o fim da frase. Dois segundos é o intervalo
 * em que uma pessoa pensa na próxima palavra.
 */
function agendarGravacao(channelId: string, nota: NotaViva, log: FastifyBaseLogger): void {
  if (nota.gravacao) clearTimeout(nota.gravacao);
  nota.gravacao = setTimeout(() => {
    nota.gravacao = null;
    void gravar(channelId, nota).catch((err: unknown) => {
      log.error({ err, channelId }, 'não consegui gravar a nota');
    });
  }, 2000);
  nota.gravacao.unref?.();
}

/** Texto achatado, para busca e prévia. O estado de verdade é o `ydoc`. */
export function textoDaNota(nota: NotaViva): string {
  const fragmento = nota.doc.getXmlFragment(FRAGMENTO);
  const linhas: string[] = [];

  const percorrer = (no: Y.XmlElement | Y.XmlFragment | Y.XmlText | Y.XmlHook): void => {
    if (no instanceof Y.XmlText) {
      linhas.push(no.toString());
      return;
    }
    if (no instanceof Y.XmlElement || no instanceof Y.XmlFragment) {
      // Cada bloco vira uma linha: sem isto, o texto sai grudado e a busca
      // encontra palavras que nunca estiveram lado a lado.
      const antes = linhas.length;
      no.toArray().forEach((filho) => percorrer(filho as Y.XmlElement));
      if (no instanceof Y.XmlElement && linhas.length > antes) linhas.push('\n');
    }
  };

  percorrer(fragmento);
  return linhas.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export async function gravar(channelId: string, nota: NotaViva): Promise<void> {
  const estado = Buffer.from(Y.encodeStateAsUpdate(nota.doc));
  const texto = textoDaNota(nota);

  await sql`
    insert into notes (channel_id, content, ydoc, updated_by, updated_at)
    values (${channelId}, ${texto}, ${estado}, ${nota.ultimoAutor}, now())
    on conflict (channel_id) do update
      set content = ${texto}, ydoc = ${estado},
          updated_by = ${nota.ultimoAutor}, updated_at = now()
  `;
}

/**
 * Alguém fechou o painel ou caiu.
 *
 * Ao sair o último, grava **na hora** e solta a memória: esperar os 2 segundos
 * do debounce deixaria uma janela em que fechar a aba perde o que foi escrito
 * — que é exatamente o caso que o aceite da fase manda cobrir.
 */
export async function fecharNota(channelId: string, userId: string): Promise<void> {
  const nota = vivas.get(channelId);
  if (!nota) return;

  nota.leitores.delete(userId);
  if (nota.leitores.size > 0) return;

  if (nota.gravacao) {
    clearTimeout(nota.gravacao);
    nota.gravacao = null;
  }
  await gravar(channelId, nota);
  vivas.delete(channelId);
}

/** Quem está com a nota aberta — a faixa "fulano e beltrano editando". */
export function quemEsta(channelId: string): string[] {
  return [...(vivas.get(channelId)?.leitores ?? [])];
}

/** Só para o teste e para o desligamento: grava tudo o que está em memória. */
export async function gravarTudo(): Promise<void> {
  for (const [channelId, nota] of vivas) {
    if (nota.gravacao) clearTimeout(nota.gravacao);
    await gravar(channelId, nota);
  }
  vivas.clear();
}

/**
 * Acrescenta uma citação ao fim da nota.
 *
 * É o gesto central do documento: uma decisão tomada no chat vira registro em
 * um clique. Vai como bloco de citação com o nome de quem disse e um link de
 * volta — sem o link, a nota vira uma cópia sem origem, e daí ninguém confia
 * nela.
 */
export function acrescentarCitacao(
  nota: NotaViva,
  entrada: { texto: string; autor: string; link: string },
): void {
  const fragmento = nota.doc.getXmlFragment(FRAGMENTO);

  nota.doc.transact(() => {
    const citacao = new Y.XmlElement('blockquote');
    for (const linha of entrada.texto.split('\n')) {
      const paragrafo = new Y.XmlElement('paragraph');
      paragrafo.insert(0, [new Y.XmlText(linha)]);
      citacao.push([paragrafo]);
    }

    const credito = new Y.XmlElement('paragraph');
    credito.insert(0, [new Y.XmlText(`— ${entrada.autor}, ${entrada.link}`)]);

    fragmento.push([citacao, credito]);
  });
}

/**
 * A mensagem citada na nota, e o delta repassado a quem está com ela aberta.
 *
 * O delta é capturado do próprio documento: quem está editando junto tem de
 * ver a citação aparecer sem recarregar nada, e mandar "recarregue a nota"
 * seria desfazer o que o CRDT resolve.
 */
export async function citarMensagem(entrada: {
  channelId: string;
  userId: string;
  texto: string;
  autor: string;
  link: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  const nota = await abrirNota(entrada.channelId, entrada.userId);

  let delta: Uint8Array | null = null;
  const capturar = (update: Uint8Array) => {
    delta = update;
  };
  nota.doc.on('update', capturar);
  acrescentarCitacao(nota, { texto: entrada.texto, autor: entrada.autor, link: entrada.link });
  nota.doc.off('update', capturar);

  nota.ultimoAutor = entrada.userId;
  // Grava já: quem clicou pode nem ter o painel aberto, e nesse caso não há
  // ninguém para segurar a nota em memória até o debounce.
  await gravar(entrada.channelId, nota);

  if (delta) avisarDelta?.(entrada.channelId, delta);

  // Se quem citou não tem o painel aberto, a nota não deve ficar presa na
  // memória por causa dele.
  await fecharNota(entrada.channelId, entrada.userId);
}

/**
 * Como avisar quem está com a nota aberta.
 *
 * Injetado pelo gateway em vez de importado: o serviço não conhece conexões, e
 * o gateway já importa o serviço — importar de volta fecharia um ciclo.
 */
let avisarDelta: ((channelId: string, delta: Uint8Array) => void) | null = null;

export function definirAviso(fn: (channelId: string, delta: Uint8Array) => void): void {
  avisarDelta = fn;
}
