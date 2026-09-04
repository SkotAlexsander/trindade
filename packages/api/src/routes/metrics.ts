import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { config } from '../config.js';
import { unauthorized } from '../lib/errors.js';
import { registro } from '../lib/metricas.js';

/**
 * `/metrics`, para o Prometheus.
 *
 * **Protegida por token, e não por rede.** O firewall é a primeira tranca e
 * continua valendo, mas uma rota que conta quantas pessoas estão conectadas e
 * quando o servidor está ocupado não pode depender só de ninguém ter escaneado
 * a porta certa.
 *
 * Sem `METRICS_TOKEN` configurado ela não serve nada. Uma métrica aberta por
 * esquecimento é o tipo de coisa que só se descobre quando alguém a lê.
 */
export const metricsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/metrics',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const esperado = config.METRICS_TOKEN;
      if (!esperado) throw unauthorized('METRICS_OFF', 'métricas não estão configuradas');

      const cabecalho = req.headers.authorization ?? '';
      const oferecido = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
      if (!igual(oferecido, esperado)) {
        throw unauthorized('METRICS_DENIED', 'token de métricas inválido');
      }

      reply.header('content-type', registro.contentType);
      return reply.send(await registro.metrics());
    },
  );
};

/**
 * Comparação em tempo constante.
 *
 * Um `===` vaza o tamanho do prefixo correto pelo tempo de resposta. É pouco,
 * mas comparar segredo com `===` é o hábito que um dia se repete no lugar onde
 * importa.
 */
function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
