import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config, isProduction } from './config.js';
import { errorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';

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

  // Log manual de requisição, sem IP.
  app.addHook('onResponse', (req, reply, done) => {
    req.log.debug(
      { method: req.method, url: req.url, status: reply.statusCode, ms: reply.elapsedTime },
      'request',
    );
    done();
  });

  await app.register(healthRoutes, { prefix: '/api' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
