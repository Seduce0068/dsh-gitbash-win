# ADR インデックス（dsh-gitbash-win）

設計上の決定と、採用しなかった案の理由を記録します。

## 一覧

- [ADR-001 汎用 doctor コマンドは自作しない](adr-20261118-doctor-command.md):
  既存の status route とコミュニティ実装へ委譲する。
- [ADR-002 候補選択 UI は新規開発しない](adr-20261118-candidate-picker.md):
  候補の可視化は実装済みで、再実装は車輪の再開発に当たる。
- [ADR-003 設定 export/import は見送り](adr-20261118-config-export.md):
  `cordis.patch.yml` という既存経路を維持する。
- [ADR-004 設定カードのフィールド拡張](adr-20261118-config-fields.md):
  安全設定を除く 4 字段を追加する（実装は別タスク）。
- [ADR-005 エラー文を実行モード別に案内](adr-20261118-error-localization.md):
  headless / TUI に存在しない Web 設定画面を案内しない。
