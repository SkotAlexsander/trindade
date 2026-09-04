# Comece aqui

Roteiro linear. Siga de cima para baixo. Cada passo diz o que abrir, o que
colar, o que testar e quando fazer commit.

Tempo total estimado: 20 a 25 sessões de trabalho com o Claude Code, mais o
tempo de revisão sua entre elas. Não é um fim de semana; é um projeto de
algumas semanas feito com calma.

---

## Passo 0 — Ambiente

Antes de qualquer prompt.

**Instale:**

```bash
# Node 20 LTS
node --version        # v20.x

# pnpm
npm install -g pnpm
pnpm --version        # 9.x

# Docker com Compose
docker --version
docker compose version

# Claude Code
npm install -g @anthropic-ai/claude-code
claude --version
```

**Crie o projeto:**

```bash
mkdir cinco && cd cinco
# copie para cá: CLAUDE.md, README.md, COMECE-AQUI.md, docs/, design/, prompts/
git init
git add -A
git commit -m "specs: pacote inicial"
```

Esse commit é o seu ponto de referência. Tudo o que o Claude Code escrever vai
aparecer como diferença contra ele.

**Abra no VS Code:**

```bash
code .
```

No terminal integrado:

```bash
claude
```

O Claude Code lê o `CLAUDE.md` sozinho. Confirme com uma pergunta simples:

```
Resuma em 3 linhas as regras inegociáveis deste projeto.
```

Se ele citar elenco fixo, servidor decide, nenhum segredo no cliente, relay
forçado e re-encode de imagem, está lendo o arquivo certo. Se não, o
`CLAUDE.md` não está na raiz.

**Decida as três coisas do `README.md`** e escreva no fim do `CLAUDE.md`, na
seção "Estado atual":

```
## Decisões

- E-mail no cadastro: não
- Hospedagem: Hetzner CX22, coturn e LiveKit no mesmo servidor por ora
- Desktop: sim, Tauri na fase 8
```

Commit: `git commit -am "decisões iniciais"`.

---

## Como funciona cada fase

O ritmo é sempre o mesmo. Memorize-o uma vez e repita dez.

```
1. Abrir sessão nova do Claude Code
2. Colar o prompt de abertura (abaixo)
3. Colar o arquivo prompts/fase-NN inteiro
4. Deixar terminar sem interromper
5. Rodar os testes automáticos
6. Testar à mão os critérios de aceite
7. Se falhou, apontar o específico e voltar ao 4
8. Colar o prompt de fechamento
9. git commit
```

### Prompt de abertura

Cole isto **antes** do prompt da fase, em toda sessão nova:

```
Vamos trabalhar na fase N. Antes de começar:

1. Leia o CLAUDE.md e confirme que entendeu o estado atual.
2. Leia os arquivos listados em "Leia antes" no prompt que vou colar a seguir,
   na íntegra, antes de escrever qualquer código.
3. Se algo no prompt conflitar com os documentos, pare e me pergunte. Não
   escolha sozinho.
4. Ao terminar cada bloco de "Entregar", diga em uma linha o que fez e siga
   para o próximo sem esperar minha aprovação.
5. Não marque nada como concluído sem ter rodado.

Aqui está o prompt da fase:
```

E então cole o conteúdo de `prompts/fase-NN`.

### Prompt de fechamento

Quando os critérios de aceite passarem:

```
Fase N concluída. Faça o seguinte:

1. Marque a fase N no checklist do CLAUDE.md.
2. Abaixo do checklist, em "Estado atual", escreva até 5 linhas sobre o que
   ficou pendente, simplificado ou decidido diferente do prompt.
3. Rode pnpm typecheck e pnpm test uma última vez e cole o resultado.
4. Liste os arquivos criados e modificados nesta fase.
```

Depois:

```bash
git add -A
git commit -m "fase N: <o que foi entregue>"
```

### Se a sessão travar

Sinais: o Claude Code começa a repetir coisas, esquece decisões do início da
sessão, ou fica muito lento. Acontece nas fases 5, 7 e 9, que são longas.

```
Pare aqui. Crie PROGRESSO.md na raiz com:
- o que já está pronto nesta fase, com os arquivos
- o que falta, em ordem
- decisões que você tomou que não estavam no prompt
- qualquer coisa quebrada que você sabe que está quebrada
```

Feche a sessão, abra outra, cole o prompt de abertura e depois:

```
Continue a fase N a partir do PROGRESSO.md. Leia-o primeiro. Apague-o quando
a fase terminar.
```

---

## Passo 1 — Fundação

**Sessões:** 1
**Arquivo:** `prompts/fase-01-fundacao.md`

**Teste automático:**

```bash
docker compose up -d
docker compose ps                  # postgres e minio "healthy"
pnpm install
pnpm migrate up
pnpm typecheck
pnpm dev
```

**Teste à mão:**

```bash
curl localhost:3000/api/health     # {"ok":true,"db":true}
pnpm bootstrap                     # cria o primeiro admin
pnpm bootstrap                     # deve recusar: USERS_EXIST
pnpm migrate down                  # desfaz as 10
pnpm migrate up                    # refaz
```

Abra `localhost:5173`. Deve mostrar o health check.

**Confira no `psql`:**

```sql
select name, position from roles;         -- Membro e Admin
select slug from channels;                -- geral
select username from users;               -- o admin do bootstrap
```

**Commit:** `fase 1: fundação`

**Se der errado:** o erro mais comum aqui é porta ocupada (5432 ou 9000) ou
Docker sem permissão. Resolva antes de pedir ajuda ao Claude Code — ele não vê
o seu sistema.

---

## Passo 2 — Autenticação

**Sessões:** 2
**Arquivo:** `prompts/fase-02-auth.md`

Esta fase tem o maior risco de erro sutil. Não pule nenhum teste.

**Teste automático:**

```bash
pnpm test                          # todos os testes de auth
pnpm typecheck
```

**Teste à mão, nesta ordem:**

1. Gere um convite no `psql`:
   ```sql
   insert into invites (code, created_by, expires_at)
   values ('TESTE123', (select id from users limit 1), now() + interval '1 day');
   ```
2. Abra `localhost:5173/entrar/TESTE123`. Deve mostrar quem convidou e nada
   mais.
3. Crie uma conta. Deve ir para `/entrar` sem logar.
4. Tente usar o mesmo convite de novo. Deve recusar.
5. Entre com a conta nova.
6. Abra o DevTools → Application → Local Storage. **Não pode haver token.**
   Cookies: deve haver `rt` com HttpOnly marcado.
7. Recarregue a página. Deve continuar logado.
8. Espere 16 minutos (ou mude a validade para 30s no `.env` de dev). Faça
   qualquer ação. Deve renovar sozinho, sem deslogar.
9. Erre a senha 6 vezes. Deve mostrar contagem regressiva.
10. Ative 2FA nas configurações. Escaneie com o Google Authenticator ou Aegis.
    Guarde um código de recuperação.
11. Saia e entre de novo. Deve pedir o código.
12. Entre com o código de recuperação. Tente usá-lo de novo. Deve recusar.

**Teste de reuso de token** (o mais importante):

```bash
# copie o valor do cookie rt do DevTools
curl -X POST localhost:3000/api/auth/refresh -H "Cookie: rt=VALOR" -c jar.txt
# funciona e devolve um novo
curl -X POST localhost:3000/api/auth/refresh -H "Cookie: rt=VALOR"
# mesmo VALOR antigo: deve devolver 401 TOKEN_REUSE
```

Volte ao navegador: deve ter sido deslogado. A família inteira caiu.

**Commit:** `fase 2: autenticação`

---

## Passo 3 — Design system

**Sessões:** 1
**Arquivo:** `prompts/fase-03-design-system.md`

**Teste à mão:**

1. Abra `localhost:5173/dev/ui`.
2. Percorra todos os primitivos nos dois temas.
3. Troque o tema e recarregue. Não pode piscar branco.
4. Navegue só com `Tab`. Todo elemento interativo precisa mostrar o anel de
   foco.
5. DevTools → Network → recarregue. **Nenhuma requisição para domínio
   externo.** Fontes devem vir de `/fonts/`.
6. Ative "reduce motion" no sistema. As animações precisam sumir.

**Busca por valores literais:**

```bash
grep -rn "#[0-9a-fA-F]\{6\}" packages/web/src --include="*.css" --include="*.tsx" | grep -v tokens.css
```

Deve voltar vazio. Se voltar algo, é token faltando.

**Commit:** `fase 3: design system`

---

## Passo 4 — Shell

**Sessões:** 2
**Arquivo:** `prompts/fase-04-shell.md`

**Teste à mão:**

1. Crie mais quatro contas com convites (para ter cinco no elenco).
2. Entre com uma. O painel do elenco deve mostrar cinco espaços, quatro
   esmaecidos.
3. Recarregue. A sequência de acender deve rodar uma vez.
4. Abra uma segunda janela anônima com outra conta. No elenco da primeira, a
   segunda pessoa deve acender.
5. Crie um canal pelo menu. Sem `MANAGE_CHANNEL`, o item não deve aparecer.
6. Arraste canais para reordenar.
7. `Ctrl/⌘ K`, digite parte de um nome. Deve encontrar canal e pessoa.
8. Estreite a janela para 800px. Deve virar pilha com gaveta, e o elenco
   precisa estar no topo da gaveta.
9. Estreite para 380px. Ainda usável, alvos de toque de 44px.
10. Clique no compositor e aperte `Alt ↓`. **Não** pode trocar de canal.

**Commit:** `fase 4: shell`

---

## Passo 5 — Mensagens

**Sessões:** 2 a 3
**Arquivo:** `prompts/fase-05-realtime-mensagens.md`

A fase mais longa. Provável que precise do procedimento de `PROGRESSO.md`.

**Teste automático:**

```bash
pnpm test
```

**Teste à mão, com duas janelas de contas diferentes lado a lado:**

1. Mande mensagem em uma. Deve aparecer na outra em menos de 200ms.
2. Mande cinco seguidas em menos de 5 minutos. Devem agrupar sem repetir
   avatar.
3. Abra duas abas da **mesma** conta. As duas recebem.
4. Na aba que recebe, role para cima até o meio do histórico. Mande mensagem
   pela outra. **A tela não pode se mover.** Deve aparecer o botão "N novas".
5. Role até o topo repetidamente. Ao carregar histórico antigo, a tela não
   pode saltar.
6. Edite, apague, reaja, responda. Cada uma propaga.
7. Mande `@nome` da outra conta. Na outra, a mensagem ganha fundo e borda.
8. Mande um link. A prévia deve aparecer — e no DevTools da conta que **lê**,
   não pode haver requisição para o domínio do link.
9. Busque uma palavra com acento e sem. Ambas encontram.
10. Mande um bloco de código com linguagem. Realce e botão de copiar.

**Teste de reconexão:**

```bash
# com as duas janelas abertas
docker compose stop            # ou mate a API com Ctrl+C
```

Espere 3 segundos. A faixa "Sem conexão" deve aparecer. Digite uma mensagem e
envie — fica na fila, esmaecida.

```bash
pnpm dev                       # suba de novo
```

A faixa some, a mensagem da fila sai, a outra janela recebe.

**Teste de revalidação:**

Com a conta B logada, desative-a pelo `psql`:

```sql
update users set disabled_at = now() where username = 'b';
```

Em até 60 segundos, a janela de B deve ser desconectada.

**Teste de duplicata:**

DevTools → Network → Throttling → "Offline". Envie três mensagens. Volte para
"Online". Devem chegar uma vez cada, sem duplicar.

**Commit:** `fase 5: mensagens em tempo real`

---

## Passo 6 — Perfil e cargos

**Sessões:** 2
**Arquivo:** `prompts/fase-06-perfil-cargos.md`

**Teste de EXIF** (o mais importante desta fase):

1. Tire uma foto com o celular, com localização ligada.
2. Confira que tem GPS:
   ```bash
   exiftool foto.jpg | grep -i gps      # deve mostrar coordenadas
   ```
3. Envie como avatar.
4. Baixe o avatar servido pela aplicação.
5. Confira:
   ```bash
   exiftool avatar.webp | grep -i gps   # deve voltar VAZIO
   ```

Se voltar alguma coisa, a fase falhou. Não avance.

**Teste de upload malicioso:**

```bash
echo "isto não é imagem" > falso.png
# envie falso.png como avatar → deve recusar com INVALID_IMAGE
```

**Teste de hierarquia, com duas contas:**

1. Crie um cargo "Moderador" com `position` 50 e `MANAGE_ROLES`.
2. Dê a B.
3. Como B, tente atribuir "Admin" (position 100) a alguém. Deve recusar
   `HIERARCHY_VIOLATION`.
4. Como B, tente desativar A (que é Admin). Deve recusar.
5. Como B, na página de cargos, "Admin" deve aparecer esmaecido.

**Teste de propagação:**

Troque o avatar em uma janela. A outra deve atualizar sem recarregar.
Mude o cargo de B pela conta A. A janela de B deve refletir em até 60s.

**Commit:** `fase 6: perfil e cargos`

---

## Passo 7 — Voz e tela

**Sessões:** 3
**Arquivo:** `prompts/fase-07-voz-tela.md`

Precisa de duas máquinas diferentes, ou uma máquina e um celular, **em redes
diferentes**. Testar na mesma rede não valida o relay.

**Antes de testar:**

```bash
docker compose ps              # livekit e coturn "healthy"
docker compose logs coturn | tail -20
```

**Teste de privacidade** (o que importa):

1. Entre na chamada com as duas máquinas.
2. Em cada uma, abra `chrome://webrtc-internals`.
3. Procure a seção de ICE candidates da conexão ativa.
4. **Todos os candidatos usados precisam ser `relay`.** Se aparecer `host` ou
   `srflx` como candidato selecionado, o `iceTransportPolicy` não está
   aplicado. A fase falhou.

**Teste do coturn:**

```bash
# de fora do servidor
turnutils_uclient -v -t -u USER -w PASS turn.exemplo.com -p 5349 -e 10.0.0.1
# deve recusar o peer interno
```

**Teste de tela:**

1. Compartilhe em "Nítido e fluido". Na barra, o bitrate real deve subir
   acima de 12 Mbps em rede boa.
2. Na outra máquina, **não** clique em "Assistir". No webrtc-internals dela,
   a trilha de tela não pode estar recebendo pacotes.
3. Clique em "Assistir". Deve começar.
4. Diminua a janela de quem assiste. Em alguns segundos, a resolução recebida
   deve cair (webrtc-internals → `frameHeight`).
5. Maximize. Deve subir em até 3s.
6. Troque o preset no meio. O seletor nativo não pode reaparecer.
7. Pare pela barra do navegador (não pelo botão do produto). O botão do
   produto precisa atualizar.
8. Teste janela flutuante, zoom com rolagem e `Alt` + clique.
9. Repita o compartilhamento no Firefox e no Safari. O aviso de áudio deve
   aparecer.

**Teste de fala:**

Fale com pausas curtas. O anel âmbar não pode piscar — entra rápido, sai
devagar.

**Commit:** `fase 7: voz e tela`

---

## Passo 8 — Endurecimento

**Sessões:** 2
**Arquivo:** `prompts/fase-08-endurecimento.md`

A partir daqui os testes são em produção, no VPS.

**Antes de implantar:**

```bash
gitleaks detect --source . --log-opts="--all"    # histórico inteiro
pnpm audit
pnpm test
```

Se o `gitleaks` encontrar algo, o segredo precisa ser **rotacionado**, não só
removido do arquivo. Ele já está no histórico.

**Depois de implantar:**

1. `https://www.ssllabs.com/ssltest/` → nota A ou superior.
2. `https://securityheaders.com/` → nota A.
3. Abra o produto com o console. **Nenhuma violação de CSP.**
4. Tente acessar o IP do servidor diretamente na 443. Deve recusar (firewall
   só aceita Cloudflare).
5. `tail -f` no log do Caddy enquanto navega. **Nenhum IP em claro.**
6. Rode o backup à mão. Rode a restauração num banco vazio. Cronometre.
   Anote o tempo em `docs/08-operacao.md`.
7. `k6 run load/ws.js` com 50 conexões. A API não pode cair.
8. Percorra o checklist de `docs/04-seguranca.md` item por item. Marque só
   depois de ver funcionando.

**Commit:** `fase 8: produção`

**Tag:** `git tag v1.0` — a partir daqui o grupo pode usar.

---

## Passo 9 — Projeto e notificações

**Sessões:** 3
**Arquivo:** `prompts/fase-09-projeto-notificacoes.md`

**Teste à mão, duas janelas:**

1. Abra as notas do mesmo canal nas duas. Digite ao mesmo tempo em lugares
   diferentes. Nada pode se perder e os cursores devem aparecer.
2. Feche uma janela no meio da digitação. Reabra. O texto está lá.
3. "Adicionar às notas" a partir de uma mensagem. Deve anexar com link de
   volta.
4. "Criar tarefa" de uma mensagem. Título pré-preenchido, elo nos dois lados.
5. Arraste uma tarefa entre outras duas. No `psql`, só **uma** linha deve ter
   mudado.
6. Conclua uma tarefa. Mensagem de sistema no canal.
7. Crie uma enquete anônima. Vote nas duas contas. No `psql` os votos existem;
   pela API, `GET` não pode devolver quem votou.
8. Mencione a outra conta. Som e notificação desktop.
9. Mande mensagem comum. Só o ponto na lista, sem som.
10. Responda na sua própria thread. **Nada** deve notificar você.
11. Silencie um canal. Mande menção nele pela outra conta. Deve passar.

**Commit:** `fase 9: projeto e notificações`

---

## Passo 10 — Privadas e quadro

**Sessões:** 3
**Arquivo:** `prompts/fase-10-privadas-quadro.md`

**Teste à mão:**

1. Abra uma direta com B pelo cartão de perfil. Mande mensagem.
2. Em duas abas ao mesmo tempo, abra direta com C. No `psql`, deve existir
   **uma** conversa, não duas.
3. Como Admin, tente `GET /api/conversations/{id}/messages` de uma conversa
   da qual não é membro. Deve dar 403.
4. Busque uma palavra que está numa direta, a partir de um canal. Não pode
   aparecer.
5. Crie um grupo. Saia dele com uma conta. As outras ainda veem o histórico.
6. Abra um quadro nas duas janelas. Desenhe ao mesmo tempo. Nenhum traço se
   perde.
7. Clique em "Apresentar" em uma. Na outra, o zoom e a rolagem seguem.
8. Na outra, "soltar". Navegue livre. "Voltar a seguir". Volta.
9. `Alt` + clique como espectador. Ponto aparece para o apresentador e some.
10. Feche o quadro. Baixe a miniatura. `exiftool` limpo.
11. No console: `navigator.geolocation.getCurrentPosition(() => {})`. Deve
    lançar erro de política.

**Commit:** `fase 10: privadas e quadro`
**Tag:** `git tag v1.1`

---

## Depois

O pacote termina aqui. O que vem depois é uso.

Coisas que os documentos deixam como gancho, para quando alguém pedir:

- Transcrição de chamada com Whisper — `docs/06`, fim
- Histórico de versões das notas — `design/08`
- Push no celular — `design/09`, fim
- E2EE com MLS — `docs/01`
- Tauri com captura nativa — `design/12`, fim

Nenhum deles antes de o grupo usar o produto por um mês. O que vai faltar de
verdade quase nunca é o que parecia faltar antes de usar.

---

## Prompts reutilizáveis

Para colar em qualquer momento.

**Revisar o que foi feito:**

```
Leia os arquivos que você modificou nesta sessão e me aponte, sem corrigir
ainda: qualquer lugar onde o cliente decide algo que o servidor deveria
decidir, qualquer valor literal de cor ou espaço fora de tokens.css, qualquer
uso de any, e qualquer checagem de permissão que existe no front e não no back.
```

**Quando algo funciona mas parece frágil:**

```
Isto funciona mas eu não confio. Escreva um teste que quebre se [descreva o
comportamento] parar de funcionar, rode, e me mostre o teste falhando antes de
consertar.
```

**Quando o Claude Code "melhora" algo que não devia:**

```
Você mudou [X]. O documento [design/NN] especifica [Y] e explica o motivo.
Reverta para o que está no documento. Se você acha que o documento está
errado, me diga por quê e eu decido.
```

**Antes de qualquer commit grande:**

```
Rode pnpm typecheck, pnpm test e pnpm lint. Cole os três resultados. Se algum
falhar, corrija e rode de novo até os três passarem.
```

**Quando não sabe se está pronto:**

```
Percorra os critérios de aceite da fase N um por um. Para cada um, diga se
passou, e se passou, como você verificou. Se não verificou, não diga que
passou.
```
