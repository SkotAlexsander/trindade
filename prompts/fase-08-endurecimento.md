# Fase 8 — Endurecimento e produção

Rate limit, headers, logs sem IP, backup, testes e implantação. A fase que
decide se o projeto é um protótipo ou algo que roda de verdade.

Leia antes: `docs/04-seguranca.md` inteiro, com atenção ao checklist final.

## Entregar

### Headers

Bloco completo de `docs/04-seguranca.md` no Caddy: CSP, HSTS, `nosniff`,
`Referrer-Policy: no-referrer`, `Permissions-Policy`.

Teste a CSP com o console aberto. Se houver violação, **corrija o código, não
relaxe a política** — `unsafe-inline` em `script-src` anula o benefício inteiro.

`frame-ancestors 'none'` e `geolocation=()`.

### Rate limit

A tabela completa, incluindo os limites do WebSocket. Chave sempre com **hash do
IP e sal que rotaciona diariamente**, nunca o IP em claro.

Backoff progressivo no login, não bloqueio de conta — bloquear é vetor de negação
de serviço contra um membro legítimo.

### Logs

- Caddy: log de acesso desligado, ou com o último octeto do IPv4 e os últimos 80
  bits do IPv6 truncados
- API: nenhum `req.ip` em log de aplicação
- Retenção de 7 dias, rotação automática

Não adianta esconder IP na chamada se o proxy grava tudo.

### Limpezas periódicas

Um worker no mesmo processo, com `node-cron`:
- anexos órfãos com mais de 1 hora
- `client_nonce` com mais de 24 horas
- refresh tokens expirados há mais de 30 dias
- `audit_log` com mais de 180 dias

### Backup

`pg_dump` diário comprimido, enviado para storage fora do servidor da aplicação,
retenção de 30 dias.

**Escreva e execute o script de restauração.** Backup não testado não é backup.
Documente o procedimento em `docs/08-operacao.md`, com o tempo real que a
restauração levou.

### Observabilidade

Métricas em `/metrics` (Prometheus), protegido: conexões WebSocket, mensagens por
minuto, latência das rotas, tamanho do pool, erros por código.

Health check que verifica banco e storage de verdade, não só responde 200.

Alerta simples por webhook: API fora do ar, disco acima de 85%, erro 5xx acima do
normal.

### Testes

- Unitários de auth, permissões, hierarquia e utilitários de imagem
- Integração das rotas críticas com banco real em container
- Um teste end-to-end com Playwright: entrar, mandar mensagem, ver chegar em
  outra sessão
- Carga com k6 nos WebSockets — 50 conexões simultâneas, dez vezes o uso real, só
  para saber onde quebra

### Auditoria

Rode `gitleaks` no **histórico inteiro**, não só no HEAD. Se algum segredo já foi
commitado alguma vez, ele precisa ser rotacionado, não apenas removido.

`pnpm audit` e correção do que for explorável.

Percorra o checklist final de `docs/04-seguranca.md` item por item e marque cada
um só depois de verificar na prática.

### Implantação

`docker-compose.prod.yml`, Caddyfile com TLS automático, systemd ou Docker
restart policy, e um script de deploy que aplica migrations antes de trocar a
imagem.

Firewall: 443 aberto **só para os ranges da Cloudflare**. Sem essa parte, basta
escanear a faixa do provedor e o proxy é decorativo. SSH via Tailscale.

Disco criptografado com LUKS.

### `docs/08-operacao.md`

Escreva o manual: como implantar, como reverter, como restaurar o backup, como
adicionar uma pessoa, como resetar a senha de alguém que perdeu o 2FA, o que
fazer quando as chamadas ficarem ruins, e onde ficam os logs.

Escreva pensando em você mesmo daqui a seis meses, sem nenhuma memória do projeto.

### Tauri, se quiser

Empacotamento desktop, notificação nativa, ícone na bandeja, atalho global de
mudo e atualização automática.

## Aceite

- CSP ativa sem nenhuma violação no console
- Nenhum IP em claro em log nenhum
- Rate limit dispara e libera nos tempos certos
- Backup roda sozinho e a restauração foi testada de verdade
- `/metrics` responde e está protegido
- `gitleaks` limpo no histórico completo
- Playwright passa
- k6 com 50 conexões não derruba a API
- SSL Labs nota A ou superior
- Todos os itens do checklist de `docs/04-seguranca.md` marcados
- `docs/08-operacao.md` permite a outra pessoa implantar sem perguntar nada
