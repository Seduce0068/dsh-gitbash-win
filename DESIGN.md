# dsh-gitbash-win — 設計契約 (v0.1)

Windows 上の DSH (DeepSeek Harness `0.2.2-rc.1`) で、エージェントのコマンド実行シェルとして
**Git for Windows の bash** を選べるようにする DSH プラグイン。

- 対象ホスト: DSH `0.2.2-rc.1` (Web / TUI / headless いずれのプロファイルでも可)
- 対象 OS: Windows 10/11 (Git for Windows 必須)。非 Windows では行が `disabled` になり無効。
- ライセンス: MIT。ビルドなしの素の ESM JavaScript (Node >= 20, 実績 Node 24)。

## 0. 前提として判明した DSH の構造 (2026-11-10 調査)

1. エージェントのコマンド実行は `ctx.shell` (抽象 seam)。Windows では base バンドルが
   `dsh-pwsh-sandbox` を `ctx.shell` として mount し、各 agent preset (standard/ptc/cordis/minimal) が
   model-facing tool として `dsh-tool-pwsh` を mount する。POSIX では bash 系。
2. profile の patch 層では、既存行の **name は変更できない** (`name mismatch ... skipping` を実測)。
   `disabled` / `config` の上書き、`insert` はできる。
3. `ctx.shell` は単一サービス。差し替えには base 行の disable + 自前行 insert が必要だが、
   model-facing tool は *agent preset 側* にあり、preset の `plugins` 全リストを patch で
   丸ごと再宣言する必要がある (壊れやすい) 。→ **採らない**。
4. 一方 `ctx.isolate('shell')` で作った子コンテキストに自前の `ShellExecutor` を mount すると、
   **root の `ctx.shell` を汚さずに**私有 executor を持てる (実測: `LocalBashExecutor` を
   isolate 下に mount し `execute()` まで成功)。公式ツール `@deepseek-ai/dsh-tool-bash` は
   `ctx.shell` を読むだけなので、**同じ isolate ラベルに公式 tool-bash を mount すれば、
   公式ツール実装をそのまま私有 executor に接続できる** (コピー不要)。
5. `ctx.tools.register()` は non-agent scope から呼ぶと **global layer** に入り、
   全 agent から見える (per-agent の scoped 登録が同名なら shadow する)。
   → 公式 PowerShell ツール (`pwsh`, preset 側 scoped) と、こちらの `bash` (global) が
   共存でき、モデルは呼び分けられる。

## 1. アーキテクチャ (加算型・公式行は一切 disable しない)

```
profile
 └─ bundle: dsh-gitbash-win
     └─ insert row: id=gitbash-win, name=dsh-gitbash-win   (win32 のみ enabled)
          apply(ctx, config):
            ├─ const scope = ctx.isolate('shell')            // root ctx.shell は触らない
            ├─ scope.plugin(GitBashExecutor, config値)       // 私有 ctx.shell (isolate 内)
            │     └─ extends SandboxBashExecutor             // 公式 sandbox 意味論を継承
            │         ├─ direct (danger-full-access): git-bash.exe -c <command>
            │         ├─ confined: ctx.sandbox.confine([gitbash,-c,cmd]) → 公式 ACL 経路
            │         └─ confined で runner 不能: SANDBOX_UNAVAILABLE で fail-closed
            ├─ scope.plugin(公式 @deepseek-ai/dsh-tool-bash, {enableRunInBackground:true})
            │     └─ global tool "bash" (jobs/approval/render は公式と同一)
            ├─ ctx.inject(['systemPrompt']): routing 用 prompt section を追加
            └─ ctx.inject(['webServer','connection']): GET /dsh-gitbash-win/status
 └─ client half (package.json dsh.client):
      Settings → Plugins に "Git Bash" カード。configForms.get('gitbash-win') を編集し、
      status route で検出結果 (Git Bash パス候補) を表示。
```

- 公式 `pwsh` tool / `pwsh-sandbox` executor / preset 構成は **無変更**。
- アンインストール = 自パッケージ削除のみで完全復元 (base 行を触らない)。
- Windows 以外: bundle patch の `disabled: !!js process.platform !== 'win32'` で無効。

## 2. ファイル所有権 (write scope)

| ファイル | 所有者 | 内容 |
|---|---|---|
| `package.json` | Lead | パッケージ定義・exports・dsh metadata・scripts |
| `lib/host-modules.js` | executor | ホスト側 DSH パッケージの解決 (下記 §5) |
| `lib/schema.js` | executor | Config schema factory (schemastery) |
| `lib/detect.js` | executor | Git Bash 探索・検証 (§4) |
| `lib/executor.js` | executor | `GitBashExecutor` クラス (§3) |
| `lib/index.js` | host | 行プラグイン: executor/tool mount, prompt, route (§6) |
| `cordis.patch.yml` | host | profile への insert 行 (§8) |
| `lib/client.js` | client | 設定カード (§7) |
| `locale/en.json`, `locale/ja.json` | client | カード文言 |
| `test/executor.test.mjs` 他 executor テスト | executor | §9 |
| `test/host.test.mjs`, `test/patch.test.mjs` | host | §9 |
| `test/client.test.mjs` | client | §9 |
| `test/e2e.sh`, `test/e2e-home/**` | lead (統合時) | Linux 実機 E2E (§9) |
| `README.md`, `docs/**` | verifier (後で) | ユーザー向け文書 |
| `LICENSE` | lead | MIT |

- **他者のファイルを書き換えない**。インターフェース変更が必要なら Lead にメッセージ。
- 共有ファイル `package.json` は Lead のみ編集。

## 3. `lib/executor.js` — 私有 Git Bash executor

```js
// モジュール先頭で host module を解決 (静的 import は node:builtin 以外禁止)
const { SandboxBashExecutor } = await hostImport('@deepseek-ai/dsh-bash-sandbox')
const z = (await hostImport('@deepseek-ai/schemastery')).default
export const Config = makeConfig(z)          // lib/schema.js
export class GitBashExecutor extends SandboxBashExecutor {
  static Config = Config
  // static inject は親から継承 (['subprocess','sandbox','sandboxPolicy'])
  async execute(spec) { ... }               // 下記
  confine(command, policy, signal) { ... }  // 親の sandbox 経路用
  static decorateExecution(ex, sandbox) { ... } // result()/handle に sandbox facts を付与
}
export default GitBashExecutor
```

### 3.1 Config fields (`lib/schema.js`、すべて null 許容でない plain 値)

| field | 型 | default | 意味 |
|---|---|---|---|
| `cwd` | string | `''` | 実行 cwd 既定 (空 = セッション cwd) |
| `timeoutMs` | number | `120000` | 既定タイムアウト |
| `maxTimeoutMs` | number | `600000` | 上限 |
| `maxOutputBytes` | number | `64000` | 1 stream の保持上限 |
| `maxSpillBytes` | number | `67108864` | spill 上限 |
| `graceMs` | number | `3000` | kill grace |
| `bashPath` | string | `''` | Git Bash の明示パス。空 = 自動検出 |
| `initScript` | string | `''` | `BASH_ENV` に渡す初期化スクリプト (`~` 展開) |
| `sandboxFallback` | `'fail' \| 'unconfined'` | `'fail'` | 制限モードで ACL sandbox が使えない場合の挙動。既定は fail-closed |

- 行 Config と executor Config は同一 schema。executor は `scope.plugin(GitBashExecutor, values)` で
  plain 値を渡し、loader が ref 化する。base 実装は `this.config.<field>.get()` で読む。
- **volatile にしない**: 設定変更 = 行再読込 (HMR) で新しい executor を mount する。
  旧 executor のプロセスは `ctx.subprocess` 所有なので kill されない (公式仕様)。

### 3.2 実行経路 (`execute(spec)` を override)

```
bashPath = requireBashPath() // 検出失敗は明確な Error (pwsh/cmd へは絶対に fallback しない)
mode = spec.sandboxPolicy?.mode
argv = [bashPath, '-c', spec.command]

if mode === undefined || mode === 'danger-full-access':
    return decorate(await executeArgv(withInitScript(spec), argv), {mode: mode ?? 'danger-full-access', denied:false})
if sandboxFallback === 'unconfined':
    warn once; return decorate(await executeArgv(withInitScript(spec), argv),
        {mode, denied:false, enforcement:'unconfined'})
// default: 公式と同じ confining 経路。親 SandboxBashExecutor.execute が confine() を呼ぶ
return super.execute(withInitScript(spec))
```

- `gitBashRoute(spec)` を独立関数/メソッドに切り出し、**単体テスト可能**にする。
- `withInitScript(spec)`: `initScript` 設定時 `dshEnv.BASH_ENV = expandHome(initScript)` を merge。
- `get sandboxMode()`: `sandboxFallback === 'fail'` のときだけ `ctx.sandboxPolicy.defaultMode` を返す。
  `'unconfined'` のときは `undefined` を返す = 公式ツールは escalation fields を広告せず、
  sandbox facts も付けない (誤解を招く「守られている」表示をしない)。
- `confine(command, policy, signal)`:
  `return this.ctx.sandbox.confine([this.requireBashPath(), '-c', command], policy, signal)`
  (親 `SandboxBashExecutor` の confine は裸 `bash` を hard-code しているので必ず上書き)
- `super.execute()` の confined 経路が投げる `SandboxUnavailableError` は握りつぶさない
  (fail-closed)。エラー詳細に「Git Bash + Windows ACL の既知制約 / pwsh tool or
  danger-full-access への切替 / sandboxFallback」の案内文を足してよい。
- env: base の `ENV_OVERRIDES` (NO_COLOR/TERM=dumb/PAGER) は親 `spawnSpec` が適用する。
  独自 env を足す場合は `spec.env`/`spec.dshEnv` に merge する (credential scrub は subprocess 側)。
- **`spawn(cmd, {shell:true})` は使わない**。command は argv 1 要素として渡す。
- cwd は `resolve()` (親) が `config.cwd` で埋める。Windows パスのまま spawn する。

### 3.3 検出失敗時のエラー文 (fail-closed, 具体例)

```
dsh-gitbash-win: Git for Windows の bash.exe が見つからないためコマンドを実行できません。
Git for Windows をインストールするか、Settings → Plugins → Git Bash で bashPath を設定してください。
(代替シェルへの自動 fallback は行いません)
```

## 4. `lib/detect.js` — Git Bash 検出・検証

```js
export function expandHomePath(value, homedir = os.homedir())   // ~, ~/, 引用符 strip
export function candidateBashPaths({ platform, env }) -> string[]  // 重複除去・優先順
export function isWslAlias(path, env) -> boolean                    // System32 / WindowsApps
export async function probeBash(path, { timeoutMs = 4000 } = {}) -> {ok, system, version, error}
export async function resolveGitBash({ configured, platform = process.platform, env = process.env,
    probe = probeBash, cache = true } = {}) -> {
      ok: boolean, path: string|null, source: 'configured'|'known-dir'|'path'|'git-sibling'|'registry',
      candidates: [{ path, ok, source, reason? }],
      report: string   // 1 行サマリ (ログ用) / 複数行詳細も可
    }
```

- 探索順 (win32):
  1. `configured` (空でなければ最優先。ただし WSL alias は拒否)
  2. 既知ディレクトリ: `%ProgramFiles%\Git\bin\bash.exe`,
     `%ProgramFiles(x86)%\Git\bin\bash.exe`, `%ProgramW6432%\Git\bin\bash.exe`,
     `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`
  3. PATH (`;` 区切り) 上の `bash.exe`。`%SystemRoot%\System32` 配下は除外
  4. PATH 上の `git.exe` の兄弟 `..\bin\bash.exe`
  5. レジストリ `HKLM\SOFTWARE\GitForWindows` `InstallPath` (存在すれば `reg.exe query` で取得、
     失敗は無視)
- 検証: ファイル存在 + WSL alias 除外 + (自動検出候補は) `bash -c "uname -s"` の stdout が
  `/^(MINGW|MSYS|CYGWIN)/i` に一致。timeout 4s。spawn は `node:child_process.execFile`
  (shell:false) で行う。**明示 configured は uname 不一致でも使い、warning を返す**
  (ユーザーの明示指定を勝手に捨てない。ただし WSL alias だけは拒否)。
- 非 win32: `configured` が空なら `ok:false` (「Windows 専用プラグインです」)。明示パスは
  存在確認のみで採用 (Linux でのテスト用)。
- 同一 (platform, configured, PATH, env) の結果はメモ化 (プロセス内)。status route と executor が
  同じ関数を共有する。
- Git for Windows 以外 (WSL bash, Cygwin) を **自動選択しない**。WSL は特に明示拒否。

## 5. `lib/host-modules.js` — ホスト DSH パッケージの解決

out-of-tree プラグインは `@deepseek-ai/dsh-*` を bare import できない (profile の node_modules に
無い)。実測で `createRequire(<dsh>/lib/bin.js)` からすべて解決できた。

```js
export function hostResolve(specifier) -> string  // 絶対パス
export async function hostImport(specifier) -> module  // キャッシュ付き動的 import
```

- 解決候補 (順):
  1. `createRequire(import.meta.url).resolve(specifier)` (開発時: 自前 node_modules/symlink)
  2. `createRequire(process.argv[1]).resolve(specifier)` (dsh CLI から起動された場合)
  3. `createRequire(join(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh/lib/bin.js'))`
     など既知のグローバル install パスを数個試す (Windows: `%APPDATA%\npm\node_modules\...`)
- 失敗時は「DSH 本体が見つからない」と明示して throw (無言 fallback 禁止)。
- オブジェクトは `Object.freeze` せず、実測した解決結果を `console.warn` しない (静かに)。
- テスト: `hostResolve('@deepseek-ai/dsh-tool-bash')` が実在ファイルを返す、存在しない名前で
  明確に throw する、を検証。

## 6. `lib/index.js` — 行プラグイン (host half)

```js
import { GitBashExecutor, Config } from './executor.js'
import { hostImport } from './host-modules.js'
const toolBash = await hostImport('@deepseek-ai/dsh-tool-bash')   // {apply,inject,Config,name}

export const name = 'gitbash-win'
export const inject = []          // 即時 apply。子 plugin 側の inject が待つ
export { Config }
export function apply(ctx, config) {
  const scope = ctx.isolate('shell')
  const values = snapshot(config)  // plain 値へ
  const executorFiber = scope.plugin(GitBashExecutor, values)
  const toolFiber = scope.plugin(toolBash, { enableRunInBackground: true, promoteOnTimeout: true })
  ctx.inject(['systemPrompt'], (c) => c.effect(() => c.systemPrompt.section({
      name: 'gitbash-win:routing', order: c.systemPrompt.getSectionOrder('TOOL_PWSH') + 1,
      text: ROUTING_TEXT }), 'gitbash-win: routing section'))
  ctx.inject(['webServer', 'connection'], (c) => { /* §6.1 route */ })
  ctx.effect(() => () => { /* fibers auto-dispose; 明示 dispose 不要ならこの effect は省略 */ })
}
```

- `apply` は同期。top-level await で tool-bash module を取得しておく。
- child plugin の mount は `scope.plugin(...)`。root `ctx.shell` には触らない。
- 多重 mount 防止: cordis の二重 load は plugin-manager が防ぐ。同一 fiber 内で
  既に mount 済みなら何もしない等は不要。
- boot 時ログ (任意): platform 非対応/未検出なら `ctx.logger.warn(...)` を 1 回だけ。
  ただし検出 spawn は boot では行わず、初回実行/status 取得時に行う (起動を遅らせない)。

### 6.1 status route (`GET /dsh-gitbash-win/status`)

- `ctx.webServer.register({ kind:'exact', path:'/dsh-gitbash-win/status', handler })` を
  `c.effect(() => ...)` で登録し、dispose で解除。
- 認可フェンス: 公式 `dsh-host-open-in-app` と同じ `connection.requestRejection(req)` を使い、
  拒否時はその status で終了 (未認証に情報を出さない)。
- レスポンス (JSON, `cache-control: no-store`):

```json
{
  "plugin": "dsh-gitbash-win",
  "platform": "win32",
  "supported": true,
  "bashPath": {
    "configured": "C:/Program Files/Git/bin/bash.exe",
    "resolved": "C:/Program Files/Git/bin/bash.exe",
    "ok": true,
    "source": "known-dir",
    "candidates": [{ "path": "...", "ok": true, "reason": null }]
  },
  "sandbox": { "available": true, "defaultMode": "workspace-write", "fallback": "fail" },
  "tool": { "name": "bash", "global": true }
}
```

- `sandbox.available` = `ctx.get('sandbox') !== undefined`、`defaultMode` = `ctx.get('sandboxPolicy')?.defaultMode ?? null`。
- 例外は 500 JSON で `{error: message}`。パスは JSON なので `\` エスケープは JSON.stringify 任せ。

## 7. `lib/client.js` — 設定カード (browser half)

- package.json: `"dsh": { "client": { "inject": [
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-settings" ], "platform": "web" } }`
- 素の classic script 形式 (`window.__ModuleLoader__.load({ id:'dsh-gitbash-win', factory(require){...} })`)。
  末尾で `exports.apply` / `exports.inject = ['slots','configForms','locale']` を公開。
- `ctx.configForms.whileServed(['gitbash-win'], (served) => ctx.slots.inject('plugins.item', () =>
  ctx.slots.register({ name:'plugins.item', id:'gitbash-win', order:50,
    label:() => t('title'), locale: NS, inject: () => ({ form, api }) }, Card)))`
- `form = ctx.configForms.get('gitbash-win')`。
- カード表示 (`props.view === 'summary'` では説明文のみ):
  - **検出状態**: mount 時に `fetch('dsh-gitbash-win/status' or '/dsh-gitbash-win/status')`
    → resolved path / source / candidates / sandbox.defaultMode を表示。失敗時は理由表示。
    「再検出」ボタンで再取得。
  - **bashPath** (text): 空 = 自動検出。placeholder に解決済みパスを表示。
  - **initScript** (text): `BASH_ENV` 初期化スクリプト。
  - **timeoutMs / maxOutputBytes** (number): 行 Config の値を編集。
  - Save / Reset: `form.getSnapshot()` の `value` と draft を比較し、変更フィールドのみ
    `form.set(field, value)` / 未変更は `form.unset(field)` (ユーザー上書き解除) を
    `form.mutate([...])` で 1 回にまとめる (`expectedRevision = snapshot.revision`)。
    `writable === false` のときは編集不可表示。`status !== 'ready'` のときは loading 表示。
  - **sandboxFallback は UI に出さない** (安全設定なので cordis.patch.yml のみ、docs で明記)。
- UI は React (`require('react')` の `createElement`/hooks) で自前の簡潔なフォーム。
  `SettingsForm` 等の primitives への依存はしない (バージョン差に強い)。
  inline style は最小限 (font/余白)。クラス名は公式カードと衝突しない `gitbash-win-*`。
- 文言は `ctx.locale.register(NS, { en, ja })` + `ctx.locale.bind(NS)`。ja を主、en も用意。
- 文字列は locale/*.json に置き、client.js からは `require` せず JS オブジェクトとして
  locale ファイルを **import しない** (classic script なので埋め込み)。→ locale/*.json は
  docs/将来用の正本とし、client.js 内の辞書と同期させること (テストでキー一致確認)。

## 8. `cordis.patch.yml`

```yaml
# dsh-gitbash-win bundle patch: add the Git Bash row on Windows only.
# The official PowerShell executor and every official tool stay untouched.
- insert:
    - id: gitbash-win
      name: dsh-gitbash-win
      disabled: !!js process.platform !== 'win32'
      config:
        bashPath: ''
        initScript: ''
        sandboxFallback: fail
        timeoutMs: 120000
        maxOutputBytes: 64000
```

- 行 id = configForms key = `gitbash-win`。
- 既存行の disable / name 変更はしない。`insert` のみ。

## 9. テスト方針 (この環境 = Kubuntu で検証可能な範囲)

共通: `node --test test/*.test.mjs`。Node 24 / 実行は workspace-write sandbox 内。

### 9.1 executor (`test/executor.test.mjs`, `test/detect.test.mjs`)
- detect: 候補生成順、WSL alias 除外、`uname` probe の MINGW/MSYS 判定、configured 優先、
  非 win32 + 空 configured の明確なエラー。fs/probe は注入してスタブ。
- executor: **cordis を実 mount した実機テスト** (この環境で実行可能):
  ```
  new Context(); root.plugin(subprocess-local); isolated = root.isolate('shell');
  isolated.plugin(GitBashExecutor, { bashPath:'/bin/bash', ... });
  await isolated.get('shell').execute(resolve({command:'echo hi'})) → stdout 'hi\n', exit 0
  ```
  - danger-full-access 相当 (sandboxPolicy undefined) で実 spawn
  - `sandboxFallback:'unconfined'` で sandboxPolicy mode='workspace-write' のとき
    fact (`enforcement:'unconfined'`) が付く (sandbox service をスタブ)
  - `sandboxFallback:'fail'` で Git Bash 経路が sandbox.confine を呼ぶこと (スタブで確認)
  - initScript が `BASH_ENV` として dshEnv に merge されること
  - bashPath 未解決時のエラーが明確 (fallback しない)
- Windows 実機はないため、win32 固有値は `platform:'win32'`/env 注入の純関数テストで担保。

### 9.2 host (`test/host.test.mjs`, `test/patch.test.mjs`)
- patch: YAML パース、row id/name/disabled 式/config field 名が schema と一致。
- host: 公式 tool-bash の実 mount。`dsh-tools`/`dsh-system-prompt`/`dsh-shell-env`/
  `dsh-working-directory`/`dsh-subprocess-local` を root Context に mount し、
  root を sandbox として `lib/index.js` の apply を呼ぶ。`bash` tool が
  `ctx.tools.schemas()` に現れること、`ctx.shell` (root) が未登録のままであること。
  route は `webServer.register` をスタブした sandbox で登録内容を検証。
  ※ 実 DSH サービス mount が重すぎる場合は、apply が使う API を fake ctx で検証する
  単体テストに切り替え、E2E (§9.4) で実結合を担保する。
- Linux 上では platform 分岐が無効にならないため、apply テストは config を直接渡す。

### 9.3 client (`test/client.test.mjs`)
- `globalThis.window.__ModuleLoader__` を stub し client.js を `module`/`require` シムで評価。
- `exports.inject` / `exports.apply` の存在、apply が fake ctx (slots/configForms/locale/effect)
  で slot 登録を行うこと、locale 辞書 (en/ja) が locale/*.json とキー一致すること。
- fetch はグローバル stub (status route の JSON を返す)。

### 9.4 E2E (Lead が統合時に作成): `test/e2e.sh`
- temp `DSH_HOME` に web profile を初期化し、`package.json` に
  `"dsh-gitbash-win": "file:<abs path>"` + bundles 追記、`node_modules/dsh-gitbash-win` symlink。
- profile `cordis.patch.yml` で Linux テスト用に
  `- id: gitbash-win` `disabled: false` `config: { bashPath: '/bin/bash', sandboxFallback: unconfined }`。
- `DSH_PERMISSION_MODE=danger-full-access` で `dsh --profile e2e --dump-config` →
  行が有効・schema dump 成功を確認。
- `dsh --profile e2e --port <空きport>` を background 起動 → `GET /dsh-gitbash-win/status` が
  JSON 200 を返し、`bashPath.resolved == '/bin/bash'` を確認。停止。
- executor の実 spawn は 9.1 が担う。

## 10. 安全要件 (must)

1. **fail-closed 既定**: 制限モードで sandbox が使えなければコマンドを実行しない。
   `unconfined` はユーザーの明示設定のみ。warn を 1 回出す。
2. **代替シェルへの無断 fallback 禁止**: Git Bash 不在時に pwsh/cmd/WSL で代行しない。
3. `sandbox_permissions` の escalation は公式ツールの承認経路に委ねる (独自バイパス禁止)。
4. パス検証: WSL alias (`System32\bash.exe`, WindowsApps) を拒否。`spawn(shell:true)` 禁止。
5. credential/秘密をログ・route レスポンスに出さない。`env` 全体を返さない。
6. ルート/管理者権限の取得・サービス変更・レジストリ書き込みはしない
   (レジストリは `reg query` の読み取りのみ)。
7. 既存 base 行の disable/name 変更をしない (アンインストールで完全復元)。
8. 設定カードは自分の行 Config のみ書く。プロファイルの他行やグローバル設定を書き換えない。
9. 非 Windows では行が disabled。テスト時のみ patch で有効化する。

## 11. 既知の制約 / ドキュメントに書くこと

- 公式 Windows ACL sandbox (restricted token + Low integrity) と MSYS/Git Bash の
  互換性は **未検証**。制限モードで `SANDBOX_UNAVAILABLE` になる場合は、公式 `pwsh` tool で
  その操作を行うか、`danger-full-access` を選ぶか、`sandboxFallback: unconfined` を明示する
  (後者は shell の書き込みが制限されない)。
- `pwsh` tool は preset 側に残るため、モデルは bash と pwsh を呼び分けられる。
  既定の routing prompt で bash 優先を案内する。PowerShell ツールの非表示化は v0.2 以降。
- sidebar の対話 terminal (`dsh-terminal-bash` 等) は別系統。v0.1 では変更しない。
- `run_code` (PTC) の `tools.bash` も global tool として見える (PTC executor は global tool を
  SDK に載せる)。presets のツール面には影響しない。
- Git for Windows は `core.autocrlf` 等の設定差がある。v0.1 では環境を改変しない。
- WSL / Cygwin / MSYS2 は自動選択しない (明示 bashPath なら動作可、自己責任)。

## 12. 検証 (Windows 実機での確認チェックリスト — README に載せる)

1. `dsh plugin --profile web add <path|npm>` → プロファイル再起動。
2. Settings → Plugins → "Git Bash" カード: status が `resolved: C:/Program Files/Git/bin/bash.exe`。
3. 新規セッションで `/bin/bash --version`、`echo $BASH_VERSION`、`uname -s` が MINGW64_NT-*。
4. ツール一覧に `bash` と `pwsh` が共存。`bash` で POSIX コマンドが通る。
5. danger-full-access で書込み、workspace-write で sandbox 挙動を確認
   (成功 or `SANDBOX_UNAVAILABLE` の明示エラー)。`code`/`uname` の文字化け有無。
6. アンインストール → 公式 PowerShell 挙動に戻る。
