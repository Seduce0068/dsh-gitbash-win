# セキュリティとサンドボックスの意味論（dsh-gitbash-win v0.1）

このドキュメントは、このプラグインが**何を守り、何を守らないか**を正確に説明します。
対象は DSH `0.2.2-rc.1` / Windows 10・11 です。

## 1. 脅威モデル

DSH では、モデルが生成したコマンド文字列は**信頼できない入力**として扱う必要があります。
したがって DSH 本体は:

- 権限モード（`read-only` / `workspace-write` / `danger-full-access`）と
  `sandbox_permissions` の承認フロー
- ファイルツール（read/write/edit 等）のファイルサンドボックス
- プロセス起動時の環境変数スクラブ（API キー等の credential を子プロセスへ渡さない）
- 出力の上限・spill・タイムアウト

を提供します。**このプラグインはそれらの上に「Git Bash 実行器を足す」だけ**で、
承認・権限・スクラブの経路を置き換えたり迂回したりしません。

## 2. このプラグインが追加する実行経路

`bash` ツール（公式 `@deepseek-ai/dsh-tool-bash`）→ 私有 `ctx.shell`
（`ctx.isolate('shell')` 内の `GitBashExecutor`）→ `ctx.subprocess` → 実際の子プロセス。

コマンドは `bash.exe -c <command>` の **argv 1 要素**として渡されます。
`spawn(..., { shell: true })` は使いません（`cmd.exe`/PowerShell を中間に入れない）。

### 2.1 ルートのシェルは置き換えない

Git Bash 実行器は **isolated scope の中だけ**で `ctx.shell` を提供します。
ルートの `ctx.shell`（Windows では公式 `pwsh-sandbox` 実行器）はそのまま残り、
公式 `pwsh` ツール・agent preset・その他の公式コンポーネントは影響を受けません。
`cordis.patch.yml` は 1 行の `insert` のみで、既存行の `disabled` 変更・改名は行いません。

→ アンインストール時に残るものは無く、公式 PowerShell 構成へ完全に戻ります。

## 3. 権限モードごとの挙動（重要）

| セッションのモード | 挙動 |
|---|---|
| `danger-full-access` | Git Bash を直接実行。file サンドボックスなし（公式 bash 実行器と同じ意味） |
| `read-only` / `workspace-write` + `sandboxFallback: fail`（既定） | 公式 `ctx.sandbox.confine()` に Git Bash の argv を渡し、公式の ACL restricted-token runner で実行を試みる。**実測では Git Bash が初期化時に `0xC0000142` で終了しコマンドは実行されない**ため、その既知コードを **`SANDBOX_UNAVAILABLE` に変換**して fail-closed にする（下記 3.1） |
| `read-only` / `workspace-write` + `sandboxFallback: unconfined`（明示オプトイン） | Git Bash を**サンドボックスなし**で実行。結果に `enforcement: unconfined`、起動ごとに 1 回警告ログ |

### 3.1 `SANDBOX_UNAVAILABLE` の意味

2026-11-10 に GitHub Actions の実 Windows runner（Windows Server 2025 /
Git for Windows 2.56.0.windows.4）で測定した結果、公式 ACL restricted-token runner
の下では **コマンドは一度も実行されませんでした**。観測されたのは、
(a) Git Bash が CRT 初期化時に `0xC0000142`（STATUS_DLL_INIT_FAILED）で終了する run と、
(b) ACL backend 自体が使用不可で `ctx.sandbox.confine()` の時点で fail-closed になる run の
2 種類で、いずれも「実行しない」側に倒れています（fail-safe）。プラグインはこの既知のクラッシュコードを検出し、生の終了コードではなく
**`SANDBOX_UNAVAILABLE`（fail-closed）** としてモデルに返します。**fail-closed の既定は
「守れないなら実行しない」** という意味です。この場合に選べるのは:

1. その操作だけ公式 `pwsh` ツールを使う
   （PowerShell 側の ACL サンドボックスは公式のまま動きます）
2. セッションのアクセスモードを `danger-full-access` に切り替える
3. `sandboxFallback: unconfined` を明示設定する（bash の書き込みは制限されない）

モデルに対しては「承認/拒否を別シェルで回避しない」よう routing プロンプトで指示しています。

### 3.2 ファイルツールのサンドボックスは別系統

DSH の read/write/edit/glob/grep などのファイルツールは `dsh-fs-sandbox` の
ポリシーで動きます。このプラグインはそれらを変更しません。

## 4. `sandboxFallback: unconfined` の正確な意味

- 制限モードが要求されていても、**bash が行うファイル書き込み/削除は制限されません**。
- `bash` 工具の結果には `sandbox: { mode, denied: false, enforcement: 'unconfined' }` が
  付き、UI にもその事実が出ます。`sandboxMode` は `undefined` になるため、公式 bash ツールは
  `sandbox_permissions`（承認による緩和）のフィールドを**広告しません**
  （「守られている」という誤解を招く表示をしないため）。
- 警告ログが出ます。
- したがって `unconfined` は「自分が何を失うか分かっている場合のみ」使ってください。
  Web 設定カードには出していません（設定ファイルのみ）。

## 5. パス検出の安全性

- 自動検出が選ぶのは **Git for Windows（`uname -s` が MINGW）** のみです。MSYS2/Cygwin の
  bash は bash 互換ですが自動検出では選ばず、明示 `bashPath` でのみ使用できます
  （パス変換・ツールチェーンが Git for Windows と異なるため、勝手に代用しない）。
- `%SystemRoot%\System32\bash.exe`（WSL 起動用エイリアス）や `WindowsApps` の
  Store エイリアスは**明示的に拒否**します。
- 自動検出候補は `bash -c "uname -s"` を `execFile`（`shell: false`、4 秒タイムアウト）で
  実行し、Git for Windows（MINGW）であることを確認します（明示パスは MSYS/Cygwin も可）。
- ユーザーが明示指定した `bashPath` は「その実行ファイルを使う」という意思表示として
  尊重します（uname 不一致なら警告して使用）。ただし WSL/Store エイリアスだけは拒否。
- 明示パスが存在するのに**実行できない**場合（spawn 失敗など）は、別の bash を
  勝手に代用せず fail-closed でエラーにします。
- Git Bash が見つからない場合、**pwsh / cmd / WSL への自動 fallback はありません**。

## 6. HTTP status route

- `GET /dsh-gitbash-win/status` は設定カードが読む検出結果です。
- 公式 host route と同じ `connection.requestRejection(req)` フェンスを**最初に**通し、
  拒否時は本文なしで拒否コードを返します（フェンス自体が例外を投げた場合も 500 で
  fail-closed、データは返しません）。
- GET 以外は 405。`cache-control: no-store`。
- 返すのは: プラグイン名 / platform / 検出パス候補と理由 / sandbox の有無と既定モード /
  fallback 設定 / ツール名。**環境変数・トークン・認証情報は返しません**。
- 検出は読み取りのみ（`reg.exe query` は読み取り、ファイル存在確認、`uname` 実行）。

## 7. 設定の信頼境界

- `cordis.patch.yml`・設定カードの値はユーザー（ホスト管理者）が書く**信頼済み設定**です。
- プラグインが書き込む設定は自分の行（`gitbash-win` 名前空間）のみです。
  他プラグインの行・グローバル設定は書き換えません。
- 設定カードは `sandboxFallback` を UI に出しません（安全設定のため）。
- 管理者権限・サービス変更・レジストリ書き込みは行いません。

## 8. 環境変数・credential

子プロセスの環境は DSH の `ctx.subprocess` が管理します。プラグインは
`NO_COLOR` / `TERM=dumb` / `PAGER=cat` / `GIT_PAGER=cat`（公式 bash 実行器と同じ
モデル向け上書き）と、ユーザー設定の `BASH_ENV` を渡すだけです。
API キー等の scrubbing は subprocess seam 側の責務で、このプラグインは迂回しません。

## 9. 守らないもの（明示）

- **`unconfined` 時の bash のファイル書き込み**（上記）
- **読み取り制限**: 公式 ACL バックエンドは write-class のみを制限します。read は
  このプラグインでも制限しません（DSH 本体の仕様）。
- **ネットワーク**: bash からのネットワークアクセスは制限しません。
- **Windows ネイティブプログラムの出力コードページ**: UTF-8 変換はしません。
- **サイドバーの対話ターミナル**: このプラグインの管轄外です。
- **モデルによるコマンド内容の妥当性**: 承認フローと権限モードが担います。

## 10. 検証状況

- Linux 上で: 実行器の実 spawn、routing matrix、fail-closed、`BASH_ENV`、
  公式ツールの実 mount と実行、status route の認証フェンス、client bundle の配信を自動テスト。
- Windows（GitHub Actions の実 runner）で検証済み:
  Git Bash の自動検出（`C:\Program Files\Git\bin\bash.exe`）、私有 executor による
  実コマンド実行（`uname -s` = MINGW）、`BASH_ENV`、Web host への組込みと status route・
  client bundle 配信。ACL sandbox は **`acl-incompatible`（0xC0000142、コマンド未実行）**
  と確定し、プラグインが `SANDBOX_UNAVAILABLE` に変換することをテストで固定。
- 未検証: **ブラウザでの設定カード操作**（クリック/Save）と、各自の実機固有の
  Git インストール先・PATH・レジストリ差異。VM または実機で
  [verification.md](verification.md) の手順を実施してください。
