import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config, isProduction } from './config.js';
import { errorHandler } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { inviteRoutes } from './routes/invites.js';
import { ipKey } from './lib/client-key.js';

export async function buildApp() {
  const app = Fastify({
    // O log automático de requisição do Fastify inclui `remoteAddress`.
    // Desligamos e registramos o que interessa à mão, sem IP — ver
    // docs/04-seguranca.md.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: true,
    logger: {
      level: isProduction ? 'info' : 'debug',
      ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
      // Só o que é útil para depurar. Sem ip, sem headers, sem user-agent.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      redact: {
        paths: ['req.headers', 'req.ip', 'req.ips', 'req.remoteAddress', 'req.hostname'],
        remove: true,
      },
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandler);

  // Em dev, só a origem do Vite. Em produção o front é servido pelo mesmo
  // domínio e não há CORS a liberar.
  await app.register(cors, {
    origin: isProduction ? false : config.WEB_ORIGIN,
    credentials: true,
  });

  await app.register(cookie);

  // Global desligado: cada rota declara o próprio limite em `config.rateLimit`,
  // nos números da tabela de docs/04-seguranca.md. A chave padrão é o HMAC do
  // IP com sal que troca todo dia, nunca o IP em claro.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => ipKey(req),
    addHeaders: { 'retry-after': true, 'x-ratelimit-reset': true },
  });

  await app.register(authPlugin);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(inviteRoutes);
    },
    { prefix: '/api' },
  );

  // Log manual de requisição, sem IP.
  app.addHook('onResponse', (req, reply, done) => {
    req.log.debug(
      { method: req.method, url: req.url, status: reply.statusCode, ms: reply.elapsedTime },
      'request',
    );
    done();
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
