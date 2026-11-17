# Round 2 — 外部・上流調査

日時: 2026-11-17T19:55+09:00 / 情報源: GitHub MCP（deepseek-ai/deepseek-harness）、ローカルインストール済み DSH 0.2.2-rc.3

## 親エージェントによる直接確認（Runtime Proof / 一次情報）

- `list_tags` の最新は **`dsh-v0.2.2-rc.3`**（2026-11-13 公開）。**0.3.x の tag は存在しない**。
- `list_releases` の最新も `dsh-v0.2.2-rc.3`。`get_latest_release` は 404（`/releases/latest` が無い）が `list_releases` は成功。**rc.2 も公開済み**（2026-11-11）。
  - https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3
  - https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.2
- rc.3 の変更は「実験的な DeepSeek チャットインポートプラグイン追加」と「Windows デスクトップのアプリ内更新修正」のみ。**プラグイン API の変更は記載なし**。
- rc.2 は大規模リリースで、プラグイン/SDK に影響する変更が複数ある（原文より）:
  - "Tool failures provide clearer error types and codes for diagnosis; plugins and SDK integrations relying on older classifications need updating."
  - "AgentTeam uses unified named subagents, with the interrupt tool disabled by default; migrate custom plugins and SDK integrations"
  - "Windows extra-directory grants apply only to file tools, not terminal or PTC access; related sandbox extensions need migration."
  - "PTC limits total tool calls according to its runtime budget"
  - "Plugins can dynamically register and remove MCP servers, query their status, restart them, and probe connections"
- `search_issues`（`repo:deepseek-harness`, "Windows shell Git Bash sandbox"）→ **0 件**。上流 issue にこのプラグイン固有の課題は見当たらない。

## 確定した残タスク候補

| ID | 候補 | 優先度 | 根拠 | 判定 |
| --- | --- | --- | --- | --- |
| U1 | **`0.2.2-rc.2` が `dshReleases` に無く、CI も未検証** | **高** | package.json:51-54（rc.1/rc.3 のみ） vs rc.2 は 2026-11-11 公開・上述の通りプラグイン影響変更を含む | 事実。rc.2 が `engines.dsh` 範囲 `>=0.2.2-rc.1 <0.3.0` に含まれるのに未検証 |
| U2 | 0.3.x は未公開（2026-11-17 時点）。`docs/updating-dsh.md` の 0.3.x 想定は将来対応のまま | 低 | list_tags / list_releases | 事実（今はアクション不要・ウォッチ） |
| U3 | 上流 rc.2 の「ツール失敗のエラー型/コード変更」が、`augmentSandboxUnavailableError`（executor.js:153-163）の `code === 'SANDBOX_UNAVAILABLE'` 前提に影響する可能性 | 中 | rc.2 release notes + executor.js:153-163 | **推測**。rc.2 で実際にコード名が変わったかは未確認。real Windows での実測が必要 |
| U4 | 上流 rc.2 の「Windows 追加ディレクトリ許可は file tools のみ」は、`sandboxFallback: unconfined` の設計想定（shell の書き込みは制限されない）と整合するか再確認が必要 | 中 | rc.2 release notes + README「サンドボックスと権限」 | 推測（整合しそうだが未実測） |
| U5 | 上流 rc.2 の MCP 動的登録 API を、設定カード/診断機能から活用できる可能性 | 低〜中 | rc.2 release notes | 推測（要件との関連は薄い） |

## エージェント（進行中）

| Agent | 担当 | 状態 |
| --- | --- | --- |
| r2-upstream | 上流 release / issue / PR 調査 | **失敗**（結果なし）→ 親が直接 MCP で代替取得 |
| r2-ecosystem | 既存プラグイン / npm の再利用調査 | 実行中 |
| r2-api | インストール済み DSH の未活用 API 調査 | 実行中 |

## r2-ecosystem の結果（車輪の再発明防止）

一次情報の一部を親が GitHub MCP で検証済み:
- `tianxingdao/dsh-shell-switch`: stars 2, updated 2026-11-13, JavaScript, **archived=false**（エージェント報告の stars 2 と一致。最終更新日は 11-16 ではなく 11-13 と報告に差 → 親の Runtime Proof を採用）
- `inmny/dsh-git-bash`: stars 15, forks 4, open_issues 2, updated 2026-11-06（報告と一致）
- 同名 `dsh-shell-switch` が他に 4 件、`dsh-git-bash` が他に 5 件存在（選択肢が多数）

| ID | 既存ソリューション | 提供機能 | 判定 |
| --- | --- | --- | --- |
| F1/F2/F3 | `@deepseek-ai/dsh-shell`, `dsh-bash-sandbox`, `dsh-bash-local`, `dsh-tool-bash`, `dsh-pwsh-*` | 実行ライフサイクル・出力/spill・timeout・ツールマウント | **既に再利用済み。自作不要**（事実） |
| C1 | https://github.com/tianxingdao/dsh-shell-switch | Niubash/Git Bash/MSYS2/Cygwin/WSL/pwsh を検出・設定画面で選択、再スキャン、キャッシュ、`ctx.sandbox.confine` | 複数シェル選択は**既に実現例あり**。自作プラグイン全体が不要とは限らないが、WSL/cmd 追加の参照候補（事実＋評価は推測） |
| C2 | https://github.com/athif23/dsh-shell-select | pwsh/cmd/gitbash/wsl/bash/zsh/fish/sh 選択、Test ボタン | Git Bash/WSL を `workspace-write` 下で拒否する方針差（推測含む） |
| C4 | https://github.com/kaixinyujue/dsh-shell-wsl | WSL2 使い捨て Docker executor | WSL 対応の再利用候補 |
| C5 | https://github.com/inmny/dsh-git-bash , https://github.com/DR1N0/dsh-git-bash | Git Bash 既定化、restricted mode、UTF-8/MSYS パス変換 | 検出ロジックの参考候補。**/path 変換は本プラグインの既知制約（README:422-423）と直接関連** |
| C6 | https://github.com/SpookyWaste/dsh-bash-native | Rust 製 POSIX bash、3 段権限 | 代替アーキテクチャ（直接採用は要件外） |
| — | doctor 共通基盤 | 公式 CLI に `doctor` サブコマンドなし（親も `dsh --help` で確認）。コミュニティに独立実装が多数 | 「診断コマンド」は新規実装になるが、コミュニティ実装の再利用も可（推測） |
| — | Nushell 専用 DSH プラグイン | 未確認 | 「存在しない」とは断定しない |

**重要な判断材料（AGENTS §2）**: 前列挙の通り「WSL/cmd 選択」「Git Bash 検出」「設定カード」は既存プラグインに同等実装がある。本プラグインの独自価値は **加算型 isolate mount** と **NTSTATUS→`SANDBOX_UNAVAILABLE` の fail-closed 変換**、および **status route の認証 fence**。機能追加を検討する際は、既存プラグインを再利用/参考にし、自作する場合は ADR に不採用理由を記録する必要がある（**推測を含む評価**）。

## 次ラウンドへの引き継ぎ

- U1 を Round 4（敵対的レビュー）と Round 5（優先度）で重点確認。
- r2-ecosystem / r2-api の結果を追記。
