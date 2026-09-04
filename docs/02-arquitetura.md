# Arquitetura

## Desenho geral

```
                    ┌─────────────────────────────┐
   navegador ──────▶│  Cloudflare (proxy HTTP)    │
   ou Tauri         └──────────────┬──────────────┘
                                   │ TLS
                    ┌──────────────▼──────────────┐
                    │  Caddy  :443                │
                    │  TLS, headers, roteamento   │
                    └───┬──────────────────────┬──┘
                        │ /api  /ws            │ /
              ┌─────────▼─────────┐   ┌────────▼────────┐
              │  Fastify  :3000   │   │  estáticos web  │
              │  HTTP + WebSocket │   └─────────────────┘
              └───┬───────────┬───┘
                  │           │
        ┌─────────▼───┐   ┌───▼──────────┐
        │ PostgreSQL  │   │  S3 / R2     │
        │  :5432      │   │  anexos      │
        └─────────────┘   └──────────────┘

   mídia (UDP, fora do proxy HTTP):

        navegador ──▶ LiveKit SFU :7880 ──▶ demais participantes
                          │
                      coturn :3478/5349  (relay TURN)
```

O tráfego de mídia não passa pela Cloudflare — é UDP e o proxy só entende HTTP.
Isso significa que o IP do servidor de mídia fica exposto por natureza. É o
motivo de ele viver, idealmente, num host separado do banco.

## Processos

**Um processo Node.** Fastify serve HTTP e WebSocket na mesma porta, no mesmo
processo. Com cinco usuários não existe motivo para separar, e a memória
compartilhada torna o mapa de conexões trivial.

Isso tem uma consequência: **o estado de presença mora em memória**. Reiniciar a
API derruba todas as conexões e todo mundo reconecta. Aceitável — mas significa
que a presença nunca é fonte da verdade persistida, e o cliente precisa lidar
com reconexão graciosamente.

Se um dia houver mais de um processo, o estado de presença migra para Redis com
pub/sub. Não antes.

## Fluxo de uma mensagem

1. Cliente valida localmente e insere a mensagem na lista com `status: 'sending'`
   e um `clientNonce` (UUID gerado no cliente).
2. Envia pelo WebSocket: `{ op: 'MESSAGE_CREATE', channelId, content, clientNonce }`.
3. Servidor autentica a conexão, checa `SEND_MESSAGE` no canal, valida tamanho.
4. Grava no Postgres e recebe `id` e `created_at` reais.
5. Faz broadcast para todos os conectados com acesso ao canal, incluindo o autor,
   devolvendo o `clientNonce`.
6. O cliente do autor casa pelo `clientNonce`, substitui a mensagem otimista pela
   real e limpa o `status`. Os demais só inserem.

O `clientNonce` é o que evita mensagem duplicada quando a rede oscila e o cliente
reenvia. Grave-o com índice único por autor nas últimas 24 horas.

## Fluxo de uma chamada

1. Cliente pede `POST /channels/:id/voice/token`.
2. API checa permissão `CONNECT_VOICE` e emite um JWT do LiveKit com escopo
   restrito à sala daquele canal, validade de 6 horas.
3. Cliente conecta no LiveKit com `iceTransportPolicy: 'relay'`.
4. LiveKit distribui as trilhas. Nenhum par conhece o endereço do outro.
5. Estado da sala volta para a API por webhook do LiveKit e vira evento de
   presença no WebSocket, para que quem não está na chamada veja quem está.

## Camadas no backend

```
routes/      HTTP. Valida entrada com Zod, chama service, formata saída.
             Não contém regra de negócio. Não escreve SQL.

services/    Regra de negócio. Não sabe que HTTP existe, não recebe req/reply.
             Recebe dados já validados, devolve dados ou lança erro tipado.

db/          SQL. Uma função exportada por operação. Sem lógica condicional
             de negócio, sem montagem dinâmica de query além de filtros.

lib/         Utilitários sem estado: hash, token, permissões, imagem, storage.
```

A regra prática: se você precisa importar `FastifyRequest` fora de `routes/` ou
`plugins/`, a camada está errada.

## Camadas no frontend

```
routes/       Página. Compõe features, cuida de parâmetro de URL.
features/     Domínio completo: componentes, hooks e tipos de uma área.
              Ex: features/messages/, features/voice/, features/profile/
components/   Primitivos sem regra de negócio: Button, Avatar, Dialog, Menu.
lib/          Cliente HTTP, cliente WebSocket, hooks genéricos.
```

Agrupar por domínio e não por tipo de arquivo importa mais do que parece: quando
você mexe em mensagens, tudo que você precisa está numa pasta só.

## Cache e revalidação

TanStack Query cuida do estado do servidor:

- Histórico de mensagens: `staleTime: Infinity`. Mensagem antiga não muda; o que
  chega novo vem pelo WebSocket e é escrito no cache com `setQueryData`.
- Perfil e cargos: `staleTime: 5 min`, invalidado por evento `USER_UPDATE`.
- Presença: nunca via Query. Vive no Zustand, alimentada só pelo WebSocket.

O erro clássico é fazer polling. Não faça. Se o WebSocket caiu, o cliente
reconecta e refaz o fetch inicial; entre reconexões, o estado é o que o socket
entregou.

## Reconexão

O cliente WebSocket implementa backoff exponencial com jitter, teto de 30s. Ao
reconectar:

1. Reautentica com um access token fresco.
2. Busca as mensagens posteriores ao último `id` conhecido de cada canal aberto.
3. Refaz o estado de presença a partir do `READY` que o servidor envia.

Enquanto desconectado, a UI mostra uma faixa discreta e o compositor continua
aceitando texto — as mensagens ficam na fila e saem quando a conexão volta.

## Ambientes

Só existem dois: `dev` na máquina de quem programa e `prod` no VPS. Não há
staging. Com cinco usuários, o custo de um ambiente intermediário é maior que o
risco que ele mitiga; migrations são testadas contra um dump de produção
restaurado localmente.
