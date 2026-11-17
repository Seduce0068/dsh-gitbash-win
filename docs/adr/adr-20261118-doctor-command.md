---
type: Reference
title: "ADR-001: 汎用 doctor コマンドは自作しない"
description: "dsh-gitbash-win に汎用診断コマンドを追加せず、既存の status route とコミュニティ実装へ委譲する決定。"
tags: [adr, doctor, reuse]
generated:
  at: "2026-11-18T01:25:48+09:00"
status: accepted
---

## Context

`research/round-01.md` で doctor コマンドの自作が提案された。しかし
`research/round-02.md` は公式 CLI に `doctor` サブコマンドが無いことを確認し、
`research/round-05.md` は `coppynight/dsh-doctor` などコミュニティ実装 4 件を列挙した。
本プラグインは既に `GET /dsh-gitbash-win/status` で Git Bash 固有の診断情報を提供している。

## Decision

汎用 doctor コマンドは**自作しない**。ドメイン固有の診断が必要になった場合は
status route のペイロード拡張として既存部品を再利用する。

## Consequences

- 管理面（コマンド数・ドキュメント・テスト）が増えない。
- 汎用ヘルスチェックはコミュニティ実装へ委譲する。
- コミュニティ実装を実際に導入する際は、活発性・成熟さ・ライセンスを再評価する。

## Alternatives

自作案は、既存実装の機能不足・保守停止・ライセンス非互換・要件不一致のいずれの
根拠も調査で得られなかったため採用しない（AGENTS §2）。

## Links

- `research/round-01.md`: r1-ideas / doctor
- `research/round-02.md`: 公式 CLI に doctor なし
- `research/round-05.md`: コミュニティ実装 4 件
