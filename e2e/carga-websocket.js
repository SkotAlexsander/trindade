/**
 * Carga no gateway: 50 conexões simultâneas.
 *
 * Dez vezes o uso real — cinco pessoas, talvez quinze conexões contando abas —,
 * e o objetivo não é provar que aguenta: é **saber onde quebra**. Um número que
 * ninguém mediu é um número que se descobre num sábado.
 *
 * Cada conexão faz o que uma pessoa faz: entra, recebe o READY, assina os
 * canais, manda mensagem de vez em quando e responde ao heartbeat.
 *
 * Rodar (o k6 vem em contêiner; não precisa instalar nada):
 *
 *   docker run --rm -i -e ALVO=ws://host.docker.internal:3000 \
 *     -e TOKENS="$(node e2e/tokens-de-carga.mjs)" \
 *     grafana/k6:latest run - < e2e/carga-websocket.js
 *
 * A API precisa estar escutando em 0.0.0.0 para o contêiner alcançá-la:
 * `API_HOST=0.0.0.0` no `.env` enquanto durar o teste.
 */
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const ALVO = __ENV.ALVO || 'ws://host.docker.internal:3000';
const TOKENS = (__ENV.TOKENS || '').split(',').filter(Boolean);

const readyRecebidos = new Counter('ready_recebidos');
const mensagensEcoadas = new Counter('mensagens_ecoadas');
const conexoesRecusadas = new Counter('conexoes_recusadas');
const tempoAteReady = new Trend('tempo_ate_ready', true);

export const options = {
  scenarios: {
    cinquenta: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 1,
      maxDuration: '90s',
    },
  },
  thresholds: {
    // O que interessa saber: todo mundo entrou, e o READY não demorou.
    ready_recebidos: ['count>=50'],
    conexoes_recusadas: ['count==0'],
    tempo_ate_ready: ['p(95)<2000'],
  },
};

export default function () {
  // Os tokens são poucos e as conexões, muitas: cada uma pega um em rodízio,
  // que é o pior caso para o mapa `byUser` do gateway — várias sessões da
  // mesma pessoa.
  const token = TOKENS[(__VU - 1) % TOKENS.length];
  if (!token) {
    conexoesRecusadas.add(1);
    return;
  }

  const inicio = Date.now();
  let viuReady = false;

  const resposta = ws.connect(`${ALVO}/ws?token=${token}`, {}, (socket) => {
    socket.on('message', (bruta) => {
      const evento = JSON.parse(bruta);

      if (evento.op === 'READY') {
        viuReady = true;
        readyRecebidos.add(1);
        tempoAteReady.add(Date.now() - inicio);

        // Assina os canais, como o cliente de verdade faz logo depois do READY.
        const canais = (evento.d.channels || []).map((c) => c.id);
        socket.send(JSON.stringify({ op: 'SUBSCRIBE', d: { channelIds: canais } }));

        // Uma mensagem por conexão, num canal de texto. Dez segundos de
        // conversa a 50 vozes é mais barulho do que esta sala verá num mês.
        const texto = (evento.d.channels || []).find((c) => c.kind === 'text');
        if (texto) {
          socket.setTimeout(() => {
            socket.send(
              JSON.stringify({
                op: 'MESSAGE_CREATE',
                d: {
                  channelId: texto.id,
                  content: `carga ${__VU}`,
                  clientNonce: `00000000-0000-4000-8000-${String(__VU).padStart(12, '0')}`,
                },
              }),
            );
          }, 1000 + __VU * 40);
        }
      }

      if (evento.op === 'MESSAGE_CREATE') mensagensEcoadas.add(1);
      // O gateway manda `HEARTBEAT`; quem não responde é derrubado.
      if (evento.op === 'HEARTBEAT') socket.send(JSON.stringify({ op: 'HEARTBEAT_ACK' }));
    });

    socket.on('error', () => conexoesRecusadas.add(1));
    socket.setTimeout(() => socket.close(), 20000);
  });

  check(resposta, { 'handshake aceito': (r) => r && r.status === 101 });
  check(viuReady, { 'recebeu READY': (v) => v === true });
  sleep(1);
}
