# Windows へのインストール手順（dsh-gitbash-win）

対象: Windows 10/11、DSH `0.2.2-rc.1`、Git for Windows。
Linux/macOS ではこのプラグインの行は無効になります（テスト用の明示設定を除く）。

> この手順は Linux 開発環境では一部（pnpm によるインストール）を実機検証できていません。
> 各ステップの「確認」コマンドで都度確認してください。

---

## 0. 前提確認

PowerShell:

```powershell
# DSH 本体
dsh --version

# Git for Windows（bash.exe の場所）
Test-Path "C:\Program Files\Git\bin\bash.exe"
& "C:\Program Files\Git\bin\bash.exe" -c "uname -s"
# → MINGW64_NT-10.0-... のように出れば OK（Linux なら WSL の可能性があるので NG）
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

---

## 2. DSH を再起動する

Web プロファイルのホストを再起動します（タスクトレイ常駐・サービス・手動起動の
いずれでも、そのプロセスの再起動）。

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
`initScript` は bash の `BASH_ENV`（例: `~/.dsh/gitbash-init.sh` に `eval "$(fnm env)"`）。

---

## 4. 動作確認（新規セッション）

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
`pwsh` は公式の PowerShell のまま（PowerShell 7 優先、無ければ 5.1）です。

---

## 5. 権限モードの確認（任意）

`danger-full-access` で書き込み確認:

```
bash ツールで: echo ok > ./sandbox-test.txt && cat ./sandbox-test.txt
```

`workspace-write` / `read-only` では、Windows ACL + Git Bash の互換性が未検証です。
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

## 7. 困ったとき

| 症状 | 確認 |
|---|---|
| カードが出ない | 行が有効か（Windows か）、DSH 再起動済みか、bundles に入っているか |
| `bash` ツールが出ない | 同上。`dsh --profile web --dump-config` に `gitbash-win` 行が出るか |
| 検出されない | Git for Windows の場所。WSL の `bash.exe` は仕様で拒否されます |
| `SANDBOX_UNAVAILABLE` | README のサンドボックス節 |
| 文字化け | ネイティブ Windows プログラムの出力コードページ。プログラムの UTF-8 オプションを使用 |
