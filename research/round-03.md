# Round 3 — ユーザーシナリオ / UX 摩擦

日時: 2026-11-17T20:43〜20:53+09:00 / 担当エージェント: r3-onboarding, r3-settings, r3-profiles

## エージェント結果と親の事実確認

### r3-onboarding（導入 UX）

| ID | 候補 | 優先度 | 根拠 | 親の判定 |
| --- | --- | --- | --- | --- |
| F01 | 「推奨」の方法 A が Windows CI 未検証。A/B の選択基準（pnpm 有無）が無い | 高 | README:86-105, install-windows:11-13,42-44 | 事実（I1 と重複: 配布/検証ゲートクラスタ） |
| F02 | 方法 A 失敗後に方法 B へ切り替える際の中途半端な状態の掃除手順が無い | 中 | README:99-105,315-327 | 記述欠如は事実、被害は推測 |
| F03 | プロファイルごと install 要件は冒頭にあるが手順本体に再掲なし。headless 用確認例は install-windows のみ | 中 | README:48-49,72-76,92, install-windows:180-187 | 配置は事実 |
| F04 | cordis.patch.yml の「先頭 `[]` を消して末尾に追記」が 1 行テンプレート置換なのに意図が伝わらない。YAML シーケンス説明なし | 高 | README:149-150, install-windows:103-104 | 事実 |
| F05 | README の手動配置例に「既存 dependencies/bundles を消さず追記」の注記なし（install-windows にはあり） | 中 | README:128-147 vs install-windows:79-100 | 差分は事実 |
| F06 | PowerShell コマンド（`$env:USERPROFILE`, `Out-Null`, バッククォート エスケープ）に無説明 | 中 | install-windows:19,57-60,71-77,184 | 事実 |
| F07 | README の初期確認が「モデルに実行させる」だけで bash ツール指定なし。install-windows には「bash ツールで:」とある | 中 | README:168-172 vs install-windows:162-178 | 差分は事実 |
| F08 | 初期確認が Web カード前提で headless 但し書きとリンクされていない | 低 | README:165,427-428 | 既知の制約（導線不足のみ） |
| F09 | アンインストール例が `--profile web` のみで headless remove 例なし | 低 | README:315-327 | 既知の「プロファイルごと」制約の派生 |
| F10 | `core.autocrlf` / 改行コード / BOM の案内が皆無。「文字化け」はコードページのみ扱う | 高 | README:88-89,339, install-windows:44-45,252 | 記述欠如は事実、被害は推測 |

### r3-settings（設定・運用 UX）

| ID | 候補 | 優先度 | 根拠 | 親の判定 |
| --- | --- | --- | --- | --- |
| UX-01 | カードの注記に「再読込/再起動が必要」と fail-closed 理由が無い | 高 | client.js:84,113,139, README:191-195,227-229 | 事実。docs/security.md:89-94 には書かれているがカードに届いていない |
| UX-02 | Save 拒否時のカード表示に revision 競合・再読込ヒントが無い | 高 | client.js:77,132, README:242-243,342 | 事実 |
| UX-03 | 「再検出」は再探索を強制しない／15 秒キャッシュ記述が食い違う | 中高 | client.js:30,350-359,558-585 | **要修正（親の事実確認で反証）**: `index.js:192` が `resolveGitBash({ configured, cache: false })` を呼び、コメントにも「Force a fresh probe on every card read / re-detect click」とある。カードの再検出は**强力な再 probe を実行する**。実 tendency は「executor 側（executor.js:325）は cache:false を渡さず別メモを持つ」ため、カードで新パスを示しても実コマンドが古いメモを使う点（Round 1 の D-01 を既知に格下げ済み）に集約される。docs/security.md:123 の「GET のたびに probe」は事実 |
| UX-04 | カード 4 項目 vs yml 8 項目の差。カードに無い理由・反映タイミングが未説明 | 中 | client.js:148-153, README:184-189,212-224 | 事実 |
| UX-05 | 「初回 1 回だけ警告」がカードに無く、`enforcement: unconfined` も表示されない | 中 | README:262,346-347, docs/security.md:47,85 | 事実 |
| UX-06 | locale の直訳（「デプロイが…」）、en/ja 対訳ズレ、辞書の二重管理 | 低中 | locale/ja.json:11,13,26,45,49,52 | 文言差は事実、自然さは推測 |

### r3-profiles（プロファイル横断・失敗 UX）

| ID | 候補 | 優先度 | 根拠 | 親の判定 |
| --- | --- | --- | --- | --- |
| P1-1 | README の「pwsh ツールを使う」3 択 1 と、routing 指示の「Never work around a sandbox or policy denial by switching shells」が緊張関係 | 高 | README:274-276 vs lib/index.js:65-68 | **両文言は事実**（親確認）。ただし「pwsh の ACL sandbox は動く」ので回避ではなく別ツールの正規利用、という解釈も成立。**モデルが拒否後に pwsh 切替を渋るリスク**として記録（影響は推測） |
| P3-1 | バックグラウンドの `runnerFailed` が汎用通知のみで、3 択への導線が無い | 高 | README:279-282,416, docs/verification.md:28,85 | 事実（文言・表示場所の詳情は未確認） |
| P2-1 | `danger-full-access` 切替手順が拒否現場に無い | 中 | README:275,79 | 事実（DSH 本体の切替 UI は未確認） |
| P1-3 | 3 択 3 の設定手順（どのファイル／再読込要否）がその場に無い | 中 | README:274-276 vs 191-195,227-229 | 事実（headless は cordis.patch.yml＋再起動一択） |
| P4-1 | カードエラー「401/403」説明が fence 失敗時の 500／メソ違反の 405 と不一致 | 中 | README:341 vs index.js:263-283 | **部分的に反証**: 常時の未認証は fence が返す 401/403 で README は正しい。500/405 は例外出力で、ドキュメント網羅性の問題に格下げ |
| P1-2 | headless/TUI で status route がサイレントにスキップされ、未登録ログが出ない | 中 | README:59-80,427-428, index.js:261-305 | 事実（実装）＋推測（実際の出力） |
| P5-1 | ログ保存先パスが案内されていない（接頭辞のみ） | 中 | README:346-347,335, index.js:312-315 | 事実 |
| P4-2 | トラブルシューティングの症状文言が実エラー文言と一致するか | 低 | README:336 | 未確認（executor/detect は別担当） |

## 親が独自に発見した項目

- **X1（中）**: `GITBASH_UNAVAILABLE_MESSAGE`（executor.js:48-51）が「Settings → Plugins → Git Bash で bashPath を設定してください」と案内するが、設定カードは Web 専用（README:427-428）。**headless / TUI では存在しない UI を案内する**。lib/ 内に headless/TUI の文字列は皆無（grep 確認）。→ README:427-428 の既知制約と実エラー文の不一致。

## 重複クラスタの更新（第 6 ラウンドで吸収）

- F01 ↔ I1（pnpm 経路未検証）、F04/F05/F06 ↔ D5/D6（ドキュメント整備）
- UX-01/P1-3 ↔ 既知の「sandboxFallback 非 volatile」クラスタ（Round 1 D 群）
- UX-03 ↔ D-01（検出メモの executor/カード分离。既知に格下げ済み）— エージェントの主張は反証、根本課題は既知
- P1-1/P3-1/P2-1 ↔ 既知の「ACL sandbox 非互換」3 択のUX 表面化（新規機能案「doctor / status の親しやすさ」と接続）

## 次ラウンドへの引き継ぎ

- Round 4（敵対的レビュー: セキュリティ / ロバストネス / 並行処理 / バージョン互換）へ。
- 今ラウンドもコード変更なし。検証は `node --test`（前ラウンドと同一: 111/107 pass/0 fail/4 skip）を維持。
