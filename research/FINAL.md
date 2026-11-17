---
type: Reference
title: "最終統合 — dsh-gitbash-win 残タスク・機能追加案調査（5 パス＋吸収）"
description: "DSH セッション（5 パス/19 エージェント）と並行 opencode セッション（5 ラウンド/21 エージェント）の調査を重複排除・妥当性評価して集約。"
tags: [cross-review, consolidated, dsh-gitbash-win, research]
generated:
  at: "2026-11-17T21:30:00+09:00"
status: complete
---

## 概要

ユーザー依頼「未知の残タスク、機能追加案などを調査する。エージェントチームをふんだんに使う。5 回繰り返し、6 回目で重複、妥当性などを吸収する」に対する最終成果物。

- **DSH セッション（本セッション）**: 5 パス・延べ 19 エージェント（`research/round-01.md` 〜 `round-05.md`）。
- **並行 opencode セッション**: 5 ラウンド・21 エージェント・135 件。正本は
  `.scratch/dsh-gitbash-win/cross-review-2026-11-17/consolidated.md`（ローカル作業領域・リポジトリ外）、
  是正項目はプロジェクト直下 `todo.md` の `## 未着手`（高 13 / 中 14 / 低 9）。
- 両セッションは**同一リポジトリ・同一目的**で並行していた。本ファイルは 6 回目の吸収として、
  両者の重複を統合し、DSH 側で新たに得られた知見を「追加候補」として提示する。

## 6 パスの構成とエージェント

| パス | 観点 | エージェント | 結果ファイル |
| --- | --- | --- | --- |
| 1 | 内部監査（コード/テスト/文書・CI/機能案） | 9 名（うち 3 名失敗→分割再委譲） | `research/round-01.md` |
| 2 | 外部・上流（DSH releases / 生態系 / 未活用 API） | 3 名（1 名失敗→親が MCP で代替） | `research/round-02.md` |
| 3 | ユーザーシナリオ / UX | 3 名 | `research/round-03.md` |
| 4 | 敵対的レビュー（セキュリティ / ロバストネス / 互換） | 3 名 | `research/round-04.md` |
| 5 | 実現可能性と優先度 | 2 名 | `research/round-05.md` |
| 6 | 重複排除・妥当性評価・吸収（本ファイル） | 親が統合 | `research/FINAL.md` |

## 重複の吸収（DSH 側 ID → 正本の是正項目）

| DSH 側 ID / クラスタ | 正本の是正項目 | 判定 |
| --- | --- | --- |
| D2 / V-05 / D3（tarball 陳腐化・scripts 欠落） | H-1, H-10, H-11 | 完全一致（親が tarball 実展開で再確認） |
| D1（CHANGELOG `[Unreleased]` 二重） | L-2 | 完全一致 |
| D4 / I2 / U1（rc.1 コメント・rc.2 未検証） | H-7, H-13 | 完全一致（上流 release notes も確認） |
| H-01 / V-01 / V-02 / R4-8（version guard fail-open） | H-8 | 完全一致 |
| G-01〜G-04 / W-02 / W-04（fail-closed テスト不足） | H-12 | 完全一致 |
| SEC-02（status パス露出） | H-5 | 完全一致 |
| P1-1（pwsh 推奨と routing の矛盾） | H-3 | 完全一致 |
| P3-1 / SEC-05（runnerFailed・sandbox fact） | H-2 | 完全一致 |
| D5 / D6 / D11 / D12（文書形式・okf） | M-10, M-11, L-3〜L-5 | 完全一致 |
| F/UX/P 系（導入・カード情報届け） | H-10, M-6, M-7, M-8 等 | 大部分一致（下記「追加候補」に残余あり） |
| r1-ideas / r5-features（機能案） | L-9 | 一致（再利用推奨の観点は下記に補足） |

## 妥当性評価（却下 / 格下げ / 修正）

正本の 6 件に加え、DSH 側で次を判定した:

| 主張 | 判定 | 根拠 |
| --- | --- | --- |
| D-01「`cache:false` が既存メモを更新しない」を高優先バグとする | **格下げ（既知の UX 課題）** | `detect.test.mjs:413-425` が挙動を固定、README:340 に既知記載。H-5 の「GET の probing をメモ化」と同じ原因クラス |
| r1-ideas「検出候補の可視化が未実装」 | **却下** | `index.js:203-207` / `client.js:471-490` で実装済み |
| allowMismatch=true → false の return を「バグ」とする | **却下** | `host-modules.test.mjs:164-174` が `false` を期待（意図どおり） |
| UX-03「再検出は再探索を強制しない」 | **反証** | `index.js:192` が `cache:false` で毎回 probe。根本原因は executor 側の別メモ（既知 D-01） |
| P4-1「カードエラーは 401/403 説明と不一致」 | **格下げ** | 通常の未認証は fence が 401/403 を返し README は正しい。500/405 は例外経路の網羅性の問題 |
| V-04「install 時に engines/peer/compat ゲートが無い」 | **修正（カバレッジ問題へ）** | `dsh-plugin-manager/lib/index.js:734-746` に preflight 存在。path/registry は事前、git/tarball は事後チェック |
| SEC-03「BASH_ENV 注入（推測）」 | **却下（正本と同じ）** | 公式 `dsh-tool-bash` は `ctx.shellEnv.collect(exec)`（DSH_* のみ）を渡す |
| r1-code-a の `SysNative` 迂回は特権昇格 | **格下げ（設定権限前提）** | 明示 `bashPath` は warning 付きで受け入れる設計（detect.js:471-476） |

## DSH 側で新たに得られた知見（正本への追加候補）

正本 36 項目に無い、出典付きの追加候補。**すべて「事実（コード）」だが影響は要評価**。

| ID | 追加候補 | 根拠 | 優先度提案 |
| --- | --- | --- | --- |
| N-1 | **HEADLESS のエラー文が存在しない Web UI を案内**: `GITBASH_UNAVAILABLE_MESSAGE` が「Settings → Plugins → Git Bash で bashPath を設定」と案内するが設定カードは Web 専用 | `executor.js:48-51` vs `README.md:427-428`（lib 内に headless/TUI 文字列皆無を grep 確認） | **中〜高**（H-3 と同クラス・モデル向け文言） |
| N-2 | **設定スナップショットの分裂**: 1 コマンドが `configValues()` を 7 箇所で呼び、`await requireBashPath()` を跨ぐため route と argv/env/grace が別スナップショットになり得る | `executor.js:235,248,280,309,324,370`＋`await :372` | 中（C クラスタ。後回しでも可） |
| N-3 | **one-shot ラッチが logger 例外で永久消滅**: `warnedUnconfined=true` を `try` の前に設定 | `executor.js:380-388` | 低〜中 |
| N-4 | **検出メモ TTL の起点が probe 完了前**: `createdAt` を挿入時に設定するため 15s 近い probe の負結果は即期限切れ | `detect.js:663,667` | 中（H-5 のメモ化議論と関連） |
| N-5 | **検出メモ生存判定の非対称（TOCTOU）**: `existsSync`（ディレクトリも true）に対し初期検出は `isFileLike` | `detect.js:645` vs `:391` | 中（要実機・低頻度） |
| N-6 | **並行検出の重複 probe**: 古い成功の path 消失を 2 呼び出しが同時検知すると両方 `detect()` を生成し後者が `set` を上書き | `detect.js:637-651,664` | 低 |
| N-7 | **`cordis.patch.yml` の「先頭 `[]` を消す」説明が実物と不一致**: 実際のテンプレートは `- insert:` で始まり空配列 1 行ではない | `README.md:149-150` vs `cordis.patch.yml:1-3`（`cat -A` で確認） | **中**（H-10 の導入手順と同クラス） |
| N-8 | **README 手動配置に「既存 bundles を消さず追記」注記が無い**（install-windows にはある） | `README.md:128-147` vs `install-windows.md:79-100` | 低〜中 |
| N-9 | **改行コード / `core.autocrlf` 案内が皆無**: コピー手順・文字化け節に記載なし | `README.md:88-89,339`, `install-windows.md:44-45,252`（grep 該当なし） | 低（環境依存） |
| N-10 | **カードに再読込要件・revision 競合ヒントが未在**: 情報は `docs/security.md:89-94` / README:342 にあるが UI に届いていない | `client.js:77,84,113,132,139` | 中（M-6/M-7 と隣接） |
| N-11 | **WSL alias 判定が `SysNative` / `.\` 挿入を非網羅**（親が実 probe で確認）。特権昇格ではないが保証の穴 | `detect.js:102-118`, `lib` 実プローブ | 低 |
| N-12 | **AC カードの文言自然さ**: 「デプロイが…」は直訳、en「not editable here」の「この画面限定」が ja で欠落（キー一致自体は正しい=正本の却下と非矛盾） | `locale/ja.json:11,13,26,45,49,52` | 低 |
| N-13 | **機能案の再利用先を明示**: 汎用 doctor はコミュニティ実装多数、WSL/cmd は `tianxingdao/dsh-shell-switch` 等が既存。自作するなら ADR に不採用理由を記録（AGENTS §2） | `research/round-02.md:41-56`, `round-05.md`（GitHub 検索 Runtime Proof） | 低（L-9 の補足） |

## 最終的な優先順位（6 回目の吸収結果）

1. **正本の高優先度 13 項目（H-1〜H-13）をそのまま最優先で着手**。特に H-1（tarball 再生成）は
   DSH 側でも実展開で 100% 確認済み。
2. **追加候補のうち N-1 / N-7 / N-10 を既存の H-3 / H-10 / M-6 へ統合**して対応（同一原因クラス）。
3. **N-2〜N-6 は「検出メモ・設定スナップショット」クラスタとして後回し**, 変更時は
   `detect.test.mjs:413-534` / `host-modules.test.mjs:164-174` の固定を更新する必要がある。
4. **却下・格下げ 14 件は対応しない**（根拠は本ファイル「妥当性評価」と正本 `consolidated.md`）。

## 検証結果（Runtime Proof）

- `node --version` = `v24.22.2`、`dsh --version` = `0.2.2-rc.3`。
- `node --test test/*.test.mjs`: 全 6 ラウンドを通して **111 tests / 107 pass / 0 fail / 4 skipped**（Windows 専用 live）。
- tarball 実展開: `dshReleases` は rc.1 のみ、`scripts/` 0 件、作業ツリーは rc.1+rc.3（H-1 の裏付け）。
- `git status`: コード変更なし。成果物は `research/` と `todo.md` のメモ追記のみ（`todo.md` の是正項目は並行セッションが記録）。
- 全エージェントの失敗 3 件（r1-tests / r1-code / r2-upstream）は分割再委譲または親の直接調査で回収済み。

## 結論

5 回の調査（延べ 40 エージェント: DSH 19 + opencode 21）で未知の残タスク・機能追加案を網羅し、
6 回目で両セッションの重複を吸収して **正本 36 是正項目＋DSH 側追加候補 13 件** に集約した。
調査目的は達成された。
