# 変更ログ（dsh-gitbash-win）

このファイルには変更を加えたコミットを新しい順に記録します。

## 2026-11-18

- detect reason / status エラーを en/ja 辞書化、数値欄の aria 対応、
  `docs/index.md`、DESIGN の実装同期。
- pre-commit の bash 統一、`gitleaks dir`、E2E の orphan 後始末と
  port 競合リトライ。
- 設定パッチの全 9 フィールド、`tool.global` の実登録導出、
  デッドプロパティ削除、`webServer.register` の契約検証。

## 2026-11-17

- `todo.md` をプロジェクト内へ配置し、クロスレビューの是正項目を集約。
- 配布 tarball を rc.3 基準で再生成し、CHANGELOG の `[Unreleased]` を統合。
- unconfined 時の security fact、拒否回避文言、status route の DoS と
  内部パス漏えいを修正。
- E2E のトークン redact、バージョンガードの fail-closed、
  tarball 導入手順、fail-closed 経路のテストを整備。
- NTSTATUS 判定を実測 `0xC0000142` に絞り、DSH 互換 matrix を導入。
- 0.3.x 追従チェック、Windows 検出の日本環境対応、
  `apply()` の部分 mount 防止、HMR 再入ガード。
- non-Windows の fail-closed、status 取得の abort、
  再検出失敗時の検出情報保持。
