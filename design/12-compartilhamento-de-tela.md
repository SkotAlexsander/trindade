# Compartilhamento de tela em alta resolução

Substitui a seção de tela de `07-chamada.md`, que fica apenas com o resumo. O
modelo é o do Discord: quem compartilha inicia uma transmissão, os outros
escolhem assistir, e cada espectador controla a própria qualidade.

---

## Presets

Nomeados por finalidade, com os números ao lado — quem escolhe sabe o que vai
mostrar, não quantos megabits precisa.

| Preset | Resolução | fps | Bitrate alvo | Para quê |
|---|---|---|---|---|
| Texto e código | 1920×1080 | 15 | 2,5 Mbps | editor, terminal, documento |
| Padrão | 1920×1080 | 30 | 5 Mbps | navegação, slides, interface |
| Fluido | 1920×1080 | 60 | 8 Mbps | animação, protótipo interativo |
| Nítido | 2560×1440 | 30 | 9 Mbps | design, telas grandes |
| Nítido e fluido | 2560×1440 | 60 | 14 Mbps | jogo, vídeo, demonstração |
| Fonte | nativa até 3840×2160 | 30 | 22 Mbps | quando a tela é 4K e importa |

"Fonte" usa a resolução real do que foi capturado, sem redimensionar. Uma tela
1080p em "Fonte" transmite 1080p; a opção só faz diferença em monitor maior.

Padrão inicial: **Padrão** (1080p30). Da segunda vez em diante, o último preset
usado. O produto não adivinha o conteúdo; ele lembra o que a pessoa escolheu.

### Dica de conteúdo

Cada preset carrega um `contentHint` que muda o comportamento do codificador sob
pressão de banda:

- `detail` — mantém a resolução e sacrifica fps. Texto continua legível mesmo
  que trave. Presets "Texto e código", "Padrão", "Nítido", "Fonte".
- `motion` — mantém fps e sacrifica resolução. Movimento continua suave mesmo
  que embace. Presets "Fluido" e "Nítido e fluido".

É a diferença entre uma tela de código que fica borrada e ilegível e uma que
apenas atualiza mais devagar. O usuário nunca vê esse termo; ele vem embutido na
escolha.

### Codec

VP9 por padrão. Em relação ao H.264, entrega a mesma qualidade com cerca de 30%
menos banda em conteúdo de tela, e tem modo específico para captura de tela
(`screen content coding`) que trata texto muito melhor.

AV1 quando o navegador e a GPU de quem compartilha suportam codificação por
hardware — outros 30% de economia. Detecte com `RTCRtpSender.getCapabilities`
e ofereça como opção avançada, desligada por padrão: codificar AV1 por software
em 1440p60 derruba a máquina de quem compartilha.

Nunca H.264 para tela. Ele foi feito para vídeo natural e trata bordas de texto
como ruído.

---

## Transmitir

### Iniciar

Clique em 🖥 na barra de chamada abre o seletor:

```
┌──────────────────────────────────────────┐
│  Compartilhar tela                       │
├──────────────────────────────────────────┤
│  Qualidade                               │
│  ○ Texto e código      1080p · 15 fps    │
│  ● Padrão              1080p · 30 fps    │
│  ○ Fluido              1080p · 60 fps    │
│  ○ Nítido              1440p · 30 fps    │
│  ○ Nítido e fluido     1440p · 60 fps    │
│  ○ Fonte               até 4K · 30 fps   │
│                                          │
│  [ ● ] Incluir áudio do sistema          │
│                                          │
│  Sua conexão suporta até: Nítido         │
│                                          │
│              [ Cancelar ]  [ Escolher ]  │
└──────────────────────────────────────────┘
```

A linha "Sua conexão suporta até" vem de uma medição de upload feita nos
primeiros segundos da chamada, pelo relatório de `availableOutgoingBitrate` do
WebRTC. Presets acima do suportado ficam disponíveis mas com um aviso ao lado —
a pessoa pode tentar; o produto só não finge que vai funcionar.

"Escolher" abre o seletor nativo do navegador. Só existe uma tela de escolha do
produto antes dele, e ela precisa ser rápida: dois cliques do ícone à
transmissão no caminho comum.

### Enquanto transmite

A barra de chamada muda:

```
┌──────────────────────────────────┐
│  🖥 Você está transmitindo       │
│  Padrão · 1080p30 · 4,8 Mbps     │
│  👁 3 assistindo                 │
│  [ Qualidade ⌄ ]      [ Parar ]  │
└──────────────────────────────────┘
```

O contador de quem assiste é o que o Discord faz de mais útil aqui: transmitir
para ninguém é comum e a pessoa deve saber.

Trocar de preset no meio da transmissão funciona sem parar e recomeçar — é uma
troca de `constraints` na trilha existente. A resolução muda em um ou dois
segundos; o seletor nativo não reaparece.

O bitrate exibido é o real, do `getStats`, atualizado a cada 2s. Se a rede não
sustenta o preset, a linha vira âmbar: "Rede limitando a 3,1 Mbps". Explicar
por que a imagem piorou evita que a pessoa culpe o produto.

### Várias transmissões

Até três pessoas transmitindo ao mesmo tempo. Cada uma é uma trilha
independente; espectadores escolhem qual assistir, ou assistem duas lado a lado.

Acima de três, o botão desabilita com "Já há três transmissões. Aguarde uma
encerrar." Numa equipe de cinco, três telas simultâneas já é uma reunião
confusa; o limite é de produto, não técnico.

---

## Assistir

### Opcional

Ninguém recebe a transmissão automaticamente. Quem transmite aparece na grade
com um cartão diferente:

```
┌──────────────────────┐
│                      │
│   🖥  Ana            │
│   está transmitindo  │
│                      │
│   [ ▶ Assistir ]     │
└──────────────────────┘
```

Clicar assina a trilha. Até lá, o servidor não envia um byte daquela
transmissão para essa pessoa — o custo de uma tela em 4K é pago só por quem
está olhando.

> Ajustado em 4 de setembro de 2026, a pedido do dono do projeto: a tela
> transmitida é uma **caixa própria na grade**, ao lado das pessoas, e não o
> cartão da pessoa que transmite. Quem transmite continua sendo alguém na
> chamada; a tela é mais uma coisa acontecendo. Clicar na caixa põe aquela tela
> em primeiro plano, com as demais numa fileira lateral.

Exceção: se você está sozinho com quem transmite numa conversa privada, assiste
automaticamente. Pedir "Assistir" para a única outra pessoa da sala é cerimônia.

### Qualidade do espectador

Botão de engrenagem no canto do vídeo:

```
  Qualidade
  ● Automática
  ○ Fonte          o que a Ana envia
  ○ 720p           economizar dados
```

"Automática" deixa o `adaptiveStream` do LiveKit escolher a camada de simulcast
pelo tamanho do elemento na tela — assistir numa janelinha não puxa 1440p.

"Fonte" força a camada mais alta, sempre. É o que a pessoa quer quando maximiza
para ler código em 1440p e o automático demora a subir.

A escolha é por transmissão e volta para "Automática" na próxima.

### Simulcast

Quem transmite envia **três camadas**: a escolhida, uma intermediária e 360p.
O servidor entrega a cada espectador a maior camada que a conexão dele aguenta,
sem que quem transmite saiba ou se importe.

É a parte da arquitetura que faz a alta resolução ser viável para todos: quem
está no celular com sinal fraco recebe 360p; quem está no desktop com fibra
recebe 1440p; ninguém trava por causa do outro.

Custo: a codificação de três camadas pesa em quem transmite. Em máquina fraca,
o produto detecta `qualityLimitationReason: 'cpu'` no `getStats` e sugere
baixar o preset.

### Tela cheia e janela flutuante

Duplo clique ou o botão no canto: tela cheia com a API nativa. Sai com `Esc`.

Botão de janela flutuante: `Document Picture-in-Picture` no Chrome e Edge, que
abre a transmissão numa janela sempre à frente, redimensionável, com controles
próprios. Serve para assistir enquanto trabalha em outra coisa — o caso de uso
mais comum numa equipe pequena.

Onde não há suporte (Firefox, Safari), cai para o `requestPictureInPicture`
do elemento de vídeo, sem controles customizados. Funciona, só é mais simples.

### Zoom

Com a transmissão em tela cheia, rolagem do mouse dá zoom até 3x centrado no
cursor, e arrastar movimenta. `Esc` ou duplo clique volta ao ajuste.

É o que permite ler uma fonte pequena numa transmissão 1080p sem pedir para a
pessoa aumentar a fonte dela.

### Apontar

Segurar `Alt` e clicar sobre a transmissão envia a posição relativa como
`data message` para quem transmite, que vê um ponto na cor do espectador por
2s. "Olha ali" sem descrever coordenadas.

---

## Áudio

"Incluir áudio do sistema" captura o que sai das caixas de quem transmite —
vídeo tocando, notificação, som de jogo.

Trilha separada da voz, sem processamento: sem cancelamento de eco, sem
supressão de ruído, sem controle de ganho. Esses filtros existem para voz e
destroem música.

```typescript
audio: {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48000,
  channelCount: 2,
}
```

Opus a 128 kbps estéreo. Voz continua em 32 kbps mono, na trilha normal.

Espectador tem controle de volume independente para o áudio da transmissão,
separado do volume das vozes. A pessoa que quer ouvir a demonstração e a
explicação ao mesmo tempo precisa poder balancear as duas.

Suporte por plataforma, sem esconder:

| Plataforma | Áudio do sistema | Áudio da aba |
|---|---|---|
| Chrome/Edge Windows | sim | sim |
| Chrome/Edge macOS | não (só aba) | sim |
| Chrome/Edge Linux | depende do portal | sim |
| Firefox | não | não |
| Safari | não | não |

Quando não há suporte, a caixa aparece desabilitada com o motivo em texto — não
some, não falha em silêncio.

---

## Custo de banda

Os números que decidem onde hospedar.

O SFU recebe uma cópia e envia uma por espectador. Com quatro assistindo:

| Preset | Entrada | Saída | Por hora |
|---|---|---|---|
| Texto e código | 2,5 Mbps | 10 Mbps | 5,6 GB |
| Padrão | 5 Mbps | 20 Mbps | 11 GB |
| Nítido e fluido | 14 Mbps | 56 Mbps | 31 GB |
| Fonte 4K | 22 Mbps | 88 Mbps | 50 GB |

Cinco horas por semana em "Nítido e fluido" dão cerca de 600 GB por mês só de
tela. Num Hetzner com 20 TB de franquia, é 3% — irrelevante. Numa AWS a US$ 0,09
por GB, são US$ 54 por mês. Isso é o suficiente para escolher o provedor.

O simulcast **reduz** a saída na prática: espectador em janela pequena recebe
a camada baixa. Os números acima são o pior caso, com todos em tela cheia.

---

## Configuração do LiveKit

```yaml
rtc:
  # tela em alta resolução gera picos; janela larga evita drop
  packet_buffer_size: 1000
video:
  # sem limite artificial por trilha; o preset do cliente decide
  dynacast_pause_delay: 5s
```

No cliente:

```typescript
const room = new Room({
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    videoCodec: 'vp9',
    screenShareEncoding: preset.encoding,
    screenShareSimulcastLayers: [
      ScreenSharePresets.h360fps15,
      midLayerFor(preset),
    ],
  },
});

await room.localParticipant.setScreenShareEnabled(true, {
  resolution: preset.resolution,
  contentHint: preset.contentHint,
  audio: includeAudio ? systemAudioConstraints : false,
  systemAudio: 'include',
  surfaceSwitching: 'include',   // trocar de janela sem parar
  selfBrowserSurface: 'exclude', // não oferece a própria aba do produto
});
```

`surfaceSwitching: 'include'` mostra o botão "Compartilhar outra aba" na barra
nativa do Chrome — trocar de janela sem interromper a transmissão. Detalhe
pequeno, muito usado.

`selfBrowserSurface: 'exclude'` tira a aba do próprio produto da lista.
Compartilhar a aba onde você assiste a si mesmo cria um túnel infinito.

---

## O que não dá para fazer no navegador

Honesto, para ninguém prometer o que não existe:

- **4K60.** A codificação por software não acompanha; com AV1 por hardware em
  GPU recente, talvez. Não é preset oferecido; "Fonte" para em 30fps.
- **Compartilhar uma janela que está minimizada.** O sistema não renderiza.
- **Áudio do sistema no macOS** sem extensão nativa. Chrome só captura aba.
- **Latência abaixo de ~150ms.** O pipeline captura → codifica → relay →
  decodifica tem um mínimo. Para demonstração e apresentação é imperceptível;
  para jogar junto por transmissão, não serve.
- **Transmissão sem estar na chamada.** Tela é trilha da sala de voz. Isso é
  decisão, não limite: quem transmite deve poder ouvir quem assiste.

No Tauri, os dois primeiros e o terceiro melhoram — captura nativa, codificação
por hardware garantida, e áudio do sistema no macOS via `ScreenCaptureKit`. É o
argumento mais forte para o aplicativo desktop na fase 8.
