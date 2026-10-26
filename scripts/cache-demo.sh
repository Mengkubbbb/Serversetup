#!/usr/bin/env bash
# Proves Modrinth cache reuse: adding the same plugin to a second project must
# reuse the already-downloaded JAR (no new download, no duplicate library row).
set -euo pipefail
API="${API:-http://localhost:8787/api}"
OUT="${OUT:-$(cd "$(dirname "$0")" && pwd)}"
PID="$1"   # project id created by demo.sh

echo "== library row count for EssentialsX before =="
curl -fsS --max-time 60 "$API/plugins/library?q=EssentialsX&source=modrinth" -o "$OUT/lib1.json"
jq -r '"total=\(.total) :: " + ([.items[] | "\(.name) v\(.version) source=\(.source)"] | join(", "))' "$OUT/lib1.json"

J=$(find storage/plugins/modrinth -name '*.jar' | head -1)
echo "cached file on disk: $J"
BEFORE=$(stat -c '%Y %s' "$J")
echo "mtime/size before: $BEFORE"

echo
echo "== creating second project and adding the same Modrinth plugin =="
PID2=$(curl -fsS --max-time 60 -X POST "$API/projects" -H 'Content-Type: application/json' -d '{
  "name":"Cache Check","serverName":"CacheSMP","language":"en","mcVersion":"1.21.4","software":"paper"
}' | jq -r '.project.id')
echo "project 2: $PID2"
T0=$(date +%s%3N)
curl -fsS --max-time 300 -X POST "$API/projects/$PID2/plugins" -H 'Content-Type: application/json' \
  -d '{"modrinthProjectId":"hXiIvTyT"}' -o "$OUT/add_cached.json"
T1=$(date +%s%3N)
echo "install wall time: $((T1-T0)) ms"
jq -c '{installed: .plugin.displayName, version: .plugin.version, status: .plugin.status}' "$OUT/add_cached.json"

AFTER=$(stat -c '%Y %s' "$J")
echo "mtime/size after:  $AFTER"
if [ "$BEFORE" = "$AFTER" ]; then echo "RESULT: cache reused, file untouched (no re-download)"; else echo "RESULT: file changed (re-download happened)"; fi

echo
echo "== library row count after (must still be 1) =="
curl -fsS --max-time 60 "$API/plugins/library?q=EssentialsX&source=modrinth" -o "$OUT/lib2.json"
jq -r '"total=\(.total)"' "$OUT/lib2.json"

echo
echo "== both projects reference the same cached file =="
for P in "$PID" "$PID2"; do
  curl -fsS --max-time 60 "$API/projects/$P" | jq -r '"  \(.project.serverName): " + ([.plugins[] | "\(.displayName) v\(.version) status=\(.status)"] | join(", "))'
done

echo
echo "== removing a plugin must NOT delete the shared cache =="
PLID=$(curl -fsS --max-time 60 "$API/projects/$PID2/plugins" | jq -r '.plugins[0].id')
curl -fsS --max-time 60 -X DELETE "$API/projects/$PID2/plugins/$PLID?deleteConfigs=true" > /dev/null
if [ -f "$J" ]; then echo "cache file still present after project removal: OK"; else echo "cache file deleted: FAIL"; exit 1; fi
