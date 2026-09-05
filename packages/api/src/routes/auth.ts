import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  inviteCodeSchema,
  usernameSchema,
  displayNameSchema,
  passwordSchema,
  userSchema,
} from '@trindade/shared';
import { config } from '../config.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword, burnPasswordTime } from '../lib/auth/password.js';
import { isPasswordBreached } from '../lib/auth/breached.js';
import {
  signAccessToken,
  signMfaToken,
  verifyMfaToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshExpiry,
  refreshCookieOptions,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../lib/auth/tokens.js';
import { decryptSecret, verifyCode, normalizeRecoveryCode } from '../lib/auth/totp.js';
import * as backoff from '../lib/auth/backoff.js';
import { attemptedUsernameKey } from '../lib/client-key.js';
import * as usersDb from '../db/users.js';
import * as invitesDb from '../db/invites.js';
import * as tokensDb from '../db/refresh-tokens.js';
import * as recoveryDb from '../db/recovery-codes.js';
import { toApiUser } from '../services/user-view.js';

/** O user-agent é guardado para a pessoa reconhecer a sessão. Nunca o IP. */
function userAgentOf(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 200) : null;
}

async function issueSession(
  reply: FastifyReply,
  req: FastifyRequest,
  userId: string,
  familyId: string = randomUUID(),
): Promise<string> {
  const refresh = generateRefreshToken();
  const row = await tokensDb.insertRefreshToken({
    userId,
    familyId,
    tokenHash: hashRefreshToken(refresh),
    userAgent: userAgentOf(req),
    expiresAt: refreshExpiry(),
  });
  reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOptions());
  return signAccessToken(userId, row.id);
}

const loginResponse = z.union([
  z.object({ access: z.string(), user: userSchema }),
  z.object({ mfaRequired: z.literal(true), mfaToken: z.string() }),
]);

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // --- registro ---------------------------------------------------------
  app.post(
    '/auth/register',
    {
      /*
       * Dez por hora, e não três.
       *
       * Cinco pessoas cadastrando da mesma casa ou do mesmo escritório dividem
       * um IP, e com três o terceiro amigo batia no limite no meio da tarde de
       * estreia. Quem defende de verdade aqui é o limite de **vagas**: um
       * flood não consegue passar de `VAGAS` contas de jeito nenhum. Dez ainda
       * segura a enxurrada e não atrapalha quem tem o direito de entrar.
       */
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        body: z.object({
          /**
           * O convite é **opcional**.
           *
           * Com ele, o caminho antigo: o convite é consumido e quem convidou
           * fica registrado. Sem ele, cadastro aberto — nome e senha, e nada
           * mais. As duas portas coexistem porque servem a momentos
           * diferentes: abrir o produto para o grupo entrar, e depois convidar
           * alguém pontualmente com as vagas já fechadas.
           */
          code: inviteCodeSchema.optional(),
          username: usernameSchema,
          /* Ausente, vira o próprio nome de usuário: pedir duas versões do
             nome numa tela de cadastro é uma pergunta a mais para uma resposta
             que a pessoa muda depois no perfil, se quiser. */
          displayName: displayNameSchema.optional(),
          password: passwordSchema,
        }),
        response: { 201: z.object({ user: userSchema }) },
      },
    },
    async (req, reply) => {
      const { code, username, password } = req.body;
      const displayName = req.body.displayName?.trim() || username;

      if (code) {
        const invite = await invitesDb.findInvite(code);
        if (!invite) throw badRequest('INVITE_INVALID', 'este convite não vale mais');
        if (invite.used_by) throw conflict('INVITE_USED', 'este convite não vale mais');
        if (invite.expires_at <= new Date()) {
          throw badRequest('INVITE_EXPIRED', 'este convite não vale mais');
        }
      } else if (config.VAGAS === 0) {
        // Distinto de "as vagas acabaram": aqui a porta foi fechada de
        // propósito, e a resposta não conta quantas contas existem.
        throw forbidden('CADASTRO_FECHADO', 'o cadastro está fechado');
      }

      if (await isPasswordBreached(password)) {
        throw badRequest(
          'PASSWORD_BREACHED',
          'esta senha apareceu em vazamentos públicos, escolha outra',
          'password',
        );
      }

      const passwordHash = await hashPassword(password);
      const result = code
        ? await usersDb.createUserFromInvite({ code, username, displayName, passwordHash })
        : await usersDb.createUser({
            username,
            displayName,
            passwordHash,
            vagas: config.VAGAS,
          });

      if ('error' in result) {
        if (result.error === 'USERNAME_TAKEN') {
          throw conflict('USERNAME_TAKEN', 'este nome já está sendo usado');
        }
        if (result.error === 'SEM_VAGAS') {
          throw forbidden('SEM_VAGAS', 'as vagas deste espaço acabaram');
        }
        throw conflict('INVITE_USED', 'este convite não vale mais');
      }

      // Sem login automático: exercitar a senha uma vez logo depois de criá-la
      // aumenta muito a chance de ela ser lembrada. Ver design/06-autenticacao.md.
      return reply.code(201).send({ user: toApiUser(result.user, result.roles) });
    },
  );

  // --- login ------------------------------------------------------------
  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          keyGenerator: (req: FastifyRequest) => {
            const body = req.body as { username?: string } | undefined;
            return `login:${attemptedUsernameKey(req, body?.username)}`;
          },
        },
      },
      schema: {
        body: z.object({ username: usernameSchema, password: z.string().min(1) }),
        response: { 200: loginResponse },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body;
      const key = attemptedUsernameKey(req, username);

      await backoff.wait(backoff.delayFor(key));

      const user = await usersDb.findUserByUsername(username);

      if (!user) {
        // Usuário inexistente gasta o mesmo tempo de um hash real.
        await burnPasswordTime();
        backoff.recordFailure(key);
        throw unauthorized('INVALID_CREDENTIALS', 'usuário ou senha incorretos');
      }

      const ok = await verifyPassword(user.password_hash, password);
      if (!ok) {
        backoff.recordFailure(key);
        // Nunca diga qual dos dois errou: isso confirma quais usuários existem.
        throw unauthorized('INVALID_CREDENTIALS', 'usuário ou senha incorretos');
      }

      if (user.disabled_at) {
        throw unauthorized(
          'ACCOUNT_DISABLED',
          'esta conta foi desativada, fale com quem administra o servidor',
        );
      }

      backoff.clearFailures(key);

      if (user.totp_enabled_at && user.totp_secret) {
        return reply.send({ mfaRequired: true as const, mfaToken: await signMfaToken(user.id) });
      }

      const access = await issueSession(reply, req, user.id);
      const roles = await usersDb.findRolesOfUser(user.id);
      return reply.send({ access, user: toApiUser(user, roles) });
    },
  );

  // --- segundo fator ----------------------------------------------------
  app.post(
    '/auth/totp',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          keyGenerator: (req: FastifyRequest) => {
            const body = req.body as { mfaToken?: string } | undefined;
            // O token curto identifica a tentativa sem expor o usuário na chave.
            return `totp:${(body?.mfaToken ?? '').slice(-24)}`;
          },
        },
      },
      schema: {
        body: z
          .object({
            mfaToken: z.string().min(1),
            code: z.string().optional(),
            recoveryCode: z.string().optional(),
          })
          .refine((b) => Boolean(b.code ?? b.recoveryCode), {
            message: 'informe o código do aplicativo ou um código de recuperação',
          }),
        response: { 200: z.object({ access: z.string(), user: userSchema }) },
      },
    },
    async (req, reply) => {
      const { mfaToken, code, recoveryCode } = req.body;
      const claims = await verifyMfaToken(mfaToken);

      const user = await usersDb.findUserById(claims.sub);
      if (!user?.totp_secret) throw unauthorized('INVALID_TOKEN', 'token inválido');
      if (user.disabled_at) throw unauthorized('ACCOUNT_DISABLED', 'esta conta foi desativada');

      let verified = false;

      if (code) {
        verified = verifyCode(decryptSecret(user.totp_secret), code);
        if (!verified) {
          throw unauthorized('INVALID_CODE', 'código incorreto, confira o aplicativo');
        }
      } else if (recoveryCode) {
        const normalized = normalizeRecoveryCode(recoveryCode);
        const available = await recoveryDb.listAvailable(user.id);
        for (const candidate of available) {
          if (await verifyPassword(candidate.code_hash, normalized)) {
            // `consume` só devolve true na primeira vez: uso único mesmo com
            // duas tentativas simultâneas.
            verified = await recoveryDb.consume(candidate.id);
            break;
          }
        }
        if (!verified) {
          throw unauthorized('INVALID_RECOVERY_CODE', 'código de recuperação inválido ou já usado');
        }
      }

      const access = await issueSession(reply, req, user.id);
      const roles = await usersDb.findRolesOfUser(user.id);
      return reply.send({ access, user: toApiUser(user, roles) });
    },
  );

  // --- rotação ----------------------------------------------------------
  app.post(
    '/auth/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: { response: { 200: z.object({ access: z.string() }) } },
    },
    async (req, reply) => {
      const presented = req.cookies[REFRESH_COOKIE];
      if (!presented) throw unauthorized('NO_REFRESH_TOKEN', 'faça login para continuar');

      const row = await tokensDb.findByHash(hashRefreshToken(presented));
      if (!row) {
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        throw unauthorized('INVALID_REFRESH_TOKEN', 'faça login para continuar');
      }

      // Um token já revogado reapareceu: alguém tem uma cópia. Derruba a
      // família inteira. Ver docs/04-seguranca.md.
      if (row.revoked_at) {
        await tokensDb.revokeFamily(row.family_id);
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        req.log.warn({ familyId: row.family_id }, 'reuso de refresh token: família revogada');
        throw unauthorized('TOKEN_REUSE', 'sessão revogada, entre de novo');
      }

      if (row.expires_at <= new Date()) {
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        throw unauthorized('REFRESH_EXPIRED', 'sua sessão expirou, entre de novo');
      }

      const user = await usersDb.findUserById(row.user_id);
      if (!user || user.disabled_at) {
        await tokensDb.revokeFamily(row.family_id);
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        throw unauthorized('ACCOUNT_DISABLED', 'esta conta foi desativada');
      }

      const next = generateRefreshToken();
      const rotated = await tokensDb.rotate({
        oldId: row.id,
        userId: row.user_id,
        familyId: row.family_id,
        tokenHash: hashRefreshToken(next),
        userAgent: userAgentOf(req),
        expiresAt: refreshExpiry(),
      });

      // Perdeu a corrida: outra requisição rotacionou este mesmo token.
      if (!rotated) {
        await tokensDb.revokeFamily(row.family_id);
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
        throw unauthorized('TOKEN_REUSE', 'sessão revogada, entre de novo');
      }

      reply.setCookie(REFRESH_COOKIE, next, refreshCookieOptions());
      return reply.send({ access: await signAccessToken(row.user_id, rotated.id) });
    },
  );

  // --- saída ------------------------------------------------------------
  app.post('/auth/logout', async (req, reply) => {
    const presented = req.cookies[REFRESH_COOKIE];
    if (presented) {
      const row = await tokensDb.findByHash(hashRefreshToken(presented));
      if (row) await tokensDb.revokeFamily(row.family_id);
    }
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return reply.code(204).send();
  });

  app.post('/auth/logout-all', { preHandler: app.authenticate }, async (req, reply) => {
    if (req.user) await tokensDb.revokeAllOfUser(req.user.id);
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return reply.code(204).send();
  });
};
