---
type: Reference
title: "ADR-005: エラー文を実行モード別に案内する"
description: "headless/TUI に存在しない Web 設定画面を案内しないよう、文言を分岐する決定。"
tags: [adr, i18n, error]
generated:
  at: "2026-11-18T01:25:48+09:00"
status: accepted
---

## Context

`GITBASH_UNAVAILABLE_MESSAGE` は「Settings → Plugins → Git Bash で bashPath を設定」
と案内するが、設定カードは Web 専用（`README.md` に記載）。headless / TUI では
存在しない画面を案内していた（`research/FINAL.md` の N-1 → H-3 に統合済み）。

## Decision

エラー文言を DESIGN §13 の方針に整合させ、Web は Settings 案内、
headless / TUI は `cordis.patch.yml` の案内に分岐する。

## Consequences

- executor の定数とドキュメントの文言を揃える必要がある。
- 回避策の提案（pwsh / danger-full-access / unconfined）はモデル向け文言から除去済みで、
  本決定と矛盾しない。

## Alternatives

headless / TUI に独自の設定 UI を新設する案は上流 API 依存で工数が大きく、
文案分岐で代替するため今回見送る。

## Links

- `research/FINAL.md`: N-1（追加候補）
- `DESIGN.md` §13: ログ・エラー文と言語の方針
- `lib/executor.js`: エラー定数
