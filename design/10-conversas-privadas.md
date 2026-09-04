# Conversas privadas

Conversa direta entre duas pessoas, ou grupo de três a quatro, fora dos canais.

Com cinco pessoas, existem exatamente dez pares possíveis e um punhado de
grupos. Isso permite um desenho que não escala e não precisa: sem busca de
contatos, sem convite, sem "nova conversa" que pede para digitar um nome.

---

## Modelo

```sql
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('direct','group')),
  name       text check (char_length(name) <= 48),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table conversation_members (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id         uuid references users(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  primary key (conversation_id, user_id)
);

alter table messages
  add column conversation_id uuid references conversations(id) on delete cascade,
  alter column channel_id drop not null,
  add constraint messages_one_target
    check ((channel_id is null) <> (conversation_id is null));
```

A garantia de par único para conversas diretas é feita na aplicação: ao abrir uma conversa direta,
procura-se uma `direct` cujos membros sejam exatamente os dois; se não existe,
cria. Uma função `find_or_create_direct(a, b)` em transação com lock resolve a
corrida.

Mensagens usam a **mesma tabela `messages`**, com `conversation_id` em vez de
`channel_id` — as duas colunas nulas alternadamente, com `check` garantindo que
exatamente uma esteja preenchida. Isso reaproveita busca, reações, anexos,
threads e todo o gateway sem duplicar nada.

Permissão: apenas membros leem e escrevem. `ADMINISTRATOR` **não** dá acesso a
conversas privadas de outros. É a única exceção ao bitfield, e é deliberada:
privado significa privado.

---

## Onde vive

Na barra lateral, uma seção acima dos canais:

```
┌──────────────────────────────┐
│ Cinco                     ⌄  │
├──────────────────────────────┤
│ CONVERSAS                    │
│  ◉ Bruno                  ●  │
│  ◉◉ Ana, Carla               │
│                              │
│ CANAIS                       │
│  # geral                     │
│  # produto                   │
└──────────────────────────────┘
```

Só aparecem as conversas com mensagem. Uma conversa direta sem nada nunca ocupa
espaço na lista.

Direta mostra avatar de 20px com anel de status e o primeiro nome. Grupo mostra
dois avatares sobrepostos e os nomes separados por vírgula, ou o `name` se foi
dado.

Ordenada pela última mensagem. Com no máximo uma dúzia de entradas, não precisa
de mais nada.

---

## Abrir uma conversa

Três caminhos, nenhum deles "digite um nome":

- **Cartão de perfil** → botão "Mandar mensagem". É o principal.
- **Painel do elenco** → clique no avatar abre o cartão, mesmo botão.
- **Paleta de comandos** → `Ctrl/⌘ K`, digitar o nome, a pessoa aparece na
  seção Pessoas, `Enter` abre.

Abrir uma direta que não existe cria e vai para ela, com o compositor focado e o
placeholder "escreva para Bruno". Se a pessoa fechar sem mandar nada, a
conversa continua existindo no banco e continua invisível na lista.

### Grupo

No cabeçalho de uma direta, "Adicionar pessoa" abre um seletor com **as três
restantes** — não um campo de busca. Marcar uma ou mais e confirmar cria um
grupo novo; a direta original permanece intacta.

Grupo pode ser nomeado pelo cabeçalho. Sem nome, mostra os nomes.

Sair de um grupo é `left_at`, não remoção — a pessoa deixa de receber, mas o
histórico dela continua para os outros. Uma mensagem de sistema registra.

Grupo com uma pessoa só é arquivado automaticamente.

---

## Cabeçalho

Direta:

```
┌────────────────────────────────────────────────────────┐
│  ◉ Bruno Costa   Produto      🔍  📞  ⋯                │
└────────────────────────────────────────────────────────┘
```

Avatar, nome, cargo de maior posição, e à direita busca, chamar e mais. O
status vem no anel do avatar; o status personalizado aparece abaixo do nome em
11px se existir.

Chamar cria uma sala de voz efêmera só para os membros da conversa, mesma
infraestrutura da fase 7, `room: conversation:{id}`. Não aparece na lista de
canais de voz — é privada como a conversa.

---

## Diferenças em relação ao canal

- Sem tópico, sem fixadas, sem notas, sem tarefas. O painel direito só abre
  para busca e thread.
- Sem menção `@aqui`. Numa direta, tudo já é dirigido.
- Notificação: toda mensagem em conversa privada notifica como menção — som,
  desktop e badge. É a exceção à regra de notificações, e faz sentido: alguém
  falou diretamente com você.
- Silenciar existe, com as mesmas opções.
- Não dá para apagar uma conversa. Dá para esconder da lista (`hidden_at` em
  `conversation_members`); ela reaparece na próxima mensagem.

---

## Privacidade

O conteúdo de conversa privada não aparece em nenhuma busca global, apenas na
busca dentro dela mesma.

`audit_log` registra criação e saída de grupo, nunca conteúdo.

A promessa ao usuário, em uma linha na primeira vez que abre uma direta:

> Só vocês dois veem esta conversa. Nem quem administra o servidor tem acesso.

É verdade no nível da aplicação. Não é E2EE — quem tem acesso ao banco lê. A
frase diz "nem quem administra o servidor", e essa é a pessoa com acesso ao
banco, então a promessa precisa ser honesta: reformule para "Nem quem administra
o servidor vê pela interface" ou implemente o que a frase promete. O pacote
assume a reformulação.
