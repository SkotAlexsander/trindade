import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { WebhookReceiver } from 'livekit-server-sdk';
import { Perm, can } from '@trindade/shared';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import { userKey } from '../lib/client-key.js';
import { config } from '../config.js';
import * as channelsDb from '../db/channels.js';
import {
  credenciaisTurn,
  garantirSala,
  salaDoCanal,
  tokenDeVoz,
  vozConfigurada,
} from '../services/voz.js';
import { aplicarEventoDoLiveKit } from '../services/estado-de-voz.js';

/**
 * Voz.
 *
 * Duas rotas com públicos opostos: uma para quem vai entrar na chamada, outra
 * para o LiveKit contar o que aconteceu. A segunda não tem sessão e por isso
 * carrega duas trancas — assinatura e origem.
 */

export const voiceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/channels/:id/voice/token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 hour', keyGenerator: userKey } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            token: z.string(),
            wsUrl: z.string(),
            room: z.string(),
            iceServers: z.array(
              z.object({
                urls: z.array(z.string()),
                username: z.string().optional(),
                credential: z.string().optional(),
              }),
            ),
            canShareScreen: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      const me = requireUser(req);
      if (!can(me.permissions, Perm.CONNECT_VOICE)) {
        throw forbidden('MISSING_PERMISSION', 'você não pode entrar em chamadas');
      }
      if (!vozConfigurada()) {
        throw badRequest('VOICE_OFF', 'a chamada não está configurada neste servidor');
      }

      const canal = await channelsDb.findChannelById(req.params.id);
      if (!canal || canal.archived_at) throw notFound('CHANNEL_NOT_FOUND', 'este canal não existe');
      if (canal.kind !== 'voice') {
        throw badRequest('CHANNEL_NOT_VOICE', 'este canal não é de voz');
      }

      // A sala nasce aqui, e não no cliente: `auto_create` está desligado no
      // SFU justamente para que criar uma sala seja decisão do servidor,
      // depois da permissão conferida.
      try {
        await garantirSala(canal.id);
      } catch (err) {
        req.log.error({ err }, 'não consegui criar a sala no LiveKit');
        throw badRequest('VOICE_OFF', 'a chamada não está disponível agora');
      }

      return {
        token: await tokenDeVoz({
          userId: me.id,
          displayName: me.row.display_name,
          channelId: canal.id,
          permissions: me.permissions,
        }),
        wsUrl: config.LIVEKIT_URL as string,
        room: salaDoCanal(canal.id),
        iceServers: credenciaisTurn(me.id),
        // A interface esconde o botão sem a permissão; o token já não deixaria
        // publicar a trilha. As duas coisas, sempre.
        canShareScreen: can(me.permissions, Perm.SHARE_SCREEN),
      };
    },
  );
};

/**
 * O webhook do LiveKit.
 *
 * Plugin separado porque **não tem sessão** — quem chama é o SFU, não uma
 * pessoa. Separado e não só "registrado antes do hook": proteção que depende
 * da ordem das linhas é proteção que um dia se perde.
 */
export const livekitWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  // O corpo tem de chegar **cru**: a assinatura é sobre os bytes exatos, e
  // qualquer normalização do JSON — ordem de chave, espaço — muda o hash.
  app.addContentTypeParser(
    'application/webhook+json',
    { parseAs: 'string' },
    (_req, corpo, feito) => feito(null, corpo),
  );

  app.post(
    '/livekit/webhook',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!vozConfigurada()) return reply.code(204).send(null);

      // Primeira tranca: a origem. A assinatura já basta, mas uma rota que
      // reescreve o estado de voz de todo mundo merece as duas — e aceitar de
      // qualquer lugar significa aceitar de quem descobrir o segredo um dia.
      const permitidos = (config.LIVEKIT_WEBHOOK_IPS ?? '')
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean);
      if (permitidos.length > 0 && !permitidos.includes(req.ip)) {
        // Sem dizer qual lista existe nem quem está nela.
        throw unauthorized('WEBHOOK_REJECTED', 'origem não autorizada');
      }

      const assinatura = req.headers.authorization;
      if (!assinatura) throw unauthorized('WEBHOOK_REJECTED', 'sem assinatura');

      const receiver = new WebhookReceiver(
        config.LIVEKIT_API_KEY as string,
        config.LIVEKIT_API_SECRET as string,
      );

      let evento;
      try {
        // Segunda tranca: a assinatura, conferida sobre o corpo cru.
        evento = await receiver.receive(req.body as string, assinatura);
      } catch (err) {
        req.log.warn({ err }, 'webhook do LiveKit com assinatura inválida');
        throw unauthorized('WEBHOOK_REJECTED', 'assinatura inválida');
      }

      aplicarEventoDoLiveKit(evento, req.log);
      // 200 e pronto: o LiveKit repete o que não recebe resposta, e repetir um
      // evento de presença não custa nada — mas travar a fila dele custa.
      return reply.code(200).send({ ok: true });
    },
  );
};
