#!/usr/bin/env bash
# Démarre le dashboard locaux v4 en HTTP local (mode local-first par défaut).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8765}"
HOST="${HOST:-127.0.0.1}"
PID_FILE="${PID_FILE:-/tmp/pharma-dashboard.pid}"
LOG_FILE="${LOG_FILE:-/tmp/pharma-dashboard.log}"

cd "$ROOT"

need=(
  dashboard_4_locaux_pharma.html
  supabase-client.js
  plant-domain.js
)
for f in "${need[@]}"; do
  [[ -f "$f" ]] || { echo "MANQUANT: $f"; exit 1; }
done

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Déjà en cours PID=$(cat "$PID_FILE") → http://${HOST}:${PORT}/dashboard_4_locaux_pharma.html"
  exit 0
fi

# Port libre ?
if command -v ss >/dev/null 2>&1; then
  if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
    echo "Port $PORT déjà occupé par un autre process. Exportez PORT=autre."
    exit 1
  fi
fi

nohup python3 -m http.server "$PORT" --bind "$HOST" >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 0.4

URL="http://${HOST}:${PORT}/dashboard_4_locaux_pharma.html"
code=$(curl -s -o /dev/null -w "%{http_code}" "$URL" || true)
if [[ "$code" != "200" ]]; then
  echo "ÉCHEC démarrage (HTTP $code). Log: $LOG_FILE"
  exit 1
fi

echo "OK  PID=$(cat "$PID_FILE")"
echo "URL $URL"
echo "Mode hybride: cache local + synchronisation Supabase après connexion."
echo "Arrêt: kill \$(cat $PID_FILE)"
