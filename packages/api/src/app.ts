import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config, isProduction } from './config.js';
import { errorHandler } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { taskRoutes } from './routes/tasks.js';
import { medirRequisicoes } from './lib/metricas.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { inviteAdminRoutes, inviteRoutes } from './routes/invites.js';
import { roleRoutes } from './routes/roles.js';
import { livekitWebhookRoutes, voiceRoutes } from './routes/voice.js';
import { channelRoutes } from './routes/channels.js';
import { userRoutes } from './routes/users.js';
import { messageRoutes } from './routes/messages.js';
import { attachmentRoutes, fileRoutes } from './routes/attachments.js';
import { registerGateway } from './ws/index.js';
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

  // Antes das rotas: o gancho de medição é `onResponse` e precisa estar de pé
  // quando a primeira resposta sair.
  medirRequisicoes(app);

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
  //
  // `hook: 'preHandler'` não é detalhe: o padrão do plugin é `onRequest`, que
  // roda **antes** do corpo ser lido. A tabela do documento manda o login usar
  // "usuário + hash de IP" como chave, e no `onRequest` o `req.body` é
  // undefined — a chave viraria só o IP, silenciosamente, e todo mundo atrás
  // do mesmo endereço dividiria o mesmo balde.
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    keyGenerator: (req) => ipKey(req),
    addHeaders: { 'retry-after': true, 'x-ratelimit-reset': true },
  });

  // 50 MB e 10 arquivos são os números de docs/04-seguranca.md. O limite fica
  // aqui, no plugin, e não numa checagem depois de ler: o ponto de cortar um
  // upload grande demais é antes de ele caber na memória.
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 10, fields: 4, fieldSize: 1024 },
  });

  await app.register(authPlugin);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(metricsRoutes);
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(inviteRoutes);
      await api.register(inviteAdminRoutes);
      await api.register(roleRoutes);
      await api.register(voiceRoutes);
      await api.register(livekitWebhookRoutes);
      await api.register(channelRoutes);
      await api.register(userRoutes);
      await api.register(messageRoutes);
      await api.register(taskRoutes);
      await api.register(attachmentRoutes);
      await api.register(fileRoutes);
    },
    { prefix: '/api' },
  );

  // O gateway vive na mesma porta e no mesmo processo — ver docs/02-arquitetura.md.
  await registerGateway(app);

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
