import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import {
  CLOSE,
  Perm,
  can,
  clientEventSchema,
  type ClientEvent,
  type ReadyPayload,
} from '@trindade/shared';
import { verifyAccessToken } from '../lib/auth/tokens.js';
import { effectivePermissions } from '../lib/auth/permissions.js';
import * as usersDb from '../db/users.js';
import * as channelsDb from '../db/channels.js';
import * as messagesDb from '../db/messages.js';
import { toApiChannel } from '../services/channel-view.js';
import { toApiMessage } from '../services/message-view.js';
import { toApiUser } from '../services/user-view.js';
import * as gw from './gateway.js';

const REVALIDACAO_MS = 60_000;

/**
 * Gateway WebSocket.
 *
 * Fastify serve HTTP e WebSocket na mesma porta e no mesmo processo: com cinco
 * usuários não existe motivo para separar, e a memória compartilhada torna o
 * mapa de conexões trivial. Ver docs/02-arquitetura.md.
 */
export async function registerGateway(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get('/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    if (!token) {
      socket.close(CLOSE.UNAUTHENTICATED, 'NO_TOKEN');
      return;
    }

    let userId: string;
    try {
      const claims = await verifyAccessToken(token);
      userId = claims.sub;
    } catch {
      socket.close(CLOSE.UNAUTHENTICATED, 'INVALID_TOKEN');
      return;
    }

    const linha = await usersDb.findUserById(userId);
    if (!linha || linha.disabled_at) {
      socket.close(CLOSE.ACCOUNT_DISABLED, 'ACCOUNT_DISABLED');
      return;
    }

    const cargos = await usersDb.findRolesOfUser(userId);
    const conn: gw.Connection = {
      ws: socket,
      userId,
      // Uma pessoa pode ter várias conexões — desktop e celular ao mesmo
      // tempo. O id da sessão é da conexão, não do usuário.
      sessionId: randomUUID(),
      permissions: effectivePermissions(cargos),
      subscribed: new Set(),
      lastHeartbeat: Date.now(),
      status: linha.status === 'offline' ? 'online' : linha.status,
      customStatus: linha.custom_status,
      timers: [],
    };

    const eraOffline = gw.sessionsOf(userId).length === 0;
    gw.register(conn);

    // --- READY ------------------------------------------------------------
    const [pessoas, canais, leitura] = await Promise.all([
      usersDb.listUsers(),
      channelsDb.listChannels(),
      messagesDb.listReadState(userId),
    ]);
    const conectados = new Set(gw.online());

    const payload: ReadyPayload = {
      user: toApiUser(linha, cargos),
      users: pessoas.map(({ user, roles }) => {
        const api = toApiUser(user, roles);
        // O status que sai daqui é o público: quem escolheu invisível aparece
        // offline, e quem não tem socket aberto também.
        const declarado = gw.sessionsOf(user.id)[0]?.status ?? user.status;
        api.status = conectados.has(user.id) ? gw.statusPublico(declarado) : 'offline';
        return api;
      }),
      channels: canais.map(toApiChannel),
      readState: leitura,
      voiceStates: [],
      first: gw.primeiroReady(userId),
    };
    gw.send(conn, { op: 'READY', d: payload });

    if (eraOffline) gw.broadcastPresenca(userId, conn.status, conn.customStatus);

    // --- timers -----------------------------------------------------------
    conn.timers.push(gw.iniciarHeartbeat(conn, app.log));
    conn.timers.push(
      setInterval(() => {
        void revalidar(conn, app);
      }, REVALIDACAO_MS),
    );

    // --- mensagens --------------------------------------------------------
    socket.on('message', (bruto: Buffer) => {
      void tratar(conn, bruto, app);
    });

    socket.on('close', () => {
      const saida = gw.unregister(conn.sessionId);
      // Só marque offline quando **todas** as conexões caírem: fechar uma aba
      // não pode deixar a pessoa offline para os outros.
      if (saida?.ultima) gw.broadcastPresenca(saida.userId, 'offline', conn.customStatus);
    });
  });
}

/**
 * A cada 60 segundos: conta desativada cai, permissão nova é avisada.
 *
 * Sem isto, remover alguém do grupo não tem efeito até a pessoa fechar o
 * navegador — a conexão vive muito mais que os 15 minutos do access token.
 */
async function revalidar(conn: gw.Connection, app: FastifyInstance): Promise<void> {
  const linha = await usersDb.findUserById(conn.userId);
  if (!linha || linha.disabled_at) {
    app.log.info({ userId: conn.userId }, 'conta desativada, derrubando conexão');
    conn.ws.close(CLOSE.ACCOUNT_DISABLED, 'ACCOUNT_DISABLED');
    return;
  }

  const cargos = await usersDb.findRolesOfUser(conn.userId);
  const perms = effectivePermissions(cargos);
  if (perms !== conn.permissions) {
    conn.permissions = perms;
    gw.send(conn, { op: 'PERMISSIONS_UPDATE', d: { permissions: perms.toString() } });
    gw.broadcast({ op: 'USER_UPDATE', d: toApiUser(linha, cargos) });
  }
}

async function tratar(conn: gw.Connection, bruto: Buffer, app: FastifyInstance): Promise<void> {
  let evento: ClientEvent;
  try {
    evento = clientEventSchema.parse(JSON.parse(bruto.toString()));
  } catch (err) {
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      conn.ws.close(CLOSE.INVALID_PAYLOAD, 'INVALID_PAYLOAD');
      return;
    }
    throw err;
  }

  switch (evento.op) {
    case 'HEARTBEAT':
      conn.lastHeartbeat = Date.now();
      return;

    case 'SUBSCRIBE':
      conn.subscribed = new Set(evento.d.channelIds);
      return;

    case 'TYPING_START':
      // Não existe TYPING_STOP: quem recebe guarda o instante e limpa sozinho
      // após 8 segundos. Ver docs/06-realtime-e-webrtc.md.
      gw.broadcast(
        { op: 'TYPING_START', d: { channelId: evento.d.channelId, userId: conn.userId } },
        conn.sessionId,
      );
      return;

    case 'PRESENCE_UPDATE': {
      conn.status = evento.d.status;
      conn.customStatus = evento.d.customStatus ?? null;
      await usersDb.setPresence(conn.userId, conn.status, conn.customStatus);
      gw.broadcastPresenca(conn.userId, conn.status, conn.customStatus);
      return;
    }

    case 'MESSAGE_CREATE':
      await criarMensagem(conn, evento.d, app);
      return;
  }
}

async function criarMensagem(
  conn: gw.Connection,
  d: Extract<ClientEvent, { op: 'MESSAGE_CREATE' }>['d'],
  app: FastifyInstance,
): Promise<void> {
  if (!can(conn.permissions, Perm.SEND_MESSAGE)) {
    gw.send(conn, {
      op: 'ERROR',
      d: { code: 'MISSING_PERMISSION', message: 'você não pode enviar mensagens' },
    });
    return;
  }

  const ficha = gw.consumirFicha(conn.userId);
  if (!ficha.ok) {
    gw.send(conn, {
      op: 'ERROR',
      d: {
        code: 'RATE_LIMITED',
        message: 'devagar — espere um instante',
        retryAfter: Math.ceil(ficha.esperaMs / 1000),
      },
    });
    // Fecha só se insistir depois do aviso. Quem escreve rápido não é atacante.
    if (ficha.fechar) conn.ws.close(CLOSE.RATE_LIMITED, 'RATE_LIMITED');
    return;
  }

  const canal = await channelsDb.findChannelById(d.channelId);
  if (!canal || canal.archived_at) {
    gw.send(conn, { op: 'ERROR', d: { code: 'CHANNEL_NOT_FOUND', message: 'este canal não existe' } });
    return;
  }

  const { row, novo } = await messagesDb.createMessage({
    channelId: d.channelId,
    authorId: conn.userId,
    content: d.content,
    clientNonce: d.clientNonce,
    replyToId: d.replyToId ?? null,
    parentId: d.parentId ?? null,
  });

  // Reenvio por rede instável cai aqui: a linha já existia, então confirmamos
  // para quem mandou e não repetimos o broadcast.
  if (!novo) {
    gw.send(conn, { op: 'MESSAGE_CREATE', d: toApiMessage(row, { meuId: conn.userId }) });
    app.log.debug({ nonce: d.clientNonce }, 'nonce repetido, sem duplicar');
    return;
  }

  // Menções contam para o badge de quem foi citado, nunca para quem escreveu.
  const mencionados = await messagesDb.resolveMentions(d.content);
  if (mencionados.length > 0) {
    await messagesDb.somarMencoes(d.channelId, mencionados, conn.userId);
  }

  // O broadcast inclui o autor: é assim que ele casa pelo `clientNonce` e
  // substitui a mensagem otimista pela real.
  for (const outra of [...gw.sessionsOf(conn.userId)]) {
    gw.send(outra, { op: 'MESSAGE_CREATE', d: toApiMessage(row, { meuId: outra.userId }) });
  }
  for (const c of gw.online()) {
    if (c === conn.userId) continue;
    gw.sendToUser(c, {
      op: 'MESSAGE_CREATE',
      // Sem o nonce para os outros: ele só serve a quem enviou.
      d: { ...toApiMessage(row, { meuId: c }), clientNonce: undefined },
    });
  }
}

export { gw as gateway };
