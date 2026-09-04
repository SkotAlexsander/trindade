#!/usr/bin/env bash
#
# Restauração. Ver docs/08-operacao.md.
#
#   ./scripts/restaurar.sh ./backups/trindade-20260904-120000.dump
#   ./scripts/restaurar.sh <arquivo> trindade_ensaio     # num banco à parte
#
# Backup não testado não é backup. Este script existe para ser rodado **antes**
# de precisar dele — o segundo argumento restaura num banco novo, sem tocar no
# que está no ar, e é assim que se ensaia.
#
# Sem o segundo argumento ele restaura por cima do banco de produção, e por isso
# exige que se digite o nome do banco para confirmar.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

USUARIO="${POSTGRES_USER:-trindade}"
ORIGEM="${1:-}"
ALVO="${2:-${POSTGRES_DB:-trindade}}"

if [ -z "$ORIGEM" ] || [ ! -s "$ORIGEM" ]; then
  echo "uso: $0 <arquivo.dump> [banco-alvo]" >&2
  exit 1
fi

EM_PRODUCAO="${POSTGRES_DB:-trindade}"
if [ "$ALVO" = "$EM_PRODUCAO" ]; then
  echo
  echo "  Isto vai SOBRESCREVER o banco '$ALVO', que é o que está no ar."
  echo "  Digite o nome do banco para confirmar:"
  read -r confirmacao
  if [ "$confirmacao" != "$ALVO" ]; then
    echo "cancelado." >&2
    exit 1
  fi
  echo "==> parando a API para ninguém escrever durante a restauração"
  $COMPOSE stop api
fi

COMECO=$(date +%s)

echo "==> recriando o banco '$ALVO'"
# `postgres` como banco de conexão: não dá para derrubar o banco em que se está.
$COMPOSE exec -T postgres psql -U "$USUARIO" -d postgres \
  -c "drop database if exists \"$ALVO\" with (force)" \
  -c "create database \"$ALVO\""

echo "==> restaurando"
# `--no-owner` casa com o dump; `--exit-on-error` porque uma restauração pela
# metade que "termina bem" é a pior coisa que pode acontecer aqui.
$COMPOSE exec -T postgres pg_restore -U "$USUARIO" -d "$ALVO" --no-owner --exit-on-error < "$ORIGEM"

FIM=$(date +%s)
echo "==> restaurado em $((FIM - COMECO))s"

echo "==> conferindo"
$COMPOSE exec -T postgres psql -U "$USUARIO" -d "$ALVO" -c \
  "select 'usuarios' as tabela, count(*) from users
   union all select 'canais', count(*) from channels
   union all select 'mensagens', count(*) from messages"

if [ "$ALVO" = "$EM_PRODUCAO" ]; then
  echo "==> subindo a API"
  $COMPOSE start api
fi

echo "==> pronto"
