#!/usr/bin/env bash
#
# Backup do banco. Ver docs/08-operacao.md.
#
# Formato `custom` do pg_dump, que já vem comprimido e permite restaurar tabela
# a tabela — um `.sql` de texto só permite restaurar tudo, e "tudo" é justamente
# o que não se quer quando alguém apagou uma linha por engano.
#
# O arquivo pousa em ./backups e sobe para o storage. As duas cópias importam:
# a local resolve o engano de cinco minutos atrás, a remota resolve o servidor
# que pegou fogo.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"
DESTINO="${DESTINO:-./backups}"
DIAS_LOCAIS="${DIAS_LOCAIS:-7}"

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

USUARIO="${POSTGRES_USER:-trindade}"
BANCO="${POSTGRES_DB:-trindade}"
CARIMBO="$(date -u +%Y%m%d-%H%M%S)"
ARQUIVO="$DESTINO/trindade-$CARIMBO.dump"

mkdir -p "$DESTINO"

echo "==> pg_dump ($BANCO)"
# `--no-owner`: restaurar numa instalação nova não pode depender de o papel
# `trindade` já existir com o mesmo nome.
$COMPOSE exec -T postgres pg_dump -U "$USUARIO" -d "$BANCO" -Fc --no-owner > "$ARQUIVO"

TAMANHO="$(du -h "$ARQUIVO" | cut -f1)"
echo "==> $ARQUIVO ($TAMANHO)"

# Um dump de zero byte é o backup que só se descobre inútil no dia do desastre.
if [ ! -s "$ARQUIVO" ]; then
  echo "!! o dump saiu vazio" >&2
  rm -f "$ARQUIVO"
  exit 1
fi

echo "==> enviando para o storage"
node packages/api/scripts/enviar-backup.mjs "$ARQUIVO"

echo "==> limpando cópias locais com mais de $DIAS_LOCAIS dias"
find "$DESTINO" -name 'trindade-*.dump' -mtime "+$DIAS_LOCAIS" -delete

echo "==> pronto"
