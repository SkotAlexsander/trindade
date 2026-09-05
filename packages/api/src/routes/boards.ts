import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Perm, can } from '@trindade/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import { userKey } from '../lib/client-key.js';
import { reencodar, reencodarMiniatura, sniffImagem } from '../lib/imagem.js';
import * as storage from '../lib/storage.js';
import * as boardsDb from '../db/boards.js';
import * as boardFilesDb from '../db/board-files.js';
import * as channelsDb from '../db/channels.js';
import { toApiBoard } from '../services/board-view.js';
import { gateway } from '../ws/index.js';

/**
 * Os quadros brancos.
 *
 * Estas rotas cuidam do **cartão**: criar, renomear, arquivar, miniatura. O
 * desenho não passa por HTTP nenhum — ele é o CRDT que viaja pelo WebSocket,
 * como o das notas. Ver design/11-quadro.md.
 *
 * A permissão é `MANAGE_NOTES`, de propósito a mesma da nota: quadro e nota são
 * o mesmo tipo de artefato, e ter duas permissões para "registrar o que o grupo
 * decidiu" seria duas coisas para manter em dia sem nenhuma diferença real.
 */

const boardSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
});

const nomeSchema = z.string().trim().min(1).max(48);

/** Toda mudança de cartão vira um evento para todo mundo — a lista é do canal. */
function anunciar(row: boardsDb.BoardRow, removido = false): void {
  gateway.broadcast({ op: 'BOARD_LIST_UPDATE', d: { board: toApiBoard(row), removido } });
}

export const boardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/channels/:id/boards',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ boards: z.array(boardSchema) }) },
      },
    },
    async (req) => {
      requireUser(req);
      const linhas = await boardsDb.listar(req.params.id);
      return { boards: linhas.map(toApiBoard) };
    },
  );

  app.post(
    '/channels/:id/boards',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ name: nomeSchema }),
        response: { 200: z.object({ board: boardSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_NOTES)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode criar quadros');
      }

      const canal = await channelsDb.findChannelById(req.params.id);
      if (!canal || canal.archived_at) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');

      const linha = await boardsDb.criar({
        channelId: canal.id,
        name: req.body.name,
        createdBy: me.id,
      });
      anunciar(linha);
      return { board: toApiBoard(linha) };
    },
  );

  app.patch(
    '/boards/:id',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ name: nomeSchema }),
        response: { 200: z.object({ board: boardSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_NOTES)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode mexer nos quadros');
      }

      const linha = await boardsDb.renomear(req.params.id, req.body.name);
      if (!linha) throw notFound('BOARD_NOT_FOUND', 'este quadro não existe');
      anunciar(linha);
      return { board: toApiBoard(linha) };
    },
  );

  /**
   * Arquivar, e não apagar.
   *
   * O quadro é o desenho de uma conversa que aconteceu. Ele some da lista e
   * continua no banco — não existe rota que o remova, e é de propósito.
   */
  app.post(
    '/boards/:id/archive',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_NOTES)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode mexer nos quadros');
      }

      const linha = await boardsDb.arquivar(req.params.id);
      if (!linha) throw notFound('BOARD_NOT_FOUND', 'este quadro não existe');
      anunciar(linha, true);
      return { ok: true };
    },
  );

  /**
   * Uma imagem colada dentro do quadro.
   *
   * O Excalidraw guarda na cena um `fileId` e os bytes num dicionário à parte.
   * Os bytes **não** passam pelo CRDT — seriam megabytes de base64 dentro de
   * cada delta, e dois desenhos com foto acabariam com o quadro. Eles sobem por
   * aqui, passam pelo `sharp` como toda imagem do produto, e o que viaja pelo
   * documento é o par `fileId` → URL.
   *
   * O `fileId` é o hash do conteúdo, feito pelo próprio Excalidraw: a mesma
   * imagem colada duas vezes reaproveita o arquivo em vez de gravar um gêmeo.
   */
  app.post(
    '/boards/:id/files/:fileId',
    {
      config: { rateLimit: { max: 200, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({
          id: z.string().uuid(),
          // O id vem do cliente: sem esta cerca ele entraria numa chave de
          // banco e num nome de arquivo com o que quisesse dentro.
          fileId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        }),
        response: {
          200: z.object({
            fileId: z.string(),
            url: z.string(),
            contentType: z.string(),
          }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_NOTES)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode desenhar neste quadro');
      }
      if (!storage.storageConfigurado()) {
        throw badRequest('STORAGE_OFF', 'o armazenamento de arquivos não está configurado');
      }

      const quadro = await boardsDb.porId(req.params.id);
      if (!quadro || quadro.archived_at) throw notFound('BOARD_NOT_FOUND', 'este quadro não existe');

      const parte = await req.file({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
      if (!parte) throw badRequest('NO_FILE', 'nenhum arquivo veio no formulário');

      const bruto = await parte.toBuffer();
      if (parte.file.truncated) throw badRequest('FILE_TOO_LARGE', 'a imagem passa de 8 MB');
      if (bruto.length === 0) throw badRequest('EMPTY_FILE', 'arquivo vazio');

      const tipo = sniffImagem(bruto);
      if (!tipo) throw badRequest('UNSUPPORTED_MEDIA_TYPE', 'isso não é uma imagem');

      let processada;
      try {
        processada = await reencodar(bruto, tipo === 'gif');
      } catch (err) {
        req.log.warn({ err }, 'imagem de quadro recusada pelo re-encode');
        throw badRequest('INVALID_IMAGE', 'não consegui ler essa imagem');
      }

      const chave = storage.novaChave('quadros');
      await storage.guardar(chave, processada.buffer, processada.contentType);

      const { linha, novo } = await boardFilesDb.guardar({
        boardId: quadro.id,
        fileId: req.params.fileId,
        storageKey: chave,
        contentType: processada.contentType,
        byteSize: processada.buffer.byteLength,
        createdBy: me.id,
      });

      // Outra pessoa colou a mesma imagem primeiro: o arquivo que acabou de
      // subir não serve para nada, e ficar no storage seria lixo permanente.
      if (!novo) await storage.apagar(chave);

      return {
        fileId: linha.file_id,
        url: `/api/files/${linha.storage_key}`,
        contentType: linha.content_type,
      };
    },
  );

  /**
   * A miniatura, gerada no cliente ao fechar o quadro.
   *
   * Ela chega como PNG e sai como WebP de 400×300: passa pelo `sharp` como toda
   * imagem do produto, e é assim que o metadado morre no caminho. Ver
   * docs/04-seguranca.md, "Upload de arquivo".
   */
  app.post(
    '/boards/:id/thumbnail',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ board: boardSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.MANAGE_NOTES)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode mexer nos quadros');
      }
      if (!storage.storageConfigurado()) {
        throw badRequest('STORAGE_OFF', 'o armazenamento de arquivos não está configurado');
      }

      const quadro = await boardsDb.porId(req.params.id);
      if (!quadro) throw notFound('BOARD_NOT_FOUND', 'este quadro não existe');

      const parte = await req.file({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
      if (!parte) throw badRequest('NO_FILE', 'nenhum arquivo veio no formulário');

      const bruto = await parte.toBuffer();
      if (parte.file.truncated) throw badRequest('FILE_TOO_LARGE', 'a miniatura passa de 8 MB');
      if (bruto.length === 0) throw badRequest('EMPTY_FILE', 'arquivo vazio');
      // O tipo real vem dos bytes. Vale aqui como vale no avatar: o
      // `Content-Type` declarado é escrito por quem envia.
      if (!sniffImagem(bruto)) throw badRequest('UNSUPPORTED_MEDIA_TYPE', 'isso não é uma imagem');

      let processada;
      try {
        processada = await reencodarMiniatura(bruto);
      } catch (err) {
        req.log.warn({ err }, 'miniatura recusada pelo re-encode');
        throw badRequest('INVALID_IMAGE', 'não consegui ler essa imagem');
      }

      const chave = storage.novaChave('quadros');
      await storage.guardar(chave, processada.buffer, processada.contentType);

      const troca = await boardsDb.trocarMiniatura(req.params.id, chave);
      if (!troca) throw notFound('BOARD_NOT_FOUND', 'este quadro não existe');

      // A miniatura velha sai só depois que o banco aponta para a nova: na
      // ordem inversa, uma falha no meio deixaria a lista apontando para um
      // arquivo que não existe mais.
      if (troca.anterior) await storage.apagar(troca.anterior);

      anunciar(troca.board);
      return { board: toApiBoard(troca.board) };
    },
  );
};
