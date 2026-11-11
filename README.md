# dsh-gitbash-win

DeepSeek Harness (DSH) の Windows 版で、エージェントのコマンド実行シェルに
**Git for Windows の bash** を追加するプラグインです。

DSH の Windows 構成は既定で PowerShell 実行器（`dsh-pwsh-sandbox`）と
`pwsh` ツールだけを用意します。このプラグインは公式構成を**一切壊さずに**、
Git Bash 用の実行器と公式 `bash` ツールを追加でマウントします。

- 追加されるもの: グローバル `bash` ツール（公式 `@deepseek-ai/dsh-tool-bash` を
  Git Bash 実行器に接続したもの）＋ Web 設定カード＋ 検出状態 API
- 変更しないもの: `pwsh` 実行器・`pwsh` ツール・agent preset・base バンドルの各行
  → アンインストールすれば完全に元通り（公式 PowerShell 挙動に戻る）
- モデルは **`bash` と `pwsh` を用途で選べます**（bash 優先の routing 指示を自動追加）

> **対象**: DSH `0.2.2-rc.1` / Windows 10・11 / Git for Windows
> **状態**: v0.1（Git Bash 対応）。WSL・cmd・Nushell の選択は今後（[既知の制約](#既知の制約v01)）。
> **リポジトリ**: https://github.com/Seduce0068/dsh-gitbash-win
> [![gitleaks](https://github.com/Seduce0068/dsh-gitbash-win/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/Seduce0068/dsh-gitbash-win/actions/workflows/gitleaks.yml)
> [![windows-smoke](https://github.com/Seduce0068/dsh-gitbash-win/actions/workflows/windows-smoke.yml/badge.svg)](https://github.com/Seduce0068/dsh-gitbash-win/actions/workflows/windows-smoke.yml)
> [![linux-tests](https://github.com/Seduce0068/dsh-gitbash-win/actions/workflows/linux-tests.yml/badge.svg)](https://github.com/Seduce0068/dsh-gitbash-win/actions/workflows/linux-tests.yml)

---

## 何が嬉しいのか

Windows の DSH では、モデルが使えるシェルツールが `pwsh` だけでした。
このプラグインを入れると、同じセッションで:

| ツール | 実体 | 使いどころ |
|---|---|---|
| `bash`（追加） | `C:\Program Files\Git\bin\bash.exe -c <command>` | POSIX コマンド・パイプ・シェルスクリプト・git・make など |
| `pwsh`（公式のまま） | 公式 PowerShell 実行器 | cmdlet・.NET・レジストリ・Windows ネイティブ操作 |

`bash` ツールは公式 `dsh-tool-bash` の実装をそのまま使い、`ctx.shell` だけを
Git Bash 実行器に差し替えてマウントしています。そのため **バックグラウンドジョブ・
タイムアウト・出力上限・サンドボックス承認（`sandbox_permissions`）・描画は
公式 bash ツールと同一**です。

---

## 必要環境

- DeepSeek Harness `0.2.2-rc.1`（`engines.dsh` で確認されます）
- Node.js `>= 24.9.0`（DSH `0.2.2-rc.1` 本体の要件）
- Windows 10 / 11
- [Git for Windows](https://gitforwindows.org/)（`bash.exe` を含むもの）
- DSH の Web GUI を使う場合: Web プロファイル（`dsh web`）

Linux/macOS では行が無効化されます（テスト用に profile patch で `disabled: false` と
明示 `bashPath` を設定すれば動作可）。

> DSH 本体を更新する場合（例: `0.3.x`）は、先に
> [docs/updating-dsh.md](docs/updating-dsh.md) の追従チェックリストを確認してください。

---

## インストール（Windows）

### 方法 A: パッケージを入れる（推奨）

このリポジトリを Windows 機へコピーするか、配布用 tarball
`dsh-gitbash-win-0.1.0.tgz` を用意して、PowerShell で:

```powershell
# フォルダから入れる場合
dsh plugin --profile web add file:C:/path/to/dsh-gitbash-win

# tarball から入れる場合
dsh plugin --profile web add file:C:/path/to/dsh-gitbash-win-0.1.0.tgz
```

`dsh plugin add` は pnpm でパッケージを入れ、パッケージが宣言する
`dsh.bundle`（このプラグインの `cordis.patch.yml`）をプロファイルの
`dsh.profile.bundles` に追加します。**その後 DSH を再起動**してください。

> この pnpm 経由のインストール経路は、CI（Windows 実機）ではまだ自動検証して
> いません（CI は「方法 B」と同じ手動配置で E2E を実行しています）。失敗する
> 場合は **方法 B** の手動配置を試してください。

インストール後に確認:

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\web\package.json"
#   "dependencies": { "dsh-gitbash-win": "..." }
#   "dsh": { "profile": { "bundles": [ ..., "dsh-gitbash-win" ] } }
```

> `%USERPROFILE%\.dsh` は既定の DSH ホームです。`DSH_HOME` を設定している場合は
> そのディレクトリ配下の `profiles\web` を見てください。

### 方法 B: 手動で入れる（pnpm を使わないフォールバック）

`dsh plugin add` が使えない環境では、プロファイルに直接配置できます。

```powershell
$profileDir = "$env:USERPROFILE\.dsh\profiles\web"
New-Item -ItemType Directory -Force "$profileDir\node_modules" | Out-Null
Copy-Item -Recurse -Force "C:\path\to\dsh-gitbash-win" "$profileDir\node_modules\dsh-gitbash-win"
```

`$profileDir\package.json` を編集:

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-gitbash-win": "file:C:/path/to/dsh-gitbash-win"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-gitbash-win"
      ]
    }
  }
}
```

`$profileDir\cordis.patch.yml` の**先頭の `[]` を消して**（テンプレートは空配列
1 行で終わっています）、末尾に設定を追記します（省略可。既定のままでも動きます）:

```yaml
- id: gitbash-win
  config:
    # bashPath: 'C:/Program Files/Git/bin/bash.exe'  # 空 = 自動検出
    sandboxFallback: fail
```

DSH を再起動します。

### インストール後の初期確認

いずれの方法でも、再起動後に:

1. **Settings → Plugins → 「Git Bash」カード**を開く
   - 「検出済み」/ `C:/Program Files/Git/bin/bash.exe` / 検出元「既知のフォルダー」などと表示
   - 検出されていない場合はカードに理由（WSL alias 拒否・見つからない等）が出ます
2. **新しいセッション**を作り、モデルに次を実行させる:
   - `echo $BASH_VERSION` → `5.x.x(1)-release` など
   - `uname -s` → `MINGW64_NT-10.0-...`
   - `command -v bash` → `/usr/bin/bash`
3. ツール一覧に **`bash` と `pwsh` の両方**が出ていれば成功です。

---

## 設定

設定は 2 か所から行えます。

### Web 設定カード（推奨）

**Settings → Plugins → Git Bash** を開き、次の 4 項目を編集して **Save**:

| フィールド | 既定値 | 説明 |
|---|---|---|
| `bashPath` | 空（自動検出） | `bash.exe` の明示パス。空なら自動検出。WSL/Store のエイリアスは拒否 |
| `initScript` | 空（無効） | bash の `BASH_ENV` に渡す初期化スクリプト（`~` 展開）。`eval "$(fnm env)"` などに使う |
| `timeoutMs` | `120000` | 1 コマンドの既定タイムアウト |
| `maxOutputBytes` | `64000` | 1 ストリームの保持上限（超過分は spill ファイルへ） |

`sandboxFallback` は安全設定のため**カードでは編集できません**。カードには現在値が
変更不可の値として表示されます。この値は非 volatile で、公式 bash ツールが mount 時に
広告する sandbox モードと実行経路を一致させるため、変更は**プロファイルの
`cordis.patch.yml` を編集**し、**プラグイン行の再読込（HMR 有効な Web プロファイル）か
ホスト再起動**で反映します。

「再検出」ボタンで Git Bash の探索をやり直せます。`sandboxFallback` 以外の設定は
**保存すると次のコマンドから即時反映**され（volatile config を executor が毎回
読み直す）、実行中のコマンドは `ctx.subprocess` 側が所有しているため殺されません
（公式 executor と同じ扱い）。

> 設定した `bashPath` が存在しない場合、その候補は「利用不可」と表示され、自動検出へ
> フォールバックします（タイポすると別の Git インストールが選ばれることがあります）。
> 存在するのに実行できない場合は fail-closed でエラーになり、別の bash を勝手に
> 代用しません。

### 設定ファイル（`cordis.patch.yml`）

`...\profiles\web\cordis.patch.yml` に行設定を書くと、カードと同じ値（＋カードでは
編集できない項目）を設定できます。

```yaml
- id: gitbash-win
  config:
    bashPath: ''            # 空 = 自動検出
    initScript: ''          # BASH_ENV（~ 展開、空 = 無効）
    timeoutMs: 120000
    maxTimeoutMs: 600000
    maxOutputBytes: 64000
    maxSpillBytes: 67108864
    graceMs: 3000
    # 安全設定（通常は fail のまま。変える場合は docs/security.md 参照）
    sandboxFallback: fail   # fail | unconfined
```

行 ID（`gitbash-win`）は設定カードの識別子・設定名前空間と同一です。
`sandboxFallback` は非 volatile です。変更した場合は**プラグイン行の再読込（HMR 有効な
Web プロファイル）またはホスト再起動後**に反映されます（カードからの保存では変更
できません）。

### カード保存と手編集の共存（`cordis.patch.yml`）

カードで **Save** した値（`bashPath` / `initScript` / `timeoutMs` / `maxOutputBytes`）は、
Host の設定サービス経由でプロファイルの `cordis.patch.yml` に書き込まれます
（`set` / `unset` の最小操作。行 ID は `gitbash-win`）。

- Save は**カードが所有するフィールドだけ**を書き換えます。同じファイルに手で書いた
  他のキー（`maxTimeoutMs` / `maxSpillBytes` / `graceMs` / `sandboxFallback` など）は
  そのまま残ります。
- 逆に、カードを開いたまま同じキーを手で編集すると、次回 Save でカード側の値に
  上書きされ得ます。手編集したらページ/カードを再読込してから操作してください。
- Save が revision 競合などで拒否された場合は、カードを再読込して最新値を確認してから
  再保存してください（下のトラブルシューティング「Save が受け付けられない」も参照）。
- `sandboxFallback` は非 volatile のためカードの Save 対象外です。手で
  `cordis.patch.yml` を編集し、行の再読込またはホスト再起動で反映してください。

---

## サンドボックスと権限（重要）

DSH の権限モード（`read-only` / `workspace-write` / `danger-full-access`）に対する
このプラグインの挙動:

- **`danger-full-access`**: Git Bash を直接実行（公式 bash 実行器と同じ意味）。
- **制限モード**（`read-only` / `workspace-write`）: 公式 `ctx.sandbox` の
  ACL restricted-token 経路に Git Bash の argv を渡します。ここで runner が
  起動できない場合、コマンドは**実行せずエラー**にします（fail-closed）。
- 既定 `sandboxFallback: fail` では、**制限モードで Git Bash を実行できない＝
  コマンドを実行しない**。エラーは `SANDBOX_UNAVAILABLE` としてモデルに返ります。
- `sandboxFallback: unconfined` は**明示オプトイン**です。制限モード要求時でも
  Git Bash を**サンドボックスなし**で実行し、結果に `enforcement: unconfined` を付け、
  初回の `unconfined` 実行時に 1 回警告ログを出します。安全設定なので**カードでは
  編集できず**、現在値が変更不可の値として表示されるのみです（変更は `cordis.patch.yml`
  に書き、**行の再読込またはホスト再起動**で反映します）。

> **実測結果（2026-11-10 / GitHub Actions `windows-latest` = Windows Server 2025 /
> Git for Windows 2.56.0.windows.4）**: 公式 ACL restricted-token 経路では
> **コマンドは実行されませんでした**（run により `0xC0000142` STATUS_DLL_INIT_FAILED で
> Git Bash が初期化に失敗、または sandbox backend 自体が使用不可の fail-closed）。
> プラグインはこの既知のクラッシュコードを **`SANDBOX_UNAVAILABLE` に変換**し、
> 「実行していない」ことと代替手段をモデルに明示します。つまり **Windows の `read-only` / `workspace-write` では
> Git Bash は現状使えません**。選べる運用は次の 3 つです:
>
> 1. その操作だけ公式 `pwsh` ツールを使う（PowerShell 側の ACL サンドボックスはそのまま動きます）
> 2. セッションのアクセスモードを `danger-full-access` に切り替える
> 3. 明示的に `sandboxFallback: unconfined` を設定する（**bash の書き込みは制限されません**）
>
> 前景の confined 呼び出しは `SANDBOX_UNAVAILABLE`（fail-closed）として返ります。
> バックグラウンド / プロモートされたジョブでは、既知の restricted-token 起動
> クラッシュ（`0xC0000142` 等）が `runnerFailed` として扱われ、ジョブの表示に
> runner 失敗の通知が出ます（例外としては表面化しません）。いずれも
> **コマンドは実行されません**。
>
> ファイル系ツール（read/write/edit/glob など）のサンドボックスは別系統で、
> このプラグインの影響を受けません。実測ログは
> [docs/verification.md](docs/verification.md)、詳細は [docs/security.md](docs/security.md)。

脆弱性の報告方法は [SECURITY.md](SECURITY.md) を参照してください。

---

## 仕組み（短縮版）

```
profile
└─ bundle: dsh-gitbash-win            (cordis.patch.yml の insert 1 行だけ)
   └─ row: gitbash-win → lib/index.js apply()
      ├─ ctx.isolate('shell')          ← ルートの ctx.shell は触らない
      │  ├─ plugin: GitBashExecutor    （公式 SandboxBashExecutor を継承）
      │  └─ plugin: 公式 dsh-tool-bash （isolate 内の ctx.shell = Git Bash 実行器）
      ├─ systemPrompt section: bash 優先の routing 指示
      └─ GET /dsh-gitbash-win/status   （設定カードが読む検出結果）
```

- Git Bash 実行器は `bash.exe -c <command>` を **argv 1 要素**として起動します
  （`shell: true` は使いません）。
- Git Bash が見つからない場合は、**pwsh / cmd / WSL に自動で切り替えません**
  （明示エラー）。勝手に別シェルで実行する方が危険なためです。
- base バンドルの行は disable も rename もしません。アンインストールで完全復元。

設計の詳細は [DESIGN.md](DESIGN.md)、安全性は [docs/security.md](docs/security.md)。

---

## アンインストール / 元に戻す

```powershell
dsh plugin --profile web remove dsh-gitbash-win
```

または手動の場合は次を削除して再起動:

1. `...\profiles\web\node_modules\dsh-gitbash-win`
2. `package.json` の `dependencies` の該当行と `dsh.profile.bundles` の `"dsh-gitbash-win"`
3. `cordis.patch.yml` の `- id: gitbash-win` ブロック（書いた場合）

再起動後は公式の Windows 構成（`pwsh` ツールのみ）に戻ります。

---

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `bash` ツールが出ない | プラグイン行が無効（Linux では仕様）/ 未再起動 / bundle 未登録。`...\profiles\web\package.json` と DSH ログを確認 |
| `Git for Windows の bash.exe が見つからない` | Git for Windows 未インストール、または PATH/既定インストール先以外。カードで `bashPath` を指定 |
| カードで「未検出」のまま | WSL の `bash.exe`（System32）は意図的に拒否。Git for Windows の `...\Git\bin\bash.exe` を指定 |
| `SANDBOX_UNAVAILABLE` | 上記[サンドボックス](#サンドボックスと権限重要)の 3 択を参照 |
| 文字化けする | Git Bash 自体は UTF-8 ですが、bash から呼んだネイティブ Windows プログラムの出力コードページは変換しません。プログラム側の UTF-8 オプションを使ってください |
| 再検出しても古い結果 | ①カードの「再検出」は毎回キャッシュを無視して再探索します。②それでも古い場合は 15 秒待つ（実行側の検出キャッシュは否定結果のみ 15 秒で失効）。③カードで `bashPath` を明示指定。④最後の手段として DSH 再起動、の順で確認 |
| カードに「検出状態を取得できませんでした」 | セッション切れなどで status route が 401/403 を返しています。ページを再読込し、必要なら再ログインしてください |
| Save が受け付けられない | 設定の revision 競合など。カードを再読込して最新値を確認してから再保存してください |

検出パネルには候補パスとその理由が表示されます（status route は認証済みセッションのみ・`cache-control: no-store`）。

ログ: 起動時は非 Windows 起動の警告（`dsh-gitbash-win:` 接頭辞）、初回実行時は
`unconfined` 使用・設定パスの uname 不一致の警告（`gitbash-win:` 接頭辞）が出ます。

---

## 開発・テスト（Linux でも可）

前提: `dsh` CLI（DSH `0.2.2-rc.1`）がグローバルにインストールされている Linux。
テストはホストの DSH パッケージを解決して実行します（テスト件数は
[docs/verification.md](docs/verification.md) を参照）。

```bash
cd work/dsh-gitbash-win
node --test test/*.test.mjs     # テスト一式（Linux では Windows 専用 4 件を skip）
bash test/e2e.sh                # Linux: 一時 DSH_HOME で web を起動し、行の合成・status route・
                                # client bundle 配信・未認証拒否まで検証（/bin/bash 使用）
```

**Windows 実機がない場合の検証方法は [docs/verification.md](docs/verification.md) を参照**:

- **GitHub Actions `linux-tests`**（push/PR ごとに自動）: ubuntu-latest で
  テスト一式（Linux では Windows 専用 4 件を skip）と `test/e2e.sh`（profile 合成・
  status route・認証・client bundle 配信）を実行
- **GitHub Actions `windows-smoke`**（Windows 機不要・push/PR ごとに自動）:
  実 Windows runner で「実 Git Bash の検出 → 私有 executor による実実行 →
  実 `dsh web` への組込み → status route → client bundle 配信」を検証。
  さらに **Playwright + Edge で設定カードを実際に開き、値を保存して再読込後に
  永続化を確認**（CI 実測: PASS）。ACL サンドボックスとの組み合わせは **ブロッキング**の
  診断で記録（`UNEXPECTED` なら CI 失敗。`confined-ok` / `fail-closed` /
  `acl-incompatible` は成功扱い、いずれもコマンド未実行の fail-closed を確認）。
  失敗時は `browser-card-failure` アーティファクト（スクリーンショット）が残ります
- **手元の Kubuntu に Windows 11 評価版 VM（QEMU/KVM）**: ブラウザでの設定カード操作まで確認
- Windows 専用テスト（実機/VM/CI 用）: `node --test test/windows-live.test.mjs`、
  `bash test/e2e-windows.sh`、`node test/windows-sandbox-probe.mjs`
- 設定カードの実ブラウザテスト（Windows 実機/VM でも可）:
  `npm install --no-save playwright-core@1.56.1` のうえで
  `BROWSER_CARD=1 bash test/e2e.sh`（Linux）/
  `BROWSER_CARD=1 bash test/e2e-windows.sh`（Windows）

### 秘密情報スキャン（Gitleaks）

- **CI**: `.github/workflows/gitleaks.yml` が push / PR ごとに
  gitleaks `8.30.1`（tarball の期待 SHA-256 をワークフロー側に固定して照合してから
  実行）で **全 git 履歴 + 作業ツリー**をスキャンし、検出時はジョブを失敗させます。
- **ローカル（任意）**: gitleaks をインストールしてコミット前フックを有効化:

  ```bash
  git config core.hooksPath .githooks   # staged の変更をコミット前にスキャン
  # または pre-commit フレームワークを使う場合:
  # pre-commit install
  ```

  gitleaks 未インストールの環境では警告してスキップします（CI 側が必ずスキャンします）。
  手動実行は `gitleaks git --no-banner --redact .`。

---

## 既知の制約（v0.1）

- **自動検出は Git for Windows（MINGW の bash）のみ**。WSL・cmd・Nushell は選択できません
  （WSL/Store の `bash.exe` は明示拒否）。MSYS2/Cygwin の bash は bash 互換ですが
  自動検出では選ばず、明示 `bashPath` でのみ使用できます（ツールチェーン・パス変換が
  Git for Windows と異なるため自己責任）。
- **Windows の `read-only` / `workspace-write` では Git Bash を実行できません**（実測: ACL restricted-token 下で `0xC0000142`、または sandbox backend 自体が使用不可。上記参照）。前景は `SANDBOX_UNAVAILABLE`、バックグラウンドジョブでは既知の起動クラッシュ（`0xC0000142` 等）が `runnerFailed` として通知され、いずれもコマンドは実行されません。`danger-full-access` か、明示 `sandboxFallback: unconfined` を使ってください。
- **`bash` と `pwsh` の両ツールが見えます**。PTC（`run_code`）からもグローバル
  ツールが `tools.bash` として見えます（PTC executor は global tool を SDK に載せる
  ため）。agent preset のツール面（bash/pwsh の構成）は変更しません。隠す設定は v0.2 以降。
- **サイドバーの対話ターミナル**（「新しいターミナル」）は別系統で、このプラグインは
  変更しません。
- パス方言の書き換えはしません（MSYS の `/c/...` と Windows の `C:\...` が混在し得ます。
  どちらも多くの場合 Git Bash が受理します）。
- `unconfined` フォールバックは安全設定なので UI では編集不可（現在値のみ変更不可の値
  として表示。変更は `cordis.patch.yml` のみで、反映は行の再読込（HMR 有効な Web
  プロファイル）またはホスト再起動）。
- 本プラグインは v0.1 時点では npm 未公開です（GitHub とローカル tarball で配布）。

---

## ライセンス

MIT（`LICENSE` は MIT 本文のみ）。公式 DSH パッケージ（MIT）は実行時にホストの
インストールから解決してマウントするのみで、再配布しません。
