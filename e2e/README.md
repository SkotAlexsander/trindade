# Testes de navegador

Roteiros que percorrem os testes à mão do `COMECE-AQUI.md` num Chrome de
verdade, em vez de você repetir tudo com a mão a cada fase.

Não fazem parte do build nem do `pnpm test` — são uma ferramenta de conferência.
Estão em Python porque o Playwright já roda assim aqui e não exigem acrescentar
mais nada ao monorepo.

## Rodar

Uma vez:

```bash
python -m pip install playwright requests pillow
```

`requests` e `pillow` são da fatia de anexos: o Pillow gera a foto de teste
**com EXIF de GPS dentro**, que é o que prova que o re-encode do servidor apaga
o metadado.

Usa o Chrome já instalado (`channel='chrome'`), sem baixar navegador.

O elenco de desenvolvimento sai de um comando, e **todas as contas usam a mesma
senha**, `cavalo-bateria-grampo-9`:

```bash
pnpm dev:seed     # alex, bruno, carla, daniel, eva + os quatro canais
pnpm dev:admin    # a conta `admin`, com uma senha curta para uso à mão
```

`pnpm dev:seed` é também o conserto de `pnpm migrate down`, que desfaz **todas**
as migrations e apaga o banco inteiro. Para desfazer só a última:
`pnpm migrate down 1`.

Com o `docker compose up -d` e o `pnpm dev` no ar:

```bash
python e2e/fase-02-autenticacao.py .capturas
python e2e/fase-02-dois-fatores.py .capturas
```

As capturas de tela vão para a pasta passada como argumento.

## O que cada um cobre

**`fase-02-autenticacao.py`** — 23 verificações: prévia de convite, convite
inválido e já usado, medidor de senha, registro sem login automático, erro de
credencial que não distingue usuário de senha, cookie `rt` com `HttpOnly` e
`Path` restrito, ausência de token em `localStorage`, sessão sobrevivendo ao
recarregar, renovação pelo cookie, reuso de token derrubando a sessão, `Tab`,
`Enter`, e nenhuma requisição a domínio externo.

**`fase-02-dois-fatores.py`** — 12 verificações: ativação do 2FA, as seis caixas
(foco inicial, avanço ao digitar, backspace voltando, setas, envio automático no
sexto dígito, balanço e limpeza no erro), código de recuperação de uso único, e o
anel de foco envolvendo o campo inteiro.

**`fase-03-design-system.py`** — 18 verificações dos primitivos e dos dois temas.

**`fase-04-shell.py`** — 25 verificações do shell: colunas, elenco, atalhos,
painel contextual e as três faixas responsivas.

**`fase-05-mensagens.py`** — 30 verificações da conversa, com duas janelas
abertas ao mesmo tempo: envio otimista, agrupamento, ritmo de 2px e 12px,
divisor de dia grudado sem sobrepor o do dia seguinte, as regras de rolagem
(colar no fim, não mover quem está lendo, compensar a prepend), editar pelo `↑`,
`Shift Enter`, indicador de digitação, faixa de desconexão, fila de quem
escreveu fora do ar e recuperação do que passou.

Antes de rodar, semeie o histórico — sem isso a paginação não tem o que paginar
e três verificações passam sem exercitar nada:

```bash
docker compose exec -T postgres psql -U trindade -d trindade < e2e/semear-historico.sql
```

O roteiro fala com `#geral` explicitamente, que é o canal semeado.

O mesmo arquivo deixa uma **menção pendente em `#bugs`** para cada pessoa, e
zera o `last_read_message_id` desse canal. É do que `fase-04-shell.py` precisa
para conferir a pílula com contador — e as duas coisas juntas, porque semear só
a mensagem não basta: quem já abriu `#bugs` numa corrida anterior continua com
o canal lido, e a mensagem semeada é mais velha que a última lida.

**Rode o seed logo antes de `fase-04-shell.py`.** Qualquer roteiro que abra
`#bugs` consome a menção, e essa verificação passa a falhar até semear de novo.

**`fase-05-upload-api.py`** — 37 verificações **sem navegador**, direto na API.
O que está em jogo aqui não é interface: é o que o servidor faz com um arquivo
e com uma URL que outra pessoa escolheu. Confere que o JPEG vira WebP, que o
EXIF de GPS some, que a orientação foi aplicada antes de ser descartada, que a
chave da URL não carrega o nome do arquivo, que o SVG disfarçado de PNG baixa
em vez de renderizar, e que a prévia de link recusa `127.0.0.1`, `localhost`,
`169.254.169.254`, `[::1]`, as portas do Postgres e do MinIO, e `file://`.

**`fase-05-anexos.py`** — 31 verificações no navegador: o upload que começa ao
anexar (o arquivo sobe sozinho, sem ninguém apertar Enter), a faixa de
pendentes, foto sem legenda como mensagem inteira, a grade de duas imagens na
ordem em que foram escolhidas, a lightbox com setas, o arquivo comum como linha
de download, e o cartão de link com a miniatura vinda do nosso domínio.

Precisa de internet: uma verificação busca a prévia de `https://example.com/`.

**`fase-06-perfil.py`** — 32 verificações do diálogo de editar perfil: 560px e
centralizado, nome de usuário como texto e não campo desabilitado, contador de
caracteres só a partir de 80%, Salvar desligado sem alteração, `Escape` com
alteração pendente perguntando antes, o recortador quadrado, e a foto que sobe
com EXIF e volta em WebP sem metadado nenhum. Mais a aba de segurança: sessões
sem IP — o roteiro procura por qualquer coisa com cara de endereço e falha se
achar — e os três passos de ativar o segundo fator.

**`fase-06-pessoas.py`** — 27 verificações de pessoas e convites: o menu de
ações que some na sua própria linha (o servidor recusa mexer na própria conta),
a confirmação de desativar que exige o nome digitado e explica a consequência
real, a conta desativada que deixa de entrar, e o convite gerado ao abrir o
diálogo. A verificação que mais vale: o roteiro **abre o link** numa janela
anônima — ele apontava para uma rota que não existe e caía no redirecionamento
de rota desconhecida.

**`fase-06-cargos.py`** — 21 verificações da página de cargos: a lista ordenada
pela hierarquia, permissões em português e agrupadas por área, `ADMINISTRATOR`
separado no fim com o aviso literal, o salvamento automático que **não** dispara
antes dos 800ms nem ao abrir a página, e o cargo novo nascendo abaixo de quem o
criou. Fecha checando a mesma regra pelos dois lados: a página recusa quem não
tem `MANAGE_ROLES`, e a rota recusa a mesma pessoa direto na API.

Precisa da conta `admin` (`pnpm dev:admin`).

**`fase-06-cartao.py`** — 17 verificações do cartão de perfil: que ele **não**
abre antes dos 400ms, que não fecha na hora em que o mouse sai (o atraso de
300ms é o assunto principal — sem ele, atravessar a borda fecha o cartão na
cara de quem ia clicar), a faixa de 56px que não pode ser da cor do cartão, o
contraste de todo chip de cargo acima de 4.5:1, e o menu do servidor sem os
itens que a pessoa não pode usar — escondidos, nunca esmaecidos.

O `pnpm dev:seed` dá ao cargo `Admin` um azul-marinho de propósito: é escuro
demais para o tema escuro, e sem uma cor difícil no banco o ajuste de contraste
nunca é exercitado por ninguém olhando a tela.

**`fase-07-dispositivos.py`** — 12 verificações da camada de dispositivo, e a
única da suíte que não olha a interface: importa `src/lib/midia.ts` pelo próprio
servidor do Vite e exercita o grafo de áudio dentro do Chrome. Cobre a lista sem
rótulo antes da permissão, a trilha de sondagem que fecha logo depois de abrir,
o medidor respondendo ao ganho, o portão abrindo com sinal, e a que importa: que
**trocar de microfone mantém a mesma trilha publicada**, que é o motivo de a
chamada não cair na troca.

Sobe o Chrome com `--use-fake-device-for-media-stream` e **sem**
`--use-fake-ui-for-media-stream`. A diferença não é detalhe: com a interface
falsa o Chrome se comporta como já autorizado desde o primeiro
`enumerateDevices`, e o estado "ainda sem rótulo" — metade do que essa camada
trata — deixa de existir no teste. A permissão é concedida no meio do roteiro,
por `context.grant_permissions`, depois de a primeira leitura já ter acontecido.

O dispositivo falso emite um bipe curto e periódico, e a cadeia mede em janelas
de ~21ms. Uma janela que pegue meio bipe dá um RMS menor, então comparar dois
níveis exige ler **mais denso que o tique interno de 33ms** — a 100ms, dois
terços das medições passam batido e o pico vira sorteio: a mesma verificação
passava com +5,9 dB e falhava com +4,0 dB sem nada ter mudado no código.

**`fase-07-chamada.py`** — 21 verificações com **duas pessoas numa chamada de
verdade**, contra o LiveKit e o coturn do compose. A que dá nome à fase é a dos
candidatos: a página é aberta com um espião sobre `RTCPeerConnection`, e o teste
lê `getStats()` de cada conexão. Nenhum candidato local pode ser `host` nem
`srflx`, e todo endereço tem de ser do relay — é o `chrome://webrtc-internals`
do aceite, lido por programa.

`prflx` aparece e é aceito: não é um endereço local, é o endereço **como o outro
lado o viu**, e com a política de relay o outro lado só vê o relay. Por isso a
verificação seguinte compara endereços, não rótulos.

Cobre também a borda de 2px da barra (a única saturada da interface, e o tipo de
coisa que some num ajuste de CSS sem ninguém notar), o ícone de microfone
ganhando um traço ao fechar — a barra diagonal, que é o que cobre daltonismo —,
ensurdecer calando junto, a conversa do canal de voz e a saída aparecendo do
outro lado.

**`fase-07-grade.py`** — 18 verificações da grade de participantes. Que ela
**sobrepõe** a conversa em vez de trocar de tela (a URL não muda e o compositor
continua montado atrás), que entrar numa chamada de voz não liga vídeo nenhum,
que o cartão de quem está sem câmera é o avatar e não um retângulo preto, que
dois participantes ficam lado a lado em 16:9, e que `Escape` fecha a grade sem
sair da chamada.

### A câmera falsa do Chrome encerra a trilha sozinha

Nesta máquina, `--use-fake-device-for-media-stream` dá um microfone que funciona
e uma câmera que morre: a trilha de vídeo vai a `ended` cerca de 150ms depois de
abrir. Testado com e sem janela, com `--use-fake-ui-for-media-stream`, e com o
headless antigo — em todos, o mesmo.

Isso tira do teste a verificação da imagem, e por um tempo pareceu defeito
nosso: a interface acendia a câmera e a apagava sozinha, com o toast de "a
câmera parou" por cima. O que ficou no lugar é melhor do que nada — a
verificação de que a interface **se recupera** de uma trilha que morre, que é
exatamente o caso de quem tem a câmera tomada por outro programa no meio da
chamada.

Ao investigar isso apareceu um defeito de verdade, esse nosso: o aviso de fim
estava na trilha que abrimos, e `publishTrack` a substitui pela sua. O aviso
agora vai na trilha do SDK.

### Participante fantasma na sala

O LiveKit mantém quem não se despediu direito até o tempo limite, e um roteiro
interrompido no meio deixa esse rastro — a grade abre com três cartões onde
deviam estar dois. Reiniciar o SFU limpa tudo, porque as salas vivem em memória:

```bash
docker compose restart livekit
```

**`fase-07-tela.py`** — 26 verificações do compartilhamento de tela. A que dá
nome à fatia: **quem não clicou em "Assistir" não recebe pacote nenhum**, lido
em `getStats` (`inbound-rtp` de vídeo em zero) e não na interface. Cobre também
o diálogo de presets, a caixa própria da tela ao lado das pessoas, o clique que
põe uma tela em primeiro plano, o contador de espectadores, o seletor de
qualidade do espectador e os três modos da sala.

Neste Chrome headless o `getDisplayMedia` **nunca resolve** — não há tela, o
seletor não abre e nem `--auto-select-desktop-capture-source` acha uma fonte; a
promessa fica pendurada para sempre. O roteiro troca só essa função por uma que
devolve um `<canvas>` animado. Todo o resto é o caminho de verdade: publicação
como fonte de tela, assinatura por escolha, contagem de bytes, foco e contador.
O que fica de fora é escolher a janela, que é coisa de olhar.

**`fase-07-flutuante.py`** — 16 verificações da janela flutuante: que ela
aparece quando a chamada sai da tela, continua em outro canal, obedece ao
arrasto e ao canto de redimensionar, guarda posição e tamanho, deixa escolher
quem aparece, e some ao voltar para a sala.

O defeito que ela pegou de primeira: `setPointerCapture` na barra de arrasto
rouba os eventos seguintes, e o clique nunca chega aos botões que moram nela — o
menu de "quem aparece" simplesmente não abria. Botão dentro da alça não arrasta.

**`fase-07-foco.py`** — 18 verificações do que fecha a fase: zoom até 3x
centrado no cursor, imagem presa ao quadro ao arrastar, duplo clique voltando ao
ajuste, tela cheia com saída própria, a janela do sistema detectada por
capacidade, e o apontador de `Alt` + clique chegando na tela de quem transmite —
em posição relativa, para cair no mesmo lugar em qualquer tamanho de janela.

Sair da tela cheia com `Esc` é do navegador, e o headless não faz isso com tecla
sintética; o que o roteiro verifica é o que é nosso — que a mesma tecla não
fecha a tela em primeiro plano por baixo.

**`fase-08-csp.py`** — 11 verificações da política de segurança, com o front
**construído** e servido com os cabeçalhos de produção. O roteiro **lê a política
do `infra/cabecalhos.caddy`**, o mesmo arquivo que o Caddy importa: se alguém a
relaxar, o teste passa a testar a política relaxada e o diff mostra; se alguém
puser um script inline no código, o teste falha.

    pnpm --filter @trindade/web build
    python e2e/fase-08-csp.py .capturas

Sobe um servidor estático próprio na 4179, com os cabeçalhos, e passa `/api`
adiante para a API de desenvolvimento — assim dá para entrar e carregar a
aplicação inteira sob a política. O WebSocket não é encaminhado; a faixa de
"reconectando" aparecendo é esperado e não é violação.

Duas coisas que o navegador não deixa verificar por ali: **HSTS** é descartado
em origem HTTP (fica conferido no arquivo), e `connect-src` ganha a origem do
servidor de teste — em produção a aplicação e a API dividem o domínio e `'self'`
basta.

O primeiro defeito que ele pegou foi nosso: o `index.html` carimbava o tema com
um `<script>` inline, que `script-src 'self'` recusa. A correção foi mover o
bloco para `/tema.js` — corrigir o código, não relaxar a política.

**`fase-09-notas.py`** — 12 verificações das notas colaborativas, com dois
navegadores no mesmo documento: o que um escreve aparece no outro, as duas
edições sobrevivem, os documentos convergem, o cursor de quem está junto
aparece, fechar a aba no meio da edição não perde nada, e "adicionar às notas"
leva a mensagem com autor e link de volta.

**Fixe o canal.** Cada pessoa cai no seu primeiro não lido, e a nota é por
canal: sem `goto('/c/geral')` o roteiro compara documentos diferentes e conclui
que a sincronia está quebrada. Foi o que aconteceu na primeira corrida — e o
sintoma parecia defeito do Yjs.

O rótulo do cursor entra no `innerText` do editor. Para comparar os dois lados,
o roteiro clona o nó e remove os cursores antes de ler o texto.

**`fase-09-tarefas.py`** — 14 verificações do quadro, também com dois
navegadores: a tarefa criada aparece no quadro do outro sem recarregar nada,
"criar tarefa" leva **a primeira linha** da mensagem (e não o resto), a mensagem
passa a dizer "Virou tarefa · coluna" e esse rodapé abre o quadro, arrastar muda
a coluna dos dois lados, concluir deixa uma linha de sistema no canal sem avatar
nem barra de ações, e o cartão volta para a mensagem que o originou.

**Arrastar precisa de passos de mouse.** O `dnd-kit` só ativa depois de 6px e só
com eventos de ponteiro reais; um `drag_to` direto não move nada. O roteiro
interpola dez posições entre a origem e o destino.

**Não compare texto de interface sem normalizar a caixa.** O cabeçalho da coluna
é caixa alta por CSS, então `innerText` devolve `"FAZENDO"` — foi isso que fez a
primeira corrida acusar um arrasto que tinha funcionado. E o clique que expande
"Feito" passou a ser feito por `aria-expanded`: depois que a mensagem ganhou o
rodapé "Virou tarefa · Feito", `button` com texto "Feito" passou a acertar a
mensagem em vez da coluna.

**`fase-09-enquetes.py`** — 11 verificações das enquetes, com dois navegadores:
`/enquete` abre o formulário, a enquete chega no canal do outro sem recarregar,
o voto de um move a barra do outro, trocar de opção não conta duas pessoas,
encerrar tira a interação para todo mundo, e "adicionar o resultado às notas"
grava a decisão na nota do canal.

A verificação que importa é a da enquete anônima: o roteiro confere que o nome
de quem votou **não aparece** na tela de quem perguntou. A garantia de verdade
está no teste de API, que olha a resposta crua — na tela só se vê o que foi
desenhado, e o que vaza vaza no JSON.

**`fase-09-avisos.py`** — 9 verificações das notificações. As regras já estão
testadas como função pura em `packages/web/test/notificacoes.test.ts`; o que
este roteiro prova é que elas chegam à tela: contador no título, contador no
canal, o sino cortado, e a regra que mais importa — **canal silenciado deixa
passar menção direta**.

Os dois usuários vêm por argumento (`... eva bruno`) justamente por causa do
limite de login: depurar o roteiro esgota a cota de um par, e trocar de par é
mais honesto que desligar a proteção nos testes.

Ele começa desfazendo o silêncio do canal. O silêncio fica no banco, e a
segunda corrida encontraria o botão chamado "Canal silenciado" em vez de
"Silenciar canal" — roteiro que assume estado limpo quebra na segunda vez.

**Navegue clicando, não com `goto`.** Cada carregamento de página gasta um
`POST /auth/refresh`, que tem limite de 30 por hora e por IP. Um roteiro que
troca de canal com `goto` seis vezes esgota a cota em poucas corridas e depois
cai na tela de entrar — o que parece sessão quebrada e é a proteção
funcionando. Clicar no link da barra lateral também é o que a pessoa faz.

**O login tem limite de 5 por 15 minutos por IP.** Rodar os roteiros em sequência
esgota a cota e o próximo falha em `wait_for_url` — o que parece defeito da
aplicação é a proteção funcionando. Espere a janela ou reinicie a API, que
guarda a contagem em memória.

**`fase-10-conversas.py`** — 11 verificações das conversas privadas, com três
navegadores: abrir a direta pelo cartão de perfil, a lista mostrar a conversa
só depois da primeira mensagem, o outro receber como menção, **uma terceira
pessoa não ver nada**, e abrir a mesma direta de novo não criar uma segunda.

A prova de que o administrador não passa está no teste de API, que olha a
resposta crua — na tela só se vê o que foi desenhado, e o que vaza vaza no JSON.

**"Este é o começo da conversa" não é o estado vazio.** Ela aparece quando há
mensagens e não há mais antigas; o vazio de verdade diz "Nenhuma mensagem
ainda". Trocar os dois fez o roteiro acusar uma regra que estava certa.

**`fase-10-quadro.py`** — 15 verificações do quadro branco, com dois
navegadores: criar e abrir em tela cheia, desenhar, o outro receber o desenho
inteiro ao abrir depois, os dois desenhando sem perder traço, dois quadros do
mesmo canal não se misturarem, e a miniatura aparecer na lista ao fechar.

```bash
python e2e/fase-10-quadro.py e2e/.tmp/quadro carla daniel
```

**Duas contagens, e elas medem coisas diferentes.** `data-elementos` na tela
cheia é a contagem **do servidor** — prova que o traço chegou. A contagem de
pixels do canvas (`tinta()`) prova que ele foi **desenhado**. A primeira versão
só olhava a primeira, e passou verde enquanto o retângulo aparecia como um ponto
do outro lado.

**O atalho da ferramenta precisa de foco no canvas**, e o clique que dá foco não
pode cair no canto superior esquerdo: ali mora o menu do Excalidraw, e o
Playwright acusa "subtree intercepts pointer events".

**O botão do painel alterna.** O painel de quadros continua aberto atrás da tela
cheia, então voltar de um quadro e clicar "Quadros" de novo o **fecha**.

**O quadro não entra em `fase-08-csp.py`**, e a razão é do roteiro: aquele
servidor de teste não faz upgrade para WebSocket, e sem gateway o quadro nunca
recebe o `BOARD_STATE` que o faz montar. Quem confere o quadro sob as mesmas
origens é este roteiro, com a API de verdade. O mesmo vale para qualquer coisa
que dependa do gateway — notas, presença, digitando.

**`fase-10-apresentacao.py`** — 15 verificações do modo apresentação, com dois
navegadores: a borda ao vivo dos dois lados, as ferramentas sumindo para quem
assiste, o espectador seguindo o zoom, soltar sem interromper, voltar a seguir,
a linha de sistema clicável, a linha indentada na lista de canais, a caneta
passada pelo avatar, e o encerramento.

```bash
python e2e/fase-10-apresentacao.py e2e/.tmp/apresentacao carla daniel
```

**`fase-10-quadro-na-chamada.py`** — 8 verificações do encontro entre as duas
telas: entrar na chamada, abrir o quadro por dentro dela, a chamada virar janela
flutuante **por cima** do quadro (com `z-index` comparado de verdade), desenhar
com a chamada de pé, e voltar pelo mesmo botão. Precisa das flags de mídia
falsa, como os roteiros da fase 7.

**O quadro é do canal, e a chamada também.** O botão "Ir para o quadro" só
aparece quando o canal **da chamada** tem quadro — criar um em `#geral` e
esperá-lo no canal de voz `sala` é o erro que este roteiro cometeu primeiro.

**`fase-10-imagem-no-quadro.py`** — 5 verificações da imagem dentro do quadro:
colar insere, o outro lado recebe **desenhado** (contagem de pixels do canvas),
e a imagem volta servida pelo nosso storage já como WebP — a prova de que os
bytes passaram pelo `sharp` e não pelo CRDT.

**O seletor de arquivos do sistema não entra aqui.** Colar cai no mesmo caminho
do Excalidraw e é estável; `expect_file_chooser` em cima da ferramenta de imagem
não dispara neste fluxo.

**`fase-10-mencao-de-todos.py`** — 5 verificações do `@todos`: a sugestão vem
na frente das pessoas, a menção sai destacada, e quem **não** escreveu recebe o
chamado no título.

**Quem recebe precisa estar em outro canal.** Com o canal aberto e a janela à
frente, a regra de notificação não marca nada — e é o certo, porque a pessoa
está lendo. O roteiro erra sozinho se esquecer disso.

## Carga: 50 conexões no gateway

Dez vezes o uso real. O objetivo não é provar que aguenta — é saber onde quebra,
porque um número que ninguém mediu é um número que se descobre num sábado.

O k6 vem em contêiner; nada para instalar. A API precisa estar escutando fora do
loopback para o contêiner alcançá-la:

```bash
# .env: API_HOST=0.0.0.0 enquanto durar o teste
node e2e/tokens-de-carga.mjs > /tmp/tokens.txt
docker run --rm -i -e ALVO=ws://host.docker.internal:3000   -e TOKENS="$(cat /tmp/tokens.txt)"   --add-host=host.docker.internal:host-gateway   grafana/k6:latest run - < e2e/carga-websocket.js
```

**Medido em 4 de setembro de 2026:** 50 conexões, nenhuma recusada, READY em
144ms de mediana e 164ms no p95, 2.500 mensagens entregues (50 escritas × 50
destinos) e a API em 130 MB de memória residente ao final, saudável. Os tokens
saem das contas do elenco, em rodízio — várias sessões da mesma pessoa é o pior
caso para o mapa do gateway.

O limite de login é 5 por 15 minutos por conta: numa segunda corrida seguida os
tokens vêm em falta, e aí é `touch packages/api/src/app.ts` para zerar o
contador.

### O relay não pode estar em 127.0.0.1

Custou uma tarde. Enquanto a página **não** tem permissão de microfone, o Chrome
usa nomes mDNS e um TURN em `127.0.0.1` funciona. No instante em que a permissão
é concedida — por `context.grant_permissions` ou pela interface —, ele passa a
ligar os sockets ICE às interfaces reais, e um socket ligado a `192.168.x.x` não
alcança o loopback. A alocação não acontece, e **em silêncio**: nenhum candidato
`relay`, nenhum `icecandidateerror`, o `iceGatheringState` parado em `gathering`
até o SDK desistir com "could not establish pc connection".

Por isso o `.env` tem `TURN_EXTERNAL_IP` com o endereço da máquina na rede local,
e o compose publica o coturn nele. Ver `docs/06-realtime-e-webrtc.md`.

O sintoma engana de outra forma ainda: com `auto_create: false` no SFU, o
primeiro erro é `requested room does not exist` — a sala é criada pelo servidor
na rota que emite o token, e não pelo cliente.

### Se o Vite servir 404 num módulo que existe

Renomear um arquivo deixa o grafo de módulos do Vite apontando para o nome
velho, e nem recarregar nem `touch` no importador resolvem — a aresta velha
está na memória do servidor. O jeito limpo é fazer o Vite se reiniciar sozinho:

```bash
touch packages/web/vite.config.ts
```

### Derrubar a conexão de verdade

Duas maneiras óbvias não funcionam, e as duas custaram uma corrida inteira para
descobrir:

- **`context.set_offline(True)`** bloqueia HTTP e conexões novas, mas **não
  fecha o WebSocket já aberto**. A suíte inteira passa sem nunca ter caído.
- **`route_web_socket`** trava a API síncrona do Playwright: cada quadro do
  socket volta pelo driver, e se isso coincidir com um `evaluate` bloqueante o
  roteiro fica pendurado para sempre.

O que funciona é as duas coisas juntas: `set_offline(True)` para impedir a
reconexão, e `touch packages/api/src/app.ts` para o `tsx watch` reiniciar a API
e fechar o socket. Reiniciar sozinho às vezes volta rápido demais para a faixa
de 2s aparecer — e um teste que passa ou falha conforme a velocidade do watcher
não testa nada.

As regras de **tempo** da reconexão — backoff, jitter, teto, fila — não estão
aqui. Estão em `packages/web/test/ws.test.ts`, contra um servidor WebSocket de
verdade em Node, onde o relógio é nosso.

Cada roteiro cria um usuário novo a cada corrida. Isso não é capricho: a chave do
rate limit do login inclui o nome do usuário, e reaproveitar a mesma conta faz a
segunda execução travar em 429.

## Não rode a suíte da API junto com os roteiros

As duas usam **o mesmo banco**, e os testes da API chamam `resetDatabase()`
entre blocos. Rodar `pnpm test` e um roteiro do Playwright ao mesmo tempo faz os
dois falharem em lugares que não têm nada a ver com o que quebrou — e, pior, com
falhas diferentes a cada corrida.

Aconteceu aqui: seis testes da API falharam numa corrida em segundo plano
enquanto um roteiro do navegador semeava o histórico. Repetidos sozinhos,
passaram os 148.

## Se a suíte travar em "Timeout ... waiting for navigation"

Quase sempre é o rate limit do login: cinco tentativas por 15 minutos por
usuário, e cada corrida gasta uma. Rodar a suíte várias vezes seguidas esgota.

Não é bug — é o controle funcionando. O contador vive na memória do processo da
API, então reiniciar zera:

```bash
touch packages/api/src/app.ts   # o tsx watch reinicia sozinho
```

Os roteiros da fase 4 em diante reaproveitam o cookie `rt` entre janelas em vez
de logar de novo, justamente para gastar o mínimo. Cada retomada rotaciona o
token, então o estado tem de ser encadeado: reapresentar o anterior é o que a
detecção de reuso derruba.
