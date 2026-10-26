#!/usr/bin/env bash
# End-to-end demo against the running app: create project -> download 2 Modrinth
# plugins -> apply a template -> preview + download the ZIP and inspect it.
set -euo pipefail
API="${API:-http://localhost:8787/api}"
OUT="${OUT:-$(cd "$(dirname "$0")" && pwd)}"

echo "===== 1. Live metadata (Mojang + PaperMC) ====="
curl -fsS --max-time 60 "$API/minecraft/versions?software=paper" -o "$OUT/versions.json"
echo "latest verified release: $(jq -r '[.versions[] | select(.type=="release")][0].id' "$OUT/versions.json")"
echo "paper supported versions: $(jq -r '[.software.versions[]] | join(", ")' "$OUT/versions.json")"
echo "source: $(jq -r '.software.source' "$OUT/versions.json") | warning: $(jq -r '.warning // "none"' "$OUT/versions.json")"

MC_VERSION="1.21.4"

echo
echo "===== 2. Create project ====="
curl -fsS --max-time 60 -X POST "$API/projects" -H 'Content-Type: application/json' -d '{
  "name": "End2End Demo",
  "serverName": "DemoSMP",
  "language": "en",
  "description": "Created by artifacts/demo.sh end-to-end run",
  "mcVersion": "'"$MC_VERSION"'",
  "software": "paper"
}' -o "$OUT/project.json"
PID=$(jq -r '.project.id' "$OUT/project.json")
jq -r '"created: id=\(.project.id) name=\(.project.name) server=\(.project.serverName) mc=\(.project.mcVersion) channel=\(.project.versionChannel) verified=\(.project.versionVerified) software=\(.project.software) lang=\(.project.language)"' "$OUT/project.json"
echo "version warning: $(jq -r '.versionWarning // "none"' "$OUT/project.json")"

echo
echo "===== 3. Modrinth search (live API) ====="
curl -fsS --max-time 60 "$API/modrinth/search?q=essentialsx&limit=3" -o "$OUT/s1.json"
curl -fsS --max-time 60 "$API/modrinth/search?q=luckperms&limit=3" -o "$OUT/s2.json"
jq -r '"essentialsx -> " + ([.hits[0:3][] | "\(.title) id=\(.id) dl=\(.downloads)"] | join("  |  "))' "$OUT/s1.json"
jq -r '"luckperms  -> " + ([.hits[0:3][] | "\(.title) id=\(.id) dl=\(.downloads)"] | join("  |  "))' "$OUT/s2.json"
P1=$(jq -r '.hits[0].id' "$OUT/s1.json")
P2=$(jq -r '.hits[0].id' "$OUT/s2.json")

echo
echo "===== 4. Download two Modrinth plugins into the project ====="
curl -fsS --max-time 300 -X POST "$API/projects/$PID/plugins" -H 'Content-Type: application/json' \
  -d '{"modrinthProjectId":"'"$P1"'"}' -o "$OUT/add1.json"
jq -c '{installed: .plugin.displayName, version: .plugin.version, source: .plugin.sourceType, status: .plugin.status, compat: .plugin.compatibility.level, reasons: .plugin.compatibility.reasons, configsCreated: [.createdConfigs[].path], warnings: .warnings}' "$OUT/add1.json"
curl -fsS --max-time 300 -X POST "$API/projects/$PID/plugins" -H 'Content-Type: application/json' \
  -d '{"modrinthProjectId":"'"$P2"'"}' -o "$OUT/add2.json"
jq -c '{installed: .plugin.displayName, version: .plugin.version, source: .plugin.sourceType, status: .plugin.status, compat: .plugin.compatibility.level, reasons: .plugin.compatibility.reasons, configsCreated: [.createdConfigs[].path], warnings: .warnings}' "$OUT/add2.json"

echo
echo "-- duplicate add of $P1 (must not duplicate):"
CODE=$(curl -s -o "$OUT/add1again.json" -w '%{http_code}' --max-time 120 -X POST "$API/projects/$PID/plugins" \
  -H 'Content-Type: application/json' -d '{"modrinthProjectId":"'"$P1"'"}') || CODE="000"
echo "HTTP $CODE -> $(jq -r '.error.message // "installed"' "$OUT/add1again.json" 2>/dev/null || cat "$OUT/add1again.json")"

echo
echo "-- cached file reuse (re-download attempt for $P1):"
curl -fsS --max-time 120 "$API/projects/$PID/plugins" -o "$OUT/plugins1.json"
jq -r '.plugins[] | "  \(.displayName): status=\(.status) file=\(.statusDetail // .fileMissing // "-")"' "$OUT/plugins1.json" 2>/dev/null || jq -c '.plugins[0]' "$OUT/plugins1.json"

echo
echo "===== 5. Server setup template: preview + apply ====="
curl -fsS --max-time 60 "$API/templates" -o "$OUT/templates.json"
TID=$(jq -r '.templates[] | select(.name=="Minimal SMP") | .id' "$OUT/templates.json")
jq -r '.templates[] | select(.name=="Minimal SMP") | "Minimal SMP (\(.id))\n  plugins: " + ([.plugins[].name] | join(", ")) + "\n  warnings: " + ((.warnings // []) | join(" / "))' "$OUT/templates.json"
curl -fsS --max-time 60 "$API/templates/$TID/preview?projectId=$PID" -o "$OUT/tplpreview.json"
echo "preview shape: $(jq -c '.preview | keys' "$OUT/tplpreview.json")"
jq -r '(.preview.entries // .preview.plugins // .preview.steps // [])[]? | "  - " + (tojson)' "$OUT/tplpreview.json" | head -20
curl -fsS --max-time 300 -X POST "$API/templates/$TID/apply" -H 'Content-Type: application/json' \
  -d '{"projectId":"'"$PID"'","installMissing":true,"overwriteConfigs":false}' -o "$OUT/tplapply.json"
jq -c '{added: [.added[] | .name // .plugin // .], skipped: .skipped, failed: .failed, warnings: .warnings}' "$OUT/tplapply.json"

echo
echo "===== 6. Reopen project (persistence check) ====="
curl -fsS --max-time 60 "$API/projects/$PID" -o "$OUT/reopen.json"
jq -r '"plugins (" + (.plugins|length|tostring) + "): "' "$OUT/reopen.json" | tr -d '\n'
jq -r '[.plugins[] | "\(.displayName) v\(.version) [\(.compatibility.level)]"] | join(", ")' "$OUT/reopen.json"
jq -r '"configs (" + (.configs|length|tostring) + "): " + ([.configs[].path] | join(", "))' "$OUT/reopen.json"
jq -r '"compatibility: \(.summary.compatibility) | dependency issues: \(.summary.dependencyIssues|length) | missing files: \(.summary.missingFiles|length) | warnings: \(.summary.warnings|length)"' "$OUT/reopen.json"

echo
echo "===== 7. Export preview ====="
curl -fsS --max-time 60 "$API/projects/$PID/export/preview" -o "$OUT/exportpreview.json"
jq -r '.preview | "archive=\(.fileName) files=\(.fileCount) uncompressed=\(.totalBytes)B errors=\(.errors|length) collisions=\(.collisions|length) warnings=\(.warnings|length)"' "$OUT/exportpreview.json"
jq -r '.preview.entries[] | "  [\(.source)] \(.path)  \(.size)B  <- \(.plugin)"' "$OUT/exportpreview.json"
jq -r '(.preview.warnings // [])[] | "  warning: \(.)"' "$OUT/exportpreview.json"

echo
echo "===== 8. Download ZIP ====="
ZIP="$OUT/DemoSMP-Setup.zip"
rm -f "$ZIP"
curl -fsS --max-time 300 "$API/projects/$PID/export" -o "$ZIP"
echo "downloaded $(stat -c%s "$ZIP") bytes"
file "$ZIP" | sed 's/^[^:]*: /format: /'
sha256sum "$ZIP"

echo
echo "===== 9. Verify archive contents ====="
unzip -t "$ZIP" | tail -2
echo "--- full listing ---"
unzip -l "$ZIP"
echo "--- forbidden content check (expect: clean) ---"
if unzip -Z1 "$ZIP" | grep -Eiq '(^|/)(server\.jar|eula\.txt|server\.properties|logs/|world|[^/]+\.db|\.env|node_modules|storage/)'; then
  echo "!!! forbidden entry found"; exit 1
else
  echo "clean: no server jars, worlds, logs, DBs, env files or internal paths"
fi
echo "--- top-level entries (must be only 'plugins') ---"
unzip -Z1 "$ZIP" | awk -F/ '{print $1}' | sort -u
echo "--- extracted JAR plugin.yml identity (never executed) ---"
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"
find "$TMP/plugins" -name '*.jar' -print0 | while IFS= read -r -d '' J; do
  T=$(mktemp)
  unzip -p "$J" plugin.yml > "$T" 2>/dev/null || unzip -p "$J" paper-plugin.yml > "$T" 2>/dev/null || true
  echo "  $(basename "$J") :: $(grep -E '^(name|version):' "$T" | tr '\n' ' ')"
  rm -f "$T"
done
rm -rf "$TMP"
echo
echo "project id for your own inspection: $PID"
echo "===== DONE ====="
