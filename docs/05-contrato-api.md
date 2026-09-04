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

`multipart/form-data`, campo `file`. Máx. 8 MB, 10 por hora.
→ `200 { avatarUrl, avatarBlurhash, user }` e broadcast `USER_UPDATE`.

> A resposta devolve o `User` inteiro em vez do `avatarKey` do rascunho
> original. A chave é detalhe de armazenamento e o cliente nunca a monta em
> URL nenhuma; o `User` é o que ele precisa para atualizar o próprio estado.

Re-encodado para WebP 256×256, `fit: 'cover'`, com todo metadado descartado —
inclusive as coordenadas de GPS de uma foto de celular. O tipo é decidido pelos
**bytes**; SVG fica de fora, como nos anexos. Apaga o avatar anterior do
storage, e nessa ordem: o banco aponta para a foto nova primeiro. O pior caso
de uma falha no meio é um arquivo órfão, nunca uma linha apontando para um
arquivo que não existe.

Erros: `UNSUPPORTED_MEDIA_TYPE`, `FILE_TOO_LARGE`, `EMPTY_FILE`,
`INVALID_IMAGE`, `NO_FILE`, `STORAGE_OFF`.

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

### Cargos

- `GET /roles` → `200 { roles: Role[] }` — **qualquer pessoa autenticada**. O
  chip de cargo no cartão de perfil precisa do nome e da cor de todo mundo;
  nada aqui é segredo, o segredo seria poder mudar.

Os demais exigem `MANAGE_ROLES`:

- `POST /roles` `{ name, color?, permissions? }` → `201 { role }`
- `PATCH /roles/:id` `{ name?, color?, permissions? }` → `200 { role }`
- `PUT /roles/order` `{ roleIds }` → `200 { roles }`
- `DELETE /roles/:id` → `204` (rejeita `is_default` com `DEFAULT_ROLE`)

> `position` **não** entra no corpo do `POST`, ao contrário do rascunho
> original: o cargo nasce logo abaixo de quem o criou. Deixar o cliente
> escolher a posição daria a qualquer gestor de cargos um caminho de uma
> chamada até o topo da hierarquia.

Reordenar vai numa chamada só, com a lista **inteira** na ordem final
(`INCOMPLETE_ORDER` se faltar alguém). Mandar uma posição por vez deixaria a
lista passar por estados em que dois cargos empatam — e é a comparação de
posições que autoriza quem mexe em quem.

`permissions` sempre string no JSON. Bit fora dos que existem hoje é recusado
com `INVALID_PERMISSIONS`: gravar um bit da faixa reservada faria o cargo ganhar
sozinho a permissão que um dia ocupasse esse número.

### As três regras de hierarquia

Todas devolvem `403 HIERARCHY_VIOLATION`. Sem elas, `MANAGE_ROLES` **é**
`ADMINISTRATOR` — quem atribui cargos se atribui o de administrador no primeiro
clique.

1. Ninguém mexe em cargo de `position` **maior ou igual** ao seu maior cargo.
   "Ou igual" não é excesso: dois cargos de mesma posição poderiam se remover
   em círculo.
2. Ninguém mexe em pessoa com cargo maior ou igual ao seu — nem na própria
   conta por esta porta.
3. Ninguém dá a um cargo permissão que não tem. Sem isto, criar o cargo e
   vesti-lo em seguida contornaria as outras duas.

`ADMINISTRATOR` passa por cima da comparação de posições, e continua sendo o
único lugar do projeto onde isso acontece.

---

## Convites

### `POST /invites` — exige `CREATE_INVITE`

```json
{ "note": "para o Bruno", "expiresInHours": 168 }
```
→ `201 { code, url, expiresAt }`

### `GET /invites` → `200 { invites: Invite[] }` — exige `CREATE_INVITE`

```typescript
interface Invite {
  code: string;
  url: string;
  note: string | null;
  createdBy: string;   // nome de exibição
  usedBy: string | null;
  usedAt: string | null;
  expiresAt: string;
  createdAt: string;
}
```

Lista os que ainda valem e os já usados. Convite expirado e não usado some: ele
não é histórico de nada.

### `DELETE /invites/:code` → `204` — exige `CREATE_INVITE`

Convite já usado devolve `404 INVITE_NOT_FOUND`: ele virou uma conta, e apagar
o registro só apagaria a memória de quem convidou quem.
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

### `PUT /messages/:id/save` / `DELETE` → `204`

Guardar para você. **Sem permissão nenhuma** — guardar não muda nada para
ninguém — e **sem broadcast**: a lista é sua e não sai daqui. Idempotente nos
dois sentidos: guardar o que já está guardado devolve `204` igual.

### `GET /saved` → `200 { messages: (Message & { channel: Channel })[], hasMore }`

Atravessa canais, do mais recente guardado para o mais antigo. Aceita `limit` e
`before` (id de mensagem), como o histórico. Cada linha traz o canal de origem,
senão a lista é um monte de frases sem lugar.

Mensagem apagada não aparece: o `on delete cascade` já a tirou da tabela.

`Message` ganha `saved: boolean` — sempre do ponto de vista de quem pediu,
como o `me` das reações.
### `PUT /messages/:id/reactions/:emoji` / `DELETE`
Emoji vai percent-encoded na URL.

### `GET /messages/:id/thread`
→ `200 { parent: Message, replies: Message[] }`

### `POST /channels/:id/attachments`

`multipart/form-data`, campo `file` (aceita vários). Exige `ATTACH_FILE`. Sobe
o arquivo **antes** de enviar a mensagem — o upload começa ao anexar.
→ `201 { attachments: Attachment[] }`. Os ids vão no `MESSAGE_CREATE`.

Limites: 50 MB por arquivo, 10 por mensagem, 50 uploads por hora por pessoa, e
no máximo 30 anexos pendentes ao mesmo tempo.

O que é imagem — decidido pelos **bytes**, não pela extensão nem pelo
`Content-Type` declarado — é re-encodado para WebP e volta com `width`,
`height` e `blurhash`. Todo o resto vira `application/octet-stream`, incluindo
SVG: é um formato de imagem que também é um documento com script.

Anexo órfão por mais de 1 hora é apagado por tarefa periódica, objeto antes da
linha. Remover um anexo pendente na interface **não** chama o servidor; a
varredura recolhe.

Erros: `MISSING_PERMISSION`, `CHANNEL_NOT_FOUND`, `CHANNEL_NOT_TEXT`,
`FILE_TOO_LARGE`, `EMPTY_FILE`, `BAD_IMAGE`, `TOO_MANY_PENDING`, `NO_FILE`,
`STORAGE_OFF`.

### `GET /files/*` — sem sessão

Serve o anexo. **Não autenticada**, e isso é decisão e não esquecimento: o
access token vive só na memória do JavaScript e um `<img src>` não tem como
mandá-lo, e docs/04-seguranca.md prevê estes arquivos num domínio de CDN
separado, que por construção não enxerga sessão nenhuma. O controle de acesso
é a chave: 32 bytes aleatórios no caminho.

`X-Content-Type-Options: nosniff` sempre. Imagem re-encodada sai `inline`; todo
o resto sai `attachment`.

### `GET /link-preview?url=` → `200 { preview: LinkPreview | null }`

O servidor busca a página **no lugar de quem lê**. `preview: null` é resposta
normal e não erro: URL recusada pela guarda, site fora do ar, página sem
título. 120 por hora por pessoa.

```typescript
interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  siteName: string;
  /** Sempre `/api/link-preview/thumb/...` — nunca o domínio de origem. */
  thumbUrl: string | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
}
```

A guarda de SSRF está em docs/04-seguranca.md. O cache é em memória: seis horas
para um cartão, dez minutos para a ausência dele.

### `GET /link-preview/thumb/:id` — sem sessão

A miniatura, re-encodada e servida dos nossos bytes. Se o cliente buscasse a
imagem no site de origem, abrir a conversa entregaria o IP de todos os leitores
a quem mandou o link. Vive no mesmo cache em memória, então pode dar `404`
antes do cartão — a interface esconde a imagem e mantém o cartão.

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

`content` aceita string vazia **quando há `attachmentIds`**: uma foto sem
legenda é uma mensagem inteira. Sem uma coisa nem outra, o evento é recusado.

Um `attachmentId` só é costurado se for **seu**, **deste canal** e **ainda
solto**. O que não casar é ignorado em silêncio e a mensagem sai assim mesmo —
ela vale mais que o anexo, e já está no banco quando a costura roda.

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
  avatarBlurhash: string | null;
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
  /** Se **você** guardou. Nunca diz nada sobre os outros. */
  saved: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  clientNonce?: string;
}
```

Datas são sempre ISO 8601 em UTC. A formatação para o fuso local acontece só na
renderização.
