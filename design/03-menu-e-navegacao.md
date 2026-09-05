# Menu e navegação

Cobre o rail, a lista de canais, o painel do elenco e os menus contextuais.

> Revisão de 4 de setembro de 2026: as citações de `--ember` viraram `--live`
> na troca de direção visual. A cor de presença ao vivo passou de âmbar a
> magenta; o papel dela não mudou. Ver `00-direcao-visual.md`.

O painel do elenco é o elemento mais importante deste documento. Ele é o que
diferencia o produto e a seção sobre ele é a mais longa por isso.

---

## Lista de canais

### Item

```
┌────────────────────────────────┐
│  #  produto                  ● │   32px de altura
└────────────────────────────────┘
   ↑  ↑                         ↑
  14px nome                  indicador
```

```css
.channel {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  align-items: center;
  gap: var(--s-2);
  height: 32px;
  padding: 0 var(--s-2);
  margin: 1px var(--s-2);
  border-radius: var(--r-control);
  font: var(--weight-normal) var(--text-ui) / 1 var(--font-ui);
  color: var(--text-secondary);
}
```

Quatro estados, e a distinção não pode depender só de cor:

| Estado | Cor do texto | Peso | Fundo |
|---|---|---|---|
| lido | `--text-secondary` | 400 | — |
| hover | `--text-primary` | 400 | `--bg-hover` |
| não lido | `--text-primary` | 600 | — |
| ativo | `--text-primary` | 500 | `--bg-active` |

Não lido usa peso 600 mais um ponto de 6px em `--text-primary` na direita. Ativo
usa fundo. São sinais diferentes porque são informações diferentes, e um canal
pode ser as duas coisas.

**Menção** troca o ponto por um contador: pílula `--r-full`, fundo `--accent`,
texto `--text-on-accent`, 11px peso 600, altura 16px, `tabular-nums`. Acima de 9,
mostre `9+`.

Menção é o único lugar da lista com fundo saturado. Ela precisa saltar; se cada
canal tiver algo colorido, nada salta.

### Categorias

Cabeçalho de 13px, peso 500, `--text-tertiary`, caixa normal — **não caixa alta
espaçada**. Chevron de 12px à esquerda que gira 90° ao recolher.

Categoria recolhida esconde os canais lidos e mantém visíveis os não lidos. Um
canal com menção nunca some, mesmo com a categoria fechada.

### Canal de voz

Ícone de alto-falante em vez de `#`. Quando há gente dentro, os avatares aparecem
indentados abaixo, 20px, empilhados verticalmente:

```
  🔊 sala
     ◉ Ana          ← borda magenta: falando agora
     ◉ Bruno  🖥     ← compartilhando tela
```

Aqui aparece o magenta pela primeira vez na navegação, e ele significa
exatamente uma coisa: essa pessoa está falando neste instante.

### Ordenar

Arrastar exige `MANAGE_CHANNEL`. Alça aparece no hover, à esquerda. Enquanto
arrasta, o item fica em `opacity: 0.4` e uma linha de 2px em `--accent` marca o
destino. Sem animação de rearranjo dos vizinhos — a 60fps numa lista pequena isso
custa mais do que comunica.

---

## Painel do elenco

> Movido em 4 de setembro de 2026, a pedido do dono do projeto: o elenco saiu
> do rodapé da coluna de canais e foi para o **rail**, na vertical. O que se
> ganha é que ele fica visível em qualquer largura — inclusive com a gaveta
> fechada, na faixa estreita — e para de disputar altura com a lista de canais
> e com a barra de chamada. O que fica no rodapé é só o **seu canto**: seu
> nome, microfone, áudio e configurações.

> As regras não mudaram: são sempre cinco espaços, quem está offline aparece
> esmaecido e não some, e o anel de estado continua sendo o sinal.

O elemento identitário. Fixo no rodapé da coluna de canais, 88px, fundo
`--bg-live`, `border-top: 1px solid var(--border)`.

```
┌──────────────────────────────────┐
│                                  │
│   ◉    ◉    ○    ◉    ◐          │  ← 5 espaços fixos
│  Ana  Bru  Car  Dan  Eva         │
│                                  │
├──────────────────────────────────┤
│  ◉ você        🎤  🎧  ⚙         │
└──────────────────────────────────┘
```

### Por que isto existe

O Discord mostra membros numa lista que rola porque pode haver mil. Aqui há
cinco. Cinco cabem numa linha, permanentemente, e isso muda a experiência: você
sabe quem está por perto sem procurar, o tempo todo.

**São sempre cinco espaços.** Quem está offline aparece esmaecido, não some. O
espaço vazio de alguém ausente é informação — é o que faz o painel funcionar como
instrumento em vez de lista.

### Cada espaço

40px de largura, avatar de 32px, nome abreviado de 11px embaixo.

```css
.cast-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-1);
  width: 40px;
  cursor: pointer;
}
.cast-avatar {
  width: 32px; height: 32px;
  border-radius: var(--r-full);
  transition: filter var(--dur-quick) var(--ease-out);
}
```

O nome usa o primeiro nome do `displayName`, truncado em 6 caracteres sem
reticências — `Cristina` vira `Crist`. Reticências em 11px são ruído.

### Estados

| Estado | Avatar | Anel | Nome |
|---|---|---|---|
| offline | `grayscale(1) opacity(0.35)` | — | `--text-tertiary` |
| online | normal | 2px `--status-online` | `--text-secondary` |
| ausente | `opacity(0.6)` | 2px `--status-idle` | `--text-tertiary` |
| ocupado | normal | 2px `--status-busy` | `--text-secondary` |
| em chamada | normal | 2px `--live` | `--text-primary` |
| falando | normal | 2px `--live` + halo | `--text-primary` |

O anel é `box-shadow: 0 0 0 2px var(--bg-live), 0 0 0 4px <cor>`. A primeira
sombra abre um sulco entre o avatar e o anel; sem ela, encostam e ficam sujos.

**Falando** acrescenta `0 0 12px var(--magenta-glow)` como terceira camada. Entra
em `--dur-quick`, sai em `--dur-slow`. A assimetria é o detalhe que faz a coisa
parecer viva em vez de piscar: entrar rápido acompanha a voz, sair devagar
absorve as pausas curtas.

**Digitando** anima o nome, não o avatar: três pontos substituem o texto,
opacidade em sequência, ciclo de 1,2s. Anel intacto.

### Um momento orquestrado

O projeto tem uma animação não disparada pelo usuário, e é aqui.

Quando o WebSocket estabelece e o `READY` chega, os cinco espaços acendem em
sequência da esquerda para a direita, 60ms entre cada, `opacity` e `scale` de
0,92 a 1, duração de 220ms com `--ease-out`.

Acontece uma vez por sessão. É a interface dizendo "o grupo está aqui". Não
repita em reconexão — aí seria irritante em vez de bonito.

Respeite `prefers-reduced-motion`: sem escalonamento, tudo aparece de uma vez.

### Clique e hover

Hover mostra um cartão de perfil depois de 400ms, à direita, acima do painel:
avatar de 64px, nome, `@usuario`, cargos como chips coloridos, bio, status
personalizado, e um botão "Mandar mensagem".

Clique abre o mesmo cartão fixado, com foco preso dentro e `Escape` para fechar.

### A sua faixa

Abaixo dos cinco espaços, 32px, separada por `border-top: 1px solid var(--border-soft)`.

Avatar de 24px, seu nome, e três controles à direita: microfone, fone,
configurações. 28px cada.

Microfone e fone desligados ficam em `--danger` com uma barra diagonal — não
apenas cor, porque daltonismo. O tooltip diz o atalho.

Clicar no seu avatar abre o menu de status: Disponível, Ausente, Ocupado,
Invisível, e um campo para status personalizado.

---

## Menu de servidor

Abre pelo chevron no cabeçalho da coluna 2. Popover de 240px, `--bg-raised`,
`--r-surface`, `--shadow-pop`.

```
┌──────────────────────────┐
│  Convidar alguém         │
│  Criar canal             │
│  ───────────────────     │
│  Cargos e permissões     │
│  Pessoas                 │
│  ───────────────────     │
│  Aparência               │
│  Atalhos             ?   │
│  ───────────────────     │
│  Sair                    │
└──────────────────────────┘
```

Itens sem permissão **não aparecem**. Não os mostre desabilitados — isso informa
a hierarquia a quem não precisa saber dela.

"Sair" em `--danger`, separado. Sem ícone de porta; o texto basta.

Anima com `opacity` e `translateY(-4px)` em `--dur-quick`, origem no topo.

---

## Menu contextual de canal

Botão direito ou o `⋯` no hover:

```
Marcar como lido
Copiar link
───────────────
Silenciar          ▸    1 hora / 8 horas / até eu ligar
───────────────
Editar canal            (MANAGE_CHANNEL)
Arquivar canal          (MANAGE_CHANNEL)
```

Arquivar, não excluir. Um canal com histórico não deve sumir por um clique.
Se `MANAGE_CHANNEL` incluir exclusão, exija digitar o nome do canal para
confirmar.

---

## Paleta de comandos

`Ctrl/⌘ K`. Sobreposição centralizada, 560px de largura, 40% da altura, ancorada
a 15% do topo — centralizar na vertical joga o campo baixo demais.

```
┌────────────────────────────────────────┐
│  🔍  ir para…                          │
├────────────────────────────────────────┤
│  CANAIS                                │
│   # produto                            │
│   # bugs                               │
│  PESSOAS                               │
│   ◉ Ana Silva                          │
│  AÇÕES                                 │
│   Criar canal                          │
└────────────────────────────────────────┘
```

Busca difusa em canais, pessoas e ações. Sem resultado exato, ofereça "Buscar
'termo' nas mensagens" como última linha — transforma um beco sem saída em ação.

Navegação com setas, `Enter` confirma, `Escape` fecha. O primeiro item já vem
selecionado.

Sem histórico de comandos recentes na v1. Com um punhado de canais, ordenar por
recência não ajuda.

---

## Não lidos

Um traço horizontal de 2px em `--accent` marca onde você parou de ler, com o
rótulo "Novas" à direita em 11px sobre o fundo da conversa.

Some quando você rola para além dele **e a janela está em foco**. Se estiver em
outra aba, permanece — o objetivo é te devolver ao ponto certo quando voltar.

`⇧ Esc` marca tudo como lido, sem confirmação. É reversível na prática: as
mensagens continuam lá.

---

## Os controles que não faziam nada

> Varredura de 5 de setembro de 2026.

Dez controles prometiam uma ação e não entregavam nenhuma. Sete eram
`onSelect={() => undefined}` ou um botão sem `onClick`; três navegavam para uma
rota de configuração que respondia "esta página chega numa fase adiante".

| Controle | O que fazia | O que faz |
|---|---|---|
| `+` da coluna de canais | nada | abre "Criar canal" |
| Menu do servidor → Criar canal | nada | o mesmo diálogo |
| Paleta → Criar canal | ia para `/config/canais` | o mesmo diálogo |
| Paleta → Convidar alguém | ia para `/config/convites` | abre o diálogo de convite, o mesmo do menu do servidor |
| Engrenagem do rail | ia para `/config/perfil` | abre o diálogo de perfil |
| Menu do servidor → Aparência | ia para `/config/aparencia` | a página de tema |
| Menu do servidor → Atalhos | ia para `/config/atalhos` | a página de atalhos |
| Menu do canal → Marcar como lido | nada | marca, e o servidor resolve "até a última" |
| Menu do canal → Silenciar | nada | 1 hora, 8 horas, até eu ligar |
| Menu do canal → Editar canal | nada | abre o diálogo de edição |

O último item da lista escondia o maior dos defeitos: **o menu do canal nunca
era montado.** `ChannelMenu` existia desde a fase 4, completo, e nenhum
componente o renderizava — por isso ninguém tinha percebido que três dos seus
itens não faziam nada. Agora ele abre por um botão de reticências que aparece no
hover e no foco do item.

O servidor sabia fazer tudo isso desde as fases 4 e 9: `POST /channels`,
`PATCH /channels/:id`, `PUT /channels/:id/mute`, `PUT /channels/:id/read`. O que
faltava era a interface chamar.

`e2e/fase-11-controles-mortos.py` aperta os dez, um por um, e exige que algo
aconteça.

### Criar e editar canal

Diálogo, não página: é edição pontual, e tirar a pessoa da conversa para trocar
um tópico custa mais do que a edição vale.

**O endereço segue o nome até alguém mexer nele.** "Bugs de Produção" vira
`bugs-de-producao` — o acento sai por decomposição, não por tabela. Depois de
editado à mão, para de seguir: senão corrigir o endereço é impossível, porque a
letra seguinte do nome o reescreve.

**O endereço não muda depois de criado.** Links já enviados apontariam para
lugar nenhum. O diálogo de edição diz isso em vez de omitir o campo — omitir
deixa a pessoa procurando onde se edita.

**O tipo é escolhido uma vez.** Dois cartões lado a lado, não uma lista
suspensa: são duas opções que não mudam nunca, e a escolha define o que o canal
é para sempre. Um canal de texto com histórico não vira canal de voz.

### Aparência e atalhos

Duas páginas, porque as duas são referência que se lê, não ajuste que se faz no
meio de uma frase.

**Aparência** tem três opções e nada mais. Não há controle de densidade nem de
tamanho de fonte: densidade é decisão de projeto, e quem quer texto maior tem o
zoom do navegador, que funciona melhor que qualquer réplica nossa porque também
aumenta o alvo de clique.

**Atalhos** lista o que **existe**, não o que este documento imaginou. Uma
página que promete `Alt ⇧ ↑` e não faz nada quando a pessoa aperta é pior que
página nenhuma: ela ensina a não confiar na lista inteira. Cada linha foi
conferida contra o `useHotkeys` do `AppShell`, o `Composer` e a `MessageList`.
