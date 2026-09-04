import { z } from 'zod';
import QRCode from 'qrcode';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  bioSchema,
  displayNameSchema,
  hexColorSchema,
  passwordSchema,
  roleSchema,
  userSchema,
  userStatusSchema,
} from '@trindade/shared';
import { badRequest, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/auth/password.js';
import { isPasswordBreached } from '../lib/auth/breached.js';
import {
  generateSecret,
  otpauthUrl,
  verifyCode,
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from '../lib/auth/totp.js';
import { requireUser } from '../plugins/auth.js';
import * as usersDb from '../db/users.js';
import * as tokensDb from '../db/refresh-tokens.js';
import * as recoveryDb from '../db/recovery-codes.js';
import { toApiRole, toApiUser } from '../services/user-view.js';
import { userKey } from '../lib/client-key.js';
import { reencodarAvatar, sniffImagem } from '../lib/imagem.js';
import * as storage from '../lib/storage.js';
import { gateway } from '../ws/index.js';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/me',
    {
      schema: {
        response: {
          200: z.object({
            user: userSchema,
            // bigint serializado: não sobrevive ao JSON como número.
            permissions: z.string(),
            roles: z.array(roleSchema),
          }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      return {
        user: toApiUser(me.row, me.roles),
        permissions: me.permissions.toString(),
        roles: me.roles.map(toApiRole),
      };
    },
  );

  app.patch(
    '/me',
    {
      schema: {
        // Cada campo é opcional, e `null` é diferente de ausente: ausente
        // significa "não mexa", `null` significa "apague". `.nullish()` aceita
        // os dois e o `db/users.ts` sabe distinguir.
        body: z.object({
          displayName: displayNameSchema.optional(),
          bio: bioSchema.nullish(),
          accentColor: hexColorSchema.nullish(),
          status: userStatusSchema.optional(),
          customStatus: z.string().max(64).nullish(),
        }),
        response: { 200: z.object({ user: userSchema }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const linha = await usersDb.updateProfile(me.id, req.body);
      if (!linha) throw badRequest('USER_NOT_FOUND', 'sua conta sumiu');

      const usuario = toApiUser(linha, me.roles);
      gateway.broadcast({ op: 'USER_UPDATE', d: usuario });
      return { user: usuario };
    },
  );

  // --- avatar -------------------------------------------------------------
  //
  // Nenhum byte original chega ao disco. Foto de celular carrega EXIF com
  // coordenadas de GPS, e servir o arquivo original faria cada pessoa publicar
  // onde mora sem saber. Ver docs/04-seguranca.md, "Upload de arquivo".

  app.post(
    '/me/avatar',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        response: {
          200: z.object({
            avatarUrl: z.string().nullable(),
            avatarBlurhash: z.string().nullable(),
            user: userSchema,
          }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!storage.storageConfigurado()) {
        throw badRequest('STORAGE_OFF', 'o armazenamento de arquivos não está configurado');
      }

      const parte = await req.file({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
      if (!parte) throw badRequest('NO_FILE', 'nenhum arquivo veio no formulário');

      const bruto = await parte.toBuffer();
      if (parte.file.truncated) throw badRequest('FILE_TOO_LARGE', 'a foto passa de 8 MB');
      if (bruto.length === 0) throw badRequest('EMPTY_FILE', 'arquivo vazio');

      // O tipo real vem dos bytes: um `.txt` renomeado para `.png` não passa
      // daqui, e o `Content-Type` declarado nunca entra na decisão.
      if (!sniffImagem(bruto)) {
        throw badRequest('UNSUPPORTED_MEDIA_TYPE', 'isso não é uma imagem');
      }

      let processada;
      try {
        processada = await reencodarAvatar(bruto);
      } catch (err) {
        req.log.warn({ err }, 'avatar recusado pelo re-encode');
        throw badRequest('INVALID_IMAGE', 'não consegui ler essa imagem');
      }

      const chave = storage.novaChave('avatares');
      await storage.guardar(chave, processada.buffer, processada.contentType);

      const troca = await usersDb.trocarAvatar(me.id, chave, processada.blurhash);
      if (!troca) throw badRequest('USER_NOT_FOUND', 'sua conta sumiu');

      // A foto velha sai só depois que o banco já aponta para a nova. Na ordem
      // inversa, uma falha no meio deixaria a linha apontando para um arquivo
      // que não existe mais; assim, o pior caso é um arquivo órfão.
      if (troca.anterior) await storage.apagar(troca.anterior);

      const usuario = toApiUser(troca.user, me.roles);
      gateway.broadcast({ op: 'USER_UPDATE', d: usuario });
      return {
        avatarUrl: usuario.avatarUrl,
        avatarBlurhash: usuario.avatarBlurhash,
        user: usuario,
      };
    },
  );

  app.delete(
    '/me/avatar',
    { schema: { response: { 204: z.null() } } },
    async (req, reply) => {
      const me = requireUser(req);
      const troca = await usersDb.trocarAvatar(me.id, null, null);
      if (troca?.anterior) await storage.apagar(troca.anterior);
      if (troca) gateway.broadcast({ op: 'USER_UPDATE', d: toApiUser(troca.user, me.roles) });
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/me/password',
    {
      schema: {
        body: z.object({ current: z.string().min(1), next: passwordSchema }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);

      if (!(await verifyPassword(me.row.password_hash, req.body.current))) {
        throw unauthorized('INVALID_CREDENTIALS', 'a senha atual está incorreta');
      }
      if (await isPasswordBreached(req.body.next)) {
        throw badRequest(
          'PASSWORD_BREACHED',
          'esta senha apareceu em vazamentos públicos, escolha outra',
          'next',
        );
      }

      await usersDb.updatePasswordHash(me.id, await hashPassword(req.body.next));

      // Derruba as outras sessões e mantém a atual: trocar a senha é a reação
      // natural a "acho que alguém entrou na minha conta".
      const family = await tokensDb.findFamilyOfSession(me.id, me.sessionId);
      if (family) await tokensDb.revokeAllExceptFamily(me.id, family);
      else await tokensDb.revokeAllOfUser(me.id);

      return reply.code(204).send(null);
    },
  );

  // --- 2FA --------------------------------------------------------------

  app.post(
    '/me/totp/setup',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        response: {
          200: z.object({ secret: z.string(), otpauthUrl: z.string(), qrSvg: z.string() }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const secret = generateSecret();
      const url = otpauthUrl(secret, me.row.username);

      // Guarda cifrado mas **não** ativa: só o `enable` com código correto
      // ativa. Sem isso, um setup abandonado deixaria a conta exigindo um
      // código que ninguém tem.
      await usersDb.setTotpSecret(me.id, encryptSecret(secret));

      return {
        secret,
        otpauthUrl: url,
        qrSvg: await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }),
      };
    },
  );

  app.post(
    '/me/totp/enable',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: userKey } },
      schema: {
        body: z.object({ code: z.string() }),
        response: { 200: z.object({ recoveryCodes: z.array(z.string()) }) },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!me.row.totp_secret) {
        throw badRequest('TOTP_NOT_STARTED', 'comece pela configuração do segundo fator');
      }
      if (!verifyCode(decryptSecret(me.row.totp_secret), req.body.code)) {
        throw badRequest('INVALID_CODE', 'código incorreto, confira o aplicativo');
      }

      await usersDb.enableTotp(me.id);

      // Mostrados uma única vez. Sem e-mail no sistema, são a única saída se a
      // pessoa perder o telefone. Ver docs/04-seguranca.md.
      const codes = generateRecoveryCodes();
      // Em série de propósito: Argon2id usa 64 MB por hash, e dez em paralelo
      // pediriam 640 MB de uma vez num servidor que tem 4 GB no total.
      const hashes: string[] = [];
      for (const code of codes) hashes.push(await hashPassword(code));
      await recoveryDb.replaceRecoveryCodes(me.id, hashes);

      return { recoveryCodes: codes };
    },
  );

  app.post(
    '/me/totp/disable',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: userKey } },
      schema: {
        body: z.object({ password: z.string().min(1), code: z.string() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const me = requireUser(req);
      if (!me.row.totp_secret || !me.row.totp_enabled_at) {
        throw badRequest('TOTP_NOT_ENABLED', 'o segundo fator não está ativo');
      }
      if (!(await verifyPassword(me.row.password_hash, req.body.password))) {
        throw unauthorized('INVALID_CREDENTIALS', 'a senha está incorreta');
      }

      // Aceita o código do aplicativo ou um de recuperação: quem perdeu o
      // telefone precisa conseguir desligar o 2FA para reconfigurá-lo.
      const secret = decryptSecret(me.row.totp_secret);
      let verified = verifyCode(secret, req.body.code);

      if (!verified) {
        const normalized = normalizeRecoveryCode(req.body.code);
        for (const candidate of await recoveryDb.listAvailable(me.id)) {
          if (await verifyPassword(candidate.code_hash, normalized)) {
            verified = await recoveryDb.consume(candidate.id);
            break;
          }
        }
      }
      if (!verified) throw badRequest('INVALID_CODE', 'código incorreto, confira o aplicativo');

      await usersDb.disableTotp(me.id);
      await recoveryDb.deleteAll(me.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/me/totp/recovery-codes/count',
    { schema: { response: { 200: z.object({ available: z.number().int() }) } } },
    async (req) => {
      const me = requireUser(req);
      return { available: await recoveryDb.countAvailable(me.id) };
    },
  );

  // --- sessões ----------------------------------------------------------

  app.get(
    '/me/sessions',
    {
      schema: {
        response: {
          200: z.object({
            sessions: z.array(
              z.object({
                id: z.string(),
                userAgent: z.string().nullable(),
                createdAt: z.string(),
                current: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      const currentFamily = await tokensDb.findFamilyOfSession(me.id, me.sessionId);
      const rows = await tokensDb.listSessions(me.id);
      // Sem IP, de propósito. Ver docs/05-contrato-api.md.
      return {
        sessions: rows.map((row) => ({
          id: row.id,
          userAgent: row.user_agent,
          createdAt: row.created_at.toISOString(),
          current: row.family_id === currentFamily,
        })),
      };
    },
  );

  app.delete(
    '/me/sessions/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const me = requireUser(req);
      const family = await tokensDb.findFamilyOfSession(me.id, req.params.id);
      if (family) await tokensDb.revokeFamily(family);
      return reply.code(204).send(null);
    },
  );
};
