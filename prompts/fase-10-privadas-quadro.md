# Fase 10 — Conversas privadas e quadro

Mensagem direta, grupos pequenos, e o quadro colaborativo com modo apresentação.

Leia antes: `design/10-conversas-privadas.md`, `design/11-quadro.md`,
`docs/07-permissoes-do-navegador.md`.

## Entregar

### Migrations

`012_conversations` conforme o design: `conversations`, `conversation_members`,
e a alteração em `messages` com `conversation_id` e o `check` de alvo único.

`013_boards`.

### Conversas privadas

`find_or_create_direct(a, b)` em transação com `select ... for update` no par,
para não criar duas diretas numa corrida.

Rotas:
- `GET /conversations` — as suas, com última mensagem e não lidos
- `POST /conversations/direct` `{ userId }`
- `POST /conversations/group` `{ userIds, name? }`
- `PATCH /conversations/:id` `{ name }` — só grupo
- `POST /conversations/:id/leave` — só grupo, grava `left_at`
- `POST /conversations/:id/hide` / `unhide`
- `POST /conversations/:id/voice/token` — sala `conversation:{id}`

As rotas de mensagem passam a aceitar `conversation_id` como alvo. Reaproveite
tudo: busca (restrita à conversa), reações, anexos, threads, gateway.

**A checagem de acesso é ser membro com `left_at` nulo. `ADMINISTRATOR` não
passa.** É a única exceção ao bitfield e está no design com justificativa.

Barra lateral com a seção "Conversas" acima dos canais, mostrando só as que
têm mensagem, ordenadas pela última. Direta com avatar e anel; grupo com dois
avatares sobrepostos.

Abrir pelo cartão de perfil, pelo elenco e pela paleta. "Adicionar pessoa"
mostra as três restantes como caixas de marcação, não um campo de busca.

Notificação: toda mensagem em conversa privada notifica como menção.

A frase de privacidade na primeira abertura, com o texto **reformulado** para
ser honesto sobre o que a aplicação garante.

### Quadro

`@excalidraw/excalidraw` como componente, tema seguindo o do produto.

Colaboração via Yjs no WebSocket existente: elementos num `Y.Map` indexado por
id, `BOARD_UPDATE` com o delta, `BOARD_AWARENESS` com cursor, viewport e
apontador. Persistência com debounce de 2s e ao último sair.

Miniatura gerada no cliente ao fechar, enviada pelo pipeline de upload com o
`sharp`.

Lista de quadros no painel direito; abrir é tela cheia sobre a conversa.

**Modo apresentação:**
- estado `presenter_id` na awareness do quadro
- borda superior `--ember` na barra enquanto ativo
- espectadores recebem a viewport da apresentadora e a aplicam com
  `updateScene({ appState: { scrollX, scrollY, zoom } })` a cada mudança,
  com throttle de 50ms
- "Seguindo Ana" / "Voltar a seguir" por espectador
- apontador de 8px na cor da pessoa, some 1,5s após parar
- apresentadora concede desenho por avatar
- mensagens de sistema de início e fim no canal
- se há chamada de voz no canal, sugerir entrar

"Enviar no canal" exporta a seleção com `exportToBlob` e manda como anexo com
link para o quadro. "Abrir no quadro" a partir de imagem em mensagem.

Imagem inserida no quadro passa pelo upload normal; resolva `fileId` para a
chave no storage.

Limite de 2 000 elementos com aviso ao se aproximar.

### Permissões do navegador

Aplique `docs/07-permissoes-do-navegador.md`: o `Permissions-Policy` completo,
`navigator.permissions.query()` antes de pedir onde suportado, e os textos de
negação com a instrução real.

## Aceite

- Abrir direta com a mesma pessoa duas vezes, em abas simultâneas, cria uma só
- Admin sem ser membro recebe 403 numa conversa privada, inclusive via busca
- Sair de um grupo preserva o histórico para os outros
- Conversa privada notifica como menção
- Dois quadros no mesmo canal não se misturam
- Duas pessoas desenhando ao mesmo tempo não perdem traço
- Espectador segue o zoom e a rolagem da apresentadora com atraso imperceptível
- Soltar e voltar a seguir funciona sem afetar os outros
- Apontador aparece para todos e some sozinho
- Miniatura passa pelo `sharp` (confira que não há EXIF)
- `navigator.geolocation` lança erro de política no console
