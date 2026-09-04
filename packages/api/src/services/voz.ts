import { createHmac } from 'node:crypto';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { Perm, can } from '@trindade/shared';
import { config } from '../config.js';

/**
 * Voz: token do LiveKit e credencial do relay.
 *
 * O requisito central desta fase é de privacidade, não de mídia: **nenhum
 * participante pode descobrir o endereço de rede de outro.** Tudo aqui é
 * consequência disso — o SFU no meio para não haver conexão direta, e o TURN
 * para quem está atrás de CGNAT chegar ao SFU.
 */

/** Seis horas. Uma reunião longa não pode cair no meio por token vencido. */
const VALIDADE_SEGUNDOS = 6 * 3600;

export function vozConfigurada(): boolean {
  return Boolean(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET);
}

/** O nome da sala. Um canal, uma sala — e o token vale para uma só. */
export function salaDoCanal(channelId: string): string {
  return `channel:${channelId}`;
}

/**
 * A sala de uma conversa privada.
 *
 * Prefixo diferente de propósito: os dois espaços de nome não se cruzam, e um
 * id de canal nunca abre a sala de uma conversa nem o contrário — mesmo que
 * alguém montasse o nome à mão. Ver design/10-conversas-privadas.md.
 */
export function salaDaConversa(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * Credencial efêmera do coturn.
 *
 * O usuário é `{expiração}:{userId}` e a senha é o HMAC-SHA1 disso com o
 * segredo estático. O coturn valida sozinho, sem consultar banco nenhum, e a
 * credencial morre na hora marcada.
 *
 * **Nunca senha fixa.** Uma senha fixa no código vaza no primeiro dump de
 * `chrome://webrtc-internals` que alguém colar num chamado de suporte, e daí
 * em diante o relay é de quem a leu.
 */
export function credenciaisTurn(userId: string): IceServer[] {
  if (!config.TURN_URL || !config.TURN_STATIC_SECRET) return [];

  const expiracao = Math.floor(Date.now() / 1000) + VALIDADE_SEGUNDOS;
  const username = `${expiracao}:${userId}`;
  const credential = createHmac('sha1', config.TURN_STATIC_SECRET)
    .update(username)
    .digest('base64');

  // UDP para o caminho normal e TLS na 5349 para rede corporativa que bloqueia
  // UDP. Quem só tem a segunda ainda entra, mais lento.
  const urls = [config.TURN_URL];
  if (config.TURN_TLS_URL) urls.push(config.TURN_TLS_URL);

  return [{ urls, username, credential }];
}

/** Cinco minutos vazia e a sala morre — o mesmo `empty_timeout` do livekit.yaml. */
const VAZIA_POR_SEGUNDOS = 300;
const MAXIMO_DE_PESSOAS = 8;

let servico: RoomServiceClient | null = null;

function clienteDoServico(): RoomServiceClient {
  // A URL do SDK é HTTP; a que o navegador usa é WebSocket. É a mesma máquina.
  const http = (config.LIVEKIT_URL as string).replace(/^ws/, 'http');
  servico ??= new RoomServiceClient(
    http,
    config.LIVEKIT_API_KEY as string,
    config.LIVEKIT_API_SECRET as string,
  );
  return servico;
}

/**
 * Cria a sala antes de emitir o token.
 *
 * É a contrapartida de `auto_create: false` no livekit.yaml: com a criação
 * automática ligada, qualquer token válido faria nascer salas arbitrárias, e o
 * escopo por canal — que é a garantia inteira do token — não significaria
 * nada. Desligada, **quem decide que uma sala existe é o servidor**, aqui,
 * depois de checar a permissão e o canal.
 *
 * `createRoom` é idempotente: a sala que já existe volta como está, sem
 * derrubar quem estiver dentro.
 */
export async function garantirSala(channelId: string): Promise<void> {
  await criarSala(salaDoCanal(channelId));
}

export async function garantirSalaDaConversa(conversationId: string): Promise<void> {
  await criarSala(salaDaConversa(conversationId));
}

/**
 * A sala nasce no servidor, nunca no cliente.
 *
 * `auto_create` está desligado no SFU justamente para que criar uma sala seja
 * decisão de quem já conferiu a permissão — e é a contrapartida disso.
 */
async function criarSala(nome: string): Promise<void> {
  await clienteDoServico().createRoom({
    name: nome,
    emptyTimeout: VAZIA_POR_SEGUNDOS,
    maxParticipants: MAXIMO_DE_PESSOAS,
  });
}

/**
 * O token do LiveKit, com escopo de uma sala.
 *
 * `canPublishSources` só inclui a tela com `SHARE_SCREEN`: esconder o botão na
 * interface não é controle de acesso, e aqui é o servidor recusando de
 * verdade — quem não tem a permissão não consegue publicar a trilha nem
 * mandando o comando à mão.
 */
export async function tokenDeVoz(entrada: {
  userId: string;
  displayName: string;
  /** Uma das duas: o token vale para uma sala só, seja de canal ou de conversa. */
  channelId?: string;
  conversationId?: string;
  permissions: bigint;
}): Promise<string> {
  const at = new AccessToken(config.LIVEKIT_API_KEY as string, config.LIVEKIT_API_SECRET as string, {
    identity: entrada.userId,
    name: entrada.displayName,
    ttl: VALIDADE_SEGUNDOS,
  });

  at.addGrant({
    room: entrada.conversationId
      ? salaDaConversa(entrada.conversationId)
      : salaDoCanal(entrada.channelId as string),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // O documento do projeto escreve estas fontes como texto; no SDK 2.18 o
    // tipo é o enum numérico do protocolo, e é ele que o `addGrant` aceita. O
    // JWT sai com os nomes em texto de qualquer forma — o SDK converte —, e é
    // assim que o teste os lê.
    canPublishSources: can(entrada.permissions, Perm.SHARE_SCREEN)
      ? [
          TrackSource.CAMERA,
          TrackSource.MICROPHONE,
          TrackSource.SCREEN_SHARE,
          TrackSource.SCREEN_SHARE_AUDIO,
        ]
      : [TrackSource.CAMERA, TrackSource.MICROPHONE],
  });

  return at.toJwt();
}
