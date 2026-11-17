---
type: Todo
title: "dsh-gitbash-win プロジェクトTODO"
description: "dsh-gitbash-win 固有のタスク。横断タスクはグローバルTODOへ。"
tags:
  - todo
  - tasks
  - "dsh-gitbash-win"
generated:
  by: opencode
  at: "2026-11-17T20:11:47+09:00"
status: current
---

## 進行中

（なし）

## 未着手

### 優先度: 高

- [ ] **日本語 Windows でレジストリ検出を実機確認（H-9 の残り）**: CP932 出力・HKCUの InstallPath・REG_EXPAND_SZ 展開が実環境で候補として出ることを windows-smoke で確認（要実機）
- [ ] **配布物の署名/完全性検証を追加**: GitHub Release に SHA-256 公開＋README に照合手順（または npm publish + provenance）
- [ ] **AgentTeam/PTC/global tool の可視性を実機確認（0.3.x 追従）**: rc.2 の AgentTeam/PTC 変更で `bash` グローバルツールがモデルのツール一覧に出続けることを実セッションで確認（要実機）

### 優先度: 中


### 優先度: 低

- [ ] bashPath の WSL ヒントを保存前検証へ
- [ ] DOM id を `useId()` で衝突回避（同一カード二重 mount 対応・テストセレクタ含む）
- [ ] 機能追加案（doctor コマンド / 候補選択 UI / 設定 export 等）を `research/round-01.md` から選別して ADR 化

## 完了

- [x] `todo.md` をプロジェクト内へ配置（2026-11-17）
- [x] 配布 tarball を rc.3 基準で再生成・`scripts/check.sh` 同梱（2026-11-17）
- [x] CHANGELOG の `[Unreleased]` を 1 つに統合（2026-11-17）
- [x] unconfined 時の security fact を修正（2026-11-17）
- [x] 拒否回避の推奨文言をモデル入力から除去（2026-11-17）
- [x] status route の DoS と内部パス漏えいを対策（2026-11-17）
- [x] E2E のトークン露出と虚偽 fail-closed を修正（2026-11-17）
- [x] バージョンガードの fail-open を塞ぐ（2026-11-17）
- [x] tarball の導入手順を完成（2026-11-17）
- [x] fail-closed 経路のテストを充実（2026-11-17）
- [x] NTSTATUS クラッシュ扱いを実測 0xC0000142 に絞る（2026-11-17）
- [x] DSH 互換 matrix を CI に導入（2026-11-17・rc.2 の実検証は CI で実施）
- [x] 0.3.x 追従チェックの版固定箇所を整備（2026-11-17）
- [x] Windows 検出の日本環境対応（CP932 / HKCU / REG_EXPAND_SZ / Path）（2026-11-17）
- [x] apply() の部分 mount 防止（2026-11-17・中優先度）
- [x] section order の NaN/基準崩れを防止（2026-11-17・中優先度）
- [x] HMR 再入ガード（2026-11-17・中優先度）
- [x] non-Windows で patch 未適用時の fail-open を防止（2026-11-17・中優先度）
- [x] status 取得のタイムアウト／Abort 導入（2026-11-17・中優先度）
- [x] 再検出失敗時の検出情報保持（2026-11-17・中優先度）
- [x] detect reason / status エラーの辞書化（2026-11-18・中優先度）
- [x] 数値欄の aria 関連付け・role 統一・Reset の aria-busy（2026-11-18・中優先度）
- [x] `docs/index.md` 追加（2026-11-18・中優先度）
- [x] DESIGN のコード例・型定義・probe 記述を実装に同期（2026-11-18・中優先度）
- [x] gitleaks dir スキャンと pre-commit の bash 統一（2026-11-18・中優先度）
- [x] E2E の orphan 後始末と port TOCTOU 解消（2026-11-18・中優先度）
- [x] 設定パッチの全 9 字段同期・tool.global 導出・デッドプロパティ削除（2026-11-18・中優先度）
- [x] webServer.register の dispose 契約を実サービスで検証（2026-11-18・中優先度）
- [x] 低優先度: 空ディレクトリ削除・`docs/log.md` 追加（2026-11-18）
- [x] 低優先度: DESIGN 参照節と systemPrompt 英語固定方針を明記（2026-11-18）

## メモ

- グローバルTODO: `~/.config/opencode/todo.md`（複数プロジェクト横断のタスク用）。
- 残タスク・機能追加案の調査（6 パス: 1〜5 で洗い出し、6 で重複・妥当性を吸収）を実施中。
  根拠付きの全候補は `research/round-01.md` / `research/round-02.md` に記録。
  現時点の高優先度クラスタ: 配布 tarball の陳腐化（rc.3 未反映 / scripts 欠落）、
  CHANGELOG `[Unreleased]` 二重、DSH rc.2 未検証、fail-closed 経路のテスト不足。
  推測.includes 未検証事項は上記ファイルで「事実 / 推測」を区別しており、
  確定後に本ファイルの `## 未着手` へ昇格させる（調査タスクのため今は昇格させない）。

- **5 回のクロスレビュー完了（2026-11-17）**: 全 135 件を収集し、重複排除・妥当性評価のうえ
  上記 `## 未着手` へ集約（高 13 / 中 14 / 低 8）。詳細は `.scratch/dsh-gitbash-win/
  cross-review-2026-11-17/consolidated.md` および同ディレクトリの `round-01.md`〜
  `round-05.md` を参照。21 名の read-only エージェントを起動（途中終了 2 名は再開して回収）。
- **却下 / 格下げした指摘**: BASH_ENV 注入（公式ツールは DSH_* のみ渡すため現状注入不可）、
  ローカルコピーによるバージョン偽装（実環境では plugin 直下に node_modules が無く未発生）、
  認証バイパス（fence は契約どおり fail-closed）、XSS（React createElement のみ）、
  locale 不整合（en/ja 51 キー完全一致）、リンク切れ（0 件）。根拠は `consolidated.md`。
