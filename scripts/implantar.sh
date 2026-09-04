#!/usr/bin/env bash
#
# Implantação. Ver docs/08-operacao.md.
#
# A ordem é o assunto inteiro deste arquivo:
#
#   1. backup, antes de qualquer coisa
#   2. migrations, com a versão antiga ainda no ar
#   3. troca da imagem
#   4. saúde, e reversão automática se não subir
#
# Migration antes da imagem porque o código novo espera o esquema novo, e o
# código velho tem de sobreviver ao esquema novo por alguns segundos — é por
# isso que toda migration é aditiva: coluna nova aceita nulo, coluna que sai
# é abandonada primeiro e removida na versão seguinte. Ver CLAUDE.md.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"
IMAGEM="${IMAGEM_API:-trindade/api:latest}"

passo() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
erro() { printf '\n\033[31m!! %s\033[0m\n' "$*" >&2; }

passo "backup antes de mexer"
./scripts/backup.sh

passo "imagem: $IMAGEM"
$COMPOSE pull api

# A imagem que está rodando agora, para poder voltar a ela.
ANTERIOR="$($COMPOSE images -q api || true)"

passo "migrations, com a versão antiga ainda no ar"
# Roda num contêiner à parte, com a imagem nova: é ela que traz as migrations
# novas. Se falhar aqui, nada foi trocado e o serviço continua de pé.
$COMPOSE run --rm --no-deps api pnpm migrate up

passo "trocando a API"
$COMPOSE up -d --no-deps api

passo "esperando a saúde"
for tentativa in $(seq 1 30); do
  if $COMPOSE exec -T api node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))" \
    2>/dev/null; then
    passo "no ar"
    $COMPOSE up -d
    exit 0
  fi
  sleep 2
done

erro "a API não ficou saudável em 60s — voltando para a imagem anterior"
if [ -n "$ANTERIOR" ]; then
  IMAGEM_API="$ANTERIOR" $COMPOSE up -d --no-deps api
  erro "revertido. as migrations **não** foram desfeitas: elas são aditivas e a"
  erro "versão anterior convive com o esquema novo. Ver docs/08-operacao.md."
else
  erro "sem imagem anterior conhecida — suba à mão e investigue."
fi
exit 1
