import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { FastifyInstance } from 'fastify';

/**
 * Métricas.
 *
 * O que se mede aqui responde às perguntas que se fazem às três da manhã: tem
 * gente conectada? está passando mensagem? alguma rota ficou lenta? o banco
 * está respondendo?
 *
 * **Nada aqui identifica ninguém.** Rótulo é rota, método e código — nunca id
 * de pessoa, nunca canal, nunca IP. Uma série temporal por usuário é um
 * histórico de presença de cada um, e isso é justamente o que este projeto não
 * guarda. Ver docs/04-seguranca.md.
 */

export const registro = new Registry();

// Memória, GC, event loop. Vem do próprio processo e não fala de ninguém.
collectDefaultMetrics({ register: registro, prefix: 'trindade_' });

export const conexoesWs = new Gauge({
  name: 'trindade_ws_conexoes',
  help: 'Conexões WebSocket abertas agora',
  registers: [registro],
});

export const mensagensCriadas = new Counter({
  name: 'trindade_mensagens_total',
  help: 'Mensagens criadas desde que o processo subiu',
  registers: [registro],
});

export const duracaoDaRota = new Histogram({
  name: 'trindade_http_duracao_segundos',
  help: 'Tempo de resposta por rota',
  // Rótulo é a **rota declarada** (`/api/channels/:id/messages`), não a URL:
  // a URL carrega ids, e um id numa métrica é um rastro de quem fez o quê.
  labelNames: ['metodo', 'rota', 'status'] as const,
  // De 5ms a 5s: abaixo disso não interessa, acima disso já é problema.
  buckets: [0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registro],
});

export const errosPorCodigo = new Counter({
  name: 'trindade_erros_total',
  help: 'Respostas de erro por código',
  labelNames: ['status'] as const,
  registers: [registro],
});

/**
 * Mede toda requisição, sem tocar em nada que identifique.
 *
 * `routeOptions.url` é o padrão da rota; quando não há rota (404), o rótulo
 * vira `desconhecida` — agrupar todos os 404 numa série só é o que se quer,
 * porque a URL de um 404 costuma ser justamente lixo de varredura.
 */
export function medirRequisicoes(app: FastifyInstance): void {
  app.addHook('onResponse', (req, reply, feito) => {
    const rota = req.routeOptions?.url ?? 'desconhecida';
    const status = String(reply.statusCode);
    duracaoDaRota.observe(
      { metodo: req.method, rota, status },
      reply.elapsedTime / 1000,
    );
    if (reply.statusCode >= 400) errosPorCodigo.inc({ status });
    feito();
  });
}
