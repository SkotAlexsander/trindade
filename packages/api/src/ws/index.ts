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
import * as conversationsDb from '../db/conversations.js';
import * as messagesDb from '../db/messages.js';
import * as attachmentsDb from '../db/attachments.js';
import { toApiChannel } from '../services/channel-view.js';
import { toApiMessage } from '../services/message-view.js';
import { toApiAttachment } from '../services/attachment-view.js';
import { definirMicrofone, esquecerUsuario, estadosDeVoz } from '../services/estado-de-voz.js';
import { toApiUser } from '../services/user-view.js';
import * as gw from './gateway.js';
import { mensagensCriadas } from '../lib/metricas.js';
import * as notas from '../services/notas.js';
import * as quadros from '../services/quadro-branco.js';

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
      notas: new Set(),
      quadros: new Set(),
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
      voiceStates: estadosDeVoz(),
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
      // Fechar a aba no meio da edição não pode perder nada: cada nota aberta
      // por esta conexão é fechada, e a última a sair grava na hora.
      for (const channelId of [...conn.notas]) {
        void fecharPainelDeNotas(conn, channelId).catch((err: unknown) => {
          app.log.error({ err, channelId }, 'não consegui fechar a nota ao desconectar');
        });
      }
      // O mesmo para o quadro, e aqui pesa mais: o último traço costuma ser o
      // que a pessoa acabou de explicar em voz alta.
      for (const boardId of [...conn.quadros]) {
        void fecharQuadro(conn, boardId).catch((err: unknown) => {
          app.log.error({ err, boardId }, 'não consegui fechar o quadro ao desconectar');
        });
      }

      const saida = gw.unregister(conn.sessionId);
      // Só marque offline quando **todas** as conexões caírem: fechar uma aba
      // não pode deixar a pessoa offline para os outros.
      if (saida?.ultima) {
        gw.broadcastPresenca(saida.userId, 'offline', conn.customStatus);
        // E sai da chamada junto. O LiveKit também vai avisar, mas por outro
        // caminho e com outro tempo; quem fecha o navegador não pode ficar
        // parado na grade até o SFU perceber.
        esquecerUsuario(saida.userId);
      }
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

    case 'TYPING_START': {
      // Não existe TYPING_STOP: quem recebe guarda o instante e limpa sozinho
      // após 8 segundos. Ver docs/06-realtime-e-webrtc.md.
      const d = {
        channelId: evento.d.channelId ?? null,
        conversationId: evento.d.conversationId ?? null,
        userId: conn.userId,
      };

      // Numa conversa privada, "está digitando" também é privado: quem não é
      // membro não fica sabendo nem que há alguém escrevendo ali.
      if (d.conversationId) {
        if (!(await conversationsDb.ehMembro(d.conversationId, conn.userId))) return;
        for (const membro of await conversationsDb.membros(d.conversationId)) {
          if (membro.left_at || membro.user_id === conn.userId) continue;
          gw.sendToUser(membro.user_id, { op: 'TYPING_START', d });
        }
        return;
      }

      gw.broadcast({ op: 'TYPING_START', d }, conn.sessionId);
      return;
    }

    case 'PRESENCE_UPDATE': {
      conn.status = evento.d.status;
      conn.customStatus = evento.d.customStatus ?? null;
      await usersDb.setPresence(conn.userId, conn.status, conn.customStatus);
      gw.broadcastPresenca(conn.userId, conn.status, conn.customStatus);
      return;
    }

    case 'VOICE_STATE':
      definirMicrofone(
        conn.userId,
        evento.d.channelId,
        evento.d.muted,
        evento.d.deafened,
      );
      return;

    case 'MESSAGE_CREATE':
      await criarMensagem(conn, evento.d, app);
      return;

    case 'NOTE_OPEN':
      await abrirPainelDeNotas(conn, evento.d.channelId);
      return;

    case 'NOTE_CLOSE':
      await fecharPainelDeNotas(conn, evento.d.channelId);
      return;

    case 'NOTE_UPDATE': {
      // **Só com `MANAGE_NOTES`.** Esconder o editor na interface não é
      // controle de acesso: sem esta linha, um delta mandado à mão entraria.
      if (!can(conn.permissions, Perm.MANAGE_NOTES)) {
        gw.send(conn, {
          op: 'ERROR',
          d: { code: 'MISSING_PERMISSION', message: 'você não pode editar as notas' },
        });
        return;
      }
      const nota = await notas.abrirNota(evento.d.channelId, conn.userId);
      notas.aplicar(
        evento.d.channelId,
        nota,
        Buffer.from(evento.d.update, 'base64'),
        conn.userId,
        app.log,
      );

      // Repassa a quem está com a nota aberta, e só a eles: o delta não
      // interessa a quem nem abriu o painel.
      for (const outra of gw.comNotaAberta(evento.d.channelId)) {
        if (outra.sessionId === conn.sessionId) continue;
        gw.send(outra, {
          op: 'NOTE_UPDATE',
          d: { channelId: evento.d.channelId, update: evento.d.update, de: conn.userId },
        });
      }
      return;
    }

    case 'NOTE_AWARENESS':
      // Cursor e seleção não passam pelo banco nem exigem permissão: quem só
      // lê também aparece, e é assim que se sabe que alguém está olhando.
      for (const outra of gw.comNotaAberta(evento.d.channelId)) {
        if (outra.sessionId === conn.sessionId) continue;
        gw.send(outra, {
          op: 'NOTE_AWARENESS',
          d: { channelId: evento.d.channelId, estado: evento.d.estado, de: conn.userId },
        });
      }
      return;

    case 'BOARD_OPEN':
      await abrirQuadro(conn, evento.d.boardId);
      return;

    case 'BOARD_CLOSE':
      await fecharQuadro(conn, evento.d.boardId);
      return;

    case 'BOARD_UPDATE': {
      // A mesma linha da nota, pelo mesmo motivo: esconder as ferramentas na
      // tela não é controle de acesso, e um delta mandado à mão entraria.
      if (!can(conn.permissions, Perm.MANAGE_NOTES)) {
        gw.send(conn, {
          op: 'ERROR',
          d: { code: 'MISSING_PERMISSION', message: 'você não pode desenhar neste quadro' },
        });
        return;
      }

      const quadro = await quadros.abrirQuadro(evento.d.boardId, conn.userId);
      quadros.aplicar(
        evento.d.boardId,
        quadro,
        Buffer.from(evento.d.update, 'base64'),
        conn.userId,
        app.log,
      );

      for (const outra of gw.comQuadroAberto(evento.d.boardId)) {
        if (outra.sessionId === conn.sessionId) continue;
        gw.send(outra, {
          op: 'BOARD_UPDATE',
          d: { boardId: evento.d.boardId, update: evento.d.update, de: conn.userId },
        });
      }

      anunciarContagem(evento.d.boardId, quadros.contarElementos(quadro));
      return;
    }

    case 'BOARD_AWARENESS':
      // Cursor e apontador de quem está olhando. Não exige permissão: quem só
      // vê também aponta, e é para isso que o apontador existe.
      for (const outra of gw.comQuadroAberto(evento.d.boardId)) {
        if (outra.sessionId === conn.sessionId) continue;
        gw.send(outra, {
          op: 'BOARD_AWARENESS',
          d: { boardId: evento.d.boardId, estado: evento.d.estado, de: conn.userId },
        });
      }
      return;
  }
}

/**
 * Abre um quadro: manda o desenho inteiro e avisa quem já está lá.
 *
 * Sem `MANAGE_NOTES` o quadro abre **em leitura**, como a nota: quem não
 * desenha ainda precisa ver o que foi desenhado.
 */
async function abrirQuadro(conn: gw.Connection, boardId: string): Promise<void> {
  const quadro = await quadros.abrirQuadro(boardId, conn.userId);
  conn.quadros.add(boardId);

  gw.send(conn, {
    op: 'BOARD_STATE',
    d: {
      boardId,
      update: Buffer.from(quadros.estadoDoQuadro(quadro)).toString('base64'),
      podeEditar: can(conn.permissions, Perm.MANAGE_NOTES),
      elementos: quadros.contarElementos(quadro),
    },
  });

  avisarPresencaDoQuadro(boardId);
}

async function fecharQuadro(conn: gw.Connection, boardId: string): Promise<void> {
  conn.quadros.delete(boardId);
  // O serviço só solta o quadro da memória quando ninguém mais o tem aberto —
  // e aí grava na hora, sem esperar o debounce.
  if (!gw.comQuadroAberto(boardId).some((c) => c.userId === conn.userId)) {
    await quadros.fecharQuadro(boardId, conn.userId);
  }
  // Sem ninguém dentro, a contagem lembrada não vale mais: o quadro sai da
  // memória e volta do banco na próxima abertura.
  if (gw.comQuadroAberto(boardId).length === 0) contagens.delete(boardId);
  avisarPresencaDoQuadro(boardId);
}

/**
 * Quantos elementos o quadro tem, quando o número muda.
 *
 * A contagem sai do servidor e não de cada navegador: os dois enxergam o
 * quadro com atrasos diferentes, e dois desenhando ao mesmo tempo chegariam a
 * dois números para o mesmo limite. Só sai quando muda — um traço arrastado são
 * dezenas de deltas com a mesma contagem, e mandar todos seria dobrar o tráfego
 * do desenho para dizer a mesma coisa.
 */
const contagens = new Map<string, number>();

function anunciarContagem(boardId: string, elementos: number): void {
  if (contagens.get(boardId) === elementos) return;
  contagens.set(boardId, elementos);
  for (const outra of gw.comQuadroAberto(boardId)) {
    gw.send(outra, { op: 'BOARD_COUNT', d: { boardId, elementos } });
  }
}

function avisarPresencaDoQuadro(boardId: string): void {
  const abertos = gw.comQuadroAberto(boardId);
  const userIds = [...new Set(abertos.map((c) => c.userId))];
  for (const outra of abertos) {
    gw.send(outra, { op: 'BOARD_PRESENCE', d: { boardId, userIds } });
  }
}

/**
 * Abre o painel de notas: manda o documento inteiro e avisa quem já está lá.
 *
 * Sem `MANAGE_NOTES` a nota abre **em leitura** — o painel existe para todo
 * mundo, porque uma decisão registrada que só alguns podem ler não é registro.
 */
async function abrirPainelDeNotas(conn: gw.Connection, channelId: string): Promise<void> {
  const nota = await notas.abrirNota(channelId, conn.userId);
  conn.notas.add(channelId);

  gw.send(conn, {
    op: 'NOTE_STATE',
    d: {
      channelId,
      update: Buffer.from(notas.estadoDaNota(nota)).toString('base64'),
      podeEditar: can(conn.permissions, Perm.MANAGE_NOTES),
    },
  });

  avisarPresencaDaNota(channelId);
}

async function fecharPainelDeNotas(conn: gw.Connection, channelId: string): Promise<void> {
  conn.notas.delete(channelId);
  // O serviço só solta a nota da memória quando ninguém mais a tem aberta —
  // e aí grava na hora, sem esperar o debounce.
  if (!gw.comNotaAberta(channelId).some((c) => c.userId === conn.userId)) {
    await notas.fecharNota(channelId, conn.userId);
  }
  avisarPresencaDaNota(channelId);
}

/* O serviço avisa por aqui quando algo mudou a nota fora do WebSocket — hoje,
   "adicionar às notas" a partir de uma mensagem. */
notas.definirAviso((channelId, delta) => {
  for (const conexao of gw.comNotaAberta(channelId)) {
    gw.send(conexao, {
      op: 'NOTE_UPDATE',
      d: { channelId, update: Buffer.from(delta).toString('base64'), de: 'servidor' },
    });
  }
});

function avisarPresencaDaNota(channelId: string): void {
  const abertas = gw.comNotaAberta(channelId);
  const userIds = [...new Set(abertas.map((c) => c.userId))];
  for (const outra of abertas) {
    gw.send(outra, { op: 'NOTE_PRESENCE', d: { channelId, userIds } });
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

  /*
   * O alvo, e quem tem direito a ele.
   *
   * Em conversa privada a checagem é **ser membro**, e `ADMINISTRATOR` não
   * passa: é a única exceção ao bitfield no produto inteiro, e é deliberada.
   * Ver design/10-conversas-privadas.md.
   */
  if (d.conversationId) {
    if (!(await conversationsDb.ehMembro(d.conversationId, conn.userId))) {
      gw.send(conn, {
        op: 'ERROR',
        d: { code: 'NOT_A_MEMBER', message: 'esta conversa não é sua' },
      });
      return;
    }
  } else {
    const canal = await channelsDb.findChannelById(d.channelId ?? '');
    if (!canal || canal.archived_at) {
      gw.send(conn, {
        op: 'ERROR',
        d: { code: 'CHANNEL_NOT_FOUND', message: 'este canal não existe' },
      });
      return;
    }
  }

  const { row, novo } = await messagesDb.createMessage({
    channelId: d.channelId ?? null,
    conversationId: d.conversationId ?? null,
    authorId: conn.userId,
    content: d.content,
    clientNonce: d.clientNonce,
    replyToId: d.replyToId ?? null,
    parentId: d.parentId ?? null,
  });

  // Reenvio por rede instável cai aqui: a linha já existia, então confirmamos
  // para quem mandou e não repetimos o broadcast — com os anexos que ela já
  // tem, porque foi a primeira tentativa que os costurou.
  if (!novo) {
    const jaAnexados = await attachmentsDb.listarDeMensagens([row.id]);
    gw.send(conn, {
      op: 'MESSAGE_CREATE',
      d: toApiMessage(row, {
        meuId: conn.userId,
        attachments: jaAnexados.map(toApiAttachment),
      }),
    });
    app.log.debug({ nonce: d.clientNonce }, 'nonce repetido, sem duplicar');
    return;
  }

  // Os anexos já estão no disco desde que a pessoa os arrastou; aqui eles só
  // ganham dono. O `costurar` devolve **o que casou** — anexo de outra pessoa,
  // de outro canal ou já usado em outra mensagem fica de fora em silêncio, e a
  // mensagem sai assim mesmo: ela vale mais que o anexo, e já está no banco.
  // O anexo casa pelo alvo em que foi enviado: canal com canal, conversa com
  // conversa. É o que impede reaproveitar um arquivo pendente de outro lugar
  // — e é a mesma regra dos dois lados, sem exceção para o privado.
  const anexos = await attachmentsDb.costurar(row.id, d.attachmentIds ?? [], conn.userId, {
    channelId: d.channelId ?? null,
    conversationId: d.conversationId ?? null,
  });
  if (anexos.length < (d.attachmentIds?.length ?? 0)) {
    app.log.warn(
      { pedidos: d.attachmentIds?.length ?? 0, costurados: anexos.length },
      'anexo recusado na costura',
    );
  }
  const paraApi = anexos.map(toApiAttachment);

  // Menções contam para o badge de quem foi citado, nunca para quem escreveu.
  const alvo = { channelId: d.channelId ?? null, conversationId: d.conversationId ?? null };
  const mencionados = await messagesDb.resolveMentions(d.content);
  if (mencionados.length > 0) {
    await messagesDb.somarMencoes(alvo, mencionados, conn.userId);
  }

  /* Em conversa privada, **toda** mensagem conta como menção para quem
     recebe: alguém falou diretamente com você. É a exceção da tabela de
     notificações, e ela mora aqui porque o contador é do servidor. */
  if (d.conversationId) {
    const outros = (await conversationsDb.membros(d.conversationId))
      .filter((m) => !m.left_at && m.user_id !== conn.userId)
      .map((m) => m.user_id);
    await messagesDb.somarMencoes(alvo, outros, conn.userId);
    // A conversa escondida volta para a lista de quem a escondeu.
    await conversationsDb.revelar(d.conversationId);
  }

  mensagensCriadas.inc();

  // O broadcast inclui o autor: é assim que ele casa pelo `clientNonce` e
  // substitui a mensagem otimista pela real.
  for (const outra of [...gw.sessionsOf(conn.userId)]) {
    gw.send(outra, {
      op: 'MESSAGE_CREATE',
      d: toApiMessage(row, { meuId: outra.userId, attachments: paraApi }),
    });
  }
  /* Em canal, todo mundo; em conversa, só os membros. Este `for` é o lugar
     onde o privado deixa de ser público — mandar para `gw.online()` numa
     conversa entregaria a mensagem às cinco pessoas. */
  const destinos = d.conversationId
    ? (await conversationsDb.membros(d.conversationId))
        .filter((m) => !m.left_at)
        .map((m) => m.user_id)
    : gw.online();

  for (const c of destinos) {
    if (c === conn.userId) continue;
    gw.sendToUser(c, {
      op: 'MESSAGE_CREATE',
      // Sem o nonce para os outros: ele só serve a quem enviou.
      d: { ...toApiMessage(row, { meuId: c, attachments: paraApi }), clientNonce: undefined },
    });
  }
}

export { gw as gateway };
