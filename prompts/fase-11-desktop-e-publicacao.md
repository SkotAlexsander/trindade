# Fase 11 — Aplicativo de mesa e publicação

O produto já roda no navegador. Falta ele virar um programa que se baixa e se
abre como qualquer outro — estilo Discord —, e falta ele estar no ar num
endereço de verdade.

São duas coisas independentes. Faça a que precisar primeiro; nenhuma depende da
outra.

Leia antes: `CLAUDE.md` inteiro, `docs/08-operacao.md`,
`docs/07-permissoes-do-navegador.md` (a seção "Desktop") e `design/12-*.md` se
existir.

---

## Parte A — O aplicativo de mesa (Tauri)

### Por que Tauri e não Electron

O front já é estático (`packages/web/dist`, servido pelo Caddy). Tauri embrulha
esse mesmo `dist` num binário de 8 a 15 MB usando o WebView do sistema; o
Electron carregaria um Chromium inteiro de 150 MB para exibir a mesma página.
Para cinco pessoas num programa que fica aberto o dia todo ao lado de uma
chamada, a diferença é memória que sai do lugar errado.

**O código do produto não muda.** O que muda é onde ele roda e o que ele pode
fazer a mais.

### O que entregar

**Empacotamento.** `packages/desktop/` com a estrutura do Tauri v2, apontando
para o `dist` do `@trindade/web`. O `beforeBuildCommand` roda o build do web, e
o `devUrl` aponta para o servidor de desenvolvimento na 5173 — assim `pnpm
desktop:dev` recarrega igual ao navegador.

**A janela abre no lugar certo.** Tamanho mínimo de 940×600 — abaixo disso o
shell vira gaveta e um programa de mesa que abre em modo telefone parece
quebrado. Lembre posição e tamanho entre execuções.

**Notificação nativa.** O produto já pede permissão de notificação do navegador
e a usa na primeira menção (`docs/07-permissoes-do-navegador.md`). No Tauri, o
plugin `notification` fala com o sistema e **não** pede permissão de navegador.
Ponha isso atrás da camada que o `CLAUDE.md` manda existir: o resto do código
não deve saber em qual dos dois está rodando.

**Ícone na bandeja**, com o menu mínimo: abrir, silenciar microfone, sair. Fechar
a janela esconde na bandeja em vez de encerrar — um programa de conversa que
morre ao fechar a janela perde a notificação, que é metade do motivo de ele
existir.

**Atalho global de mudo.** `Ctrl/⌘ ⇧ M` funcionando com a janela em segundo
plano. É o atalho que se usa com a mão longe do teclado, no meio de uma frase de
outra pessoa; se ele exigir foco na janela, não serve para nada.

**Atualização automática.** O `updater` do Tauri, assinado, apontando para as
releases do GitHub. Sem isso, cinco pessoas ficam em cinco versões diferentes e
o primeiro bug de protocolo entre elas é impossível de depurar.

### O que vai te morder

**A permissão de mídia é do sistema, não do navegador.** No macOS, sem
`NSMicrophoneUsageDescription` e `NSCameraUsageDescription` no `Info.plist`, o
`getUserMedia` falha em silêncio — e o produto tem `estadoDaPermissao()` em
`packages/web/src/lib/midia.ts` justamente para não deixar ninguém olhando um
"conectando" que nunca sai. Confira que o caminho de erro continua honesto no
desktop.

**A CSP vale dentro do Tauri.** Ela vive no `tauri.conf.json`, não no Caddy, e
precisa ser a mesma de `infra/cabecalhos.caddy` — incluindo o
`frame-src https://www.youtube-nocookie.com` do cartão de vídeo, senão o player
não abre e ninguém entende por quê. Uma política que diverge da outra é como o
desktop passa a ter bugs que o navegador não tem.

**O token de acesso continua só na memória.** Não guarde credencial no store do
Tauri "porque agora dá". O refresh continua no cookie `httpOnly`, e o WebView
manda cookie igual ao navegador. Se você precisar mexer nisso, releia
`docs/04-seguranca.md` antes.

**`iceTransportPolicy: 'relay'` continua obrigatório.** O WebView não muda essa
regra, e o Tauri não é desculpa para vazar IP entre membros.

**Uma origem, não `file://`.** Sirva o `dist` pelo protocolo do Tauri e aponte a
API para o domínio de produção por variável de ambiente. `file://` quebra
cookie, CSP e WebSocket de uma vez só.

### Aceite da parte A

- O instalador de cada plataforma abre e o produto entra normalmente
- Chamada conecta, e `getStats()` mostra só candidatos de relay
- Notificação nativa aparece com a janela minimizada
- `Ctrl/⌘ ⇧ M` muta com o foco em outro programa
- Fechar a janela não encerra; a bandeja reabre
- O vídeo do YouTube toca (a CSP do Tauri permite o `frame-src`)
- Uma versão nova é baixada e aplicada sozinha
- Nenhuma credencial em disco: procure por token no perfil do app

---

## Parte B — Publicar

### O que o projeto assume

Um servidor Linux com Docker, disco cifrado com LUKS, acesso por Tailscale e o
DNS na Cloudflare — como proxy na frente, não como hospedagem. `docs/08-operacao.md`
tem o procedimento inteiro, incluindo reversão e restauração de backup.

**A API não roda em Cloudflare Workers**, e não é questão de configuração: o
`sharp` é binário nativo, o gateway de WebSocket e os documentos Yjs vivem na
memória de um processo longo, o `postgres.js` fala TCP, e LiveKit e coturn são
servidores com faixa larga de UDP. Se alguém pedir "põe na Cloudflare", o que
cabe lá é o DNS, o TLS e o proxy — e é exatamente o que o projeto já espera.

### Passo a passo

1. **Provisione a máquina.** Qualquer VPS com 4 GB serve para cinco pessoas.
   Disco em LUKS, Tailscale instalado, Docker com o plugin `compose`.
2. **DNS na Cloudflare**, com o proxy ligado, para `dominio` e `midia.dominio`.
3. **Firewall: 443 e 80 só para as faixas da Cloudflare.** Sem isso, basta
   escanear a faixa do provedor e o proxy vira decoração. A lista muda; puxe de
   `cloudflare.com/ips-v4` num cron mensal.
4. **`.env` a partir do `.env.example`**, com segredos gerados de verdade
   (`pnpm keygen` para as chaves). Confira `VAGAS` — é quantas contas o cadastro
   aberto aceita antes de fechar sozinho.
5. **`./scripts/implantar.sh`.** Ele faz backup, aplica migrations com a versão
   antiga ainda no ar, troca a imagem e reverte sozinho se a saúde não vier em
   60 segundos.
6. **Abra o endereço e crie a primeira conta.** Ela vira **Admin**
   automaticamente. As contas de desenvolvimento não existem em produção — o
   `dev-seed` recusa rodar com `NODE_ENV=production`.
7. **Feche a porta quando o grupo entrar.** `VAGAS=0` no `.env` e reinicie a
   API; a partir daí só se entra por convite.
8. **Backup e vigia.** Confirme o `backup.sh` no cron e instale o
   `scripts/vigia.sh` como timer do systemd — é ele que avisa quando a API cai,
   porque processo caído não manda webhook.

### Aceite da parte B

- SSL Labs nota A ou superior
- `curl` direto no IP da máquina, sem passar pela Cloudflare, não responde
- A primeira conta criada pelo site é Admin
- `VAGAS=0` faz o cadastro recusar, e o convite continua funcionando
- Uma restauração de backup foi executada de verdade, com o tempo anotado
- Derrubar a API dispara o aviso do vigia, e voltar dispara o "voltou"
- Os itens do checklist de `docs/04-seguranca.md` que dependem do servidor
  ficam marcados — e só depois de verificados na prática

---

## Como pedir isto ao Claude Code

Abra o projeto e cole:

```
Leia o CLAUDE.md e depois prompts/fase-11-desktop-e-publicacao.md.
Faça a Parte A (aplicativo de mesa com Tauri).
Vá em fatias: empacotar e abrir primeiro, depois bandeja e notificação,
depois atalho global, depois atualização automática. Verifique cada fatia
rodando o aplicativo de verdade antes de seguir para a próxima, e faça
commit ao fim de cada uma explicando o porquê, não o quê.
```

Troque "Parte A" por "Parte B" para a publicação. **Não peça as duas na mesma
sessão** — a primeira mexe em empacotamento e a segunda em servidor, e misturar
as duas transforma qualquer erro numa caça ao tesouro.
