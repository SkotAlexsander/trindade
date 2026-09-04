# Fase 9 — Ferramentas de projeto e notificações

Notas colaborativas, quadro de tarefas, enquetes, fixadas e o sistema de
notificações. É a fase que transforma o chat em ferramenta de trabalho.

Leia antes: `design/08-projeto.md`, `design/09-notificacoes.md`,
`docs/03-modelo-de-dados.md` (notes, tasks), `docs/05-contrato-api.md`
(notas e tarefas).

O princípio das ferramentas de projeto: **a conversa é a origem.** Cada uma
precisa ter o gesto que leva da mensagem para ela em um clique. Sem isso, são
um Trello e um Notion piores.

## Entregar

### Migration

`011_polls` com `polls`, `poll_options`, `poll_votes`. Enquete é uma mensagem
com `kind = 'poll'` — acrescente a coluna `kind` em `messages` com padrão
`'text'`. Isso mantém a enquete no fluxo e no histórico sem tabela paralela de
"itens especiais".

Índice em `tasks (assignee_id, due_at) where completed_at is null` para o
lembrete de prazo.

### Notas

Yjs no servidor com `y-protocols`, estado em `notes.ydoc`, texto achatado em
`notes.content` atualizado a cada persistência. Transporte pelo WebSocket
existente: `NOTE_UPDATE` com o delta em base64, `NOTE_AWARENESS` para cursores.

Persista no banco com debounce de 2s após a última alteração, e sempre ao
último editor desconectar.

Editor com `@tiptap/core` sobre Yjs, renderização ao vivo do Markdown, sintaxe
visível só na linha do cursor. Sem barra de ferramentas. Cursores remotos na cor
de destaque de cada pessoa, com etiqueta que some após 2s.

"Adicionar às notas" no menu de ações da mensagem, anexando como citação com
autor e link de volta.

Exige `MANAGE_NOTES` para editar; sem a permissão, o painel abre em leitura.

### Tarefas

Rotas conforme o contrato. Mover é `PATCH` com `columnKey` e `position`, e a
posição é a média das vizinhas — uma linha atualizada.

Broadcast de `TASK_UPDATE` em toda mudança.

Painel com colunas empilhadas na vertical; botão de expandir abre o quadro em
tela cheia com colunas lado a lado. Arrastar com `@dnd-kit`.

"Criar tarefa" no menu de ações, popover ancorado na mensagem, título
pré-preenchido, dono focado. A tarefa guarda `source_message_id`; a mensagem
ganha o rodapé "Virou tarefa · coluna" clicável; o cartão ganha o ícone de volta.

Concluir grava `completed_at` e insere uma mensagem de sistema no canal, uma
linha, `kind = 'system'`.

Coluna Feito recolhida, últimos 14 dias ao expandir.

Lembrete de prazo: worker diário às 9h no fuso configurado no servidor, uma
notificação desktop por tarefa que vence hoje.

### Enquetes

`/enquete` no compositor abre o formulário inline: pergunta, 2 a 6 opções,
voto único ou múltiplo, aberta ou anônima, prazo opcional.

Votar é `PUT /polls/:id/vote` com `optionIds`. Votar de novo substitui.
Broadcast de `POLL_UPDATE`.

Renderização dentro da mensagem conforme o design: barra em `--accent` para a
líder, `--bg-active` para as demais, sua escolha com círculo preenchido,
contagem em `tabular-nums`, "N de 5 votaram".

Fechar por prazo é worker; fechar manualmente é `POST /polls/:id/close`, só o
autor. Ao fechar, sugestão de "Adicionar o resultado às notas" ao autor.

### Fixadas

**Antecipado para a fase 5** em 4 de setembro de 2026, junto com a barra de
ações da mensagem: o botão já existia no cabeçalho desde a fase 4 e `Ctrl/⌘ P`
já estava na tabela de atalhos. Se ainda não estiver pronto, é lá que ele
mora — painel em ordem inversa, link de volta, aviso acima de 25.

### Notificações

A tabela inteira de `design/09-notificacoes.md`, implementada no cliente a
partir dos eventos do WebSocket. Nada é decidido no servidor além de
`mention_count` em `read_state`.

Regras que precisam estar certas:
- nada do que você mesmo fez notifica você
- nada notifica se a janela está em foco **e** o canal está aberto
- nada de desktop durante compartilhamento de tela
- agrupamento de mensagens seguidas da mesma pessoa em uma notificação
- cooldown de 5 minutos por canal, exceto menção
- silenciado deixa passar menção direta
- pedir permissão de desktop **na primeira menção**, não no primeiro acesso

Dois sons, em `public/sounds/`, curtos, gerados ou de licença livre. Badge no
título com `(N)`. No Tauri, badge nativo.

Tela de configurações conforme o design, incluindo não perturbe agendado.

## Aceite

- Duas pessoas editam a nota ao mesmo tempo sem conflito, com cursores visíveis
- Fechar a aba no meio da edição não perde nada
- "Adicionar às notas" a partir de uma mensagem funciona e tem link de volta
- Criar tarefa de mensagem preenche o título e liga os dois lados
- Arrastar tarefa move em tempo real na outra aba e não reindexa a coluna
- Concluir tarefa gera a mensagem de sistema
- Enquete anônima não revela votos nem pela API
- Votar de novo troca o voto, não duplica
- Menção toca som e mostra desktop; mensagem comum só marca o ponto
- Responder na própria thread não notifica você
- Canal silenciado deixa menção passar
- Focar a janela com o canal aberto zera o badge; focar em outro canal não
