import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import {
  CLOSE,
  HEARTBEAT_TIMEOUT_MS,
  type ServerEvent,
  type UserStatus,
} from '@trindade/shared';

/**
 * Estado do gateway, em memória.
 *
 * Um processo Node só, então não há Redis nem pub/sub. Com cinco pessoas e
 * talvez quinze conexões, percorrer o mapa inteiro num broadcast custa nada —
 * não invente índice por canal antes de precisar.
 * Ver docs/02-arquitetura.md e docs/06-realtime-e-webrtc.md.
 */
export interface Connection {
  ws: WebSocket;
  userId: string;
  sessionId: string;
  permissions: bigint;
  subscribed: Set<string>;
  lastHeartbeat: number;
  /** Status declarado pela pessoa. `invisible` some para os outros. */
  status: UserStatus;
  customStatus: string | null;
  timers: NodeJS.Timeout[];
}

const connections = new Map<string, Connection>();
const byUser = new Map<string, Set<string>>();

/** Quem já recebeu um READY nesta execução — a sequência do elenco roda uma vez. */
const jaViuReady = new Set<string>();

export function register(conn: Connection): void {
  connections.set(conn.sessionId, conn);
  const sessoes = byUser.get(conn.userId) ?? new Set<string>();
  sessoes.add(conn.sessionId);
  byUser.set(conn.userId, sessoes);
}

/** Devolve `true` se esta era a última conexão da pessoa. */
export function unregister(sessionId: string): { userId: string; ultima: boolean } | null {
  const conn = connections.get(sessionId);
  if (!conn) return null;

  for (const t of conn.timers) clearInterval(t);
  connections.delete(sessionId);

  const sessoes = byUser.get(conn.userId);
  sessoes?.delete(sessionId);
  const ultima = !sessoes || sessoes.size === 0;
  if (ultima) byUser.delete(conn.userId);

  return { userId: conn.userId, ultima };
}

export function get(sessionId: string): Connection | undefined {
  return connections.get(sessionId);
}

export function sessionsOf(userId: string): Connection[] {
  const ids = byUser.get(userId);
  if (!ids) return [];
  return [...ids].map((id) => connections.get(id)).filter((c): c is Connection => Boolean(c));
}

export function online(): string[] {
  return [...byUser.keys()];
}

export function primeiroReady(userId: string): boolean {
  if (jaViuReady.has(userId)) return false;
  jaViuReady.add(userId);
  return true;
}

/** Só para os testes: devolve o gateway ao estado inicial. */
export function resetGateway(): void {
  for (const conn of connections.values()) {
    for (const t of conn.timers) clearInterval(t);
  }
  connections.clear();
  byUser.clear();
  jaViuReady.clear();
}

// --- envio ----------------------------------------------------------------

export function send(conn: Connection, evento: ServerEvent): void {
  if (conn.ws.readyState !== 1) return;
  conn.ws.send(JSON.stringify(evento));
}

export function sendToUser(userId: string, evento: ServerEvent): void {
  for (const conn of sessionsOf(userId)) send(conn, evento);
}

/**
 * Broadcast para todos os conectados.
 *
 * Não há ACL por canal — com cinco pessoas, todo mundo vê todo canal — então
 * não há o que filtrar aqui. `exceto` serve para o autor que já aplicou a
 * mudança de forma otimista, quando for o caso.
 */
export function broadcast(evento: ServerEvent, exceto?: string): void {
  for (const conn of connections.values()) {
    if (exceto && conn.sessionId === exceto) continue;
    send(conn, evento);
  }
}

/**
 * Fecha todas as conexões de alguém agora.
 *
 * Existe porque desativar uma conta não pode esperar a revalidação de 60s: a
 * conexão vive muito mais que os 15 minutos do access token, e enquanto o
 * socket está de pé a pessoa continua lendo tudo o que passa.
 */
export function derrubar(userId: string, codigo: number, motivo: string): void {
  for (const conn of sessionsOf(userId)) conn.ws.close(codigo, motivo);
}

/**
 * Avisa alguém de que a permissão mudou, sem esperar a revalidação.
 *
 * O `conn.permissions` é atualizado junto: ele é o que autoriza cada evento
 * que chega pelo socket, e deixá-lo velho manteria a permissão antiga valendo
 * de verdade — não só na interface.
 */
export function avisarPermissoes(userId: string, permissoes?: bigint): void {
  for (const conn of sessionsOf(userId)) {
    if (permissoes !== undefined) conn.permissions = permissoes;
    // Sem o valor novo em mãos, a revalidação periódica corrige em até 60s; o
    // aviso aqui serve para a interface se ajustar na hora.
    send(conn, { op: 'PERMISSIONS_UPDATE', d: { permissions: conn.permissions.toString() } });
  }
}

/**
 * Presença que os outros veem.
 *
 * `invisible` sai como `offline`. O filtro é aqui, no servidor: mandar o
 * status real e deixar o cliente esconder seria confiar no cliente para
 * guardar um segredo da pessoa. Ver docs/06-realtime-e-webrtc.md.
 */
export function statusPublico(status: UserStatus): UserStatus {
  return status === 'invisible' ? 'offline' : status;
}

export function broadcastPresenca(userId: string, status: UserStatus, customStatus: string | null): void {
  broadcast({
    op: 'PRESENCE_UPDATE',
    d: { userId, status: statusPublico(status), customStatus },
  });
}

// --- heartbeat -------------------------------------------------------------

/**
 * O cliente manda `HEARTBEAT` a cada 30s e o servidor fecha aos 90s.
 *
 * Não usamos o ping/pong do protocolo: proxies intermediários respondem por
 * conta própria e a conexão parece viva depois de morta.
 */
export function iniciarHeartbeat(conn: Connection, log: FastifyBaseLogger): NodeJS.Timeout {
  return setInterval(() => {
    if (Date.now() - conn.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      log.info({ sessionId: conn.sessionId }, 'sem heartbeat, fechando');
      conn.ws.close(CLOSE.HEARTBEAT_TIMEOUT, 'HEARTBEAT_TIMEOUT');
    }
  }, HEARTBEAT_TIMEOUT_MS / 3);
}

// --- rate limit ------------------------------------------------------------

/**
 * Token bucket por usuário: 10 mensagens por 10s com estouro de 3.
 *
 * Estourar manda `ERROR` e não fecha — quem escreve rápido não é atacante.
 * Fecha com 4003 só se continuar martelando depois do aviso.
 */
const CAPACIDADE = 13;
const RECARGA_POR_MS = 10 / 10_000;
const AVISOS_ATE_FECHAR = 5;

interface Balde {
  fichas: number;
  atualizado: number;
  avisos: number;
}

const baldes = new Map<string, Balde>();

export function consumirFicha(userId: string): { ok: true } | { ok: false; esperaMs: number; fechar: boolean } {
  const agora = Date.now();
  const balde = baldes.get(userId) ?? { fichas: CAPACIDADE, atualizado: agora, avisos: 0 };

  balde.fichas = Math.min(CAPACIDADE, balde.fichas + (agora - balde.atualizado) * RECARGA_POR_MS);
  balde.atualizado = agora;

  if (balde.fichas >= 1) {
    balde.fichas -= 1;
    balde.avisos = 0;
    baldes.set(userId, balde);
    return { ok: true };
  }

  balde.avisos += 1;
  baldes.set(userId, balde);
  return {
    ok: false,
    esperaMs: Math.ceil((1 - balde.fichas) / RECARGA_POR_MS),
    fechar: balde.avisos >= AVISOS_ATE_FECHAR,
  };
}

export function resetRateLimit(): void {
  baldes.clear();
}
