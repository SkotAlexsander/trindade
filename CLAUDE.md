# Trindade

Espaço de trabalho privado para uma equipe fixa de 5 pessoas. Conversa em canais,
chamada de voz, compartilhamento de tela e notas de projeto. Auto-hospedado.

Nome definido: **Trindade**. Ele aparece em `packages/web/index.html`, no cabeçalho
da barra lateral, nas telas de autenticação e em `serverName` do contrato da API.

---

## Regras que valem para todo o projeto

**O elenco é fixo.** Cinco pessoas, cadastro fechado por convite. Nunca implemente
paginação, busca de membros, descoberta de servidores, onboarding público ou
qualquer coisa que assuma escala. Se uma decisão de arquitetura só se justifica
acima de mil usuários, ela está errada aqui.

**Servidor decide, cliente exibe.** Toda permissão é verificada no backend a cada
operação. Esconder um botão na UI não é controle de acesso. Se você escrever uma
checagem de permissão no front, escreva a mesma no back.

**Nada de segredo no cliente.** Access token vive em memória do JavaScript.
Refresh token vive em cookie `httpOnly`. `localStorage` nunca guarda credencial.

**IP dos membros não vaza entre membros.** WebRTC sempre com relay forçado
(`iceTransportPolicy: 'relay'`). Isso não é opcional nem otimizável.

**Metadado de imagem é dado pessoal.** Toda imagem enviada é re-encodada antes de
ser gravada. Nenhum byte original de upload chega ao disco.

---

## Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Front | React 18 + Vite + TypeScript | — |
| Estado servidor | TanStack Query | cache e revalidação |
| Estado local | Zustand | sem boilerplate de Redux |
| Estilo | CSS Modules + tokens em `:root` | sem framework de utilitário |
| Back | Node 20 + Fastify + TypeScript | plugins e validação de schema |
| Realtime | `ws` puro | Socket.IO é peso desnecessário aqui |
| Banco | PostgreSQL 16 | `citext`, `tsvector`, `jsonb` |
| Query | `postgres.js` | sem ORM |
| Migrations | `node-pg-migrate` | SQL explícito |
| Arquivos | S3-compatível (R2/MinIO) | |
| Mídia | LiveKit (SFU) + coturn | |
| Desktop | Tauri | fase final |

Sem ORM. Sem Tailwind. Sem framework de componente pronto. As queries e os
componentes são escritos à mão porque o projeto é pequeno o suficiente para isso
e porque a camada extra atrapalha mais do que ajuda nesta escala.

---

## Estrutura

```
packages/
  api/
    src/
      routes/          uma rota por arquivo, plugin Fastify
      services/        regra de negócio, sem saber que HTTP existe
      db/              queries SQL, uma função por operação
      ws/              gateway de WebSocket e eventos
      lib/             auth, permissões, storage, imagem
      plugins/         auth, rate limit, error handler
    migrations/
  web/
    src/
      routes/          páginas
      features/        agrupado por domínio, não por tipo de arquivo
      components/      genéricos, sem regra de negócio
      styles/          tokens.css e globals.css
      lib/             cliente http, cliente ws, hooks
  shared/
    src/               tipos e schemas Zod usados pelos dois lados
```

`shared` é a fonte da verdade dos tipos. Um evento de WebSocket ou um corpo de
requisição se define lá uma vez e se importa nos dois lados.

---

## Convenções

- Tudo em inglês no código; comentário e documentação em português.
- Nome de arquivo em `kebab-case`. Componente React em `PascalCase`.
- Toda rota valida entrada com Zod antes de tocar em qualquer coisa.
- Erro é objeto `{ error: string, code: string }`, nunca string solta.
- Nada de `any`. Se o tipo é difícil, o desenho está errado.
- Migration nunca é editada depois de aplicada; cria-se outra.

---

## O que ler antes de escrever código

- `docs/03-modelo-de-dados.md` antes de qualquer coisa que toque o banco
- `docs/04-seguranca.md` antes de auth, upload ou WebRTC
- `docs/05-contrato-api.md` antes de criar rota
- `design/01-tokens.md` antes de escrever CSS
- O arquivo de design da tela específica antes de montar a tela

---

## Comandos

```bash
pnpm dev              # api + web juntos
pnpm --filter api dev
pnpm --filter web dev
pnpm migrate up
pnpm migrate create nome-da-migration
pnpm test
pnpm typecheck
docker compose up -d  # postgres, minio, livekit, coturn
```

---

## Estado atual

Atualizar esta seção ao fim de cada fase.

- [x] Fase 1 — fundação
- [x] Fase 2 — autenticação
- [x] Fase 3 — design system
- [x] Fase 4 — shell da aplicação
- [x] Fase 5 — mensagens em tempo real
- [x] Fase 6 — perfil e cargos
- [x] Fase 7 — voz e tela
- [ ] Fase 8 — endurecimento
- [ ] Fase 9 — ferramentas de projeto e notificações
- [ ] Fase 10 — conversas privadas e quadro

---

## Decisões

Tomadas no Passo 0. Não reabrir sem me perguntar.

- **Nome:** Trindade.
- **E-mail no cadastro:** não. Não existe "esqueci minha senha" — recuperação é
  reset manual por um admin, e `pnpm bootstrap` cobre o caso do banco vazio.
  Não crie campo de e-mail, SMTP nem fluxo de verificação.
- **Hospedagem:** Cloudflare na frente, VPS único atrás.
  - HTTP e WebSocket passam pelo proxy da Cloudflare; o DNS aponta para eles e o
    firewall só aceita 443 vindo dos ranges deles (`docs/04-seguranca.md`).
  - Arquivos em **R2** na produção, **MinIO** no `docker compose` de
    desenvolvimento. Mesma interface S3 nos dois; a escolha é só de variável de
    ambiente. Nunca importe SDK específico da Cloudflare.
  - Upload continua passando pela API (multipart, 8 MB, re-encode obrigatório).
    Não invente URL assinada para o cliente subir direto ao R2 — isso pularia o
    re-encode e violaria a regra de metadado de imagem.
  - **Servidor único.** API, Postgres, coturn e LiveKit no mesmo VPS. Decidido,
    não é provisório: não proponha separar a mídia. **Mídia não passa pela
    Cloudflare** — é UDP, vai direto ao VPS, e o IP do TURN é visível por
    natureza. Isso é aceito. Ainda assim os endereços de coturn e LiveKit são
    variável de ambiente desde a fase 1, nunca literal no código.
- **Desktop:** sim, Tauri na fase 8. A partir de agora, evite APIs de navegador
  que o Tauri trata diferente — notificação, bandeja e atalho global passam por
  uma camada de abstração em `packages/web/src/lib/`, nunca chamadas diretas
  espalhadas pelos componentes.

### Fase 1 — concluída

Aceite percorrido inteiro com Postgres e MinIO no ar: `docker compose ps` com os
dois `healthy`, as 10 migrations aplicadas, desfeitas e refeitas, `db:true` no
health check pela API e pelo proxy do Vite, seeds conferidos no `psql`
(`Membro` 1823, `Admin` 4611686018427387904, `#geral`), `pnpm bootstrap` criando
o admin com Argon2id e recusando a segunda execução com `USERS_EXIST`.
`typecheck`, `lint` e `build` limpos nos três pacotes; log da API sem IP.

Decidido diferente do prompt: Node 24.18 em vez do 20 LTS (`engines: >=20`), por
já estar instalado e ter compilado tudo, inclusive o argon2 nativo. `Channel` e
`Attachment` foram derivados de `docs/03-modelo-de-dados.md` porque o contrato
da API os cita sem definir. Não verificado por mim: a renderização da página em
`localhost:5173` num navegador de verdade — só o build, o transform dos módulos
e a resposta da API por trás dela.

### Fase 2 — concluída

41 testes passando, incluindo reuso de refresh derrubando a família inteira,
TOTP fora da janela, e código de recuperação de uso único. Verificado também
por HTTP real: cookie com HttpOnly/SameSite=Strict/Path restrito, convite de
uso único, 5 erros de senha e 429 no sexto com Retry-After, backoff de
1s/2s/4s/8s, e nenhum `localStorage` no código nem no bundle.

Decidido diferente do prompt: `011_recovery_codes` — o modelo de dados não
previu onde guardar os códigos; as migrations das fases 9 e 10 andam um número
(`polls` vira 012, `conversations` 013, `boards` 014). `tokens.css` foi
adiantado da fase 3 porque as telas não podem ser montadas sem os tokens; falta
dela só os primitivos, a troca de tema e as fontes locais. O zxcvbn ficou em
chunk sob demanda: são 523 kB gzip que não podem descer na tela de entrar.

`ADMINISTRATOR` **não** isenta da hierarquia de cargos. Isentar deixaria a regra
inócua justamente para a conta que causa mais estrago se for tomada.

Não verificado por mim, por falta de navegador: renovação silenciosa do access
token, sessão sobrevivendo ao recarregar a página, e o comportamento das seis
caixas de código (colar, backspace, envio automático, balanço no erro).

### Fase 3 — concluída

Tokens, `globals.css` com as fontes locais, doze primitivos com CSS Module
próprio, `useTheme` em cookie, utilitário de contraste e a galeria em
`/dev/ui`. 18 verificações no navegador, todas passando: os dois temas, troca
sem piscada, foco preso no diálogo, setas no menu, tooltip no foco, toast
empilhando três, `prefers-reduced-motion`, fontes locais e nenhuma requisição
externa.

**Direção visual trocada.** O dono do projeto escolheu, a partir de uma
referência, a estética de interface de comando: quase preto, neon ciano e
magenta, cantos chanfrados, rótulos em caixa alta. `design/00-direcao-visual.md`
e `design/01-tokens.md` foram reescritos para casar com o código — o segundo
agora é gerado a partir do CSS. A regra semântica sobreviveu com outras cores:
ciano é comando, magenta é presença ao vivo e nada mais. Source Serif 4 saiu.

O piso de acessibilidade não cedeu à estética: as cores foram medidas e três
delas ajustadas até passarem em AA sobre as três superfícies, nos dois temas.
A tabela está em `design/01-tokens.md`.

Decidido diferente do prompt: o `Dialog` usa o `<dialog>` nativo em vez do
`FloatingFocusManager`, porque com ele o foco vazava no terceiro Tab. Os
ícones são desenhados à mão em `components/icones.tsx` — instalar a Lucide
inteira para usar nove seria peso morto.

### Fase 4 — concluída

Rail, lista de canais com os quatro estados, painel do elenco, cabeçalho,
painel contextual, menu de servidor, paleta de comandos, atalhos e as três
faixas responsivas. Backend: rotas de canal com `MANAGE_CHANNEL` no servidor e
`GET /users` sem paginação.

25 verificações no navegador e 54 testes de unidade. O elenco sobrevive no
celular como faixa no topo da gaveta.

Três defeitos que só apareceram rodando:
- `getReferenceProps()` do Floating UI **substituía** o `onClick` do gatilho.
  Todo botão com ação própria dentro de Tooltip, Popover ou Menu estava mudo —
  inclusive os de microfone e fone do elenco. Corrigido nos três.
- A alça de arrasto dividia a célula de 20px com o ícone do canal e o espremia
  a poucos pixels. Saiu para fora do fluxo.
- Na gaveta do celular, o elenco herdava uma linha de 48px para 120px de
  conteúdo e cobria o cabeçalho.

Pendia da fase 5 e **foi resolvido nela**: estado de leitura de verdade (o
`withPlaceholderState`, que derivava "não lido" do índice na lista, saiu na
fatia 6), faixa de desconexão, presença em tempo real e a sequência de acender
disparada pelo `READY`.

### Escopo acrescentado em 4 de setembro de 2026

O dono do projeto pediu, a partir de uma referência do Discord, o que o pacote
original não especificava: **escolher microfone, alto-falante e câmera**, medidor
e teste de entrada, perfil de captura, sensibilidade, apertar para falar, e a
câmera na chamada. O pacote citava `camera` no grant do LiveKit e nunca
desenhava a tela.

| Onde entrou | O quê |
|---|---|
| `design/13-dispositivos-e-audio.md` (novo) | listas de dispositivo, ganho, medidor, perfil de entrada, limiar, apertar para falar, sons |
| `design/07-chamada.md` | seção **Câmera** e o 📹 na barra de chamada |
| `design/02-shell-principal.md` | atalhos: de 9 para 27, em cinco grupos, com o que foi recusado e por quê |
| `prompts/fase-05` | foco itinerante na lista e os atalhos de mensagem |
| `prompts/fase-07` | `lib/midia.ts`, `lib/preferencias.ts`, câmera, e 8 critérios de aceite |
| `docs/07-permissoes-do-navegador.md` | por que a lista de dispositivos vem sem rótulo |

**A ordem das fases não mudou.** Quase tudo é da fase 7 e depende do LiveKit; o
que dá para fazer antes é o grupo de teclado, que é da fase 5 porque é a lista
de mensagens que precisa do foco itinerante.

Uma coisa nova de verdade: `lib/midia.ts` é a **única** porta para
`navigator.mediaDevices`. Nenhum componente chama `getUserMedia`,
`enumerateDevices` ou `setSinkId` direto — pela mesma razão que notificação e
atalho global passam por uma camada: o Tauri muda o comportamento embaixo.

### Fixar e guardar são duas coisas

Pedido de 4 de setembro de 2026. **Fixar** já existia no pacote — bit 3
`PIN_MESSAGE`, `messages.pinned_at`, rotas na fatia 1 da fase 5. **Guardar**
(favoritar) não existia.

A confusão entre as duas é o erro que torna uma delas inútil, então a regra
está em `design/04-mensagens.md` numa tabela de seis linhas. O resumo:

- **Fixar é do canal.** Exige permissão, todo mundo vê, limite de 25, muda a
  aparência da mensagem para todos.
- **Guardar é seu.** Sem permissão, sem broadcast, sem limite, atravessa
  canais, e **não muda a aparência da mensagem no histórico** — só o botão da
  barra de ações acende. Uma marca na linha faria a mesma conversa parecer
  diferente para cada pessoa.

`Message.saved` sai sempre do ponto de vista de quem pediu, como o `me` das
reações. **Nunca exponha quem mais guardou** — não há contagem, não há lista.
E `saved_messages.message_id` é `on delete cascade`: guardar é um ponteiro,
não uma cópia, e manter o texto ali seria desfazer o apagar por outro caminho.

O painel de fixadas foi antecipado da fase 9 para a fase 5, porque o botão já
existia no cabeçalho desde a fase 4.

### Markdown sem DOMPurify, de propósito

`design/04-mensagens.md` pedia `marked` + DOMPurify. `markdown.ts` faz outra
coisa: analisa à mão e devolve **nós React**, nunca HTML.

O DOMPurify existe para limpar HTML que se vai injetar. Aqui não se injeta
HTML nenhum, e o React escapa texto por construção — a classe inteira de XSS
por conteúdo de mensagem deixa de existir em vez de ser filtrada. Vale o mesmo
para o realce de sintaxe: `realce.ts` usa `codeToTokens` do Shiki, não
`codeToHtml`, para não precisar de `dangerouslySetInnerHTML`.

**Sobra um vetor, e é o único ponto perigoso do arquivo:** o `href` de um
link. `hrefSeguro` usa lista de permitidos (`http`, `https`, `mailto`), nunca
de proibidos, e sem esquema assume `https`. Há teste para `javascript:`,
`data:` e `vbscript:`.

Se um dia for preciso aceitar HTML de verdade — de um webhook, de uma
importação — aí o DOMPurify volta, e o documento continua certo.

O Shiki entra com **oito linguagens e um tema**, pelo caminho de granularidade
fina e com o motor de JavaScript em vez do WASM. Cada linguagem é um pedaço
próprio, buscado quando alguém escreve o primeiro bloco daquela linguagem: uma
conversa sem código não paga por nada disso.

### Contas de desenvolvimento

```bash
pnpm dev:seed     # alex, bruno, carla, daniel, eva + os quatro canais
pnpm dev:admin    # a conta `admin`, senha curta, para uso à mão
```

Todas as contas do elenco usam `cavalo-bateria-grampo-9`. A `admin` usa
`010623` — **abaixo dos 12 caracteres do `passwordSchema`**, e por isso o
script escreve o hash direto no banco em vez de passar pela rota. A regra
continua valendo em toda porta de entrada real, e os dois scripts recusam
rodar com `NODE_ENV=production`.

O elenco tem cinco lugares no painel. Com a `admin` são seis contas, então uma
fica de fora da faixa — some quem tem o nome mais tarde em ordem. Para não ter
a sexta conta: `DEV_ADMIN_USER=alex pnpm dev:admin`.

**`pnpm migrate down` desfaz TODAS as migrations**, por decisão do aceite da
fase 1. Eu apaguei o banco de desenvolvimento assim em 4 de setembro de 2026,
tentando conferir se a migration 013 era reversível. Agora ele pergunta antes;
para desfazer só a última, `pnpm migrate down 1`.

### Tokens: nomes antigos corrigidos

A troca de direção visual da fase 3 reescreveu `00-direcao-visual.md` e
`01-tokens.md`, mas os outros documentos ficaram citando tokens que não existem
mais. Corrigido em 4 de setembro de 2026, com nota de revisão em cada arquivo:

| citado | virou | onde |
|---|---|---|
| `--ember` | `--live` | 07-chamada, 11-quadro, fase-07, fase-10 |
| `--ember-soft` | `--magenta-wash` | 07-chamada |
| `--ember-wash` | `--mark-wash` | 04-mensagens, fase-05 |
| `--cobalt-wash` | `--cyan-wash` | 04-mensagens |
| `--rust-wash` | `--crimson-wash` | 06-autenticacao, 07-chamada |
| `--slate-abyss` | `--abyss` / `--void` | 04-mensagens, 07-chamada |
| `--slate-mid` | `--mid` | 05-perfil-e-cargos |

`--mark-wash` e `--mark-line` são **tokens novos**, não renomeados: o destaque
de busca era âmbar, e traduzi-lo direto para magenta roubaria a cor reservada à
presença ao vivo. Medido: 11,8 · 11,1 · 9,6 no escuro, 12,7 · 12,0 · 13,9 no
claro.

`design/01-tokens.md` voltou a bater byte a byte com `tokens.css` nos dois
blocos — `--brand-ink` e `--rail-item` faltavam no documento.

Confira com:

```bash
diff <(sed -n '/^:root {/,/^}/p' packages/web/src/styles/tokens.css)      <(sed -n '/^:root {/,/^}/p' design/01-tokens.md)
```

### Fase 5 — concluída

Sete fatias. As duas últimas fecharam buracos que a especificação tinha:

**Anexo servido sem sessão, de propósito.** O access token vive só na memória
do JavaScript, e um `<img src>` não tem como mandá-lo. A chave de 32 bytes
aleatórios é o controle de acesso. O que isso custa está escrito por extenso em
docs/04-seguranca.md, "Servir": quem já teve a URL continua tendo o arquivo.

**SVG não é imagem.** É um formato de imagem que também é um documento com
script. Fica fora da lista do `sniffImagem`, vira `application/octet-stream` e
baixa. O teste sobe um SVG com `<script>` renomeado para `.png` e declarado
como `image/png` — as três mentiras juntas.

**A prévia de link tem guarda de SSRF de seis partes**, e nada disso estava no
contrato antes desta fatia. A parte que se esquece com mais facilidade: conectar
no endereço já conferido, e não no nome, porque entre a nossa consulta de DNS e
a do cliente HTTP existe uma janela de rebind.

**A miniatura da prévia também é nossa.** Deixar o `<img>` apontar para o site
de origem devolveria, pela porta dos fundos, exatamente o vazamento de IP que a
busca no servidor existe para evitar.

**`content` vazio é válido quando há anexo.** Uma foto sem legenda é uma
mensagem inteira. `messageBodySchema` (sem `min(1)`) mais um `refine` de
"sobrou alguma coisa" — não confundir com `messageContentSchema`, que continua
exigindo texto onde texto é obrigatório.

### Fase 6 — concluída

Cinco fatias. O que ficou diferente do pacote, e por quê:

**A hierarquia tem três regras, não duas.** O rascunho pedia "não mexer em
cargo acima do seu" e "não desativar quem está acima". Falta a terceira, e sem
ela as outras não valem nada: **ninguém dá a um cargo permissão que não tem**.
Daí `POST /roles` não aceitar `position` no corpo, e reordenar ser uma chamada
só com a lista inteira.

**`can()` não serve para "cobre este conjunto".** Ela responde "tem alguma
destas", que é o certo para uma permissão por vez. Para conjuntos existe
`abrange()`. Trocar as duas deixaria passar um cargo com `ADMINISTRATOR`
dentro por causa de um bit em comum.

**Três defeitos antigos apareceram ao abrir a primeira tela nova:** nenhum
diálogo fechava com `Escape` (o atalho global do shell comia a tecla), todo
diálogo nascia no canto superior esquerdo (o reset zera o `margin: auto` que o
`<dialog>` usa para centralizar), e `/config/...` era devolvido para a conversa
(o shell redirecionava qualquer caminho sem `slug`). Os três vinham das fases
3 e 4 e ninguém tinha percebido porque não havia nada em `/config` para abrir.

**O StrictMode custou três correções.** Efeito que roda, é limpo e roda de novo
gasta qualquer guarda de "primeira vez" na primeira passagem. Onde havia um ref
assim — recortador de foto, salvamento automático de cargo, geração de convite
— a guarda passou a comparar com o valor de verdade, ou a marcar a passagem
antiga como descartada. Se for escrever `useRef(true)` como guarda, é
provavelmente o erro de novo.

**Link de convite aponta para `/entrar/<código>`**, que é a rota que o
aplicativo tem. Eu tinha escrito `/convite/...`, que caía no redirecionamento
de rota desconhecida — o convite chegava quebrado e nada avisava.

### Fase 7 — concluída

**Fatia 1: infraestrutura.** `livekit.yaml`, `turnserver.conf`, os dois
serviços no compose, o token com escopo de uma sala e a credencial efêmera do
relay. Duas coisas saíram do previsto: `canPublishSources` não aceita mais texto
no SDK 2.18 (é o enum numérico do protocolo; o JWT sai com os nomes em texto
porque o SDK converte), e as portas de mídia tiveram de descer para 40000 em
desenvolvimento — **no Windows a faixa dinâmica começa em 49152**, e publicar
dentro dela colide com o que o sistema já entregou a outro processo, com um erro
que fala em permissão e não explica nada. `network_mode: host` também não serve
no Docker Desktop: o "host" ali é a máquina virtual Linux, e a porta fica
inalcançável sem erro nenhum.

**Fatia 2: a camada de dispositivo.** `lib/midia.ts` e `lib/preferencias.ts`.
`navigator.mediaDevices` não é chamado em lugar nenhum fora de `midia.ts` — a
enumeração, a sondagem de permissão, a cascata e o encerramento das trilhas são
a mesma decisão vista de ângulos diferentes, e espalhá-las é como se acaba com
uma luz de câmera acesa por um painel esquecido aberto.

O grafo tem **dois** `GainNode`: volume, medidor, portão, nessa ordem. O
documento pedia o medidor depois do volume; o portão como segundo nó é
consequência de o limiar ser desenhado sobre o medidor — com um nó só, o medidor
mostraria silêncio sempre que o portão fechasse.

A trilha publicada é a do `MediaStreamAudioDestinationNode` e **nunca é
trocada**: trocar de microfone religa um nó dentro do grafo, sem republicação e
sem a chamada cair.

**Quando o relógio falha, o portão abre.** A decisão de abrir e fechar corre num
temporizador de 33ms, que é o que o navegador estrangula em aba de segundo plano
e o que some quando a máquina suspende. Decidir com o piso de ruído velho pode
deixar alguém mudo falando; perdido o passo, o piso é esquecido e o portão abre.

`lib/preferencias.ts` reconstrói o que leu **campo a campo**, com tipo e faixa.
O efeito colateral que interessa: campo desconhecido não entra. Se um dia alguém
gravar um token ali por engano, ele não volta na leitura seguinte — a regra de
que credencial nenhuma passa por `localStorage` continua inteira.

**Fatia 3: entrar e sair.** `livekit-client` no navegador, com
`iceTransportPolicy: 'relay'` — a linha inteira do requisito de privacidade. O
que sobe é a trilha do nosso grafo de áudio, não uma captura do SDK: é o que faz
o ganho e o portão chegarem aos outros.

Três coisas que o pacote não previa e que só apareceram rodando:

**Com `auto_create: false`, quem cria a sala é o servidor.** É a contrapartida
da configuração, e o sintoma não fala disso: o sinal conecta e o cliente cai com
`requested room does not exist`. `createRoom` entrou na rota do token, depois da
permissão conferida.

**O relay não pode estar em 127.0.0.1, nem em desenvolvimento.** Sem permissão
de microfone o Chrome usa mDNS e o loopback funciona; com a permissão concedida
ele liga os sockets ICE às interfaces reais, e um socket em 192.168.x.x não
alcança o loopback. Não há erro nenhum — nem candidato, nem
`icecandidateerror` —, só dez segundos de espera e "could not establish pc
connection". Daí `TURN_EXTERNAL_IP` no `.env`.

**E o relay precisa alcançar o SFU**, que numa máquina de desenvolvimento tem
endereço privado — exatamente o que a lista `denied-peer-ip` recusa. Daí o
`infra/turnserver.dev.conf`, com uma exceção de um endereço só. Dois testes
comparam os dois arquivos: as mesmas faixas negadas, uma única linha permitida.

**O canal de voz também é canal de mensagens** — pedido do dono do projeto em 4
de setembro de 2026. Clicar conecta e abre a conversa; sair da chamada não fecha
a conversa. A regra que proibia anexo em canal de voz caiu junto: era uma regra
sem motivo depois disso.

**Fatia 4: a grade e a câmera.** Sobreposição sobre a conversa, layout
automático de 1 a 5, borda de quem fala entrando em 120ms e saindo em 400ms, e a
câmera desligada ao entrar — sempre.

**O aviso de fim da trilha vai na trilha do SDK, não na nossa.** `publishTrack`
substitui a trilha recebida pela sua e encerra a original, então um `ended` na
nossa dispara no instante seguinte à publicação: a câmera acendia e se apagava
sozinha. E, como `stopLocalTrackOnUnpublish` está desligado por causa do áudio,
despublicar não apaga a luz — é preciso parar a trilha do SDK à mão. Luz acesa é
o contrato de que alguém está sendo filmado.

**A câmera falsa do Chrome não serve para testar imagem** nesta máquina: a
trilha morre sozinha ~150ms depois de abrir, em qualquer combinação de flags. O
teste verifica a recuperação, que é o caso real de quem perde a câmera para
outro programa no meio da chamada.

**Fatia 5: compartilhar tela.** Seis presets por finalidade, simulcast em três
camadas, e **assistir é opcional** — `autoSubscribe: false` na conexão, com voz
e câmera assinadas na hora e a tela só quando alguém clica. Enquanto ninguém
clica, o servidor não envia um byte daquela transmissão.

**A linha "rede limitando" passou a ouvir o codificador.** A primeira versão
comparava o bitrate real com o alvo do preset e acusava rede apertada sempre que
a tela estava parada — que é justamente quando está tudo certo. Agora quem
responde é o `qualityLimitationReason`.

**Ajustes pedidos pelo dono do projeto em 4 de setembro de 2026**, depois de ver
rodando:

- A chamada **divide** a coluna da conversa em vez de cobri-la, com três modos:
  só a chamada, as duas, só a conversa. A escolha fica guardada — menos
  "só a conversa", que é "esconda agora" e não um layout; guardá-la fazia o
  botão de reabrir não reabrir nada.
- **Cada tela transmitida é uma caixa própria**, ao lado das pessoas. Clicar
  põe aquela tela em primeiro plano.
- A divisa entre a chamada e a conversa é **arrastável**, com as setas do
  teclado também. O arrasto guardava `event.currentTarget` numa closure e o
  React o zera quando o handler retorna: o `pointerup` explodia e o arrasto
  ficava grudado no cursor.
- Espaçamentos: `align-content: safe center` na grade — com o centro normal, o
  que não cabe é cortado **no começo**, e a primeira fileira some sem aviso.

**Um `> *` mais específico que uma classe.** A alça do divisor caía na coluna da
conversa porque `.conversa[data-chamada='ambos'] > *` vence `.divisor`; o
resultado era o cabeçalho e o histórico jogados em linhas implícitas, a chamada
com um terço da altura e o resto da coluna preto.

**Fatia 6: a janela flutuante, o elenco no rail e as proporções.** Tudo pedido
pelo dono do projeto em 4 de setembro de 2026, depois de usar.

A **janela flutuante** aparece quando a chamada sai da tela, é arrastável e
redimensionável, guarda posição e tamanho, e deixa **escolher quem aparece** —
que é o que a separa de uma miniatura que decide sozinha. `setPointerCapture` na
barra de arrasto rouba os eventos seguintes: sem excluir os botões da alça, o
menu de escolha nunca abria.

O **elenco foi para o rail**, na vertical. Fica visível em qualquer largura e
para de disputar altura com a lista de canais. No rodapé ficou só o seu canto.
O anel de estado precisou de uma variável para o sulco: ele é da cor da
superfície de trás, e o rail não é `--bg-live`.

**A barra de chamada estourava a coluna:** cinco ícones e o "Sair" somam mais de
232px, e um filho de grade sem `min-width: 0` empurra a coluna em vez de
encolher. O indicador de qualidade saía pela borda.

**Fatia 7: tela cheia, zoom, janela do sistema e apontador — fecha a fase 7.**

**`Escape` tem ordem de precedência**, e ela é a de desfazer o último passo:
tela cheia, tela em primeiro plano, sala, gaveta, painel. A tela cheia chega ao
`keydown` — o navegador entrega a tecla e só depois sai do modo —, então a
checagem é `document.fullscreenElement` no instante da tecla. Sem isso, um único
`Esc` saía da tela cheia e fechava a tela em foco junto.

**Em tela cheia, a barra de controles não existe:** ela ficou fora do elemento
que foi para a tela cheia. O botão de sair passou a viver dentro do palco.

O zoom não exige tela cheia — o palco não rola nada, então a roda ali só pode
querer dizer zoom —, e a imagem fica presa ao quadro: arrastar não pode deixar
faixa preta onde havia tela.

O apontador vai por mensagem de dados **não confiável**, em posição relativa de
0 a 1: é um gesto que some em 2s, não precisa chegar duas vezes, e tem de cair
no mesmo lugar da imagem em qualquer tamanho de janela.

### Fase 8 — em andamento

**Fatia 1: faxina, saúde e métricas.**

Quatro coisas crescem para sempre se ninguém as varrer: anexo que ninguém
enviou, `client_nonce` que já cumpriu as 24h de deduplicação, token de
atualização vencido há mais de 30 dias e auditoria com mais de 180. Cada uma é
uma função sozinha — testável sem esperar uma hora —, e a volta isola as falhas:
a tarefa que quebra não impede as outras.

**Sem `node-cron`.** O intervalo é de uma hora e não há regra de calendário; uma
dependência para dizer "de hora em hora" é mais uma coisa para atualizar e
auditar. A primeira volta sai depois do primeiro intervalo, não na subida —
reiniciar a API dez vezes não deve disparar dez faxinas.

**A saúde toca banco e storage** e responde **503** quando algo falha; um health
check que só devolve 200 mede se o Node está vivo, e o Node vive muito bem com o
banco fora do ar. Storage não configurado é `null`, e isso **não** derruba a
saúde: servidor sem anexos é uma escolha, servidor com anexos e MinIO caído é um
problema.

**`/metrics` é protegida por token**, comparado em tempo constante, e sem
`METRICS_TOKEN` não serve nada — métrica aberta conta quantas pessoas estão
conectadas e quando o servidor está ocupado. Nenhum rótulo identifica ninguém: a
rota vira o **padrão** (`/api/channels/:id/messages`), nunca a URL com id, senão
cada canal viraria uma série temporal e daí cada pessoa.

**Fatia 2: cabeçalhos, implantação e backup restaurado.**

**A CSP encontrou o primeiro defeito antes de subir:** o `index.html` carimbava
o tema num `<script>` inline, e `script-src 'self'` recusa isso. A correção foi
mover o bloco para `/tema.js` — corrigir o código, não relaxar a política, que é
a regra do prompt e é o ponto inteiro de ter CSP.

A política vive em `infra/cabecalhos.caddy`, **importada pelo Caddy e lida pelo
teste**: o roteiro serve o `dist` com exatamente aqueles cabeçalhos e falha se
houver uma violação sequer. Política e verificação saem da mesma fonte, senão
uma envelhece sem a outra.

`style-src` mantém `unsafe-inline` porque atributo `style` em elemento é estilo
inline, e a interface usa isso para posição de janela flutuante, largura de
coluna e transform de zoom. É a concessão que o documento já previa, e ela não
executa nada.

**O backup foi restaurado de verdade**, não descrito: dump de 104 KB com 8
pessoas, 4 canais e 267 mensagens, restaurado em **1 segundo** (2,2s com o banco
sendo derrubado e recriado). O número está em `docs/08-operacao.md`, junto com o
que muda numa base de um ano.

`scripts/enviar-backup.mjs` mora em `packages/api/scripts/` e não na raiz: num
monorepo pnpm, um script na raiz não enxerga o `node_modules` de um pacote — e o
erro só aparece na primeira vez que o backup roda, que é o pior momento.

O `implantar.sh` faz backup, migrations com a versão antiga no ar, troca a
imagem e **reverte sozinho** se a saúde não vier em 60s. As migrations não são
desfeitas na reversão: elas são aditivas, e desfazer migration com dado em cima
é como se perde dado.

### Numeração das migrations

O pacote previa 001 a 010 e reservava `011_polls` (fase 9), `012_conversations`
e `013_boards` (fase 10). Duas migrations não previstas entraram no caminho:

| aplicada | por quê |
|---|---|
| `011_recovery_codes` | o modelo de dados não previu onde guardar os códigos que `docs/04-seguranca.md` exige |
| `012_busca_sem_acento` | `to_tsvector('portuguese', …)` não remove acento, e o aceite pede que "migracao" ache "migração" |
| `013_saved_messages` | favoritar mensagem não existia no pacote; pedido do dono do projeto em 4 de setembro de 2026 |
| `014_anexos_pendentes` | a 008 declarou `attachments.message_id not null`, e o upload começa **antes** da mensagem existir; faltavam também `uploader_id` e `channel_id` |
| `015_ordem_dos_anexos` | sem `sort_order` a grade saía na ordem em que os uploads terminaram, não na que a pessoa escolheu |
| `016_avatar_blurhash` | a 002 guardou `avatar_key` e mais nada; a fase 6 pede a mancha de cor enquanto a foto carrega |

**As migrations das fases 9 e 10 andam seis números:** `polls` vira **017**,
`conversations` **018** e `boards` **019**. Migration aplicada não se edita; se
algo estiver errado, crie a próxima.
