# Windows へのインストール手順（dsh-gitbash-win）

対象: Windows 10/11、DSH `0.2.2-rc.1`、Git for Windows。
Linux/macOS ではこのプラグインの行は無効になります（テスト用の明示設定を除く）。

**プロファイルについて**: このプラグインはプロファイルごとにインストールします。
Web（`dsh web`）で使うなら `--profile web`、headless（`dsh --profile headless "<task>"`）
で使うなら `--profile headless` を指定してください。headless / TUI には
設定カードと status route はありません（ツールのみ）。

> この手順のうち **1-A（pnpm 経由の `dsh plugin add`）** は、Windows 実機での自動検証が
> まだありません（CI は 1-B と同じ手動配置で E2E を実行しています）。失敗する場合は
> **1-B** を使ってください。各ステップの「確認」コマンドで都度確認してください。

---

## 0. 前提確認

PowerShell:

```powershell
# Node.js（DSH 0.2.2-rc.1 本体の要件）
node --version
# → v24.9.0 以上

# DSH 本体
dsh --version

# Git for Windows（bash.exe の場所）
Test-Path "C:\Program Files\Git\bin\bash.exe"
& "C:\Program Files\Git\bin\bash.exe" -c "uname -s"
# → MINGW64_NT-10.0-... と出れば OK（`Linux` と出たら WSL の bash なので NG）
```

`dsh --version` が `0.2.2-rc.1` でない場合は、このプラグインの `engines.dsh` 範囲
（`>=0.2.2-rc.1 <0.3.0`）に合わずインストールが拒否されることがあります。

---

## 1. プラグインを配置する

### 1-A. `dsh plugin add`（推奨）

プラグインのフォルダ（または `npm pack` で作った `dsh-gitbash-win-0.1.0.tgz`）を
Windows 機へコピーしてから:

```powershell
# フォルダ指定
dsh plugin --profile web add file:C:/Tools/dsh-gitbash-win

# tarball 指定
dsh plugin --profile web add file:C:/Tools/dsh-gitbash-win-0.1.0.tgz
```

確認:

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\web\package.json"
(Get-Content $p -Raw | ConvertFrom-Json).dependencies.'dsh-gitbash-win'
(Get-Content $p -Raw | ConvertFrom-Json).dsh.profile.bundles
# bundles に "dsh-gitbash-win" が入っていること
```

> `DSH_HOME` を設定している場合は `$env:DSH_HOME\profiles\web` がプロファイルです。

> この 1-A の経路は Windows CI ではまだ自動検証していません。失敗する場合は 1-B の
> 手動配置を使ってください（CI の E2E は 1-B と同じ手動配置で検証しています）。

### 1-B. 手動配置（`dsh plugin add` が使えない場合）

```powershell
$profileDir = "$env:USERPROFILE\.dsh\profiles\web"
$src        = "C:\Tools\dsh-gitbash-win"

New-Item -ItemType Directory -Force "$profileDir\node_modules" | Out-Null
Copy-Item -Recurse -Force $src "$profileDir\node_modules\dsh-gitbash-win"
```

`$profileDir\package.json`:

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-gitbash-win": "file:C:/Tools/dsh-gitbash-win"
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

（既存の `dependencies` / `bundles` は消さずに追記してください。）

任意で `$profileDir\cordis.patch.yml` に行設定を追記します（省略可。既定のままでも動きます）。
テンプレートは空配列 `[]` 1 行で終わっているので、**`[]` を消してから**末尾に追記してください:

```yaml
- id: gitbash-win
  config:
    # bashPath: 'C:/Program Files/Git/bin/bash.exe'  # 空 = 自動検出
    sandboxFallback: fail   # fail | unconfined（安全設定。通常は fail のまま）
```

カードの Save による書き込みと手編集の共存（Save はカード所有の 4 項目だけを書き換え、
他のキーは残る／手編集後はカードを再読込）については README の
[カード保存と手編集の共存](../README.md#カード保存と手編集の共存cordispatchyml)
を参照してください。

> 手動配置は `dsh plugin` の `engines.dsh` 検査を通りません。DSH 本体を更新した場合は
> [docs/updating-dsh.md](updating-dsh.md) の追従チェックリストを実行してください。

---

## 2. DSH を再起動する

Web プロファイルのホストを再起動します（タスクトレイ常駐・サービス・手動起動の
いずれでも、そのプロセスの再起動）。

- カードの **Save** は、編集可能な 4 項目（`bashPath` / `initScript` / `timeoutMs` /
  `maxOutputBytes`）を Host の設定サービス経由でプロファイルの `cordis.patch.yml` に
  書き込みます。同じファイルへの手編集との共存（Save はカード所有のキーだけ更新、
  手編集後は再読込）は README の
  [カード保存と手編集の共存](../README.md#カード保存と手編集の共存cordispatchyml)
  を参照してください。
- `sandboxFallback` は非 volatile です。変更は**プラグイン行の再読込（HMR 有効な Web
  プロファイル）またはホスト再起動**で反映されます。

```powershell
# 手動起動の場合の例
dsh web
```

---

## 3. 設定カードで検出を確認する

1. Web UI → **Settings → Plugins → Git Bash**
2. 「検出済み」と `C:/Program Files/Git/bin/bash.exe`（または別の Git インストール）が出る
3. 出ない場合:
   - 「bash.exe のパス」に `C:\Program Files\Git\bin\bash.exe` を入力 → Save
   - 「再検出」を押す
   - それでもだめなら DSH ログの `dsh-gitbash-win:` 行を確認

カードで編集できるのは `bashPath` / `initScript` / `timeoutMs` / `maxOutputBytes` の 4 項目です。
`sandboxFallback` は安全設定のため**編集できません**（現在値のみ変更不可の値として表示）。
非 volatile のため、変更はプロファイルの `cordis.patch.yml` を編集し、**プラグイン行の
再読込（HMR 有効な Web プロファイル）またはホスト再起動**で反映されます。
`initScript` は bash の `BASH_ENV`（例: `~/.dsh/gitbash-init.sh` に `eval "$(fnm env)"`）。

---

## 4. 動作確認（新規セッション / headless）

新しいセッションでモデルに次を実行させます:

```
bash ツールで: echo $BASH_VERSION
bash ツールで: uname -s
bash ツールで: command -v bash
bash ツールで: pwd
```

期待結果:

- `5.x.x(1)-release` のような bash バージョン
- `MINGW64_NT-10.0-...`（WSL なら `Linux` になるので、その場合は検出が誤っています）
- `/usr/bin/bash`
- セッションの作業ディレクトリ（`/c/Users/...` 形式）

ツール一覧に `bash` と `pwsh` の両方が出ていれば成功です。

headless の場合（モデルの認証情報を起動環境に用意したうえで）:

```powershell
$env:DSH_PERMISSION_MODE = "danger-full-access"   # Git Bash は制限モード非互換のため
dsh --profile headless "bash ツールで uname -s と echo `$BASH_VERSION を実行して結果を返して"
```

カード/status route が無いだけで、ツールの動作は Web と同じです。
`pwsh` は公式の PowerShell のまま（PowerShell 7 優先、無ければ 5.1）です。

---

## 5. 権限モードの確認（任意）

`danger-full-access` で書き込み確認:

```
bash ツールで: echo ok > ./sandbox-test.txt && cat ./sandbox-test.txt
```

`workspace-write` / `read-only` では、Windows ACL + Git Bash は**実測で非互換**です
（2026-11-10 / GitHub Actions `windows-latest` / Git for Windows 2.56.0.windows.4:
run により restricted-token 下で `0xC0000142` STATUS_DLL_INIT_FAILED、または ACL backend
自体が使用不可。**どちらもコマンドは実行されません**）。前景は `SANDBOX_UNAVAILABLE`、
バックグラウンド / プロモートされたジョブでは既知の起動クラッシュ（`0xC0000142` 等）が
`runnerFailed` として通知されます。
`SANDBOX_UNAVAILABLE` が出た場合の選択肢は README の
[サンドボックスと権限](../README.md#サンドボックスと権限重要) を参照してください
（公式 `pwsh` ツールを使う / danger-full-access / `sandboxFallback: unconfined`）。

---

## 6. ロールバック（元に戻す）

```powershell
dsh plugin --profile web remove dsh-gitbash-win
```

その後 DSH を再起動。手動配置の場合は:

```powershell
$profileDir = "$env:USERPROFILE\.dsh\profiles\web"
Remove-Item -Recurse -Force "$profileDir\node_modules\dsh-gitbash-win"
```

`$profileDir\package.json` から `dependencies` の該当行と `bundles` の
`"dsh-gitbash-win"` を削除。`cordis.patch.yml` に `- id: gitbash-win` を
書いた場合はそれも削除して再起動します。

このプラグインは公式行を disable / rename しないため、削除すれば公式の
Windows 構成（`pwsh` のみ）に完全に戻ります。

---

## 7. DSH 本体の更新に追従する

DSH 本体を更新する場合（例: `0.3.x`）は、[docs/updating-dsh.md](updating-dsh.md) の
チェックリストに従ってください。手動配置は `engines.dsh` の強制を通らないため、
更新後の確認（status route・`windows-live` テスト・ツール一覧）を省略しないでください。

---

## 8. 困ったとき

| 症状 | 確認 |
|---|---|
| カードが出ない | 行が有効か（Windows か）、DSH 再起動済みか、bundles に入っているか |
| `bash` ツールが出ない | 同上。`dsh --profile web --dump-config` に `gitbash-win` 行が出るか |
| 検出されない | Git for Windows の場所。WSL の `bash.exe` は仕様で拒否されます |
| `SANDBOX_UNAVAILABLE` | README のサンドボックス節（実測で非互換。前景 = `SANDBOX_UNAVAILABLE` / バックグラウンド = `runnerFailed`） |
| カードに「検出状態を取得できませんでした」 | セッション切れなどで status route が 401/403。ページ再読込、必要なら再ログイン |
| Save が受け付けられない | 設定の revision 競合など。カードを再読込して最新値を確認してから再保存 |
| 文字化け | ネイティブ Windows プログラムの出力コードページ。プログラムの UTF-8 オプションを使用 |
