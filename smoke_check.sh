#!/usr/bin/env bash
# Checks réels pour valider un déploiement local du dashboard v4.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8765}"
HOST="${HOST:-127.0.0.1}"
BASE="http://${HOST}:${PORT}"
FAIL=0

pass(){ echo "PASS  $*"; }
fail(){ echo "FAIL  $*"; FAIL=1; }

cd "$ROOT"

# 1. Fichiers requis
for f in index.html redirect.js dashboard_4_locaux_pharma.html supabase-client.js plant-domain.js supabase_schema.sql README_SUPABASE.md TOKENS_ET_DEPLOIEMENT.md; do
  [[ -f "$f" ]] && pass "fichier $f" || fail "fichier manquant $f"
done

# 2. Syntaxe JS client
if command -v node >/dev/null 2>&1; then
  if node --check supabase-client.js 2>/dev/null && node --check redirect.js 2>/dev/null; then
    pass "node --check client scripts"
  else
    fail "node --check client scripts"
  fi
else
  echo "SKIP  node non disponible"
fi

# 3. HTTP
for path in / /redirect.js /dashboard_4_locaux_pharma.html /supabase-client.js /plant-domain.js; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}${path}" || echo 000)
  [[ "$code" == "200" ]] && pass "GET $path → $code" || fail "GET $path → $code"
done

# 4. Contenu HTML métier (grep -a : contenu UTF-8 peut être vu comme binaire)
html_tmp=$(mktemp)
curl -s "${BASE}/dashboard_4_locaux_pharma.html" -o "$html_tmp" || true
size=$(wc -c <"$html_tmp" | tr -d ' ')
if (( size > 50000 )); then pass "HTML size=$size"; else fail "HTML trop petit size=$size"; fi
grep -aq 'PharmaDashboardAdapter' "$html_tmp" && pass "PharmaDashboardAdapter" || fail "PharmaDashboardAdapter absent"
grep -aq 'supabase-client.js' "$html_tmp" && pass "script supabase-client.js" || fail "script client absent"
grep -aq 'plant-domain.js' "$html_tmp" && pass "script plant-domain.js" || fail "plant-domain absent"
grep -aq 'PHARMA_SUPABASE_CONFIG' "$html_tmp" && pass "PHARMA_SUPABASE_CONFIG" || fail "config absente"
grep -aiq 'locaux' "$html_tmp" && pass "titre/domaine locaux" || fail "marqueurs locaux absents"
grep -aq 'A23' "$html_tmp" && pass "parc A23" || fail "parc A23 absent"
grep -aq 'Stock A26' "$html_tmp" && pass "UI Stock A26" || fail "UI Stock A26 absente"
rm -f "$html_tmp"

# 5. Client export
js_tmp=$(mktemp)
curl -s "${BASE}/supabase-client.js" -o "$js_tmp" || true
grep -aq 'window.PharmaSync' "$js_tmp" && pass "window.PharmaSync" || fail "PharmaSync absent"
grep -aq 'captureLocalState' "$js_tmp" && pass "captureLocalState" || fail "captureLocalState absent"
rm -f "$js_tmp"

# 6. Schema garde-fous
grep -q 'activities_no_room_overlap' supabase_schema.sql && pass "contrainte overlap" || fail "contrainte overlap absente"
grep -q 'private.is_planner' supabase_schema.sql && pass "RLS is_planner" || fail "is_planner absent"
grep -q 'enable row level security' supabase_schema.sql && pass "RLS enabled" || fail "RLS non activé"

# 7. Secrets — ne doit pas y avoir de service_role en dur (client servi uniquement)
if grep -RIn --include='*.html' --include='*.js' 'service_role' \
  --exclude-dir=tests --exclude-dir=node_modules --exclude-dir=loops \
  dashboard_4_locaux_pharma.html plant-domain.js supabase-client.js 2>/dev/null \
  | grep -v example >/tmp/pharma-secret-scan.txt; then
  if [[ -s /tmp/pharma-secret-scan.txt ]]; then
    fail "possible service_role dans le code client"
    cat /tmp/pharma-secret-scan.txt
  else
    pass "pas de service_role client"
  fi
else
  pass "pas de service_role client"
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "VERDICT: PASS — dashboard servi et cohérent sur $BASE/dashboard_4_locaux_pharma.html"
  exit 0
else
  echo "VERDICT: FAIL — voir ci-dessus"
  exit 1
fi
