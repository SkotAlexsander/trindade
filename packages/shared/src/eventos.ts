import { z } from 'zod';
import type { Channel, Message, Poll, Reaction, Task, User, UserStatus } from './types.js';
import { ANEXOS_POR_MENSAGEM, messageBodySchema, userStatusSchema } from './schemas.js';

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
    d: z
      .object({
        channelId: z.string().uuid(),
        content: messageBodySchema,
        // UUID gerado no cliente. É o que evita duplicata quando a rede oscila:
        // o índice único (author_id, client_nonce) é a barreira final.
        clientNonce: z.string().uuid(),
        replyToId: z.string().uuid().nullish(),
        parentId: z.string().uuid().nullish(),
        attachmentIds: z.array(z.string().uuid()).max(ANEXOS_POR_MENSAGEM).optional(),
      })
      // Uma foto sem legenda é uma mensagem; um `Enter` num campo vazio não é.
      // A regra é "sobrou alguma coisa", não "tem texto".
      .refine((d) => d.content.trim().length > 0 || (d.attachmentIds?.length ?? 0) > 0, {
        message: 'mensagem vazia',
        path: ['content'],
      }),
  }),
  z.object({ op: z.literal('TYPING_START'), d: z.object({ channelId: z.string().uuid() }) }),
  /**
   * Microfone e surdez.
   *
   * Vêm do cliente porque são decisão dele: o LiveKit sabe se a trilha está
   * publicada, não se a pessoa escolheu se calar. O servidor guarda e repassa;
   * quem entra depois recebe o estado no READY.
   */
  z.object({
    op: z.literal('VOICE_STATE'),
    d: z.object({
      channelId: z.string().uuid(),
      muted: z.boolean(),
      deafened: z.boolean(),
    }),
  }),
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
  /**
   * Notas colaborativas.
   *
   * O delta do Yjs viaja em base64 dentro do mesmo WebSocket de tudo o mais —
   * uma segunda conexão só para notas seria outro caminho para autenticar,
   * reconectar e depurar. `NOTE_OPEN` assina o canal e recebe o estado
   * inteiro; `NOTE_UPDATE` leva as alterações; `NOTE_AWARENESS` leva cursor e
   * seleção, que são efêmeros e não passam pelo banco.
   */
  z.object({ op: z.literal('NOTE_OPEN'), d: z.object({ channelId: z.string().uuid() }) }),
  z.object({ op: z.literal('NOTE_CLOSE'), d: z.object({ channelId: z.string().uuid() }) }),
  z.object({
    op: z.literal('NOTE_UPDATE'),
    d: z.object({
      channelId: z.string().uuid(),
      // 256 KB em base64: um delta de digitação tem dezenas de bytes, e o
      // estado inteiro de uma nota longa não passa disto. O teto existe para
      // um cliente defeituoso não empurrar um megabyte a cada tecla.
      update: z.string().max(262_144),
    }),
  }),
  z.object({
    op: z.literal('NOTE_AWARENESS'),
    d: z.object({ channelId: z.string().uuid(), estado: z.string().max(8_192) }),
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
  /**
   * Sair é um `VOICE_STATE_UPDATE` com `connected: false`, e não um evento
   * próprio: quem recebe já tem o `channelId` para saber de qual grade tirar o
   * avatar, e um segundo op só para isso seria mais uma coisa a manter em dia.
   */
  connected: boolean;
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
  /** O documento inteiro, ao abrir o painel. Só vai para quem pediu. */
  | { op: 'NOTE_STATE'; d: { channelId: string; update: string; podeEditar: boolean } }
  | { op: 'NOTE_UPDATE'; d: { channelId: string; update: string; de: string } }
  | { op: 'NOTE_AWARENESS'; d: { channelId: string; estado: string; de: string } }
  /** Quem está com a nota aberta. A faixa "fulano e beltrano editando". */
  | { op: 'NOTE_PRESENCE'; d: { channelId: string; userIds: string[] } }
  /**
   * Uma tarefa nasceu, mudou de coluna, de dono ou de prazo.
   *
   * Um evento só para as três coisas: o cartão é pequeno e o quadro é do canal
   * inteiro, então redesenhar a tarefa toda custa menos que manter três eventos
   * em dia. `removida` cobre o apagar sem um segundo op.
   */
  | { op: 'TASK_UPDATE'; d: { task: Task; removida?: boolean } }
  /**
   * A enquete mudou: alguém votou, ou ela fechou.
   *
   * Vai **um payload por pessoa**, e não um broadcast só: `myVotes` é do lado
   * de quem recebe, e numa enquete aberta `voters` também depende de quem
   * pergunta. Montar uma vez e mandar para todos entregaria a cada um o voto
   * de outra pessoa como se fosse o seu.
   */
  | { op: 'POLL_UPDATE'; d: { poll: Poll } }
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
  /** Ausente conta como `'text'`: quem não sabe do campo agrupa como antes. */
  kind?: string;
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
  // A linha de sistema não entra em bloco de nenhum dos dois lados: ela é do
  // canal, não de quem a disparou, e herdar o avatar de alguém a faria parecer
  // uma frase que a pessoa escreveu.
  if ((anterior.kind ?? 'text') !== 'text' || (atual.kind ?? 'text') !== 'text') return false;
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
