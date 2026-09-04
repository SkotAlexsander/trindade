#!/usr/bin/env bash
#
# gitleaks no histórico inteiro. Ver docs/04-seguranca.md, "Segredos".
#
# Em contêiner, para não exigir instalação: o custo é uma imagem de 10 MB e
# evita a classe de erro mais cara que existe.
#
#   ./scripts/verificar-segredos.sh            # o histórico todo
#   ./scripts/verificar-segredos.sh --staged   # só o que vai entrar no commit

set -euo pipefail

cd "$(dirname "$0")/.."
RAIZ="$(pwd -W 2>/dev/null || pwd)"

MODO=(detect --source .)
[ "${1:-}" = "--staged" ] && MODO=(protect --staged --source .)

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$RAIZ:/repo" -w /repo \
  zricethezav/gitleaks:latest \
  "${MODO[@]}" --config .gitleaks.toml --redact -v
