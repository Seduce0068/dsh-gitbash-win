---
type: Reference
title: "ADR-003: 設定 export/import は今回見送り"
description: "cordis.patch.yml という既存経路があるため、設定 export/import 機能は追加しない決定。"
tags: [adr, config, reuse]
generated:
  at: "2026-11-18T01:25:48+09:00"
status: accepted
---

## Context

`research/round-01.md` で設定 export/import が提案されたが、
`research/round-05.md` は一次情報なし・ウォッチと評価した。
`README.md` は `cordis.patch.yml` による設定の宣言的持ち運びを既に説明している。

## Decision

**不採用（ウォッチ）**。設定の再現は `cordis.patch.yml` とバージョン管理で充当する。

## Consequences

- 秘密情報（`initScript` / `bashPath` に埋め込み得る値）の露出面を増やさない。
- 将来対応する場合も、マスキング規則と権限スコープを先に設計する。

## Alternatives

DSH 側に設定 export API があるかは未確認。一次情報が無いため実装の裏付けが取れない。
既存の patch ファイルを「設定の宣言的表現」として再利用する案を採用した。

## Links

- `research/round-01.md`: r1-ideas / 設定 export/import
- `research/round-05.md`: 機能案の分類
- `README.md`: cordis.patch.yml による設定手順
