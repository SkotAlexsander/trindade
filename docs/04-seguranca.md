# Segurança

## Modelo de ameaça

Antes de qualquer controle, o que estamos defendendo e contra quem.

| Ameaça | Realista? | Defesa principal |
|---|---|---|
| Alguém de fora entra na aplicação | sim | convite fechado, Argon2id, 2FA, rate limit |
| Roubo de token por XSS | sim | CSP, sem token em `localStorage`, sanitização |
| Um membro descobre onde outro mora | **sim** | relay forçado no WebRTC, EXIF removido |
| Escaneamento do servidor a partir do IP | sim | Cloudflare, firewall, coturn restrito |
| Upload malicioso executando no domínio | sim | re-encode, domínio separado, `Content-Disposition` |
| Escalada de privilégio por membro | médio | hierarquia de `position` validada no servidor |
| Hospedagem lê o banco | baixo | disco criptografado (LUKS) |
| Estado-nação com acesso ao datacenter | fora de escopo | — |

A terceira linha é a que diferencia este projeto. Ela vem de uma propriedade
técnica do WebRTC que a maioria dos clones de Discord ignora.

---

## Autenticação

### Senha

Argon2id, nunca bcrypt, nunca SHA sozinho.

```typescript
export const HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,   // 64 MB
  timeCost: 3,
  parallelism: 4,
};
```

Mínimo de 12 caracteres. Não exija símbolo, maiúscula e número — isso produz
`Senha123!` e nada mais. Verifique contra a lista de senhas vazadas via k-anonymity
do Have I Been Pwned: envie os 5 primeiros caracteres do SHA-1 e compare o resto
localmente, sem nunca mandar a senha.

Comparação de hash sempre em tempo constante. No login com usuário inexistente,
execute um hash falso mesmo assim — senão o tempo de resposta entrega quais
usuários existem.

### Tokens

**Access token.** JWT, 15 minutos, algoritmo `EdDSA`. Fica em memória do
JavaScript e some quando a aba fecha. Nunca em `localStorage`, nunca em
`sessionStorage`, nunca em cookie legível.

**Refresh token.** 32 bytes aleatórios, 30 dias, guardado como SHA-256 no banco.
Vai em cookie:

```
httpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh
```

O `Path` restrito importa: o cookie não é enviado em nenhuma outra rota, o que
reduz a superfície de CSRF a uma rota só.

**Rotação com detecção de reuso.** É o ponto que quase todo tutorial erra.

Cada token pertence a uma `family_id`. Ao renovar, o antigo é revogado e um novo
nasce na mesma família. Se um token já revogado é apresentado, significa que
alguém tem uma cópia — o servidor revoga a família inteira e força login em todos
os dispositivos daquela sessão.

```typescript
if (row.revoked_at) {
  await db.revokeFamily(row.family_id);
  return reply.code(401).send({ error: 'sessão revogada', code: 'TOKEN_REUSE' });
}
```

### Segundo fator

TOTP (RFC 6238), 6 dígitos, janela de 30 segundos, tolerância de ±1 período.

O segredo é gerado no servidor, exibido uma vez como QR code e guardado
**cifrado** com AES-256-GCM usando uma chave da aplicação. Se o banco vazar, o
segundo fator ainda serve para alguma coisa.

Códigos de recuperação: 10 códigos de uso único, hasheados com Argon2id igual a
senha, exibidos uma única vez. Sem e-mail no sistema, esses códigos são a única
saída se a pessoa perder o telefone — deixe isso explícito na tela.

Rate limit no TOTP: 5 tentativas por 15 minutos por usuário. Sem isso, 6 dígitos
caem por força bruta em minutos.

---

## Autorização

**Toda checagem no servidor, sem exceção.** Esconder um botão é experiência de
uso, não controle de acesso.

```typescript
export function can(perms: bigint, need: bigint): boolean {
  return (perms & Perm.ADMINISTRATOR) !== 0n || (perms & need) !== 0n;
}
```

Duas regras de hierarquia, ambas validadas no backend:

1. Ninguém atribui, edita ou apaga cargo com `position` maior ou igual ao seu
   maior cargo.
2. Ninguém desativa alguém cujo maior cargo seja maior ou igual ao seu.

Sem elas, `MANAGE_ROLES` é equivalente a `ADMINISTRATOR`.

### WebSocket

O handshake usa o access token. Mas a conexão vive muito mais que 15 minutos, o
que cria um buraco: você remove alguém do grupo e a pessoa continua lendo tudo
até fechar o navegador.

Revalide a cada 60 segundos: se `disabled_at` não é nulo, feche com código 4001.
E recarregue as permissões no mesmo ciclo, para que mudança de cargo tenha efeito
sem reconectar.

---

## Privacidade de IP

### O vazamento entre membros

Em WebRTC mesh, cada participante conecta direto com os outros. É assim que o ICE
funciona — os candidatos trocados **contêm o endereço público de cada um**. Numa
chamada de cinco pessoas, todo mundo tem o IP de todo mundo, e ninguém percebe.

A defesa é forçar relay. Todo o tráfego passa pelo servidor e os pares só enxergam
o endereço dele:

```typescript
const pc = new RTCPeerConnection({
  iceServers: [{
    urls: ['turns:turn.exemplo.com:5349?transport=tcp'],
    username: ephemeralUser,
    credential: ephemeralPass,
  }],
  iceTransportPolicy: 'relay',   // ignora candidatos host e srflx
});
```

`iceTransportPolicy: 'relay'` é a linha inteira. Sem ela o navegador tenta P2P
primeiro e o endereço já foi para o outro lado na negociação — não adianta
bloquear depois.

Com LiveKit isso é ainda mais simples, porque um SFU já é relay por desenho: o
cliente só fala com o servidor. Configure `rtc.use_external_ip` e force TURN nos
clientes mesmo assim, para o caso de UDP direto estar disponível.

### Credenciais TURN efêmeras

Nunca senha fixa no código. Use o mecanismo REST do coturn: usuário é
`{expiraEm}:{userId}`, senha é HMAC-SHA1 desse usuário com o segredo estático,
em base64. Validade de 6 horas.

```
static-auth-secret=<segredo longo e aleatório>
use-auth-secret
realm=turn.exemplo.com
```

### coturn não pode virar proxy

Sem isto, seu servidor TURN vira ferramenta de scan da sua própria rede interna:

```
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
no-multicast-peers
no-cli
```

### O IP do servidor

Cloudflare na frente do HTTP e do WebSocket: o DNS aponta para eles.

Isso só funciona se o firewall fechar a 443 para todo mundo exceto os ranges da
Cloudflare. Sem essa parte, basta escanear a faixa do provedor e o proxy é
decorativo.

```bash
ufw default deny incoming
ufw allow from <cloudflare ranges> to any port 443 proto tcp
ufw allow 22/tcp                        # ou só via Tailscale
ufw allow 3478,5349/udp                 # TURN, inevitavelmente exposto
```

O TURN não passa por Cloudflare — é UDP. Esse IP fica visível por natureza. Se
isso incomoda, coloque o coturn e o LiveKit num VPS separado do banco e da
aplicação; o que vaza é o endereço de uma máquina que só faz relay.

Alternativa mais forte para cinco pessoas: expor tudo apenas via **Tailscale**.
Resolve exposição, autenticação de rede e IP de uma vez. O custo é depender de um
terceiro para o acesso.

### Logs

Não adianta esconder IP na chamada se o nginx grava tudo em `access.log`.

- Caddy: desative o log de acesso, ou trunque o último octeto do IPv4 e os
  últimos 80 bits do IPv6.
- API: nunca registre `req.ip` em log de aplicação.
- Banco: não há coluna de IP em `refresh_tokens` nem em `audit_log`. De propósito.
- Retenção: 7 dias no que sobrar.

O rate limit precisa de alguma noção de origem — use o hash do IP com uma chave
que rotaciona diariamente, não o IP em claro.

---

## Upload de arquivo

### Imagem: sempre re-encodar

Foto de celular carrega EXIF com coordenadas GPS. Se você servir o arquivo
original, cada membro publica onde mora sem saber. Esse é o mesmo problema de
privacidade da seção anterior, por outro caminho.

```typescript
const webp = await sharp(buf, { limitInputPixels: 50_000_000 })
  .rotate()                                  // aplica a orientação EXIF e descarta
  .resize(256, 256, { fit: 'cover' })
  .webp({ quality: 82 })
  .toBuffer();
```

Três coisas de uma vez: o metadado some, o formato é validado de verdade (se não
for imagem, o `sharp` lança), e `limitInputPixels` bloqueia decompression bomb —
um PNG de 2 KB que vira 10 GB na memória.

**Nenhum byte original de upload chega ao disco.** Vale para avatar e para anexo.

### Validação

Cheque **magic bytes**, não a extensão nem o `Content-Type` declarado. Ambos são
controlados pelo cliente.

Limites: avatar 8 MB, anexo 50 MB, 10 anexos por mensagem.

SVG fica **fora** da lista de imagens, de propósito. É um formato de imagem que
também é um documento com script, e rasterizar SVG de terceiro abre uma porta
que nada aqui precisa. Ele cai como arquivo comum: baixado, nunca renderizado.
O teste `e2e/fase-05-upload-api.py` sobe um SVG com `<script>` dentro,
renomeado para `.png` e declarado como `image/png` — as três mentiras juntas —
e confere que ele sai `application/octet-stream`.

### Servir

- Chave aleatória, nunca o nome enviado pelo usuário.
- Domínio separado (`cdn.exemplo.com`). Um SVG ou HTML malicioso que rode no
  mesmo origin da aplicação lê o token de quem abrir.
- `Content-Disposition: attachment` para tudo que não seja imagem re-encodada.
- `X-Content-Type-Options: nosniff` sempre.

**A rota de arquivo não tem sessão, e isso é uma decisão.** O access token vive
só na memória do JavaScript e um `<img src>` não tem como mandá-lo; e o
domínio de CDN acima, por construção, não enxerga a sessão de ninguém. O
controle de acesso é a chave: 32 bytes aleatórios (256 bits), que não se
adivinham.

O que isso custa, dito por extenso: **quem já teve a URL continua tendo o
arquivo.** Tirar alguém de um canal não invalida um link que essa pessoa
copiou. Com elenco fixo de cinco é um risco pequeno e conhecido; num produto
com convidados entrando e saindo, não seria — ali a resposta é um token de
mídia curto por cookie, ou URL assinada com validade.

---

## Prévia de link: o servidor busca no lugar de quem lê

Preview de link é buscado pelo **servidor**, nunca pelo navegador de quem lê.
Se o cliente buscasse, abrir uma mensagem entregaria o IP de todos os leitores
para quem mandou o link. Vale também para a **miniatura**: ela é baixada,
re-encodada e servida do nosso domínio — deixar o `<img>` apontar para o site
de origem devolveria o vazamento por outra porta, depois de todo o cuidado com
o HTML.

A troca é direta: o servidor passa a buscar URLs escolhidas por outra pessoa, e
um servidor assim pode ser mandado bater na porta da própria rede — o metadado
da nuvem em `169.254.169.254`, o Postgres, o painel do MinIO. É o SSRF, e a
guarda tem seis partes:

1. **Só `http:` e `https:`.** Lista de permitidos; `file:`, `gopher:` e
   `data:` falham fechado.
2. **Só as portas da web** (80, 443, ou a padrão). `:5432` e `:9000` não são
   engano de ninguém.
3. **Nada de credencial na URL.** `http://usuario@interno/` engana quem lê o
   link e alguns clientes HTTP.
4. **Resolvemos o nome nós mesmos** e recusamos todo endereço que não seja da
   internet pública: privado, laço local, link-local, CGNAT, documentação,
   benchmark, multicast, reservado — e o IPv4 embutido em IPv6, porque
   `::ffff:127.0.0.1`, `2002:7f00:1::` e `64:ff9b::7f00:1` são 127.0.0.1
   escritos de outros três jeitos.
5. **Conectamos no endereço já conferido**, com o `Host` original no cabeçalho
   e o `servername` no TLS. Passar o *nome* para o cliente HTTP deixaria uma
   janela entre a nossa consulta de DNS e a dele em que a resposta pode mudar
   para `127.0.0.1` — é o rebind, e ele derrota a checagem feita cedo demais.
6. **Cada redirecionamento repete tudo**, no máximo três. Um host público que
   redireciona para `169.254.169.254` é a forma mais comum de SSRF que
   sobrevive a uma checagem só na entrada.

Mais: 5 segundos de espera, 512 KB de HTML, 4 MB de imagem, e só `text/html` é
lido como página. Na dúvida a guarda diz não — em `lib/rede-publica.ts`, texto
que não parse devolve "não é público".

A recusa é **sempre a mesma mensagem**, sem dizer para onde o nome resolveu:
dizer "resolveu para 10.0.0.5" transformaria a prévia num scanner de rede.

---

## Headers e front

```
Content-Security-Policy: default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' https://cdn.exemplo.com data: blob:;
  media-src 'self' blob:;
  connect-src 'self' wss://exemplo.com https://livekit.exemplo.com;
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), camera=(self), microphone=(self)
```

`frame-ancestors 'none'` mata clickjacking. `geolocation=()` garante que nem por
acidente a aplicação peça localização.

Markdown passa por `DOMPurify` **depois** de renderizado, com whitelist de tags.
Nunca `dangerouslySetInnerHTML` com conteúdo de usuário sem essa passagem.

Preview de link é buscado pelo **servidor** — ver "Prévia de link" acima, com a
guarda de SSRF por extenso.

---

## Rate limit

| Rota | Limite | Chave |
|---|---|---|
| `POST /auth/login` | 5 / 15 min | usuário + hash de IP |
| `POST /auth/totp` | 5 / 15 min | usuário |
| `POST /auth/register` | 3 / hora | hash de IP |
| `POST /auth/refresh` | 30 / hora | usuário |
| `POST /me/avatar` | 10 / hora | usuário |
| `GET /link-preview` | 120 / hora | usuário |
| upload de anexo | 50 / hora | usuário |
| `MESSAGE_CREATE` (ws) | 10 / 10s | usuário |

No login, use backoff progressivo em vez de bloqueio duro: 1s, 2s, 4s, 8s. Um
bloqueio de conta é vetor de negação de serviço contra um membro legítimo.

---

## Segredos

Nada em `.env` commitado. `.env.example` com as chaves e valores vazios.

Em produção: Docker secrets ou Infisical. Rode `git-secrets` ou `gitleaks` no
pre-commit — o custo é uma linha e evita a classe de erro mais cara que existe.

Chaves necessárias:

```
DATABASE_URL
JWT_PRIVATE_KEY / JWT_PUBLIC_KEY     Ed25519
TOTP_ENCRYPTION_KEY                  32 bytes
S3_ENDPOINT / S3_KEY / S3_SECRET / S3_BUCKET
TURN_STATIC_SECRET
LIVEKIT_API_KEY / LIVEKIT_API_SECRET
```

---

## Checklist antes de produção

- [ ] `iceTransportPolicy: 'relay'` em todos os caminhos de mídia
- [ ] `denied-peer-ip` completo no coturn
- [ ] Firewall fechando 443 para tudo fora da Cloudflare
- [ ] Log de acesso sem IP em claro
- [ ] Nenhuma imagem servida sem passar pelo `sharp`
- [ ] Anexos num domínio separado
- [ ] A prévia de link recusa endereço interno, inclusive depois de redirecionar
- [ ] CSP ativa e testada
- [ ] 2FA ativado nas cinco contas
- [ ] Disco criptografado
- [ ] Backup do Postgres automatizado, com restauração testada de verdade
- [ ] `gitleaks` no histórico inteiro do repositório
