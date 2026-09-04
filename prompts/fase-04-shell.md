# Fase 4 — Shell da aplicação

A moldura: rail, lista de canais, painel do elenco, cabeçalho, painel contextual
e roteamento. Sem mensagens ainda — o histórico fica com um espaço reservado.

Leia antes: `design/02-shell-principal.md` e `design/03-menu-e-navegacao.md`.

O painel do elenco é o elemento identitário do produto. A seção sobre ele em
`03-menu-e-navegacao.md` é a mais detalhada por isso; siga-a de perto.

## Entregar

### Backend

Rotas de canal de `docs/05-contrato-api.md`: listar, criar, editar, arquivar,
reordenar. Permissão `MANAGE_CHANNEL` verificada no servidor.

`GET /users` devolvendo as cinco pessoas completas, sem paginação.

### AppShell

Grade de quatro colunas exatamente como no documento, com `100dvh` e
`minmax(0, 1fr)` na coluna central.

### Rail

56px. Marca, espaços de projeto, engrenagem no rodapé. Marcador vertical de 3px
no ativo, com transição de altura.

### Lista de canais

Item de 32px com os quatro estados da tabela do documento. Não lido usa peso 600
**mais** um ponto — nunca só cor. Menção vira contador em pílula, o único fundo
saturado da lista.

Categorias com chevron. Recolhida esconde os lidos e mantém os não lidos.

Reordenar por arrasto, com `MANAGE_CHANNEL`, mostrando linha de destino em
`--accent` e sem animar o rearranjo dos vizinhos.

### Painel do elenco

Fixo no rodapé da coluna, 88px, `--bg-live`, borda superior.

**Cinco espaços sempre.** Offline aparece esmaecido, não some. O espaço de quem
está ausente é informação.

Estados de anel conforme a tabela: offline, online, ausente, ocupado, em chamada,
falando. O anel é `box-shadow` de duas camadas — a primeira abre um sulco entre
o avatar e o anel.

Digitando anima o **nome**, não o avatar: três pontos em sequência, ciclo de 1,2s.

**O momento orquestrado**: ao receber o primeiro `READY` da sessão, os cinco
espaços acendem em sequência da esquerda para a direita, 60ms entre cada,
`opacity` e `scale` 0,92→1, 220ms com `--ease-out`. Uma vez por sessão, **não em
reconexão**. Desligado com `prefers-reduced-motion`.

Faixa "você" abaixo, com microfone, fone e engrenagem. Desligado em `--danger`
**com barra diagonal**, não só cor.

### Cabeçalho do canal

`#`, nome, separador vertical de 1px, tópico truncado. Ícones à direita para
busca, fixadas, notas, tarefas. O do painel aberto fica com fundo `--bg-active`.

### Painel contextual

320px, fechado por padrão. Anime `transform`, nunca `width` — animar largura
causa reflow na grade inteira. `Escape` fecha **se o foco estiver dentro**.

### Menus

Menu de servidor pelo chevron do cabeçalho. Itens sem permissão **não aparecem** —
não os mostre desabilitados.

Menu contextual de canal com botão direito. Arquivar, não excluir.

Paleta de comandos com `Ctrl/⌘ K`: busca difusa em canais, pessoas e ações,
ancorada a 15% do topo.

### Roteamento

`/c/:slug` para canal, `/entrar` e as telas de auth já feitas, `/config/*` para
as páginas de configuração (vazias por ora). Redirecionar `/` para o primeiro
canal não lido, ou `#geral`.

### Responsivo

As três faixas do documento. Abaixo de 900px, navegação em pilha com gaveta
lateral — e **o elenco vira faixa horizontal no topo da gaveta**, não desaparece.

### Atalhos

A tabela inteira de `design/02-shell-principal.md`. Um hook `useHotkeys` que
respeita foco em campo de texto: `Alt ↓` não deve trocar de canal enquanto a
pessoa digita.

## Aceite

- As quatro colunas renderizam nas proporções corretas
- Elenco mostra cinco espaços, com offline esmaecido
- A sequência de acender roda uma vez ao conectar e não em reconexão
- Não lido é distinguível sem cor
- Painel abre e fecha sem reflow perceptível
- Abaixo de 900px vira pilha, com o elenco preservado na gaveta
- Todos os atalhos funcionam e nenhum dispara enquanto digita
- `Ctrl/⌘ K` encontra canal e pessoa
- Item de menu sem permissão não aparece
- Navegação completa por teclado, foco visível em tudo
