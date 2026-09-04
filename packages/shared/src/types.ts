// Fonte da verdade dos tipos dos dois lados. Ver docs/05-contrato-api.md.
// Datas são sempre ISO 8601 em UTC; a formatação para o fuso local acontece só
// na renderização.

export type UserStatus = 'online' | 'idle' | 'busy' | 'invisible' | 'offline';

export interface Role {
  id: string;
  name: string;
  color: string | null;
  position: number;
  /** bigint serializado — não sobrevive ao JSON como número */
  permissions: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  accentColor: string | null;
  status: UserStatus;
  customStatus: string | null;
  roles: Role[];
  disabled: boolean;
}

export type MessageAuthor = Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  url: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

export interface Message {
  id: string;
  channelId: string;
  author: MessageAuthor;
  content: string | null;
  parentId: string | null;
  replyToId: string | null;
  attachments: Attachment[];
  reactions: Reaction[];
  pinnedAt: string | null;
  /**
   * Se **você** guardou esta mensagem. Como o `me` das reações, sai sempre do
   * ponto de vista de quem pediu — e, ao contrário do `count` das reações,
   * nunca existe um número: quem mais guardou não é da conta de ninguém.
   */
  saved: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  clientNonce?: string;
}

export type ChannelKind = 'text' | 'voice';

export interface Channel {
  id: string;
  slug: string;
  name: string;
  topic: string | null;
  kind: ChannelKind;
  position: number;
  category: string | null;
  archivedAt: string | null;
  createdAt: string;
}

/** Forma única de erro da API. Ver docs/05-contrato-api.md. */
export interface ApiError {
  error: string;
  code: string;
  field?: string;
}

export interface HealthResponse {
  ok: boolean;
  db: boolean;
}
