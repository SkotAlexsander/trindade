# Fase 7 — Voz e compartilhamento de tela

LiveKit, coturn, relay forçado, grade de participantes e modo tela.

Leia antes: `docs/06-realtime-e-webrtc.md` inteiro, `docs/04-seguranca.md`
(privacidade de IP), `design/07-chamada.md`.

O requisito central desta fase é de privacidade, não de mídia: **nenhum
participante pode descobrir o endereço de rede de outro.** Tudo o mais é
consequência disso.

## Entregar

### Infraestrutura

`docker-compose` acrescentando LiveKit e coturn.

`livekit.yaml` conforme o documento, com `room.auto_create: false` — com `true`,
qualquer token válido cria salas arbitrárias.

`turnserver.conf` com **todos** os `denied-peer-ip` do documento. Sem eles, seu
TURN vira proxy aberto para escanear a sua própria rede interna. Isso não é
opcional.

### Backend

`POST /channels/:id/voice/token` — checa `CONNECT_VOICE`, emite JWT do LiveKit
com escopo restrito àquela sala, 6h de validade. `canPublishSources` inclui
`screen_share` só com a permissão `SHARE_SCREEN`.

Credenciais TURN efêmeras: usuário `{expiry}:{userId}`, senha HMAC-SHA1 com o
segredo estático em base64. **Nunca senha fixa no código.**

`POST /livekit/webhook` — valida a assinatura, converte em `VOICE_STATE_UPDATE`
no WebSocket. Restrinja por IP.

### Cliente

```typescript
await room.connect(wsUrl, token, {
  rtcConfig: { iceServers, iceTransportPolicy: 'relay' },
});
```

`iceTransportPolicy: 'relay'` é a linha inteira do requisito de privacidade. Sem
ela o navegador tenta P2P primeiro e o endereço já foi para o outro lado na
negociação — não adianta bloquear depois.

`adaptiveStream` e `dynacast` ligados; juntos derrubam o consumo pela metade numa
chamada real.

### Barra de chamada

56px acima do elenco, com **borda superior de 2px em `--ember`** — a única borda
saturada da interface, e por isso impossível esquecer que o microfone está aberto.

Controles com estado desligado em `--danger` **e barra diagonal**, nunca só cor.

Indicador de qualidade em três barras, com a explicação quando a imagem piorar.

### Grade

Sobreposição sobre a conversa, não janela nova. Layout automático: 1 ocupa tudo,
2 lado a lado, 3 e 4 em 2×2, 5 em 3+2.

**Quem está falando**: borda `--ember` entrando em 120ms e saindo em 400ms. A
assimetria é essencial — com tempos iguais, quatro pessoas conversando produzem
um efeito estroboscópico. Use `ActiveSpeakersChanged`, que já tem histerese. Não
anime a cada frame de áudio.

"Sair" separado fisicamente dos outros controles.

### Compartilhamento de tela

Leia `design/12-compartilhamento-de-tela.md` inteiro antes desta parte.

Os seis presets da tabela, com `resolution`, `frameRate`, `maxBitrate` e
`contentHint` corretos em cada um. VP9 por padrão; AV1 como opção avançada só
quando `getCapabilities` mostrar codificação por hardware.

Simulcast em três camadas na tela: a escolhida, uma intermediária e 360p.

**Assistir é opcional.** Quem transmite aparece na grade com o cartão "está
transmitindo" e o botão "Assistir". Sem clicar, o cliente não assina a trilha e
o servidor não envia. Exceção: direta com duas pessoas assiste automaticamente.

Seletor de qualidade do espectador: Automática (adaptiveStream), Fonte
(`setVideoQuality(HIGH)` forçado), 720p.

Barra de quem transmite com preset, resolução real, bitrate do `getStats` a cada
2s, contador de espectadores, e a linha âmbar "Rede limitando a X Mbps" quando
o bitrate real fica abaixo de 70% do alvo. Detecção de
`qualityLimitationReason: 'cpu'` sugerindo baixar o preset.

Trocar de preset no meio da transmissão via `applyConstraints`, sem reabrir o
seletor nativo.

Medição de upload nos primeiros segundos da chamada por
`availableOutgoingBitrate`, exibida como "Sua conexão suporta até".

Até três transmissões simultâneas; espectador pode ver duas lado a lado.

Tela cheia nativa. Janela flutuante com `Document Picture-in-Picture` onde
existir, `requestPictureInPicture` do vídeo como alternativa. Zoom até 3x com
rolagem em tela cheia. `Alt` + clique envia apontador por `data message`.

Áudio do sistema como trilha separada, sem processamento de voz, Opus 128 kbps
estéreo, volume independente no espectador. Tabela de suporte por plataforma
aplicada: caixa desabilitada com o motivo, nunca escondida.

`surfaceSwitching: 'include'` e `selfBrowserSurface: 'exclude'`.

Três casos que precisam funcionar:
- **Firefox não captura áudio de tela** — detecte e avise, não falhe mudo
- **Safari exige gesto do usuário** na mesma pilha — nada de `await` antes de
  `setScreenShareEnabled`
- **A pessoa pode parar pela barra do navegador** — escute `track.onended` e
  sincronize o estado

### Entrada e saída

Clique no canal conecta direto, sem antessala. Microfone entra **aberto** — a
borda âmbar torna o estado impossível de ignorar, o que faz desse padrão o
seguro. Sons curtos e distintos, subindo para entrar e descendo para sair,
desligáveis.

Quem está fora vê os avatares no canal da lista, com anel âmbar em quem fala.
**Sem notificação de entrada** — numa equipe de cinco isso dispararia o dia todo.

### Erros

A tabela de estados do documento. Permissão negada não diz "permissão negada";
diz onde clicar:

> O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e
> permita o acesso.

## Aceite

- Cinco pessoas em chamada com áudio estável
- **`chrome://webrtc-internals` mostra apenas candidatos `relay`** — nenhum
  `host` ou `srflx`. Este é o teste que importa.
- Nenhum participante consegue ver o IP de outro em nenhuma ferramenta
- Compartilhar tela funciona em Chrome, Firefox e Safari
- Transmissão em "Nítido e fluido" mantém 1440p60 com bitrate real acima de 12 Mbps em rede boa
- Espectador em janela pequena recebe a camada baixa; ao maximizar, sobe para a alta em até 3s
- Quem não clicou em "Assistir" não recebe pacotes da trilha (confira em webrtc-internals)
- Trocar de preset no meio não reabre o seletor nativo nem derruba os espectadores
- Texto em "Texto e código" continua legível sob limitação de rede (fps cai, resolução não)
- Áudio do sistema chega em estéreo sem supressão de ruído
- Janela flutuante funciona no Chrome e tem alternativa no Firefox
- Parar pela barra do navegador sincroniza o botão da interface
- Indicador de fala não pisca com fala entrecortada
- Desligar o microfone é visível sem depender de cor
- Rede caindo reconecta sozinho
- Sem `SHARE_SCREEN`, o botão não aparece e o token não permite
- `turnutils_uclient` contra um IP interno é recusado
