#!/usr/bin/env bash
#
# A vigilância que a API não pode fazer por si. Ver docs/08-operacao.md.
#
# Disco cheio e 5xx em série a própria API avisa (`services/alerta.ts`). Mas o
# alerta que mais importa é justamente o que ela não consegue mandar: processo
# caído não manda webhook, e um servidor fora do ar em silêncio é indistinguível
# de um servidor tranquilo. Por isso este script roda **fora** do contêiner, por
# um timer do systemd, e só precisa de `curl`.
#
# Instalação e o arquivo do timer estão em docs/08-operacao.md.
#
# Variáveis (o systemd as passa pelo EnvironmentFile do .env):
#   ALERTA_WEBHOOK  para onde avisar; vazio desliga
#   SAUDE_URL       o que checar (padrão: https://$DOMINIO/api/health)
#   VIGIA_ESTADO    onde guardar a contagem entre uma volta e outra

set -uo pipefail

WEBHOOK="${ALERTA_WEBHOOK:-}"
SAUDE="${SAUDE_URL:-https://${DOMINIO:-localhost}/api/health}"
ESTADO="${VIGIA_ESTADO:-/var/lib/trindade/vigia.estado}"

# Duas falhas seguidas, com o timer de minuto em minuto, são os dois minutos da
# tabela em docs/08-operacao.md. Uma só é reinício, implantação ou rede piscando
# — e alerta que dispara em toda implantação é alerta que vira ruído.
LIMITE_DE_FALHAS="${VIGIA_FALHAS:-2}"

[ -n "$WEBHOOK" ] || exit 0

avisar() {
  # Discord lê `content`; Slack, Mattermost e Rocket.Chat leem `text`. Mandar os
  # dois faz uma URL só funcionar em qualquer um deles. O mesmo corpo de
  # `services/alerta.ts`.
  #
  # O corpo vai por **stdin**, e não como argumento: argumento aparece inteiro
  # na lista de processos e ainda atravessa a conversão de codificação do
  # sistema — foi assim que o "não" do aviso chegou quebrado na primeira prova.
  local texto="$1" campo
  campo=$(json "$texto")
  printf '{"content":%s,"text":%s}' "$campo" "$campo" |
    curl -fsS --max-time 10 -X POST -H 'content-type: application/json' \
      --data-binary @- "$WEBHOOK" >/dev/null 2>&1 || true
}

# Aspas e barras invertidas no texto quebrariam o JSON. Os textos daqui são
# fixos, mas a URL entra neles.
json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/'
}

mkdir -p "$(dirname "$ESTADO")" 2>/dev/null || true

falhas=0
avisado=0
if [ -f "$ESTADO" ]; then
  # shellcheck disable=SC1090
  . "$ESTADO"
fi

if curl -fsS --max-time 10 -o /dev/null "$SAUDE"; then
  # A saúde responde 503 quando banco ou storage falham, e `curl -f` trata isso
  # como erro: é exatamente o que se quer alertar.
  if [ "$avisado" -eq 1 ]; then
    avisar "A API voltou. $SAUDE responde de novo."
  fi
  falhas=0
  avisado=0
else
  falhas=$((falhas + 1))
  if [ "$falhas" -ge "$LIMITE_DE_FALHAS" ] && [ "$avisado" -eq 0 ]; then
    avisar "A API não responde há $falhas minutos. Tentei $SAUDE."
    avisado=1
  fi
fi

printf 'falhas=%s\navisado=%s\n' "$falhas" "$avisado" > "$ESTADO"
