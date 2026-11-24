---
type: Reference
title: "ADR-004: 設定カードの編集フィールドを拡張する"
description: "schema の 9 フィールドのうち安全設定を除く 4 フィールドをカード編集対象に追加する決定。"
tags: [adr, config, ui]
generated:
  at: "2026-11-18T01:25:48+09:00"
status: accepted
---

## Context

`lib/schema.js` の `CONFIG_FIELD_DEFAULTS` は 9 フィールドを定義するが、
設定カードが編集するのは `bashPath` / `initScript` / `timeoutMs` / `maxOutputBytes` の
4 フィールドのみ。`research/round-05.md` は追加候補を「自作すべき・工数小・依存なし」と分類した。

## Decision

`cwd` / `maxTimeoutMs` / `graceMs` / `maxSpillBytes` を編集対象に追加する。
`sandboxFallback` は fail-closed の安全設定として変更不可を維持する。

## Consequences

- locale 辞書（en/ja）と `lib/client.js` の埋め込み辞書にキー追加が必要。
- 既存の `OWNED_FIELDS` と配置テストを更新する。
- 実装はこの ADR とは別タスクで行う。

## Alternatives

他プラグインの設定画面を再利用する案は対象フィールドが異なり要件を満たさない。
`sandboxFallback` を UI に含める案は安全原則に反するため却下。

## Links

- `research/round-01.md` / `research/round-05.md`: 機能案の分類
- `lib/schema.js`: 9 フィールドの定義
- `lib/client.js`: 現在の編集対象 4 フィールド
