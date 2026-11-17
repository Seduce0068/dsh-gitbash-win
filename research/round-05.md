# Round 5 — 実現可能性と優先度の深掘り

日時: 2026-11-17T21:18〜21:27+09:00 / 担当: r5-feasibility-core, r5-feasibility-features

## 親の独自 Runtime Proof（V-04 の精緻化）

r4-version の V-04「install 時に engines/peer/compat のゲートが無い」を精査したところ、
**不正確**と判明。インストール済み DSH の `dsh-plugin-manager/lib/index.js:734-746` に
`evaluatePluginCompatibility(manifest, exemptions)` による preflight があり、
不 compatible なら「nothing was installed」で reject する（同 :742, :748）。
`:521-560` のコメントによれば path / registry spec はインストール前に manifest を読み、
git / tarball spec は fetch が必要なため事後チェックとなる。
→ **正しくは「path/registry には preflight ゲートがある。tarball 経路のみ事後チェック」**。
V-04 を「ゲート皆無」から「tarball 経路のカバレッジ問題」へ修正。

## r5-feasibility-core（コア品質クラスタ A〜D）

| クラスタ | 工数 | リスク | 優先度根拠 | 判定 |
| --- | --- | --- | --- | --- |
| A: version guard fail-open | 中〜大 | **高**（null→true は host-modules.test.mjs:164 固定。厳格化は symlink peer を壊す恐れ） | 影響中 × 発生低 × コスト中 | **後回し**（R4-8 の null キャッシュ解除のみ先行可） |
| B: 検出メモ整合性 | 小〜中 | 低（detect.test.mjs:413-425,485-534 が挙動を固定） | 影響低〜中 × 発生中〜高 × コスト小 | **着手推奨** |
| C: 設定スナップショット分裂 | 中 | 中（live ref は仕様。sandboxMode getter 維持要） | 影響低 × 発生低 × コスト中 | **後回し** |
| D: 配布物完全性 | 小〜中 | 低（コード契約は無傷。tgz 再生成＋SHA 再確定が必要） | 影響高 × 発生**100%** × コスト小 | **最優先** |

**上位 5（親の事実確認済み）**:
1. **D2/V-05** tarball の rc.3 追従＋再生成 — 実展開で tgz は `dshReleases: rc.1 のみ`、
   `scripts/` 0 件、作業ツリーは rc.1+rc.3。**親が実測で確定**。
2. **R4-1** 負結果 TTL の開始時点を probe 完了後に（detect.js:663/667）— テスト
   `detect.test.mjs:485-534` が既存挙動を固定しているため**テスト更新が必須**（推定）。
3. **D-01/UX-03** 再検出と executor メモの同期（detect.js:628, executor.js:325）— README:340 に既知記載済み。
4. **R4-8** `runningDshVersion` の null 永続キャッシュ解除（host-modules.js:293）— 小。
5. **D3+D7** `files` に `scripts/` 追加＋`npm pack --dry-run` ゲート。

**線引き**: 1〜5 と D1（CHANGELOG `[Unreleased]` 二重）は今すぐ着手可（class identity /
fail-closed 契約を壊さず既存テスト衝突小）。A のセマンティクス変更（V-01 null→fail-closed、
V-02 require chain 順序、V-03 engines 範囲対応）は設計判断を伴い別審議。

## r5-feasibility-features（機能案・UX 案）

| 案 | 既存代替 | 工数／依存 | 分類 |
| --- | --- | --- | --- |
| ACL sandbox 互換 | なし（C2 は workspace-write 下で拒否方針） | 大／大、上流 DSH 依存。**fail-closed 変換が独自価値で互換化はそれを削る** | ウォッチ（自力解決不能） |
| pwsh 非表示 | 専用プラグイン 0 件（GitHub 検索） | prompt 文言は小／真の非表示は `tools.restrict` 要確認 | 自作は prompt 明確化に限定（DESIGN §14 準拠） |
| doctor | **多数のコミュニティ実装**: coppynight/dsh-doctor, white-sand-grand/dsh-plugin-doctor, d86e/dsh-doctor, jincheng3870682453-hash/dsh-doctor | 大／中。本プラグインの status route がドメイン診断を已在り | **既存を再利用**（自作は AGENTS §2 違反） |
| 設定 UI 拡張 (cwd/maxTimeoutMs) | C1 に設定画面はあるが同フィールド不可 | **小／なし**。schema.js:73,77 で volatile 済み、client.js:148 に追記＋locale のみ | **自作すべき（高）** |
| WSL/cmd/Nushell | **C1/C2/C4** が既存 | 大／大、専用 executor 必須 | **既存を再利用**（自作なら ADR に理由記録） |
| export/import | 一次情報なし（未確認） | 中／中 | ウォッチ |
| 実行監査ログ | d86e/dsh-doctor が tool error 捕捉（部分重複） | 中／中。既存 audit stamp で十分 | ウォッチ（パス漏洩 R4-9 の増幅リスク） |
| 日本語化＋X1 | なし | **小／なし** | **自作すべき（高）** |
| UX-01/UX-02 | なし（情報は docs/security.md:89-94 にあり卡片未届け） | **小／なし** | **自作すべき（高）** |

**3 分類**:
- **自作すべき**: X1 のエラー文案内分岐（Web: Settings / headless: cordis.patch.yml）、UX-01/02 のカード情報届け、設定 UI 拡張、pwsh は削除せず routing 文言明確化。
- **既存を再利用すべき**: 汎用 doctor（コミュニティ実装）、WSL/cmd 選択（C1/C2/C4）、汎用監査（d86e/dsh-doctor）。
- **ウォッチ**: ACL 互換、export/import、`tools.restrict`/`configEditor`/`cmdlineArgs` の API 安定化、U1/U3（rc.2）。

## 第 6 ラウンド（収束）への引き継ぎ

- 全候補は A〜E クラスタ＋機能案 3 分類に整理済み。第 6 ラウンドで
  (1) 重複の最終統合、(2) 妥当性の最終判定（事実/推測/却下/既知）、
  (3) 最終レポート（優先順位付き残タスク一覧）を `research/FINAL.md` に作成する。
- 今ラウンドもコード変更なし。検証 `node --test`: 111 tests / 107 pass / 0 fail / 4 skip（不変）。
