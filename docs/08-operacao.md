# Operação

Escrito para você mesmo daqui a seis meses, sem nenhuma memória do projeto.

Tudo aqui pressupõe: um servidor Linux, Docker com o plugin `compose`, o disco
cifrado com LUKS, acesso por Tailscale e o DNS na Cloudflare. Se algum desses
não for verdade, leia "O que muda sem cada peça" no fim.

---

## O mapa em cinco linhas

- **Caddy** atende 80/443, encerra o TLS e serve o front construído.
- **API** (Node) responde `/api/*` e o WebSocket `/ws`, no mesmo processo.
- **Postgres** guarda tudo o que é texto.
- **LiveKit** é o SFU da chamada; **coturn** é o relay por onde a mídia passa.
- **Storage** (R2 ou compatível) guarda anexo, avatar e backup.

O front é estático: `pnpm --filter @trindade/web build` gera `packages/web/dist`,
e o Caddy o serve. Não há Node servindo HTML.

---

## Implantar

```bash
./scripts/implantar.sh
```

A ordem importa e está no próprio script:

1. **backup**, antes de qualquer coisa;
2. **migrations**, com a versão antiga ainda no ar;
3. troca da imagem da API;
4. espera a saúde e **reverte sozinho** se ela não vier em 60s.

Migration antes da imagem porque o código novo espera o esquema novo — e o
código **velho** precisa sobreviver ao esquema novo por alguns segundos. É por
isso que toda migration é aditiva: coluna nova aceita nulo, coluna que sai é
abandonada numa versão e removida na seguinte.

Se a reversão acontecer, as migrations **não** são desfeitas. Isso é de
propósito: a versão anterior convive com o esquema novo, e desfazer migration
com dados em cima é como se perde dado de verdade.

### Publicar o front

```bash
pnpm install
pnpm --filter @trindade/web build
docker compose -f docker-compose.prod.yml restart caddy   # só se mudou o Caddyfile
```

O `dist` é montado no Caddy como volume: trocar os arquivos já basta. O
`index.html` vai com `no-cache` e os arquivos de `assets/` com um ano — eles
têm hash no nome.

---

## Backup

```bash
./scripts/backup.sh
```

`pg_dump` em formato `custom` (comprimido, e permite restaurar tabela a tabela),
gravado em `./backups` e enviado ao storage. Sete dias de cópias locais, trinta
no storage — a limpeza remota está no próprio script de envio, e não numa regra
de ciclo de vida do provedor, porque regra que mora no painel do provedor é
invisível aqui e ninguém lembra dela.

Automatize com uma entrada de cron do sistema:

```cron
17 4 * * * cd /srv/trindade && ./scripts/backup.sh >> /var/log/trindade-backup.log 2>&1
```

`17` e não `0`: todo mundo agenda às zero e o storage sente.

### Restaurar

**Ensaie antes de precisar.** Num banco à parte, sem tocar no que está no ar:

```bash
./scripts/restaurar.sh ./backups/trindade-20260904-144320.dump trindade_ensaio
```

Por cima do banco de produção, o script pede o nome do banco digitado, para a
API antes e a devolve depois:

```bash
./scripts/restaurar.sh ./backups/trindade-20260904-144320.dump
```

**Medido em 4 de setembro de 2026**, no ambiente de desenvolvimento: dump de
**104 KB** com 8 pessoas, 4 canais e 267 mensagens, restaurado em **1 segundo**
(2,2s incluindo derrubar e recriar o banco). O script conta as três tabelas ao
final — se os números vierem zerados, a restauração falhou mesmo tendo dito que
terminou.

Numa base de um ano de uso, espere alguns megabytes e alguns segundos. O que
demora numa restauração real não é o banco: é decidir de qual backup restaurar.

**Anexos não estão no dump.** Eles vivem no storage, que tem versionamento
próprio. Um "restaurar tudo" completo é: dump do banco + o balde de anexos no
mesmo instante.

---

## Adicionar uma pessoa

Não existe cadastro aberto. Quem tem `MANAGE_ROLES` abre **Pessoas › Convidar**,
o link vale por 7 dias e para uma pessoa só. A pessoa abre o link, escolhe nome
de usuário e senha, e entra sem ninguém precisar aprovar depois.

Pelo terminal, se a interface estiver fora do ar:

```bash
docker compose -f docker-compose.prod.yml exec api pnpm dev:admin   # só emergência
```

---

## Alguém perdeu o segundo fator

Cada pessoa recebeu **códigos de recuperação** ao ativar o 2FA. Um deles entra
no lugar do código do aplicativo, e é gasto no uso.

Sem nenhum código, o caminho é pelo banco — e é deliberadamente manual, porque
"desligar o 2FA de alguém" é exatamente o que um invasor tentaria pedir:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U trindade -d trindade -c \
  "update users set totp_secret = null, totp_enabled_at = null where username = 'fulano'"
```

Depois avise a pessoa **por outro canal** — telefone, presencialmente — e peça
que reative o 2FA na primeira entrada. Um pedido de reset que chegou por
mensagem escrita não é prova de nada.

---

## Quando as chamadas ficam ruins

Na ordem, do mais provável ao menos:

1. **Alguém está com a conexão ruim.** A barra de chamada mostra três barras de
   qualidade por pessoa; quem estiver em vermelho é a resposta.
2. **A transmissão de tela está pesada demais.** Quem transmite vê o preset e o
   bitrate real. "Nítido e fluido" em rede doméstica brasileira costuma não
   fechar; "Padrão" fecha.
3. **O relay está saturado.** `docker compose -f docker-compose.prod.yml logs
   coturn | tail -50`. Cada pessoa numa chamada consome uma porta da faixa
   `50201-50400`; se ela esgotar, ninguém mais entra.
4. **O SFU está sem CPU.** `docker stats livekit`. Transmissão em 1440p60 com
   três camadas de simulcast é o que mais pesa.

O que **não** é a causa, e sempre parece ser: o navegador de quem reclama. Antes
de pedir para reinstalar qualquer coisa, olhe as três barras.

---

## Logs

- **Caddy**: desligado de propósito (`output discard`). Não adianta esconder IP
  na chamada se o proxy grava tudo.
- **API**: `docker compose -f docker-compose.prod.yml logs -f api`. Sem IP, sem
  cabeçalho, sem user-agent — os serializadores em `app.ts` cuidam disso.
- **Retenção**: o Docker rotaciona com `max-size`/`max-file` do daemon; ajuste
  em `/etc/docker/daemon.json` para 7 dias de equivalente.

Se precisar depurar algo que **exige** IP, ligue o log de acesso do Caddy
temporariamente, resolva, e desligue de novo. Deixar ligado "por enquanto" é
como o registro vira permanente.

---

## Métricas

`https://dominio/api/metrics`, com `Authorization: Bearer $METRICS_TOKEN`.

Sem o token não serve nada — e sem `METRICS_TOKEN` no `.env`, a rota se recusa a
responder. Um Prometheus apontando para lá enxerga conexões de WebSocket,
mensagens por minuto, latência por rota e erros por código. Nenhum rótulo
identifica ninguém: a rota vira o padrão (`/api/channels/:id/messages`), nunca a
URL com id.

Alertas que valem a pena, nesta ordem:

| Alerta | Regra |
|---|---|
| API fora | `/api/health` não responde 200 por 2 minutos |
| Disco | acima de 85% |
| Erro 5xx | `trindade_erros_total{status=~"5.."}` subindo mais de 10/min |
| Banco | `trindade_http_duracao_segundos` acima de 1s no p95 |

---

## Firewall e rede

- **443 e 80 abertos só para os ranges da Cloudflare.** Sem isso, basta escanear
  a faixa do provedor e o proxy vira decoração. A lista muda; puxe de
  `https://www.cloudflare.com/ips-v4` e `ips-v6` e reaplique num cron mensal.
- **SSH não fica exposto.** Só por Tailscale.
- **UDP 50000-50200** (LiveKit) e **50201-50400** (coturn) abertos ao mundo —
  mídia não passa pela Cloudflare.
- **3478 e 5349** para o coturn.

```bash
ufw default deny incoming
ufw allow in on tailscale0
for faixa in $(curl -s https://www.cloudflare.com/ips-v4); do ufw allow from "$faixa" to any port 443 proto tcp; done
ufw allow 3478
ufw allow 5349
ufw allow 50000:50400/udp
ufw enable
```

---

## O que muda sem cada peça

- **Sem Cloudflare**: 443 aberto ao mundo. Vale mais a pena então trocar o
  domínio por um nome que não esteja em lista nenhuma e aceitar o risco.
- **Sem Tailscale**: SSH com chave, porta alta, `fail2ban`. Pior, mas passa.
- **Sem LUKS**: um disco que sai do datacenter leva as mensagens junto. Para
  cinco pessoas conversando sobre trabalho, é o item que eu não abriria mão.
- **Sem storage externo**: anexo e backup no mesmo disco da aplicação, e aí o
  backup só protege contra engano, não contra perda de máquina.
