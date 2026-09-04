# Tempo real e WebRTC

## Gateway WebSocket

### Estado em memória

```typescript
interface Connection {
  ws: WebSocket;
  userId: string;
  sessionId: string;
  permissions: bigint;
  subscribed: Set<string>;      // channelIds
  lastHeartbeat: number;
}

const connections = new Map<string, Connection>();      // sessionId → conn
const byUser = new Map<string, Set<string>>();          // userId → sessionIds
```

Uma pessoa pode ter várias conexões — desktop e celular abertos ao mesmo tempo.
O broadcast percorre `connections`, o direcionamento por pessoa usa `byUser`.

Com cinco usuários e talvez quinze conexões, iterar o mapa inteiro custa nada.
Não invente índice por canal antes de precisar.

### Ciclo de vida

```
conectar
  ├─ valida token do query string
  ├─ carrega permissões do banco
  ├─ registra a conexão
  ├─ envia READY
  ├─ inicia revalidação a cada 60s
  └─ inicia verificação de heartbeat a cada 30s

mensagem recebida
  ├─ valida com Zod → 4004 se falhar
  ├─ checa rate limit → 4003 se estourar
  ├─ checa permissão → evento ERROR, não fecha
  └─ processa

desconectar
  ├─ limpa timers
  ├─ remove dos mapas
  └─ se foi a última conexão da pessoa, broadcast PRESENCE_UPDATE offline
```

O ponto do último item: só marque alguém como offline quando **todas** as
conexões dela caírem. Senão fechar uma aba te mostra offline.

### Revalidação

```typescript
const revalidate = setInterval(async () => {
  const row = await db.users.getAuthState(conn.userId);
  if (!row || row.disabled_at) {
    conn.ws.close(4001, 'ACCOUNT_DISABLED');
    return;
  }
  const perms = await db.roles.effectivePermissions(conn.userId);
  if (perms !== conn.permissions) {
    conn.permissions = perms;
    send(conn, { op: 'PERMISSIONS_UPDATE', d: { permissions: perms.toString() } });
  }
}, 60_000);
```

Sem isso, remover alguém do grupo não tem efeito até a pessoa fechar o navegador.

### Rate limit no socket

Token bucket por usuário, em memória: 10 mensagens por 10 segundos, com estouro
de 3. Ao esgotar, envie `ERROR` com `code: 'RATE_LIMITED'` e o tempo de espera.
Feche com 4003 apenas se a pessoa continuar martelando depois do aviso.

### Presença

Três fontes se combinam:

1. **Conexão** — tem socket aberto, está online.
2. **Declarada** — a pessoa escolheu `busy` ou `invisible`; sobrepõe a conexão.
3. **Inatividade** — sem interação por 10 minutos vira `idle`. Detectado no
   cliente com `visibilitychange` e eventos de ponteiro e teclado, enviado como
   `PRESENCE_UPDATE`.

`invisible` aparece como `offline` para os outros, mas a pessoa continua
recebendo tudo. O servidor filtra na hora do broadcast — nunca envie o status
real e deixe o cliente esconder.

### Digitando

`TYPING_START` faz broadcast para o canal. Não existe `TYPING_STOP`: o cliente
que recebe guarda um timestamp e limpa sozinho após 8 segundos.

O cliente que envia faz throttle de 4 segundos — digitar um parágrafo não deve
gerar cinquenta eventos.

---

## Escolha da topologia de mídia

### Mesh não serve aqui

Cada participante conecta com todos os outros. Com cinco pessoas, cada um mantém
quatro conexões e envia quatro cópias do próprio vídeo.

Compartilhar tela em 1080p a 30fps consome de 2,5 a 4 Mbps por cópia. Vezes
quatro dá **10 a 16 Mbps de upload sustentado**. A maioria das conexões
domésticas brasileiras não entrega isso de forma estável, mesmo em planos que
anunciam mais.

E há o problema mais grave: em mesh, todos os participantes trocam candidatos ICE
diretamente. **Todo mundo fica com o IP de todo mundo.**

### SFU resolve os dois

Com um SFU, cada cliente envia **um** stream para o servidor e recebe os dos
outros de lá. Upload cai para 2,5 a 4 Mbps — dez vezes menos.

E como o cliente só negocia com o servidor, nenhum participante vê o endereço de
outro. A privacidade que em mesh exige relay forçado vem de graça na arquitetura.

**LiveKit** é a escolha: open source, auto-hospedável, com SDK de screen share
pronto e simulcast por padrão.

Custo: banda no servidor. Cinco pessoas em chamada com uma tela compartilhada dá
algo como 4 Mbps de entrada e 16 de saída — cerca de 9 GB por hora. Um Hetzner
com franquia de 20 TB aguenta com folga. Numa AWS, a fatura assusta.

---

## LiveKit

### Configuração

```yaml
# livekit.yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: true
keys:
  APIkey: <segredo>
turn:
  enabled: true
  domain: turn.exemplo.com
  tls_port: 5349
  external_tls: true
room:
  auto_create: false           # sala só nasce via API, nunca pelo cliente
  empty_timeout: 300
  max_participants: 8
webhook:
  api_key: APIkey
  urls:
    - https://exemplo.com/api/livekit/webhook
```

`auto_create: false` importa: com `true`, quem tiver um token válido cria salas
arbitrárias.

### Emissão de token

```typescript
import { AccessToken } from 'livekit-server-sdk';

export function voiceToken(user: User, channelId: string, perms: bigint) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: user.id,
    name: user.displayName,
    ttl: '6h',
  });
  at.addGrant({
    room: `channel:${channelId}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: can(perms, Perm.SHARE_SCREEN)
      ? ['camera', 'microphone', 'screen_share', 'screen_share_audio']
      : ['camera', 'microphone'],
  });
  return at.toJwt();
}
```

O escopo é uma sala só. Um token não dá acesso a outro canal.

### Cliente

```typescript
const room = new Room({
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: {
    simulcast: true,
    screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
  },
});

await room.connect(wsUrl, token, {
  rtcConfig: {
    iceServers,
    iceTransportPolicy: 'relay',   // inegociável
  },
});
```

`adaptiveStream` reduz a qualidade recebida de quem está fora da tela.
`dynacast` para de publicar camadas que ninguém assiste. Os dois juntos derrubam
o consumo pela metade numa chamada real.

Tela a 15fps, não 30: código e slides não precisam de 30fps, e a metade da taxa
é metade da banda. Ofereça 30fps como opção explícita para quem for mostrar vídeo.

---

## coturn

Necessário mesmo com SFU. Muita operadora brasileira usa CGNAT, e nesse cenário
UDP direto para o SFU frequentemente não fecha. O TURN sobre TLS na 5349 passa
até em rede corporativa que bloqueia UDP.

```
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<64 bytes aleatórios>
realm=turn.exemplo.com
cert=/etc/letsencrypt/live/turn.exemplo.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.exemplo.com/privkey.pem
min-port=50201
max-port=50400
no-cli
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
```

Os `denied-peer-ip` não são opcionais. Sem eles, seu TURN é um proxy aberto para
escanear a sua própria rede interna.

### Credenciais efêmeras

```typescript
export function turnCredentials(userId: string) {
  const expiry = Math.floor(Date.now() / 1000) + 6 * 3600;
  const username = `${expiry}:${userId}`;
  const credential = createHmac('sha1', TURN_STATIC_SECRET)
    .update(username)
    .digest('base64');
  return {
    urls: ['turns:turn.exemplo.com:5349?transport=tcp'],
    username,
    credential,
  };
}
```

Nunca senha fixa. O coturn valida o HMAC sozinho, sem consultar banco.

---

## Compartilhamento de tela

Mesmo pipeline da câmera, outra fonte:

```typescript
await room.localParticipant.setScreenShareEnabled(true, {
  audio: true,                    // áudio da aba, Chrome e Edge
  resolution: { width: 1920, height: 1080, frameRate: 15 },
});
```

Detalhes que costumam morder:

- **Firefox não captura áudio de tela.** Detecte e avise em vez de falhar mudo.
- **Safari exige gesto do usuário** na mesma pilha de chamada. Um `await` antes
  do `setScreenShareEnabled` quebra o gesto e a permissão é negada.
- **O usuário pode parar pela barra do navegador**, fora da sua UI. Escute
  `track.onended` e sincronize o estado — senão o botão fica dizendo "parar" para
  uma transmissão que já acabou.
- **Só uma tela por vez** por padrão. Se duas pessoas compartilharem, a UI precisa
  de abas ou de uma regra explícita de quem tem o palco.

---

## Detecção de fala

Destacar quem está falando não precisa de biblioteca. O LiveKit já entrega:

```typescript
room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
  setActiveSpeakers(new Set(speakers.map(s => s.identity)));
});
```

Se quiser o nível contínuo para um medidor, use `participant.audioLevel`, que é
atualizado pelo SDK.

Uma regra de interface: **não anime nada a cada frame de áudio**. Faça o
destaque entrar em 120ms e sair em 400ms — sair devagar evita o efeito
estroboscópico em quem fala com pausas.

---

## Transcrição, se quiser

Whisper local (`whisper.cpp` com modelo `small`) processando a gravação da sala
depois que a chamada termina. Não em tempo real — a diferença de esforço é
grande e o valor está no resumo, não na legenda ao vivo.

O LiveKit Egress grava a sala em arquivo. Um worker pega o arquivo, transcreve
com diarização por participante e grava uma mensagem no canal com o resumo.

É a funcionalidade com melhor relação entre esforço e impacto de toda a lista.
Deixe para depois da fase 7, mas deixe o gancho pronto: grave o `roomId` junto
com o canal no momento em que a chamada começa.
