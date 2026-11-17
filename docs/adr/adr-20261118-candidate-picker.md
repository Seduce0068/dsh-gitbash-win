---
type: Reference
title: "ADR-002: 候補選択 UI は新規開発しない"
description: "検出候補の可視化は実装済みであり、候補選択 UI の新規開発は車輪の再発明として却下する。"
tags: [adr, ui, reuse]
generated:
  at: "2026-11-18T01:25:48+09:00"
status: accepted
---

## Context

`research/round-01.md` の「候補選択 UI」案は、同ファイルの別箇所で
「検出候補の可視化は実装済み」と自己修正されており、`research/FINAL.md` でも却下済み。
現行コードでも `lib/index.js` が candidates を返し、`lib/client.js` が
`candidates` / `candidateOk` / `candidateFailed` の locale キーで描画している。

## Decision

**却下（実装済み）**。新規 UI を開発しない。

## Consequences

- 既存の候補一覧表示を維持する。
- 「候補をクリックして `bashPath` に反映する」という新挙動が必要なら、
  別要件として新たに審議する（現行は可視化のみ）。

## Alternatives

再実装は既存機能と完全に重複し、AGENTS §2 が禁じる車輪の再発明に当たるため採用しない。

## Links

- `research/round-01.md`: r1-ideas / 候補選択 UI とその自己修正
- `research/FINAL.md`: 却下/格下げ一覧
- `lib/index.js` / `lib/client.js`: 候補返却と描画の Runtime Proof
