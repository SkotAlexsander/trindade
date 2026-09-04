import { z } from 'zod';
import type { Channel, Message, Reaction, User, UserStatus } from './types.js';
import { messageContentSchema, userStatusSchema } from './schemas.js';

/**
 * Eventos do WebSocket. Fonte da verdade dos dois lados — ver
 * docs/05-contrato-api.md, seção WebSocket.
 *
 * Toda mensagem tem a forma `{ op, d }`.
 */

// --- cliente → servidor ----------------------------------------------------

export const clientEventSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('MESSAGE_CREATE'),
    d: z.object({
      channelId: z.string().uuid(),
      content: messageContentSchema,
      // UUID gerado no cliente. É o que evita duplicata quando a rede oscila:
      // o índice único (author_id, client_nonce) é a barreira final.
      clientNonce: z.string().uuid(),
      replyToId: z.string().uuid().nullish(),
      parentId: z.string().uuid().nullish(),
      attachmentIds: z.array(z.string().uuid()).max(10).optional(),
    }),
  }),
  z.object({ op: z.literal('TYPING_START'), d: z.object({ channelId: z.string().uuid() }) }),
  z.object({
    op: z.literal('PRESENCE_UPDATE'),
    d: z.object({
      status: userStatusSchema,
      customStatus: z.string().max(64).nullish(),
    }),
  }),
  z.object({
    op: z.literal('SUBSCRIBE'),
    d: z.object({ channelIds: z.array(z.string().uuid()).max(50) }),
  }),
  z.object({ op: z.literal('HEARTBEAT'), d: z.object({}).passthrough().optional() }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

// --- servidor → cliente ----------------------------------------------------

export interface ReadStateEntry {
  channelId: string;
  lastReadMessageId: string | null;
  /**
   * Quantas mensagens de outras pessoas há depois da última lida.
   *
   * Contado no servidor porque só ele conhece o histórico inteiro: o cliente
   * carrega cinquenta linhas e não teria como saber que há trezentas atrás.
   * Depois disso, quem soma é o cliente, a cada evento que chega.
   */
  unreadCount: number;
  mentionCount: number;
  mutedUntil: string | null;
}

export interface VoiceState {
  userId: string;
  channelId: string;
  muted: boolean;
  deafened: boolean;
  screenSharing: boolean;
}

export interface ReadyPayload {
  user: User;
  users: User[];
  channels: Channel[];
  readState: ReadStateEntry[];
  voiceStates: VoiceState[];
  /** Verdadeiro só no primeiro READY da sessão — a sequência do elenco. */
  first: boolean;
}

export type ServerEvent =
  | { op: 'READY'; d: ReadyPayload }
  | { op: 'MESSAGE_CREATE'; d: Message }
  | { op: 'MESSAGE_UPDATE'; d: Message }
  | { op: 'MESSAGE_DELETE'; d: { id: string; channelId: string } }
  | { op: 'REACTION_ADD'; d: { messageId: string; channelId: string; userId: string; emoji: string } }
  | {
      op: 'REACTION_REMOVE';
      d: { messageId: string; channelId: string; userId: string; emoji: string };
    }
  | { op: 'TYPING_START'; d: { channelId: string; userId: string } }
  | { op: 'PRESENCE_UPDATE'; d: { userId: string; status: UserStatus; customStatus: string | null } }
  | { op: 'USER_UPDATE'; d: User }
  | { op: 'VOICE_STATE_UPDATE'; d: VoiceState }
  | { op: 'CHANNEL_CREATE'; d: Channel }
  | { op: 'CHANNEL_UPDATE'; d: Channel }
  | { op: 'CHANNEL_DELETE'; d: { id: string } }
  | { op: 'PERMISSIONS_UPDATE'; d: { permissions: string } }
  /** Outra aba sua marcou um canal como lido. Só vai para você. */
  | { op: 'READ_STATE_UPDATE'; d: ReadStateEntry }
  | { op: 'ERROR'; d: { code: string; message: string; retryAfter?: number } };

export type ServerEventName = ServerEvent['op'];

/** Códigos de fechamento próprios. Ver docs/06-realtime-e-webrtc.md. */
export const CLOSE = {
  ACCOUNT_DISABLED: 4001,
  UNAUTHENTICATED: 4002,
  RATE_LIMITED: 4003,
  INVALID_PAYLOAD: 4004,
  HEARTBEAT_TIMEOUT: 4005,
} as const;

/** Cliente manda a cada 30s; o servidor fecha aos 90s sem notícia. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 90_000;

/** Quem recebe um TYPING_START limpa sozinho depois disso. */
export const TYPING_TTL_MS = 8_000;
/** Quem envia faz throttle: digitar um parágrafo não gera cinquenta eventos. */
export const TYPING_THROTTLE_MS = 4_000;

/** As cinco condições de agrupamento de design/04-mensagens.md. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface AgrupavelBase {
  author: { id: string };
  createdAt: string;
  replyToId: string | null;
  parentId: string | null;
}

/**
 * Duas mensagens formam bloco quando **todas** as condições valem: mesmo
 * autor, menos de 5 minutos, mesmo dia, nenhuma é resposta, nenhuma está numa
 * thread. Fica aqui, e não no componente, para o servidor poder usar a mesma
 * regra se um dia precisar.
 */
export function mesmaSequencia(
  anterior: AgrupavelBase | undefined,
  atual: AgrupavelBase,
): boolean {
  if (!anterior) return false;
  if (anterior.author.id !== atual.author.id) return false;
  if (anterior.replyToId || atual.replyToId) return false;
  if (anterior.parentId || atual.parentId) return false;

  const antes = new Date(anterior.createdAt);
  const agora = new Date(atual.createdAt);
  if (agora.getTime() - antes.getTime() >= GROUP_WINDOW_MS) return false;
  return antes.toDateString() === agora.toDateString();
}

/** Agrega as reações cruas do banco no formato do contrato. */
export function agregarReacoes(
  linhas: readonly { emoji: string; userId: string }[],
  meuId: string,
): Reaction[] {
  const mapa = new Map<string, { count: number; me: boolean }>();
  for (const linha of linhas) {
    const atual = mapa.get(linha.emoji) ?? { count: 0, me: false };
    atual.count += 1;
    if (linha.userId === meuId) atual.me = true;
    mapa.set(linha.emoji, atual);
  }
  return [...mapa.entries()].map(([emoji, v]) => ({ emoji, count: v.count, me: v.me }));
}
