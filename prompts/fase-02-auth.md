# Fase 2 — Autenticação

Ciclo completo: convite, registro, login, 2FA, rotação de token com detecção de
reuso, e permissões carregadas do banco.

Leia antes: `docs/04-seguranca.md` inteiro, `docs/05-contrato-api.md` seções de
autenticação e perfil, `docs/03-modelo-de-dados.md`.

Esta é a fase com mais chance de erro sutil. Vá devagar e siga o documento de
segurança literalmente.

## Entregar

### Biblioteca de auth — `src/lib/auth/`

- `password.ts` — hash e verificação com Argon2id nos parâmetros do documento.
  No login com usuário inexistente, **execute um hash falso mesmo assim** para
  não vazar existência pelo tempo de resposta.
- `tokens.ts` — assinatura e verificação de JWT com Ed25519, 15 min de validade.
  Geração de refresh token com 32 bytes aleatórios, guardado como SHA-256.
- `totp.ts` — RFC 6238, janela ±1. Segredo cifrado com AES-256-GCM antes de
  gravar. Geração e verificação de códigos de recuperação, hasheados com Argon2id.
- `permissions.ts` — `can()`, cálculo de permissões efetivas (OR dos cargos),
  e as duas regras de hierarquia por `position`.

### Rotas

Exatamente como em `docs/05-contrato-api.md`:
`register`, `login`, `totp`, `refresh`, `logout`, `logout-all`, e o bloco de
2FA em `/me/totp/*`.

Pontos que precisam estar certos:

**Rotação com detecção de reuso.** Cada refresh token pertence a uma `family_id`.
Renovar revoga o anterior e cria outro na mesma família. Se um token já revogado
for apresentado, revogue a **família inteira** e devolva 401 com
`code: 'TOKEN_REUSE'`.

**Cookie do refresh**: `httpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh`.
O `Path` restrito não é detalhe — reduz a superfície de CSRF a uma rota.

**Registro não faz login automático.** Devolve 201 e o front manda para `/entrar`.

**Verificação de senha vazada** por k-anonymity no Have I Been Pwned: envie os 5
primeiros caracteres do SHA-1 e compare o resto localmente. Se a API não
responder em 2s, deixe passar — não bloqueie cadastro por indisponibilidade de
terceiro.

**Rate limit** com `@fastify/rate-limit` nos limites da tabela do documento.
A chave usa **hash do IP com sal que rotaciona diariamente**, nunca o IP em claro.
No login, backoff progressivo (1s, 2s, 4s, 8s) em vez de bloqueio duro.

### Plugin de autenticação

`preHandler` que lê o `Authorization: Bearer`, valida, carrega permissões e
popula `req.user`. Decore o tipo do Fastify corretamente, sem `any`.

### Frontend

Telas de `design/06-autenticacao.md`: entrar, código de verificação, aceitar
convite, criar conta. Siga a composição, os textos de erro e o comportamento das
seis caixas de código descritos lá.

**Cliente HTTP** em `lib/http.ts`:
- access token em memória (módulo, não `localStorage`)
- interceptor que, em 401, chama `/auth/refresh` uma vez e repete a requisição
- fila de requisições durante o refresh, para não disparar cinco refreshes
  simultâneos
- em `TOKEN_REUSE`, limpa tudo e manda para `/entrar`

**Rotas protegidas** com um `<RequireAuth>` que tenta o refresh no primeiro
carregamento antes de decidir redirecionar. Sem isso, recarregar a página desloga.

**Estado de auth** em Zustand: `user`, `permissions` (como `bigint`), `status`.

O medidor de senha usa `zxcvbn`, não contagem de caracteres, e não usa verde para
"forte" — verde significa presença online no produto.

### Testes

Vitest cobrindo: registro com convite válido e inválido; login certo e errado;
rotação normal; **detecção de reuso revogando a família**; TOTP correto,
incorreto e fora da janela; código de recuperação de uso único; hierarquia de
cargos bloqueando escalada.

## Aceite

- Convite gerado no banco à mão permite criar conta uma vez, e só uma
- Login devolve access token e grava o cookie
- Access token expirado é renovado sozinho, sem o usuário perceber
- Reapresentar um refresh token já usado derruba todas as sessões da família
- 2FA ativa, exige código no login e aceita código de recuperação
- Código de recuperação usado não funciona de novo
- Errar a senha 6 vezes ativa o rate limit com contagem regressiva
- Recarregar a página mantém a sessão
- `pnpm test` passa
- Nenhum token em `localStorage` (confira no DevTools)
