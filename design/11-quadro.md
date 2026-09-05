# Quadro

Um quadro branco colaborativo por canal, para desenhar, esboçar e apresentar.
Baseado no Excalidraw, que é open source, embeda como componente React e já
resolve desenho vetorial, formas, texto e exportação.

O que o pacote acrescenta é a integração: colaboração em tempo real pela
infraestrutura existente, o modo apresentação, e o elo com a conversa.

> Revisão de 4 de setembro de 2026: `--ember` virou `--live`.
>
> **Entregue em 4 de setembro de 2026** (fase 10, fatia 2): o quadro, a
> colaboração, a lista e a miniatura. O **modo apresentação** e os dois gestos
> para a conversa ("enviar no canal" e "abrir no quadro") ficaram para a fatia
> seguinte. O que mudou em relação ao que está escrito abaixo:
>
> - **Tela cheia é a tela toda**, e não só a coluna da conversa. Sair é o "‹" da
>   barra. Cobrir metade da tela com um canvas seria repetir os 320px do painel
>   com outro número.
> - **A miniatura é WebP**, não PNG: ela nasce no navegador como PNG e é
>   re-encodada no servidor como toda imagem do produto. Nenhum byte de upload
>   chega ao disco sem passar pelo `sharp` — nem o que a própria aplicação
>   gerou.
> - **O teto de 2 000 elementos barra o que é novo, não o que já existe.**
>   Travar o quadro inteiro seria a armadilha perfeita: um quadro cheio em que
>   nem dá para apagar algo para caber de novo. A contagem vem do servidor,
>   porque cada navegador vê o quadro com um atraso diferente.
> - **A ferramenta de imagem está desligada** nesta fatia. Uma imagem colada
>   vira arquivo local do Excalidraw e não viaja pelo CRDT: apareceria quebrada
>   para todo mundo menos para quem colou. Ela volta junto com o upload pelo
>   `sharp`.
> **Entregue na fatia 3**: o modo apresentação, e o encontro com a chamada.
> O que mudou em relação ao que está escrito abaixo:
>
> - **A apresentação passa pelo servidor**, e não só pela awareness: a linha de
>   sistema no canal precisa nascer uma vez só, e quem **não** está com o quadro
>   aberto também tem de ver que ela começou. Uma por quadro; a queda da
>   conexão encerra.
> - **Apresentar não exige `MANAGE_NOTES`.** Conduzir não é desenhar, e quem só
>   vê o quadro pode perfeitamente explicá-lo. A caneta que a apresentadora
>   passa é combinação de palco, não permissão: quem desenha continua passando
>   pelo bitfield no `BOARD_UPDATE`.
> - **O apontador é o cursor de colaboração do próprio Excalidraw**, na cor da
>   pessoa e com o primeiro nome, e some 1,5s depois de parar. Desenhar um
>   ponto nosso por cima seria refazer o que ele já posiciona em coordenadas de
>   cena, com zoom e rolagem corretos.
> - **A linha de sistema é clicável de verdade**: o nome do quadro é um link
>   `?quadro=<id>`, e o shell abre o quadro ao ver o parâmetro.
> - **A chamada não some quando o quadro abre.** O quadro cobre a tela inteira,
>   então a chamada vira a janela flutuante — **por cima** dele —, e o mesmo
>   botão leva e traz de volta. Desenhar junto e falar junto são a mesma
>   reunião. A barra da chamada ganhou o caminho de ida.
>
> **Entregue na fatia 3**: o modo apresentação, e o encontro com a chamada.
> O que mudou em relação ao que está escrito abaixo:
>
> - **A apresentação passa pelo servidor**, e não só pela awareness: a linha de
>   sistema no canal precisa nascer uma vez só, e quem **não** está com o quadro
>   aberto também tem de ver que ela começou. Uma por quadro; a queda da
>   conexão encerra.
> - **Apresentar não exige `MANAGE_NOTES`.** Conduzir não é desenhar, e quem só
>   vê o quadro pode perfeitamente explicá-lo. A caneta que a apresentadora
>   passa é combinação de palco, não permissão: quem desenha continua passando
>   pelo bitfield no `BOARD_UPDATE`.
> - **O apontador é o cursor de colaboração do próprio Excalidraw**, na cor da
>   pessoa e com o primeiro nome, e some 1,5s depois de parar. Desenhar um
>   ponto nosso por cima seria refazer o que ele já posiciona em coordenadas de
>   cena, com zoom e rolagem corretos.
> - **A linha de sistema é clicável de verdade**: o nome do quadro é um link
>   `?quadro=<id>`, e o shell abre o quadro ao ver o parâmetro.
> - **A chamada não some quando o quadro abre.** O quadro cobre a tela inteira,
>   então a chamada vira a janela flutuante — **por cima** dele —, e o mesmo
>   botão leva e traz de volta. Desenhar junto e falar junto são a mesma
>   reunião. A barra da chamada ganhou o caminho de ida.
>
> - **As fontes do Excalidraw são servidas por nós** (`/excalidraw/fonts/`,
>   copiadas do pacote instalado antes de `dev` e de `build`). Sem isso ele as
>   busca em `esm.sh` — requisição externa, do navegador de cada pessoa, que a
>   CSP recusa e que este produto não faz em lugar nenhum.

---

## Modelo

```sql
create table boards (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 48),
  ydoc        bytea,
  thumbnail_key text,
  created_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

create index boards_channel on boards (channel_id) where archived_at is null;
```

Vários quadros por canal — diferente das notas, que são uma por canal. Um
canal de produto pode ter "Fluxo de onboarding" e "Arquitetura v2" ao mesmo
tempo, e misturar os dois num quadro só não faz sentido.

O estado dos elementos vive num `Y.Map` no `ydoc`, mesma abordagem das notas.
Persistência com debounce de 2s e ao último editor sair.

`thumbnail_key` é um PNG de 400×300 gerado no cliente ao fechar e enviado pelo
mesmo pipeline de upload — passa pelo `sharp` como tudo o mais.

---

## Onde vive

Ícone no cabeçalho do canal, ao lado de notas e tarefas. Abre no painel direito
uma lista dos quadros do canal:

```
┌──────────────────────────────┐
│  Quadros · # produto    + ✕  │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │ [ miniatura ]          │  │
│  │ Fluxo de onboarding    │  │
│  │ Ana · há 2 h           │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [ miniatura ]          │  │
│  │ Arquitetura v2         │  │
│  │ Bruno · ontem          │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

Clicar abre o quadro **em tela cheia sobre a conversa**, nunca dentro dos
320px do painel. Desenhar precisa de espaço.

```
┌────────────────────────────────────────────────────────┐
│  ‹  Fluxo de onboarding          ◉◉  Apresentar  ⋯    │
├────────────────────────────────────────────────────────┤
│                                                        │
│                                                        │
│                  [ canvas do Excalidraw ]              │
│                                                        │
│                                                        │
├────────────────────────────────────────────────────────┤
│  ▭ ○ ─ ✎ T  ⌫                              ⊖ 100% ⊕   │
└────────────────────────────────────────────────────────┘
```

Barra superior própria, com a de ferramentas do Excalidraw na base. O tema do
Excalidraw segue o do produto — ele suporta escuro e claro nativamente.

Os avatares na barra são de quem está com o quadro aberto agora, com anel de
status. Cursores dos outros no canvas na cor de destaque de cada um, com o
primeiro nome.

---

## Modo apresentação

O motivo de existir. Quem está apresentando controla o que os outros veem.

Clicar em "Apresentar":

1. A pessoa vira apresentadora. A barra ganha a borda superior de 2px em
   `--live`, a mesma da chamada — porque é presença ao vivo, alguém está
   conduzindo.
2. Uma mensagem de sistema no canal: "◉ Ana está apresentando *Fluxo de
   onboarding*", clicável, e o quadro aparece na lista de canais indentado sob
   o canal, como os avatares de voz.
3. Quem entra vê a **viewport da apresentadora**: mesmo enquadramento, mesmo
   zoom, seguindo em tempo real. As ferramentas de desenho somem; sobra um
   apontador.
4. Cada espectador pode "soltar" para navegar livre — um botão "Seguindo Ana"
   que vira "Voltar a seguir". Soltar não interrompe ninguém.

O apontador do espectador é um ponto de 8px na cor da pessoa, visível para
todos, e some 1,5s após parar de mover. Serve para "olha isso aqui" sem
precisar de permissão de desenho.

A apresentadora pode dar permissão de desenho a alguém pelo avatar na barra.

Apresentação e chamada de voz são independentes, mas o caso de uso normal é as
duas juntas. Se há chamada ativa no canal, "Apresentar" sugere entrar nela.

Encerrar tira a borda âmbar, manda a mensagem de sistema de encerramento e
libera a navegação de todos.

---

## Do quadro para a conversa

Dois gestos:

**Compartilhar seleção.** Selecionar elementos e "Enviar no canal" exporta a
seleção como PNG e a manda como anexo, com um link para o quadro. Serve para
"aqui está o diagrama que discutimos" sem abrir o quadro.

**Criar quadro a partir de imagem.** No menu de ações de uma mensagem com
imagem: "Abrir no quadro". Cria um quadro com a imagem como elemento de fundo,
para anotar em cima.

---

## Restrições

- Quadro é edição livre para quem tem `MANAGE_NOTES`; os demais só veem e
  apontam. Mesma permissão das notas, de propósito — são o mesmo tipo de
  artefato.
- Máximo de 2 000 elementos por quadro. Acima disso, o Yjs e o navegador
  começam a sofrer, e um quadro desse tamanho deveria ser dois.
- Exportação como PNG e SVG pelo próprio Excalidraw. Sem PDF.
- Sem biblioteca de formas compartilhada na v1. A biblioteca padrão do
  Excalidraw cobre diagramas e fluxos.
- Imagem inserida no quadro passa pelo upload normal, com o `sharp`. O
  Excalidraw guarda um `fileId`; o servidor resolve para a chave no storage.

---

## Responsivo

Abaixo de 900px, o quadro abre em tela cheia com a barra de ferramentas
recolhida num botão. Desenhar no celular funciona mas é secundário; o caso
principal no celular é **assistir** uma apresentação, e isso precisa ser bom:
seguir a viewport, apontar, e nada mais.
