#!/usr/bin/env bash
# Windows end-to-end smoke test (Git Bash / GitHub Actions windows-latest).
#
# Unlike test/e2e.sh (Linux, uses /bin/bash), this script exercises the real
# Windows composition with the real auto-detected Git for Windows:
#   1. compose the web profile with the plugin as a bundle,
#   2. verify the additive row is present and the official PowerShell rows are
#      untouched,
#   3. dump the config schema (the preset carrier warning is tolerated),
#   4. boot the real Web host, authenticate, and call
#      GET /dsh-gitbash-win/status (platform win32, real resolved bash.exe),
#   5. verify the client bundle is composed into __DSH_BOOT__ and served,
#   6. verify unauthenticated requests are rejected.
#
# Run by .github/workflows/windows-smoke.yml. The real command execution is
# covered by test/windows-live.test.mjs; the ACL sandbox probe by
# test/windows-sandbox-probe.mjs.
set -euo pipefail

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) ;;
  *)
    echo "e2e-windows.sh: skipped (not a Windows/MSYS host)"
    exit 0
    ;;
esac

fail() { echo "WINDOWS E2E FAIL: $*" >&2; exit 1; }
step() { echo "--- $*"; }
# The Web URL carries a one-time auth token; CI logs are public, so redact it.
redact_token() { sed -E 's/(token=)[A-Za-z0-9_-]+/\1<redacted>/g'; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_POSIX="$(dirname "$ROOT")"
if [ -n "${RUNNER_TEMP:-}" ]; then
  BASE_POSIX="$(cygpath -u "$RUNNER_TEMP")"
fi

HOME_POSIX="$BASE_POSIX/dsh-win-e2e-home"
WS_POSIX="$BASE_POSIX/dsh-win-e2e-ws"
case "$HOME_POSIX" in "$BASE_POSIX"/dsh-win-e2e-home) ;; *) fail "refusing unexpected HOME_POSIX: $HOME_POSIX" ;; esac
case "$WS_POSIX" in "$BASE_POSIX"/dsh-win-e2e-ws) ;; *) fail "refusing unexpected WS_POSIX: $WS_POSIX" ;; esac
LOG_POSIX="$BASE_POSIX/dsh-win-e2e-web.log"
JAR_POSIX="$BASE_POSIX/dsh-win-e2e-cookies.txt"
DUMP_POSIX="$BASE_POSIX/dsh-win-e2e-dump.yml"
SCHEMA_POSIX="$BASE_POSIX/dsh-win-e2e-schema.json"
SCHEMA_ERR_POSIX="$BASE_POSIX/dsh-win-e2e-schema.err"
STATUS_POSIX="$BASE_POSIX/dsh-win-e2e-status.json"
INDEX_POSIX="$BASE_POSIX/dsh-win-e2e-index.html"
CLIENT_POSIX="$BASE_POSIX/dsh-win-e2e-client.js"
SPID=""

cleanup() {
  if [ -n "$SPID" ] && kill -0 "$SPID" 2>/dev/null; then
    kill "$SPID" 2>/dev/null || true
    sleep 1
    kill -9 "$SPID" 2>/dev/null || true
  fi
  rm -f "$LOG_POSIX" "$JAR_POSIX" "$DUMP_POSIX" "$SCHEMA_POSIX" "$SCHEMA_ERR_POSIX" \
    "$STATUS_POSIX" "$INDEX_POSIX" "$CLIENT_POSIX"
  return 0
}
trap cleanup EXIT

rm -rf "$HOME_POSIX" "$WS_POSIX"
mkdir -p "$HOME_POSIX" "$WS_POSIX"
export DSH_HOME="$(cygpath -w "$HOME_POSIX")"
echo "DSH_HOME=$DSH_HOME"

step "create a web profile from the shipped template"
( cd "$WS_POSIX" && dsh --profile win --from-default-profile web --dump-config >/dev/null )
PROFILE_POSIX="$HOME_POSIX/profiles/win"
[ -d "$PROFILE_POSIX" ] || fail "profile was not created at $PROFILE_POSIX"

step "install the plugin into the profile (copy + bundle list)"
PLUGIN_DEST="$PROFILE_POSIX/node_modules/dsh-gitbash-win"
mkdir -p "$PLUGIN_DEST"
cp -R "$ROOT/lib" "$ROOT/locale" "$PLUGIN_DEST/"
cp "$ROOT/package.json" "$ROOT/cordis.patch.yml" "$ROOT/README.md" "$ROOT/LICENSE" "$PLUGIN_DEST/"
node - "$(cygpath -w "$PROFILE_POSIX/package.json")" "$(cygpath -w "$ROOT")" <<'NODE'
const fs = require('node:fs')
const [file, root] = process.argv.slice(2)
const json = JSON.parse(fs.readFileSync(file, 'utf8'))
json.dependencies = json.dependencies ?? {}
json.dependencies['dsh-gitbash-win'] = `file:${root.replace(/\\/g, '/')}`
json.dsh = json.dsh ?? {}
json.dsh.profile = json.dsh.profile ?? {}
json.dsh.profile.bundles = [...(json.dsh.profile.bundles ?? []), 'dsh-gitbash-win']
fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
NODE

step "compose the profile (--dump-config)"
( cd "$WS_POSIX" && dsh --profile win --dump-config ) >"$DUMP_POSIX"
grep -q -- "- id: gitbash-win" "$DUMP_POSIX" || fail "gitbash-win row missing from composition"
grep -q "name: dsh-gitbash-win" "$DUMP_POSIX" || fail "gitbash-win row name mismatch"
# Additive-only composition: the official Windows PowerShell rows still exist.
grep -q "@deepseek-ai/dsh-pwsh-sandbox" "$DUMP_POSIX" || fail "official pwsh executor row disappeared"
grep -q "@deepseek-ai/dsh-tool-pwsh" "$DUMP_POSIX" || fail "official pwsh tool row disappeared"

step "dump the configuration schema (--dump-config-schema; preset carrier warning tolerated)"
set +e
( cd "$WS_POSIX" && dsh --profile win --dump-config-schema ) >"$SCHEMA_POSIX" 2>"$SCHEMA_ERR_POSIX"
SCHEMA_CODE=$?
set -e
if grep -qi "gitbash" "$SCHEMA_ERR_POSIX"; then
  cat "$SCHEMA_ERR_POSIX" >&2
  fail "schema dump reported an error for dsh-gitbash-win"
fi
node - "$(cygpath -w "$SCHEMA_POSIX")" "$SCHEMA_CODE" <<'NODE'
const fs = require('node:fs')
const [file, code] = process.argv.slice(2)
if (code !== '0' && code !== '1') throw new Error(`unexpected --dump-config-schema exit code ${code}`)
const schema = JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')))
for (const needle of ['gitbash-win', 'bashPath', 'initScript', 'sandboxFallback', 'timeoutMs', 'maxOutputBytes']) {
  if (!schema.includes(needle)) throw new Error(`schema is missing ${needle}`)
}
NODE

step "boot the Web host on a free localhost port"
PORT=$(node -e 'const net = require("node:net"); const s = net.createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close() })')
[ -n "$PORT" ] || fail "could not pick a free port"
( cd "$WS_POSIX" && exec dsh --profile win --no-open --port "$PORT" ) >"$LOG_POSIX" 2>&1 &
SPID=$!

URL=""
for _ in $(seq 1 180); do
  URL=$(grep -o 'http://[^ ]*' "$LOG_POSIX" 2>/dev/null | head -1 || true)
  [ -n "$URL" ] && break
  kill -0 "$SPID" 2>/dev/null || { redact_token <"$LOG_POSIX" >&2; fail "Web host exited before printing its URL"; }
  sleep 0.5
done
[ -n "$URL" ] || { redact_token <"$LOG_POSIX" >&2; fail "Web host did not print a URL"; }
BASE="http://127.0.0.1:$PORT"
echo "Web host: $(printf '%s' "$URL" | redact_token)"

step "authenticate (URL token -> session cookie)"
curl -fsS -c "$(cygpath -w "$JAR_POSIX")" -o NUL "$URL" || fail "token URL did not establish a session cookie"

step "GET /dsh-gitbash-win/status"
CODE=$(curl -sS -b "$(cygpath -w "$JAR_POSIX")" -o "$(cygpath -w "$STATUS_POSIX")" -w '%{http_code}' "$BASE/dsh-gitbash-win/status" || true)
[ "$CODE" = "200" ] || { cat "$STATUS_POSIX" >&2 || true; fail "status route returned HTTP $CODE"; }
node - "$(cygpath -w "$STATUS_POSIX")" <<'NODE'
const fs = require('node:fs')
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const problems = []
if (body.plugin !== 'dsh-gitbash-win') problems.push(`plugin=${body.plugin}`)
if (body.platform !== 'win32') problems.push(`platform=${body.platform}`)
if (body.supported !== true) problems.push(`supported=${body.supported}`)
if (body.bashPath?.ok !== true) problems.push(`bashPath.ok=${body.bashPath?.ok}`)
if (typeof body.bashPath?.resolved !== 'string' || !/git[\\/]bin[\\/]bash\.exe$/i.test(body.bashPath.resolved)) {
  problems.push(`bashPath.resolved=${body.bashPath?.resolved}`)
}
if (!Array.isArray(body.bashPath?.candidates) || body.bashPath.candidates.length === 0) problems.push('no candidates')
if (body.tool?.name !== 'bash') problems.push(`tool=${JSON.stringify(body.tool)}`)
if (body.sandbox?.available !== true) problems.push(`sandbox.available=${body.sandbox?.available}`)
if (body.sandbox?.defaultMode !== 'workspace-write') problems.push(`sandbox.defaultMode=${body.sandbox?.defaultMode}`)
if (body.sandbox?.fallback !== 'fail') problems.push(`sandbox.fallback=${body.sandbox?.fallback}`)
if (problems.length > 0) throw new Error(problems.join('; '))
console.log(JSON.stringify(body, null, 2))
NODE

step "the client module is composed into the boot graph and served"
curl -fsS -b "$(cygpath -w "$JAR_POSIX")" "$BASE/" -o "$(cygpath -w "$INDEX_POSIX")" || fail "could not read the index page"
CLIENT_URL=$(node - "$(cygpath -w "$INDEX_POSIX")" <<'NODE'
const fs = require('node:fs')
const html = fs.readFileSync(process.argv[2], 'utf8')
const match = /"id":"dsh-gitbash-win","url":"([^"]+)"/.exec(html)
if (match === null) {
  console.error('dsh-gitbash-win missing from the __DSH_BOOT__ client graph')
  process.exit(1)
}
process.stdout.write(match[1])
NODE
) || fail "client module is not in the boot graph (dsh.client declaration rejected?)"
echo "client bundle: $CLIENT_URL"
CLIENT_CODE=$(curl -sS -b "$(cygpath -w "$JAR_POSIX")" -o "$(cygpath -w "$CLIENT_POSIX")" -w '%{http_code}' "$BASE/$CLIENT_URL" || true)
[ "$CLIENT_CODE" = "200" ] || fail "client bundle returned HTTP $CLIENT_CODE"
grep -q "__ModuleLoader__" "$CLIENT_POSIX" || fail "served client bundle is not a ModuleLoader classic script"
grep -q "dsh-gitbash-win" "$CLIENT_POSIX" || fail "served client bundle lost its module id"

if [ "${BROWSER_CARD:-0}" = "1" ]; then
  step "settings card in a real browser (Edge)"
  ( cd "$ROOT" && node test/browser-card.mjs \
      --url "$URL" \
      --patch-file "$(cygpath -w "$PROFILE_POSIX/cordis.patch.yml")" \
      --platform win32 \
      --timeout-ms 131000 \
      --channel msedge ) || fail "settings card browser test failed"
fi

step "status route rejects unauthenticated callers"
UNAUTH_CODE=$(curl -sS -o NUL -w '%{http_code}' "$BASE/dsh-gitbash-win/status" || true)
case "$UNAUTH_CODE" in
  401 | 403) ;;
  *) fail "status route answered $UNAUTH_CODE without a session (expected 401/403)" ;;
esac

step "shut down"
kill "$SPID" 2>/dev/null || true
wait "$SPID" 2>/dev/null || true
SPID=""
if [ -d "$HOME_POSIX" ]; then rm -rf "$HOME_POSIX" "$WS_POSIX"; fi

echo "WINDOWS E2E PASS"
