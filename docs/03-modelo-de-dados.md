# Modelo de dados

PostgreSQL 16. Sem ORM — as queries são escritas à mão em `packages/api/src/db/`.

Chave primária é sempre `uuid` com `gen_random_uuid()`, exceto onde a chave
natural é melhor (código de convite). Todo timestamp é `timestamptz`, nunca
`timestamp` — o grupo pode estar em fusos diferentes e o bug é silencioso.

---

## Extensões

```sql
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- username sem case
create extension if not exists pg_trgm;    -- busca por similaridade
```

---

## Pessoas

```sql
create table users (
  id             uuid primary key default gen_random_uuid(),
  username       citext unique not null
                 check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name   text not null check (char_length(display_name) between 1 and 32),
  password_hash  text not null,
  avatar_key     text,
  bio            text check (char_length(bio) <= 280),
  accent_color   text check (accent_color ~ '^#[0-9a-f]{6}$'),
  totp_secret    text,
  totp_enabled_at timestamptz,
  status         text not null default 'offline'
                 check (status in ('online','idle','busy','invisible','offline')),
  custom_status  text check (char_length(custom_status) <= 64),
  disabled_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

`username` é o identificador de login e **é imutável**. `display_name` é o que
aparece na interface e pode mudar quando a pessoa quiser. Separar os dois evita a
classe de problema em que alguém renomeia e ninguém sabe mais quem é quem no
histórico.

`avatar_key` guarda a chave no storage (`avatars/{uuid}/{uuid}.webp`), nunca a
URL completa. Trocar de provedor de storage depois não exige migration de dados.

`totp_secret` nulo significa 2FA desligado. Guarde cifrado com uma chave da
aplicação, não em claro — se o banco vazar, o segundo fator ainda vale alguma
coisa.

`disabled_at` em vez de `delete`. Remover uma pessoa que escreveu quinhentas
mensagens cria buracos no histórico; desativar preserva o contexto.

---

## Cargos e permissões

```sql
create table roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 24),
  color       text check (color ~ '^#[0-9a-f]{6}$'),
  position    int not null default 0,
  permissions bigint not null default 0,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create unique index roles_one_default
  on roles (is_default) where is_default;

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  granted_by uuid references users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
```

`position` define hierarquia — número maior manda mais. Duas regras derivam dele
e ambas são verificadas no servidor:

1. Ninguém atribui ou edita um cargo de `position` maior ou igual ao seu maior
   cargo. Sem isso, qualquer moderador vira administrador em dois cliques.
2. A cor exibida ao lado do nome vem do cargo de maior `position` que tenha cor.

`permissions` é um bitfield de 64 bits. As permissões efetivas de uma pessoa são
o `OR` de todos os cargos dela.

```
bit  0  SEND_MESSAGE       enviar mensagem
bit  1  DELETE_OWN_MESSAGE apagar a própria mensagem
bit  2  DELETE_ANY_MESSAGE apagar mensagem de qualquer um
bit  3  PIN_MESSAGE        fixar mensagem
bit  4  ATTACH_FILE        enviar anexo
bit  5  MANAGE_CHANNEL     criar, renomear, arquivar canal
bit  6  MANAGE_ROLES       criar cargo e atribuir a outros
bit  7  MANAGE_MEMBERS     desativar e reativar pessoa
bit  8  CREATE_INVITE      gerar convite
bit  9  CONNECT_VOICE      entrar em chamada
bit 10  SHARE_SCREEN       compartilhar tela
bit 11  MUTE_OTHERS        silenciar outra pessoa na chamada
bit 12  MANAGE_NOTES       editar notas do canal
bit 13  MANAGE_TASKS       criar e mover tarefa
bit 62  ADMINISTRATOR      ignora todas as checagens acima
```

Deixe os bits 14 a 61 livres. Renumerar bitfield depois que existe dado é
migration com risco real.

Seed inicial: um cargo `Membro` com `is_default = true` e as permissões de
0 a 4 mais 8 a 10; um cargo `Admin` com `ADMINISTRATOR` e `position = 100`.

---

## Convites

```sql
create table invites (
  code        text primary key check (char_length(code) between 8 and 32),
  created_by  uuid not null references users(id),
  used_by     uuid references users(id),
  used_at     timestamptz,
  expires_at  timestamptz not null,
  note        text,
  created_at  timestamptz not null default now()
);
```

Uso único: `used_by` nulo significa disponível. O `note` serve para quem gerou
lembrar para quem era. Gere o código com 16 bytes aleatórios em base32 sem
caracteres ambíguos.

---

## Sessões

```sql
create table refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  family_id   uuid not null,
  token_hash  text not null unique,
  user_agent  text,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index refresh_family on refresh_tokens (family_id) where revoked_at is null;
```

`family_id` é o mecanismo de detecção de roubo. Todo refresh gera um token novo
na mesma família e revoga o anterior. Se um token já revogado reaparece, alguém
copiou — revogue a família inteira e force login.

Nunca grave o token em claro. `token_hash` é SHA-256 do valor entregue ao cliente.

Não guarde IP aqui. Ver `04-seguranca.md`.

---

## Canais

```sql
create table channels (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null check (slug ~ '^[a-z0-9-]{1,32}$'),
  name        text not null,
  topic       text check (char_length(topic) <= 200),
  kind        text not null default 'text' check (kind in ('text','voice')),
  position    int not null default 0,
  category    text,
  archived_at timestamptz,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now()
);
```

Não há tabela de permissão por canal. Com cinco pessoas, todo mundo vê todo
canal — a complexidade de ACL por canal não se paga. Se um dia precisar, a
tabela é `channel_overrides (channel_id, role_id, allow bigint, deny bigint)`.

---

## Mensagens

```sql
create table messages (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,
  author_id     uuid not null references users(id),
  parent_id     uuid references messages(id) on delete set null,
  reply_to_id   uuid references messages(id) on delete set null,
  content       text not null check (char_length(content) <= 4000),
  -- Acrescentada na migration 018. `system` é o canal registrando um fato
  -- ("Bruno concluiu X"), não a fala de ninguém: a interface a desenha sem
  -- avatar e sem barra de ações, e ela não agrupa com as vizinhas.
  kind          text not null default 'text'
                check (kind in ('text','system','poll')),
  client_nonce  uuid,
  pinned_at     timestamptz,
  edited_at     timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  -- `pt_unaccent` e não `portuguese`: a configuração padrão faz stemming mas
  -- não tira acento, e o aceite pede que "migracao" ache "migração". Criada
  -- na migration 012. Coluna gerada exige função IMMUTABLE, e é por isso que
  -- a solução é uma configuração nomeada e não uma chamada a `unaccent()`.
  search_vector tsvector generated always as
                (to_tsvector('pt_unaccent', content)) stored
);

create index messages_channel_time
  on messages (channel_id, created_at desc) where deleted_at is null;

create index messages_thread
  on messages (parent_id, created_at) where parent_id is not null;

create index messages_search using gin (search_vector);

create unique index messages_nonce
  on messages (author_id, client_nonce) where client_nonce is not null;
```

`parent_id` é thread; `reply_to_id` é citação dentro do mesmo nível. São coisas
diferentes e confundir as duas na v1 dá retrabalho.

`search_vector` é coluna gerada — o Postgres mantém sozinho, não há trigger para
esquecer. `to_tsvector('portuguese', ...)` remove stopwords em português e faz
stemming; é a razão de não precisar de Elasticsearch aqui.

`deleted_at` em vez de `delete`: preserva a numeração e permite ao autor ver o
que apagou por engano. A API nunca devolve `content` de mensagem apagada.

O índice único em `client_nonce` é a barreira final contra duplicata. Uma tarefa
periódica limpa nonces com mais de 24 horas.

---

## Reações, anexos, leitura

```sql
create table reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references messages(id) on delete cascade,
  storage_key  text not null,
  filename     text not null,
  content_type text not null,
  byte_size    bigint not null,
  width        int,
  height       int,
  blurhash     text,
  created_at   timestamptz not null default now()
);

create table saved_messages (
  user_id    uuid not null references users(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index saved_messages_recentes
  on saved_messages (user_id, created_at desc);
```

**Favoritar não é fixar.** `messages.pinned_at` é uma coluna da mensagem porque
fixar é do canal: exige `PIN_MESSAGE`, todo mundo vê e o mural é um só.
`saved_messages` é uma tabela de ligação porque guardar é de quem guardou:
cada pessoa tem a sua lista, ninguém vê a dos outros, e não há permissão a
checar — você não muda nada para ninguém ao guardar.

O `on delete cascade` no `message_id` é deliberado: mensagem apagada some da
lista de quem a guardou. Manter uma cópia do texto ali seria uma forma de
desfazer o apagar por outro caminho.

```sql
create table read_state (
  user_id            uuid not null references users(id) on delete cascade,
  channel_id         uuid not null references channels(id) on delete cascade,
  last_read_message_id uuid references messages(id) on delete set null,
  mention_count      int not null default 0,
  muted_until        timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (user_id, channel_id)
);
```

`filename` é o nome original, guardado só para exibir e para o download. **A
chave no storage nunca usa esse nome** — é aleatória, senão você tem enumeração
e colisão. Sanitize antes de exibir.

`blurhash` permite mostrar uma prévia borrada enquanto a imagem carrega. Custa
uma linha na hora do upload e melhora muito a percepção de velocidade.

---

## Conversas privadas

Direta entre duas pessoas, ou grupo de três a quatro. Criadas na migration 021.

```sql
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('direct','group')),
  name       text check (char_length(name) <= 48),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  hidden_at       timestamptz,
  primary key (conversation_id, user_id)
);

alter table messages
  add column conversation_id uuid references conversations(id) on delete cascade,
  alter column channel_id drop not null,
  add constraint messages_um_alvo
    check ((channel_id is null) <> (conversation_id is null));
```

As mensagens usam a **mesma tabela**, com `conversation_id` no lugar de
`channel_id`. É isso que reaproveita busca, reações, anexos, threads e o
gateway inteiro sem duplicar nada — uma segunda tabela de mensagens seria uma
segunda implementação de tudo o que já existe. `attachments` ganhou o mesmo
par de colunas na 022, pelo mesmo motivo: sem ele não dá para mandar uma
captura de tela numa direta.

`read_state` também acompanha: não lidas, menções e silêncio valem para
conversa exatamente como valem para canal. A chave primária `(user_id,
channel_id)` virou **dois índices únicos parciais**, um por alvo — chave
primária não aceita coluna nula, e é `on conflict` que precisa nomear o índice
certo em cada caso.

A unicidade do par de uma direta é da aplicação, não do banco: seria um índice
sobre uma agregação de duas linhas de `conversation_members`. `acharOuCriarDireta`
resolve numa transação com `for update` nas duas linhas de `users`, com o par
ordenado antes de travar — sem o lock, duas abas procuram, nenhuma acha, e as
duas criam; sem a ordem, as duas pontas travam uma a linha da outra.

Sair de um grupo é `left_at`, não remoção: quem sai deixa de receber, e o
histórico continua para os outros. `hidden_at` é esconder da lista, e some
sozinho na próxima mensagem — não existe apagar conversa.

---

## Trabalho de projeto

```sql
create table notes (
  channel_id uuid primary key references channels(id) on delete cascade,
  content    text not null default '',
  ydoc       bytea,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  body        text,
  column_key  text not null default 'todo',
  position    double precision not null,
  assignee_id uuid references users(id) on delete set null,
  due_at      timestamptz,
  source_message_id uuid references messages(id) on delete set null,
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);

create index tasks_board on tasks (channel_id, column_key, position);

-- O lembrete das 9h pergunta "o que vence hoje, e de quem". Criado na
-- migration 018, parcial porque tarefa concluída não interessa a ele.
create index tasks_prazo on tasks (assignee_id, due_at) where completed_at is null;
```

### Enquetes

A enquete **é** uma mensagem: `messages.kind = 'poll'`, e `content` guarda a
pergunta. Não há tabela paralela de "itens especiais" do canal — assim a
pergunta entra na busca, no histórico e nas fixadas como qualquer outra coisa
que aconteceu ali, e o `on delete cascade` a partir de `messages` apaga tudo
junto quando a mensagem some. Criadas na migration 020.

```sql
create table polls (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null unique references messages(id) on delete cascade,
  channel_id  uuid not null references channels(id) on delete cascade,
  question    text not null check (char_length(question) between 1 and 200),
  multiple    boolean not null default false,
  anonymous   boolean not null default false,
  closes_at   timestamptz,
  closed_at   timestamptz,
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now()
);

create index polls_canal on polls (channel_id, created_at desc);
create index polls_prazo on polls (closes_at) where closed_at is null and closes_at is not null;

create table poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references polls(id) on delete cascade,
  label    text not null check (char_length(label) between 1 and 80),
  position int not null
);

create index poll_options_da_enquete on poll_options (poll_id, position);

create table poll_votes (
  poll_id    uuid not null references polls(id) on delete cascade,
  option_id  uuid not null references poll_options(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, user_id)
);

create index poll_votes_da_enquete on poll_votes (poll_id);
```

Nenhuma contagem materializada: com cinco pessoas, contar na hora é uma
varredura de dezenas de linhas, e um total guardado em coluna seria um segundo
lugar onde a verdade mora.

`multiple` e `anonymous` são escolhidos ao criar e não mudam depois — trocar
"anônima" com votos dentro revelaria o que foi prometido em segredo. Quem
garante isso é a API: **não existe rota que altere esses dois campos.**

`position` é `double precision` de propósito. Arrastar uma tarefa entre duas
outras vira a média das duas posições vizinhas — uma única linha atualizada em
vez de reindexar a coluna inteira.

`source_message_id` é o que liga "transformar mensagem em tarefa" à origem. É a
funcionalidade que justifica ter quadro dentro do chat em vez de usar Trello.

`ydoc` guarda o estado CRDT do Yjs para edição simultânea. `content` é o texto
achatado, mantido em paralelo para busca e para renderizar sem carregar o Yjs.

---

## Auditoria

```sql
create table audit_log (
  id         bigserial primary key,
  actor_id   uuid references users(id),
  action     text not null,
  target_type text,
  target_id  uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create index audit_recent on audit_log (created_at desc);
```

Registre apenas o que tem consequência: mudança de cargo, desativação de pessoa,
criação e uso de convite, exclusão de mensagem alheia, alteração de permissão.
Não registre leitura nem navegação — vira ruído e vira dado pessoal sem uso.

Retenção de 180 dias, apagado por tarefa periódica.

---

## Ordem das migrations

```
001_extensions
002_users
003_roles              roles, user_roles, seed dos cargos padrão
004_invites
005_refresh_tokens
006_channels           + seed do canal #geral
007_messages           + índices e search_vector
008_reactions_attachments_read_state
009_notes_tasks
010_audit_log
011_recovery_codes          -- não previsto; ver CLAUDE.md
012_busca_sem_acento        -- não previsto; ver CLAUDE.md
013_saved_messages          -- não previsto; ver CLAUDE.md
014_anexos_pendentes        -- não previsto; ver CLAUDE.md
015_ordem_dos_anexos        -- não previsto; ver CLAUDE.md
016_avatar_blurhash         -- não previsto; ver CLAUDE.md
017_membro_edita_notas      -- não previsto; ver CLAUDE.md
018_mensagem_de_sistema     -- não previsto; ver CLAUDE.md
019_membro_mexe_no_quadro   -- não previsto; ver CLAUDE.md
020_enquetes                -- era 011_polls no pacote; ver CLAUDE.md
021_conversas               -- era 012_conversations no pacote
022_anexo_em_conversa       -- não previsto; ver CLAUDE.md
```

Migration aplicada não se edita. Se algo está errado, cria-se a próxima.
