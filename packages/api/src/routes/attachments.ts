import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ANEXOS_POR_MENSAGEM, Perm, can } from '@trindade/shared';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import { userKey } from '../lib/client-key.js';
import { reencodar, sniffImagem } from '../lib/imagem.js';
import * as storage from '../lib/storage.js';
import * as attachmentsDb from '../db/attachments.js';
import * as channelsDb from '../db/channels.js';
import * as usersDb from '../db/users.js';
import { toApiAttachment } from '../services/attachment-view.js';
import { previaDeLink, thumbEmCache } from '../services/link-preview.js';
import { RecusadoNaBusca } from '../lib/busca-externa.js';

/** Os limites de docs/04-seguranca.md, "Validação". */
const TAMANHO_MAXIMO = 50 * 1024 * 1024;
/** Anexo solto é arquivo que ninguém vê. Mais que isto é engano ou abuso. */
const PENDENTES_MAXIMOS = 30;

const anexoSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  byteSize: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  blurhash: z.string().nullable(),
  url: z.string(),
});

/**
 * O nome só serve para exibir e para baixar; ele nunca vira caminho.
 *
 * Ainda assim tiramos barra, contrabarra e caractere de controle: o nome
 * aparece num `Content-Disposition`, e um `"` ou um `\n` solto ali quebra o
 * cabeçalho em dois.
 */
function nomeSeguro(bruto: string): string {
  let limpo = '';
  for (const c of bruto) {
    const ponto = c.codePointAt(0) ?? 0;
    // Caractere de controle fora, sem exceção: uma quebra de linha solta no
    // `Content-Disposition` parte o cabeçalho em dois.
    if (ponto < 0x20 || ponto === 0x7f) continue;
    limpo += c === '/' || c === '\\' || c === '"' ? '_' : c;
  }
  return limpo.trim().slice(0, 200) || 'arquivo';
}

/**
 * Servir arquivo — plugin separado, **sem autenticação**, de propósito.
 *
 * Separado porque um `addHook('preHandler', …)` só alcança as rotas
 * registradas depois dele: deixar a rota pública no mesmo plugin das
 * autenticadas faria a proteção depender da ordem das linhas, e um dia
 * alguém reordenaria.
 */
export const fileRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * Servir arquivo. **Sem sessão**, e isso é uma decisão, não um esquecimento.
   *
   * O token de acesso vive só na memória do JavaScript — um `<img src>` não
   * tem como mandá-lo — e docs/04-seguranca.md prevê estes arquivos num
   * domínio de CDN separado, que por construção não enxerga a sessão de
   * ninguém. O controle de acesso é a chave: 32 bytes aleatórios, que não se
   * adivinham. Quem tem a URL tem o arquivo; quem não tem, não chega nele.
   */
  app.get(
    '/files/*',
    { schema: { params: z.object({ '*': z.string().min(1).max(200) }) } },
    async (req, reply) => {
      const chave = req.params['*'];

      // Duas coisas moram aqui: anexo de mensagem e avatar. A consulta é o que
      // impede que a rota vire um leitor genérico do bucket — só se serve o
      // que alguma linha do banco reconhece como arquivo nosso.
      const anexo = await attachmentsDb.findByStorageKey(chave);
      const dono = anexo ? null : await usersDb.findUserByAvatarKey(chave);
      if (!anexo && !dono) throw notFound('FILE_NOT_FOUND', 'este arquivo não existe');

      const objeto = await storage.buscar(chave);
      if (!objeto) throw notFound('FILE_NOT_FOUND', 'este arquivo não existe');

      // Avatar sempre saiu do `sharp` e é sempre WebP.
      const contentType = anexo ? anexo.content_type : 'image/webp';
      const nomeParaBaixar = anexo ? anexo.filename : `avatar-${dono?.username ?? 'pessoa'}.webp`;
      const imagem = contentType.startsWith('image/');
      return reply
        .header('content-type', contentType)
        // `nosniff` sempre: sem ele o navegador adivinha o tipo pelo conteúdo
        // e o `octet-stream` que serve tudo que não é imagem deixa de valer.
        .header('x-content-type-options', 'nosniff')
        // Imagem re-encodada abre na página; **todo o resto** baixa. É a linha
        // que impede um arquivo enviado por alguém de rodar como página nossa.
        .header(
          'content-disposition',
          `${imagem ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(nomeParaBaixar)}`,
        )
        .header('cache-control', 'private, max-age=31536000, immutable')
        .header('cross-origin-resource-policy', 'same-site')
        .send(objeto.corpo);
    },
  );

};

export const attachmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /**
   * Sobe um arquivo. Ele fica **pendente** até a mensagem existir.
   *
   * O upload começa ao anexar, não ao enviar: quando a pessoa termina de
   * escrever, o arquivo já está lá. Ver design/04-mensagens.md.
   */
  app.post(
    '/channels/:id/attachments',
    {
      config: { rateLimit: { max: 50, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 201: z.object({ attachments: z.array(anexoSchema) }) },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.ATTACH_FILE)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode anexar arquivos');
      }
      if (!storage.storageConfigurado()) {
        throw badRequest('STORAGE_OFF', 'o armazenamento de arquivos não está configurado');
      }

      const canal = await channelsDb.findChannelById(req.params.id);
      if (!canal || canal.archived_at) {
        throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');
      }
      // Canal de voz também recebe arquivo: ele tem conversa como qualquer
      // outro, e recusar ali seria uma regra sem motivo — quem está numa
      // chamada é justamente quem mais cola uma imagem para os outros verem.

      if ((await attachmentsDb.contarPendentes(me.id)) >= PENDENTES_MAXIMOS) {
        throw badRequest('TOO_MANY_PENDING', 'há arquivos demais esperando envio');
      }

      const partes = req.files({ limits: { fileSize: TAMANHO_MAXIMO, files: ANEXOS_POR_MENSAGEM } });
      const criados = [];

      for await (const parte of partes) {
        let bruto: Buffer;
        try {
          bruto = await parte.toBuffer();
        } catch {
          throw badRequest('FILE_TOO_LARGE', 'o arquivo passa de 50 MB');
        }
        if (parte.file.truncated) throw badRequest('FILE_TOO_LARGE', 'o arquivo passa de 50 MB');
        if (bruto.length === 0) throw badRequest('EMPTY_FILE', 'arquivo vazio');

        const nome = nomeSeguro(parte.filename ?? 'arquivo');
        // O tipo real vem dos bytes. A extensão e o `Content-Type` declarado
        // são os dois escolhidos por quem envia, e nenhum entra na decisão.
        const formato = sniffImagem(bruto);

        let corpo = bruto;
        let contentType = 'application/octet-stream';
        let width: number | null = null;
        let height: number | null = null;
        let blurhash: string | null = null;

        if (formato) {
          // Nenhum byte original de imagem chega ao disco: o EXIF de uma foto
          // de celular carrega a coordenada de onde ela foi tirada.
          try {
            const imagem = await reencodar(bruto, formato === 'gif' || formato === 'webp');
            corpo = imagem.buffer;
            contentType = imagem.contentType;
            width = imagem.width;
            height = imagem.height;
            blurhash = imagem.blurhash;
          } catch (err) {
            req.log.warn({ err }, 'imagem recusada pelo re-encode');
            throw badRequest('BAD_IMAGE', 'não consegui ler essa imagem');
          }
        }

        const chave = storage.novaChave('anexos');
        await storage.guardar(chave, corpo, contentType);

        criados.push(
          await attachmentsDb.criarPendente({
            uploaderId: me.id,
            channelId: canal.id,
            storageKey: chave,
            filename: nome,
            contentType,
            byteSize: corpo.length,
            width,
            height,
            blurhash,
          }),
        );
      }

      if (criados.length === 0) throw badRequest('NO_FILE', 'nenhum arquivo veio no formulário');
      return reply.code(201).send({ attachments: criados.map(toApiAttachment) });
    },
  );

  /**
   * A prévia de um link, buscada **aqui**.
   *
   * O navegador de quem lê nunca toca no site de origem: se tocasse, abrir a
   * conversa entregaria o IP de todos os leitores a quem mandou o link. Ver
   * docs/04-seguranca.md, e `lib/busca-externa.ts` para a guarda de SSRF.
   */
  app.get(
    '/link-preview',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        querystring: z.object({ url: z.string().url().max(2048) }),
        response: {
          200: z.object({
            preview: z
              .object({
                url: z.string(),
                title: z.string(),
                description: z.string().nullable(),
                siteName: z.string(),
                thumbUrl: z.string().nullable(),
                thumbWidth: z.number().nullable(),
                thumbHeight: z.number().nullable(),
              })
              .nullable(),
          }),
        },
      },
    },
    async (req, reply) => {
      try {
        const preview = await previaDeLink(req.query.url);
        // Um cartão vale seis horas; a ausência de cartão, dez minutos. O
        // cliente não precisa perguntar de novo em nenhum dos dois casos.
        reply.header('cache-control', `private, max-age=${preview ? 21600 : 600}`);
        return { preview };
      } catch (err) {
        // URL que a guarda recusa não é erro de quem lê — é um link que
        // simplesmente não ganha cartão.
        if (err instanceof RecusadoNaBusca) return { preview: null };
        throw err;
      }
    },
  );

  /** A miniatura da prévia, servida dos nossos bytes e do nosso domínio. */
  app.get(
    '/link-preview/thumb/:id',
    { schema: { params: z.object({ id: z.string().min(8).max(64) }) } },
    async (req, reply) => {
      const thumb = thumbEmCache(req.params.id);
      // O cache mora na memória: reiniciar a API derruba a miniatura antes do
      // cartão. O cliente esconde a imagem que não carrega, e o cartão fica.
      if (!thumb) throw notFound('THUMB_NOT_FOUND', 'miniatura fora do cache');
      return reply
        .header('content-type', thumb.contentType)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=21600')
        .send(thumb.bytes);
    },
  );
};
