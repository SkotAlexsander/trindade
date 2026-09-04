import { z } from 'zod';
import QRCode from 'qrcode';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { passwordSchema, roleSchema, userSchema } from '@trindade/shared';
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
