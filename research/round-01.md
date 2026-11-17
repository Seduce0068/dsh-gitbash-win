# Round 1 — リポジトリ内部監査

日時: 2026-11-17T19:34+09:00 / 基準 HEAD: `0c0112f` (origin/main より 1 commit ahead / unpushed)

## Runtime Proof（親エージェントが実測）

- `node --version` → `v24.22.2`、`dsh --version` → `0.2.2-rc.3`
- `node --test test/*.test.mjs` → **111 tests / 107 pass / 0 fail / 4 skipped**（Windows 専用 live 4 件）。exit 0。
- `git rev-list --left-right --count origin/main...main` → `0 1`（**未 push の commit が 1 件**）
- tarball `dsh-gitbash-win-0.1.0.tgz` を実展開し比較:
  - 内側 `package.json` の `dsh.compatibility.dshReleases` は `0.2.2-rc.1` のみ（作業ツリーは rc.1 + rc.3）
  - 内側 `CHANGELOG.md` は `## [0.1.0]` のみ（Unreleased セクション無し）
  - `package/scripts/` は **0 件**（作業ツリーには `scripts/check.sh` が存在）
  - → 配布物が `0c0112f` の rc.3 追従・headless/TUI 対応を反映していない（**事実**）

## エージェント team（Round 1）

| Agent | 担当 | 状態 |
| --- | --- | --- |
| r1-code | lib/*.js 実装監査 | 実行中 |
| r1-tests-unit | 単体テスト カバレッジ | 実行中 |
| r1-tests-ci | E2E / CI 検証ギャップ | 実行中 |
| r1-docs | ドキュメント / 設定 / 配布 | 完了（12 件） |
| r1-tests | 初回担当 | **失敗（結果なし）** → r1-tests-unit / r1-tests-ci に分割再委譲 |
| r1-ideas | 機能追加案の棚卸し | 実行中 |

## 確定した残タスク候補（r1-docs + 親による事実確認）

| ID | 候補 | 優先度 | 根拠 | 状態 |
| --- | --- | --- | --- | --- |
| D2 | 配布 tarball が rc.3 追従前の古い内容 | **高** | 実展開比較（上記 Runtime Proof） | 事実 |
| D1 | CHANGELOG に `[Unreleased]` が 2 回（L7 / L74） | **高** | CHANGELOG.md:7,74 | 事実 |
| D3 | `scripts/check.sh` が tarball / `package.json files` から欠落 | 中高 | package.json:21-31, README:363-364 | 事実（親確認） |
| D4 | windows-smoke.yml:7 のコメントが `0.2.2-rc.1` のまま（実装は rc.3） | 中 | .github/workflows/windows-smoke.yml:7 vs 50,54 | 事実（親確認） |
| D5 | docs/* に OKF frontmatter / docs/index.md が無い | 中 | docs/*.md L1、AGENTS.md §8 | 事実（※研究メモは成果物ではない） |
| D6 | markdownlint MD013（80 桁）違反が多数、設定・CI ゲートも無し | 中 | docs/verification.md:28 等 | 事実 |
| D7 | `npm pack --dry-run` / リンク / バージョン整合の CI ゲート不在 | 中 | .github/workflows/*.yml | 事実 |
| D8 | CI green 参照が旧 commit `240fd66` のまま、未来形が残る | 低中 | docs/verification.md:15-17, CHANGELOG.md:93 | 事実 |
| D9 | tarball 再生成手順が未記載 | 低 | README:88-97, install-windows.md:44-53 | 手順不在は事実 |
| D10 | `dshReleases` に rc.2 が無い（意図的なら問題なし） | 低 | package.json:51-54 | 推測 |
| D11 | リンクラベルのパス表記ずれ | 低 | install-windows.md:117-118,236 | 事実 |
| D12 | pre-commit フックが `#!/bin/sh` + `set -eu`（AGENTS §10 と差異） | 低 | .githooks/pre-commit:1,11 | 事実 |
| P1 | `0c0112f` が未 push | 中 | git rev-list 0 1 | 事実（調査タスクのため push はしない） |

## r1-tests-ci の結果（E2E / CI）

| ID | 候補 | 優先度 | 根拠 | 状態 |
| --- | --- | --- | --- | --- |
| I1 | `dsh plugin add`（pnpm）経路・tarball 経路・headless/TUI が E2E 未検証 | **高** | README:99-105, e2e-windows.sh:79-94, e2e.sh:57-70 | 事実 |
| I2 | CI は rc.3 のみ検証。package.json が rc.1 互換と宣言する根拠が無い | **高** | package.json:52-53 vs linux-tests.yml:38-43, windows-smoke.yml:50-54 | 事実 |
| I3 | playwright-core 固定が Windows 側のみ。Linux `BROWSER_CARD=1` は CI で走らない | 中 | windows-smoke.yml:73, README:388, e2e.sh:201-209 | 事実＋推測 |
| I4 | Linux CI に artifact upload が無く、E2E 失敗時ログが trap で消える | 中 | linux-tests.yml, e2e.sh:30-33,132-139 | 事実 |
| I5 | `check.sh` の gitleaks が CI と同等でない（版/SHA/`dir` スキャン） | 中 | scripts/check.sh:59-64, gitleaks.yml:21-24,52-56 | 事実 |
| I6 | `/bin/bash` 絶対パス固定、テンプレ `[]` 依存、空きポート TOCTOU、dsh 版未検証 | 中 | e2e.sh:30-33,53,77-79,85,124-129,174 | 事実＋推測 |
| I7 | check.sh が CI より多い検証をする一方 windows/ACL/browser-card は対象外 | 低 | scripts/check.sh:39-47, README:353 | 事実 |
| I8 | 特定 commit/PASS の固定記載が陳腐化、cache key の表記不統一 | 低 | docs/verification.md:14-18, linux-tests.yml:38, windows-smoke.yml:48 | 事実 |

重複: I2 ↔ D4（CI コメントの古い版）、I5 ↔ D7（CI ゲート不在）、I8 ↔ D8（commit 参照の陳腐化）。

## r1-ideas の結果（機能追加案の棚卸し）

### 既知の制約の解消（文書化済み）
- **ACL sandbox × Git Bash 互換**（DESIGN:425-431 / README:416）— 大・上流依存・実 Windows 実測必須
- **WSL / cmd / Nushell 選択**（DESIGN:478-481 / README:17,412）— 大・シェル毎 executor 必要
- **`pwsh` ツール非表示**（DESIGN:436-437,482-483）— 中（prompt+設定なら小）
- **MSYS2/Cygwin 自動検出**（DESIGN:442-443）— 中・fail-open リスク
- **サイドバー対話 terminal**（DESIGN:438）— 大・別系統
- **パス方言変換**（README:422-423）— 中・優先度低
- **headless/TUI で設定 UI**（README:427-428）— 中〜大・上流 API 依存
- **npm 公開**（README:429）— 小〜中・pnpm 経路未検証が前提
- **DSH 0.3.x 追従**（SECURITY.md:11, updating-dsh.md）— 大・7 箇所の手動ピン更新

### 全新規機能（コードからの推測）
- **診断コマンド `doctor`**（detect.js:414-565, index.js:185-215, executor.js:153-165）— 中・既存部品の CLI 化
- **設定 UI 拡張**（schema.js:46-56 の 9 項目 vs client.js:652-684 の 4 項目）— 小〜中・locale 同期必要
- **バージョン追従自動化**（host-modules.js:280-348, package.json:49-55）— 中
- **設定 export/import**（README:228-240）— 小〜中・秘密情報混入に注意
- **実行監査ログ**（executor.js:196-199,332,387）— 中・DESIGN §10.5/§13 の秘密情報原則遵守
- **候補選択 UI**（index.js:203-207, client.js:471-490）— 小〜中
- **エラー文の日本語化**（executor.js:460 が英語固定 vs DESIGN §13）— 小

r1-ideas による **誤検知の自己修正**: 「検出候補の可視化」は既に実装済み（`index.js:203-207` が `path/ok/reason` を返し `client.js:471-490` が描画）でギャップではない。第 6 ラウンドで除外対象とする。

補足: MCP で GitHub の open/closed issues と open PR は 0 件を確認（ローカル文書がロードマップの唯一の情報源）。

## r1-tests-unit の結果（単体テスト カバレッジ）

| ID | 候補 | 優先度 | 根拠 | 状態 |
| --- | --- | --- | --- | --- |
| G-01 | `augmentSandboxUnavailableError` の 3 分岐（非 SANDBOX / 凍結エラー / 既に接頭辞入り）が無テスト | 高 | executor.js:153-163, executor.test.mjs:301-321 | 事実 |
| G-02 | `execute()` の confined 枝で `super.execute()` の `result()` がクラッシュ終了した場合の guard 連動が無テスト | 高 | executor.js:400-405, windows-acl-compat.test.mjs:32-48 | 事実 |
| G-03 | `readField` の null-ref 既定値、`projectConfig` の String() 強制・sandboxFallback 正規化が無テスト | 中 | executor.js:98-123, executor.test.mjs:145-179 | 事実 |
| G-04 | `requireBashPath` の warning ラッチ・`ctx.logger.warn`（try/catch 含む）が無テスト | 中 | executor.js:323-341 | 事実 |
| G-05 | 実 `defaultRegistryQuery`（reg.exe / InstallPath 抽出）がどのテストも未実行 | 中 | detect.js:312-325, detect.test.mjs（全件注入） | 事実（実機影響は推測） |
| G-06 | `probeBash` のタイムアウト詳細文・stderr のみ・version 抽出 null 分岐が無テスト | 低 | detect.js:282-303 | 事実 |
| G-07 | 検出キャッシュの上限退避(TL32)・pending reject 時の削除が無テスト | 低 | detect.js:659-673 | 事実 |
| G-08 | `expandHomePath` の空 homedir・`isWslAlias` の windir フォールバックが無テスト | 低 | detect.js:86,109 | 事実 |
| W-02 | Windows-live に「Git Bash 不存在の fail-closed」が無い（Windows skip かつ代替なし） | 中 | executor.test.mjs:369, windows-live.test.mjs | 事実 |
| W-04 | 実 confined ACL 経路・実 restricted-token クラッシュ・レジストリ経由検出が未カバー | 中 | windows-live.test.mjs:83-149（confine は throw スタブ） | 事実 |
| H-03 | スキーマ既定値が 7 ファイル以上に重複（CONFIG_FIELD_DEFAULTS から導出可能） | 低 | live-config:17-27, executor:389-399, client:277, host:55-61, patch:250-251 等 | 事実 |
| H-04 | `67_108_864` が 5 箇所に重複 | 低 | executor:120,151,272,394, live-config:22 | 事実 |
| D-01〜03 | volatile ref 生成・完全デフォルト設定・クラッシュ終了コード配送がテスト間で重複 | 低 | config-parity:21, executor:388, live-config:28 等 | 事実 |

上位 3: (1) confined 枝の実クラッシュ連動テスト、(2) projectConfig/readField/requireBashPath の純関数境界テスト、(3) Windows-live への不存在 fail-closed とレジストリ検出の追加。

重複: G-01/G-02 ↔ I4（CI ログ消失）とは無関係だが、I2（rc.1/rc.3 のみ検証）と合わせると fail-closed 経路の実機証拠が薄いという複合リスク。

## r1-code-a の結果（detect / schema / host-modules）

| ID | 候補 | 優先度(agent) | 根拠 | 親の検証・判定 |
| --- | --- | --- | --- | --- |
| D-01 | `cache:false` が既存メモを破棄/更新しない | 高 | detect.js:628-676,578 | **事実だが既知**。`detect.test.mjs:413-425` が同挙動を固定、README:340 が「再検出しても古い結果」と対処を記載。executor は path 消失時にメモを捨てる（detect.js:639-650）。→ 既知制約の UX 改善候補に格下げ |
| D-02 | WSL alias 判定が `SysNative` / 8.3 短名を非網羅 | 中 | detect.js:102-118, test:89-101 | 事実（コード）。実害は推測 |
| D-03 | PATH 上の `git.exe` 兄弟候補生成に存在確認が無い（DESIGN §4 step 4 と乖離） | 中 | detect.js:195-202,493 | 事実。test:112 が現状を固定 |
| D-04 | 既定 registryQuery が `process.platform==='win32'` も要求し注入検証が弱い | 中 | detect.js:313 | 事実（G-05 と重複） |
| D-05 | 非 win32 の明示パスでも probe を実行（最長 4s） | 低 | detect.js:449-460 | 事実 |
| D-06 | メモキーが env 7 変数のみで注入 registryQuery の他 env 依存を拾わない | 低 | detect.js:614-623 | 事実、影響は推測 |
| H-01 | 実行中 DSH 版を plugin-first require チェーンで解決 → 競合コピーで期待値が汚染され version guard がすり抜ける | 高 | host-modules.js:280-295,140,335-345 | 構造は**事実**（親確認: runningDshVersion() が hostResolve 経由）、発生は推測 |
| H-02 | version guard が `hostImport` のみで `hostResolve` 単体を守らない | 中 | host-modules.js:158-188,205 | 事実（親確認: verifyHostPackageVersion は hostImport 内のみ） |
| H-03 | 失敗メッセージに全試行絶対パス/`Last resolution error` を露出（DESIGN §13 と抵触） | 中 | host-modules.js:178-183 | 事実（親確認） |
| H-04 | `0.2.2-rc.1` ハードコードが package.json (rc.1+rc.3) と乖離 | 低 | host-modules.js:180 | 事実（親確認）。D4/I2/U1 と同一クラスタ |
| H-05 | 相対 `argv[1]` を anchor から除外 | 低 | host-modules.js:142 | 事実 |
| S-01 | 内部防御エラーが `dsh-gitbash-win:` 接頭辞（§13 では内部は `gitbash-win:`） | 低 | schema.js:69 | 事実 |
| S-02 | 数値フィールドに範囲/整数/相互制約が無い | 低 | schema.js:75-83 | 事実、影響は推測（executor の assertServiceableConfig が実行時に防御） |

## r1-code-b の結果（index / client / patch / locale）

- **高優先度の未実装・不整合はなし**。認可 fence（`index.js:261-283`）、no-store（`:162`）、固定 3 層のみ返却（`:194-215`）、Save の所有 4 フィールド制限（`client.js:148-153,296-340`）、競合処理（`:621-631`）、locale 51 キー一致、patch 加算性（`cordis.patch.yml:3-12`）を確認。
- Cb-1 低: status route の 500 が `errorMessage(error)` の生メッセージを返す（`index.js:135-138,296-300`）。detect 例外にパスが混入すると露出しうる（事実＋推測）。
- Cb-2 低: 認可拒否経路に no-store が無いが公式 `dsh-host-open-in-app` と同一実装（事実・既知）。
- Cb-3 低: DESIGN §6:267-268 の「未検出なら warn」と実装（非 Windows のみ warn）の乖離。実装が合理的（事実）。
- Cb-4 低: DESIGN §7:319-321 の「未変更は form.unset」と実装の乖離。実装が §10.8 に整合（事実）。

## 第 1 ラウンドの重複クラスタ（第 6 ラウンドで吸収予定）

1. **バージョン文字列の陳腐化クラスタ**: D4（CI コメント rc.1）, I2（rc.1/rc.3 のみ検証）, H-04（host-modules の rc.1 固定）, D2（tarball が rc.3 未反映）, D8/I8（旧 commit `240fd66` 参照）, U1（rc.2 未検証）
2. **fail-closed 経路のテスト不足クラスタ**: G-01, G-02, G-03, G-04, W-02, W-04
3. **配布/検証ゲート欠落クラスタ**: D2, D3, D7, I1, I4, I5
4. **ドキュメント形式クラスタ**: D1, D5, D6, D11, D12, S-01
5. **検出ロジックのエッジクラスタ**: D-01（既知に格下げ）, D-02, D-03, D-04/G-05, D-06

**却下/格下げ**: r1-code-a の D-01 は「高」と報告されたが、親の Runtime Proof でテスト固定済みかつ README に既知として記載されていることを確認し、**新規の高優先度バグではなく既知制約の UX 改善候補**に格下げ。r1-ideas の「検出候補の可視化」は実装済み（index.js:203-207 / client.js:471-490）でギャップではないため除外。

## 次ラウンドへの引き継ぎ

- Round 1（内部監査）+ Round 2（外部・上流）の 1 パス目が完了。全 9 エージェントのうち 2 つは失敗したが分割再委譲でカバー済み。
- ユーザー指定の「5 回繰り返し、6 回目で重複・妥当性を吸収」に従い、**ゴールは active のまま次ラウンドへ**。次は別観点（ユーザーシナリオ / 敵対的レビュー）の調査パス。
- 本ラウンドではコード変更を行わない（ユーザー依頼は「調査」）。成果物は `research/round-01.md`, `research/round-02.md`, `todo.md` のメモ追記のみ。
