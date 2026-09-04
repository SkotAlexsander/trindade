# Contrato da API

Base: `/api`. Tudo JSON. Toda entrada validada com Zod definido em
`packages/shared` e importado pelos dois lados.

Erro tem sempre a mesma forma:

```json
{ "error": "mensagem legível", "code": "SNAKE_CASE", "field": "opcional" }
```

Códigos HTTP: 400 entrada inválida, 401 sem autenticação, 403 sem permissão,
404 não existe, 409 conflito, 413 grande demais, 429 rate limit, 500 falha nossa.

---

## Autenticação

### `POST /auth/register`

Público, mas exige convite válido.

```json
{ "code": "ABCD1234EFGH", "username": "ana", "displayName": "Ana", "password": "..." }
```

→ `201 { "user": User }`. Não faz login automático; o cliente redireciona para
`/entrar`. Isso força a pessoa a exercitar a senha que acabou de criar.

Erros: `INVITE_INVALID`, `INVITE_EXPIRED`, `INVITE_USED`, `USERNAME_TAKEN`,
`PASSWORD_TOO_SHORT`, `PASSWORD_BREACHED`.

### `POST /auth/login`

```json
{ "username": "ana", "password": "..." }
```

→ `200 { "access": "jwt", "user": User }` e o cookie `rt`.

Se a conta tem 2FA:
→ `200 { "mfaRequired": true, "mfaToken": "jwt curto de 5 min" }`

Erros: `INVALID_CREDENTIALS` (nunca diga qual dos dois estava errado),
`ACCOUNT_DISABLED`, `RATE_LIMITED`.

### `POST /auth/totp`

```json
{ "mfaToken": "...", "code": "123456" }
```

Aceita também código de recuperação em `recoveryCode`.
→ `200 { "access": "jwt", "user": User }` e o cookie.

### `POST /auth/refresh`

Sem corpo. Lê o cookie `rt`.
→ `200 { "access": "jwt" }` e um cookie novo.
→ `401 TOKEN_REUSE` revoga a família inteira.

### `POST /auth/logout`

Revoga a família do token atual. → `204`.

### `POST /auth/logout-all`

Revoga todas as sessões do usuário. → `204`.

---

## Perfil

### `GET /me`
→ `200 { user: User, permissions: "63", roles: Role[] }`

`permissions` vai como **string**, não número — `bigint` não sobrevive ao JSON.

### `PATCH /me`

```json
{ "displayName": "Ana Silva", "bio": "...", "accentColor": "#4c8df6", "status": "busy", "customStatus": "em foco" }
```

Todos opcionais. → `200 { user: User }` e broadcast `USER_UPDATE`.

### `POST /me/avatar`

`multipart/form-data`, campo `file`. Máx. 8 MB.
→ `200 { avatarKey, avatarUrl }` e broadcast `USER_UPDATE`.
Apaga o avatar anterior do storage.

Erros: `UNSUPPORTED_MEDIA_TYPE`, `FILE_TOO_LARGE`, `INVALID_IMAGE`.

### `DELETE /me/avatar` → `204`

### `POST /me/password`

```json
{ "current": "...", "next": "..." }
```
→ `204`. Revoga todas as outras sessões, mantém a atual.

### 2FA

- `POST /me/totp/setup` → `200 { secret, otpauthUrl, qrSvg }` — não ativa ainda
- `POST /me/totp/enable` `{ code }` → `200 { recoveryCodes: string[] }` — mostrados uma vez
- `POST /me/totp/disable` `{ password, code }` → `204`

### `GET /me/sessions`
→ `200 { sessions: [{ id, userAgent, createdAt, current }] }`. Sem IP, de propósito.

### `DELETE /me/sessions/:id` → `204`

---

## Pessoas e cargos

### `GET /users`
→ `200 { users: User[] }` — os cinco, sempre completo, sem paginação.

### `GET /users/:id` → `200 { user: User, roles: Role[] }`

### `PATCH /users/:id/roles` — exige `MANAGE_ROLES`

```json
{ "roleIds": ["uuid", "uuid"] }
```

Substitui o conjunto inteiro. Rejeita com `HIERARCHY_VIOLATION` se algum cargo
tiver `position` maior ou igual ao maior cargo de quem chama.

### `POST /users/:id/disable` — exige `MANAGE_MEMBERS`
Mesma checagem de hierarquia. Fecha as conexões WebSocket da pessoa. → `204`

### `POST /users/:id/enable` → `204`

### Cargos — todos exigem `MANAGE_ROLES`

- `GET /roles` → `200 { roles: Role[] }`
- `POST /roles` `{ name, color, permissions, position }` → `201`
- `PATCH /roles/:id` → `200`
- `DELETE /roles/:id` → `204` (rejeita se `is_default`)

`permissions` sempre string no JSON.

---

## Convites

### `POST /invites` — exige `CREATE_INVITE`

```json
{ "note": "para o Bruno", "expiresInHours": 168 }
```
→ `201 { code, url, expiresAt }`

### `GET /invites` → `200 { invites: Invite[] }`
### `DELETE /invites/:code` → `204`
### `GET /invites/:code/preview` — público

→ `200 { valid: true, serverName: "Trindade", invitedBy: "Ana" }`

Nunca revele quantas pessoas existem nem quem são. Se inválido, devolva
`{ valid: false }` com 200, não 404 — dificulta enumerar códigos.

---

## Canais

- `GET /channels` → `200 { channels: Channel[] }`
- `POST /channels` `{ name, slug, kind, topic, category }` — `MANAGE_CHANNEL`
- `PATCH /channels/:id` — `MANAGE_CHANNEL`
- `POST /channels/:id/archive` / `unarchive` — `MANAGE_CHANNEL`
- `PATCH /channels/reorder` `{ order: [{ id, position, category }] }`

---

## Mensagens

O envio é por WebSocket. O HTTP cobre histórico e operações pontuais.

### `GET /channels/:id/messages`

Query: `before` (uuid), `after` (uuid), `around` (uuid), `limit` (máx 100, padrão 50).

→ `200 { messages: Message[], hasMore: boolean }` — ordem cronológica crescente.

`around` serve para pular para uma mensagem vinda da busca: devolve metade antes
e metade depois.

Mensagem apagada vem com `content: null` e `deletedAt` preenchido — a UI mostra
o espaço reservado sem perder a numeração.

### `GET /channels/:id/messages/search`

Query: `q`, `from` (userId), `has` (`file` | `link` | `image`), `before`, `after`.

→ `200 { results: Message[], total: number }`

Usa `search_vector @@ websearch_to_tsquery('portuguese', q)`, ordenado por
`ts_rank_cd`. `websearch_to_tsquery` aceita aspas e `-termo` sem quebrar.

### `PATCH /messages/:id` `{ content }`
Só o autor. Marca `edited_at`. → `200` e broadcast `MESSAGE_UPDATE`.

### `DELETE /messages/:id`
Autor com `DELETE_OWN_MESSAGE`, ou qualquer um com `DELETE_ANY_MESSAGE`.
Soft delete. → `204` e broadcast `MESSAGE_DELETE`.

### `PUT /messages/:id/pin` / `DELETE` — exige `PIN_MESSAGE`
### `GET /channels/:id/pins` → `200 { messages: Message[] }`
### `PUT /messages/:id/reactions/:emoji` / `DELETE`
Emoji vai percent-encoded na URL.

### `GET /messages/:id/thread`
→ `200 { parent: Message, replies: Message[] }`

### `POST /channels/:id/attachments`

`multipart/form-data`. Sobe o arquivo antes de enviar a mensagem.
→ `201 { attachments: Attachment[] }`. Os ids vão no `MESSAGE_CREATE`.

Anexo órfão por mais de 1 hora é apagado por tarefa periódica.

---

## Leitura

### `PUT /channels/:id/read` `{ messageId }` → `204`
### `GET /read-state` → `200 { states: ReadState[] }`
### `PUT /channels/:id/mute` `{ until }` / `DELETE` → `204`

---

## Notas e tarefas

- `GET /channels/:id/notes` → `200 { content, updatedBy, updatedAt }`
- `PUT /channels/:id/notes` `{ content }` — `MANAGE_NOTES`
- `GET /channels/:id/tasks` → `200 { tasks: Task[] }`
- `POST /channels/:id/tasks` `{ title, body, columnKey, assigneeId, dueAt, sourceMessageId }`
- `PATCH /tasks/:id` — mover é `{ columnKey, position }`
- `DELETE /tasks/:id`

---

## Voz

### `POST /channels/:id/voice/token` — exige `CONNECT_VOICE`

→ `200 { token, wsUrl, iceServers: [{ urls, username, credential }] }`

O token do LiveKit tem escopo restrito à sala daquele canal, validade de 6h.
As credenciais TURN são efêmeras (HMAC com expiração).

### `POST /livekit/webhook`

Recebe eventos do LiveKit, valida a assinatura, converte em `VOICE_STATE_UPDATE`
no WebSocket. Não é rota pública — restrinja por IP e valide o header.

---

## WebSocket

`wss://host/ws?token={accessToken}`

Toda mensagem: `{ "op": "NOME", "d": { ... } }`

### Servidor → cliente

| op | quando | payload |
|---|---|---|
| `READY` | logo após conectar | `{ user, users, channels, readState, voiceStates }` |
| `MESSAGE_CREATE` | mensagem nova | `Message & { clientNonce? }` |
| `MESSAGE_UPDATE` | edição | `Message` |
| `MESSAGE_DELETE` | exclusão | `{ id, channelId }` |
| `REACTION_ADD` / `REACTION_REMOVE` | reação | `{ messageId, userId, emoji }` |
| `TYPING_START` | alguém digitando | `{ channelId, userId }` |
| `PRESENCE_UPDATE` | status mudou | `{ userId, status, customStatus }` |
| `USER_UPDATE` | perfil ou cargo | `User` |
| `VOICE_STATE_UPDATE` | entrou/saiu/mutou | `{ userId, channelId, muted, deafened, screenSharing }` |
| `CHANNEL_CREATE` / `UPDATE` / `DELETE` | canal | `Channel` |
| `TASK_UPDATE` | tarefa | `Task` |
| `PERMISSIONS_UPDATE` | cargo mudou | `{ permissions: string }` |
| `ERROR` | operação falhou | `{ code, message }` |

### Cliente → servidor

| op | payload |
|---|---|
| `MESSAGE_CREATE` | `{ channelId, content, clientNonce, replyToId?, parentId?, attachmentIds? }` |
| `TYPING_START` | `{ channelId }` |
| `PRESENCE_UPDATE` | `{ status, customStatus }` |
| `SUBSCRIBE` | `{ channelIds }` |
| `HEARTBEAT` | `{}` |

### Regras

`READY` chega em até 2 segundos ou o cliente reconecta.

Heartbeat a cada 30s do cliente. O servidor fecha a conexão sem heartbeat por
90s. Não confie no ping/pong do protocolo — proxies interferem.

`TYPING_START` expira sozinho em 8 segundos no cliente. Não existe `TYPING_STOP`.

Códigos de fechamento: `4001` não autorizado ou revogado, `4002` heartbeat
perdido, `4003` rate limit, `4004` payload inválido.

O cliente reconecta em todos, menos no `4001` com `code: 'ACCOUNT_DISABLED'`.

---

## Tipos compartilhados

`packages/shared/src/types.ts` — fonte da verdade dos dois lados.

```typescript
export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  accentColor: string | null;
  status: 'online' | 'idle' | 'busy' | 'invisible' | 'offline';
  customStatus: string | null;
  roles: Role[];
  disabled: boolean;
}

export interface Role {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: string;   // bigint serializado
}

export interface Message {
  id: string;
  channelId: string;
  author: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
  content: string | null;
  parentId: string | null;
  replyToId: string | null;
  attachments: Attachment[];
  reactions: { emoji: string; count: number; me: boolean }[];
  pinnedAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  clientNonce?: string;
}
```

Datas são sempre ISO 8601 em UTC. A formatação para o fuso local acontece só na
renderização.
