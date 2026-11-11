# Changelog

このプロジェクトの主な変更点を記録します。形式は
[Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) にゆるく従い、
バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) を使います。

## [0.1.0] - 2026-11-11

初回リリース。Windows 上の DSH で Git for Windows の bash をエージェントの
コマンド実行シェルとして追加します（公式 PowerShell 実行器・ツールはそのまま）。

### Added

- `GitBashExecutor`（公式 `SandboxBashExecutor` を継承）を
  `ctx.isolate('shell')` 内に mount し、公式 `@deepseek-ai/dsh-tool-bash` を
  そのまま接続したグローバル `bash` ツール
- Git for Windows の検出（既知ディレクトリ / PATH / `git.exe` の兄弟 /
  レジストリ。WSL/Store エイリアスは拒否、明示 `bashPath` 優先）
- `GET /dsh-gitbash-win/status`（認証フェンス付き・`cache-control: no-store`）と
  Settings → Plugins の **Git Bash** 設定カード
  * 編集可能: `bashPath` / `initScript` / `timeoutMs` / `maxOutputBytes`
  * `sandboxFallback` は安全設定のため変更不可の値として表示（非 volatile。変更は
    `cordis.patch.yml` のみで、反映は行の再読込（HMR 有効な Web プロファイル）または
    ホスト再起動）
  * `sandboxFallback` 以外の volatile schema + `liveConfigReader` により、保存した設定は
    次のコマンドから反映
  * カードの Save はカード所有の 4 項目だけをプロファイル `cordis.patch.yml` に書き込み、
    手編集した他のキーは保持
- 検出失敗・sandbox 不能時に代替シェルへ自動 fallback しない fail-closed 動作。
  `sandboxFallback: unconfined` は明示オプトイン（結果に `enforcement: unconfined`、
  初回実行時に警告、カードからは変更不可）
- Windows 実機の GitHub Actions CI: 実 Git Bash の live テスト、実 `dsh web` の
  Web E2E、Edge + Playwright による設定カードの実ブラウザテスト、ACL sandbox probe
  （ブロッキング。`UNEXPECTED` は CI 失敗）
- Linux の GitHub Actions CI: テスト一式と `test/e2e.sh`
- gitleaks（tarball の期待 SHA-256 を固定して照合。全履歴 + 作業ツリー）と
  ローカル pre-commit フック
- ホスト DSH 本体と `@deepseek-ai/*` パッケージのバージョン一致チェック
  （不一致は明確なエラー。`DSH_GITBASH_ALLOW_HOST_VERSION_MISMATCH=1` で明示上書き）
- ドキュメント: README / DESIGN / インストール（Windows）/ セキュリティ /
  検証（Windows 実機なしでの確認方法、QEMU/KVM VM 手順）/
  DSH 更新時の追従チェックリスト

### Known limitations

- **Windows の `read-only` / `workspace-write` では Git Bash を実行できません。**
  公式 ACL restricted-token runner との組み合わせは実測で非互換（`0xC0000142`
  STATUS_DLL_INIT_FAILED、または ACL backend が使用不可）。既定は fail-closed で、
  前景は `SANDBOX_UNAVAILABLE`、バックグラウンド / プロモートされたジョブでは
  既知の restricted-token 起動クラッシュ（`0xC0000142` 等）が `runnerFailed` として
  通知されます（どちらもコマンドは実行されません）。
  `danger-full-access`、公式 `pwsh` ツール、または明示 `sandboxFallback: unconfined`
  を使ってください。
- 自動検出は Git for Windows（MINGW）の bash のみ。WSL / cmd / Nushell は選択できず、
  MSYS2 / Cygwin は明示 `bashPath` のときのみ使用できます（自己責任）。
- `bash` と `pwsh` の両ツールがモデルに見えます（非表示化は将来のバージョン）。
- サイドバーの対話ターミナルは別系統で、このプラグインの管轄外です。
- npm 未公開。GitHub とローカル tarball で配布します。

## [Unreleased]

### Changed

- `sandboxFallback` を非 volatile 化。設定カードは従来どおり変更不可の値として表示し、
  変更は `cordis.patch.yml` の編集後、行の再読込（HMR 有効な Web プロファイル）または
  ホスト再起動で反映（広告される sandbox mode と実行経路の乖離を防ぐ）
- `@deepseek-ai/dsh-*` ホストパッケージのバージョン一致チェックを追加
  （`DSH_HOST_MODULE_VERSION_MISMATCH`、`engines.dsh` 範囲内でも別ビルドは既定で拒否）
- ドキュメント整備: カード Save と `cordis.patch.yml` 手編集の共存、DSH 更新時の追従
  チェックリスト（`docs/updating-dsh.md`）、ログ接頭辞・言語方針（DESIGN §13）、
  v0.2 拡張案（DESIGN §14）、PTC から見える `tools.bash` の説明
- CI: `240fd66` で gitleaks / linux-tests / windows-smoke が green
