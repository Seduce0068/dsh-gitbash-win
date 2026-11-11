#!/usr/bin/env bash
# End-to-end verification for dsh-gitbash-win on a Linux dev box.
#
# The plugin targets Windows, but everything except the Windows-only detection
# branch can be composed and exercised here with `bashPath: /bin/bash`:
#   1. resolve the package as a profile bundle (file/link + dsh.profile.bundles),
#   2. compose the profile with `--dump-config` and `--dump-config-schema`,
#   3. boot the real Web host on a free localhost port,
#   4. authenticate (URL token -> cookie) and call the plugin's status route,
#   5. shut the host down.
#
# Exit 0 = PASS. Any assertion failure aborts with a message.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(cd "$ROOT/.." && pwd)"
HOME_DIR="$WORK/.e2e-home"
WS_DIR="$WORK/.e2e-workspace"
LOG="$WORK/.e2e-web.log"
JAR="$WORK/.e2e-cookies.txt"
DUMP="$WORK/.e2e-dump.yml"
SCHEMA="$WORK/.e2e-schema.json"
SCHEMA_ERR="$WORK/.e2e-schema.err"
STATUS_BODY="$WORK/.e2e-status.json"
INDEX="$WORK/.e2e-index.html"
CLIENT_BODY="$WORK/.e2e-client.js"

# Every scratch file this script owns. The web log and the cookie jar contain a
# one-time auth token/session, so they are always removed on exit.
cleanup_artifacts() {
  rm -f "$LOG" "$JAR" "$DUMP" "$SCHEMA" "$SCHEMA_ERR" "$STATUS_BODY" "$INDEX" "$CLIENT_BODY"
  return 0
}

fail() { echo "E2E FAIL: $*" >&2; exit 1; }
step() { echo "--- $*"; }
# The Web URL carries a one-time auth token; CI logs are public, so redact it.
redact_token() { sed -E 's/(token=)[A-Za-z0-9_-]+/\1<redacted>/g'; }

# Only ever delete the scratch dirs this script owns (absolute, under WORK).
case "$HOME_DIR" in "$WORK"/*) ;; *) fail "refusing HOME_DIR outside workspace: $HOME_DIR" ;; esac
case "$WS_DIR" in "$WORK"/*) ;; *) fail "refusing WS_DIR outside workspace: $WS_DIR" ;; esac
rm -rf "$HOME_DIR" "$WS_DIR"
cleanup_artifacts
mkdir -p "$HOME_DIR" "$WS_DIR"

export DSH_HOME="$HOME_DIR"

step "create a web profile from the shipped template"
( cd "$WS_DIR" && dsh --profile e2e --from-default-profile web --dump-config >/dev/null )
PROFILE="$DSH_HOME/profiles/e2e"
[ -d "$PROFILE" ] || fail "profile was not created at $PROFILE"

step "wire the package into the profile (link + bundle list)"
mkdir -p "$PROFILE/node_modules"
ln -sfn "$ROOT" "$PROFILE/node_modules/dsh-gitbash-win"
node - "$PROFILE/package.json" "$ROOT" <<'NODE'
const fs = require('node:fs')
const [file, root] = process.argv.slice(2)
const json = JSON.parse(fs.readFileSync(file, 'utf8'))
json.dependencies = json.dependencies ?? {}
json.dependencies['dsh-gitbash-win'] = `link:${root}`
json.dsh = json.dsh ?? {}
json.dsh.profile = json.dsh.profile ?? {}
json.dsh.profile.bundles = [...(json.dsh.profile.bundles ?? []), 'dsh-gitbash-win']
fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
NODE

step "enable the row on this non-Windows host for the test profile"
node - "$PROFILE/cordis.patch.yml" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
let text = fs.readFileSync(file, 'utf8')
// The shipped template ends with a lone `[]` root node; adding rows after it
// would be a second YAML document.
text = text.replace(/^\[\]\s*$/m, '')
text += `
# dsh-gitbash-win E2E: force the Windows-only row on for this Linux host.
- id: gitbash-win
  disabled: false
  config:
    bashPath: '/bin/bash'
    sandboxFallback: 'unconfined'
`
fs.writeFileSync(file, text)
NODE

step "compose the profile (--dump-config)"
( cd "$WS_DIR" && dsh --profile e2e --dump-config ) >"$DUMP"
grep -q -- "- id: gitbash-win" "$DUMP" || fail "gitbash-win row missing from composition"
grep -q "name: dsh-gitbash-win" "$DUMP" || fail "gitbash-win row name mismatch"
awk '/- id: gitbash-win/{f=1} f&&/disabled/{print}' "$DUMP" | head -1 | grep -q "disabled: false" \
  || fail "gitbash-win row is not enabled by the profile override"
grep -A6 -- "- id: gitbash-win" "$DUMP" | grep -q "bashPath: /bin/bash" || fail "bashPath override missing"

step "dump the configuration schema (--dump-config-schema)"
# The shipped agent-preset rows are list-valued config carriers the schema
# dumper does not model, so the command exits 1 with carrier errors even on a
# stock web profile. The JSON on stdout is still complete; require that it
# parses, carries our fields, and never blames our package.
set +e
( cd "$WS_DIR" && dsh --profile e2e --dump-config-schema ) >"$SCHEMA" 2>"$SCHEMA_ERR"
SCHEMA_CODE=$?
set -e
if grep -qi "gitbash" "$SCHEMA_ERR"; then cat "$SCHEMA_ERR" >&2; fail "schema dump reported an error for dsh-gitbash-win"; fi
node - "$SCHEMA" "$SCHEMA_CODE" <<'NODE'
const fs = require('node:fs')
const [schemaFile, code] = process.argv.slice(2)
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'))
if (code !== '0' && code !== '1') throw new Error(`unexpected --dump-config-schema exit code ${code}`)
const text = JSON.stringify(schema)
for (const needle of ['gitbash-win', 'bashPath', 'initScript', 'sandboxFallback', 'timeoutMs', 'maxOutputBytes']) {
  if (!text.includes(needle)) throw new Error(`schema is missing ${needle}`)
}
NODE

step "boot the Web host on a free localhost port"
PORT=$(node -e '
const net = require("node:net")
const srv = net.createServer()
srv.listen(0, "127.0.0.1", () => { console.log(srv.address().port); srv.close() })
')
[ -n "$PORT" ] || fail "could not pick a free port"
( cd "$WS_DIR" && exec dsh --profile e2e --no-open --port "$PORT" ) >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  cleanup_artifacts
}
trap cleanup EXIT

URL=""
for _ in $(seq 1 120); do
  URL=$(grep -o 'http://[^ ]*' "$LOG" 2>/dev/null | head -1 || true)
  [ -n "$URL" ] && break
  kill -0 "$SERVER_PID" 2>/dev/null || { redact_token <"$LOG" >&2; fail "Web host exited before printing its URL"; }
  sleep 0.5
done
[ -n "$URL" ] || { redact_token <"$LOG" >&2; fail "Web host did not print a URL"; }
BASE="http://127.0.0.1:$PORT"
echo "Web host: $(printf '%s' "$URL" | redact_token)"

step "authenticate (URL token -> session cookie)"
curl -fsS -c "$JAR" -o /dev/null "$URL" || fail "token URL did not establish a session cookie"

step "GET /dsh-gitbash-win/status"
CODE=$(curl -sS -b "$JAR" -o "$STATUS_BODY" -w '%{http_code}' "$BASE/dsh-gitbash-win/status" || true)
[ "$CODE" = "200" ] || { cat "$STATUS_BODY" >&2 || true; fail "status route returned HTTP $CODE"; }
node - "$STATUS_BODY" <<'NODE'
const fs = require('node:fs')
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const problems = []
if (body.plugin !== 'dsh-gitbash-win') problems.push(`plugin=${body.plugin}`)
if (body.platform !== process.platform) problems.push(`platform=${body.platform}`)
if (body.bashPath?.ok !== true) problems.push(`bashPath.ok=${body.bashPath?.ok}`)
if (body.bashPath?.resolved !== '/bin/bash') problems.push(`bashPath.resolved=${body.bashPath?.resolved}`)
if (!Array.isArray(body.bashPath?.candidates) || body.bashPath.candidates.length === 0) problems.push('no candidates')
if (body.tool?.name !== 'bash') problems.push(`tool=${JSON.stringify(body.tool)}`)
if (problems.length > 0) throw new Error(problems.join('; '))
console.log(JSON.stringify(body, null, 2))
NODE

step "the client module is composed into the boot graph and served"
curl -fsS -b "$JAR" "$BASE/" -o "$INDEX" || fail "could not read the index page"
CLIENT_URL=$(node - "$INDEX" <<'NODE'
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
CLIENT_CODE=$(curl -sS -b "$JAR" -o "$CLIENT_BODY" -w '%{http_code}' "$BASE/$CLIENT_URL" || true)
[ "$CLIENT_CODE" = "200" ] || fail "client bundle returned HTTP $CLIENT_CODE"
grep -q "__ModuleLoader__" "$CLIENT_BODY" || fail "served client bundle is not a ModuleLoader classic script"
grep -q "dsh-gitbash-win" "$CLIENT_BODY" || fail "served client bundle lost its module id"

if [ "${BROWSER_CARD:-0}" = "1" ]; then
  step "settings card in a real browser (Edge)"
  ( cd "$ROOT" && node test/browser-card.mjs \
      --url "$URL" \
      --patch-file "$PROFILE/cordis.patch.yml" \
      --platform linux \
      --timeout-ms 131000 \
      --channel msedge ) || fail "settings card browser test failed"
fi

step "status route rejects unauthenticated callers"
UNAUTH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/dsh-gitbash-win/status" || true)
case "$UNAUTH_CODE" in
  401 | 403) ;;
  *) fail "status route answered $UNAUTH_CODE without a session (expected 401/403)" ;;
esac

cleanup
trap - EXIT

step "shut down"
if kill -0 "$SERVER_PID" 2>/dev/null; then fail "server still running after cleanup"; fi

# Success: drop the scratch home/workspace too (guarded absolute paths above).
rm -rf "$HOME_DIR" "$WS_DIR"

echo "E2E PASS"
