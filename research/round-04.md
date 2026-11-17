# Round 4 — 敵対的レビュー（セキュリティ / ロバストネス / バージョン互換）

日時: 2026-11-17T20:57〜21:05+09:00 / 担当: r4-security, r4-robustness, r4-version

## 親の独自 Runtime Proof

- `isWslAlias` の実プローブ: `C:\Windows\System32\bash.exe` → `true`（拒否）、
  **`C:\Windows\SysNative\bash.exe` → `false`（非拒否）**。`.\` 挿入
  (`C:\Windows\.\System32\bash.exe`) も `false`。→ D-02 / SEC-01 の静的事実を確認。
  ただし実害 there は「明示 `bashPath` は probe が MINGW でなくても system 文字列が
  出れば warning 付きで受け入れる」（detect.js:471-476）ため、設定権限（オペレータ）
  があれば WSL bash を選べる設計であり、特権昇格ではない。
- version guard の return: `allowMismatch:true` + version 不一致 → `false`
  を実測。**テスト固定済みの意図**（host-modules.test.mjs:164-174 が `false` を期待）
  で、バグではない。誤検知として却下。

## エージェント結果と親の検証

### r4-security

| ID | 候補 | 深刻度 | 根拠 | 親の判定 |
| --- | --- | --- | --- | --- |
| SEC-01 | WSL alias 拒否の迂回（`SysNative` / `.\` 挿入） | 中 | detect.js:106-117,471-476 | 静的は**事実**（親 probe で確認）。悪用可能性は推測・設定権限前提 |
| SEC-02 | status の候補パスが全件 map され、report の 8 件 cap と不一致 | 中 | detect.js:360-373, index.js:203-207 | 事実。認可済み接続向けだが cap との不一致は要修正候補 |
| SEC-03 | env マージで `dshEnv.BASH_ENV` が呼び出し側から残る可能性 | 低中 | executor.js:292-298,308-313 | 推測（request.env のモデル到達性は未確認） |
| SEC-04 | `gitBashRoute` が空 policy で `route:'direct'`（fail-open） | 低 | executor.js:176-184,253 | コードは事実、到達性は推測（モデルが `sandboxPolicy` を制御できる根拠なし） |
| SEC-05 | `0xc0000005` を restricted-token crash とみなし監査 fact を stamp | 低 | executor.js:75-77,418-426 | 事実。設計コメント（同 파일 70-73）が理由を説明済み |
| SEC-06 | reg.exe / uname probe の injection 不可（`execFile` + 固定 argv） | — | detect.js:24,32,241-253,318 | **良好点として記録** |
| 良好 | fence の fail-closed、メソッド判定順、`-c` 1 argv 要素、config 書込経路の不在 | — | index.js:263-283,292; executor.js:354,375,390 | 事実 |

### r4-robustness

| ID | 候補 | 深刻度 | 根拠 | 親の判定 |
| --- | --- | --- | --- | --- |
| R4-1 | 負の検出結果の `createdAt` が挿入時で probe 15s なら即期限切れ | 中 | detect.js:663,634 | 事実（性能劣化） |
| R4-2 | memo 生存判定が `existsSync`（ディレクトリも true）で初期の `isFileLike` と非対称 → TOCTOU/すり替え | 中 | detect.js:645,379-387 | 事実＋影響推測 |
| R4-3 | 古い成功の path 消失を 2 呼び出しが同時検知 → 重複 probe／`'set'` 上書き | 低 | detect.js:637-651,657-664 | 事実 |
| R4-4 | one-shot ラッチがインスタンス共有。logger throw 前に latch を立てると警告が永久消滅 | 中 | executor.js:197-199,327-334,380-388 | 事実 |
| R4-5 | 1 コマンドが `configValues()` を 5 回呼び、`await requireBashPath()` を跨ぐ → 設定変更で route と argv/env が別スナップショット | 中 | executor.js:248,280,309,324,370 | 事実 |
| R4-6 | `result()` の `??=` が最初の rejection を固定。`decorateExecution` と handle の `sandbox` が食い違う | 低 | executor.js:454-467,479-494 | 事実＋推測 |
| R4-7 | `importCache.delete` が無条件で、古い loading の rejection が新しい loading を削除 → class identity 崩壊 | 高 | host-modules.js:200-218 | **事実（コード）**。発生には clear + 並行 reject が必要で頻度は低い |
| R4-8 | `runningDshInfoCache` に null を永続キャッシュ → 一時失敗で version guard がプロセス全体で無効化 | 高 | host-modules.js:292-294,313 | **事実**。V-01 と同一根本 |
| R4-9 | エラー文言に検出 Tried 絶対パス／DSH アンカー一覧／生 MODULE_NOT_FOUND／sandbox 原文 | 中 | detect.js:337-339,370-373; host-modules.js:178-183; executor.js:153-162 | 事実（漏洩先は推測）。H-03 と重複 |
| R4-10 | `hostPackageInfo` の null も永続キャッシュ、解決失敗は非キャッシュ | 低 | host-modules.js:272,164-177 | 事実 |

### r4-version

| ID | 候補 | 深刻度 | 根拠 | 親の判定 |
| --- | --- | --- | --- | --- |
| V-01 | version guard の fail-open（expectedVersion=null / found=null で無条件 pass） | 高 | host-modules.js:313,338,280-295 | **事実**（親確認 :313）。R4-8 と同一根本 |
| V-02 | 偽装: require chain が plugin→argv[1]→cwd→global の順で最初の成功を採用。name/version 文字列一致のみ | 高 | host-modules.js:140-145,169-177,314 | 構造は事実（H-01 の発展）。悪用は推測 |
| V-03 | `engines.dsh` は範囲指定なのに guard は完全同一 version を要求。rc.2 未検証 | 中 | package.json:35,58 vs host-modules.js:314 | 事実（U1/U3 と重複） |
| V-04 | install 時に engines/peer/compat のゲートが無い（peer optional） | 中 | package.json:58-64, workflows grep | 事実 |
| V-05 | tarball 未追跡・SHA 未コミット＋`!!js process.platform` が起動時に評価 | 高 | .gitignore:2, cordis.patch.yml:6, tgz 実測 | 事実（改竄リスクは推測）。D2/D3/D9 と関連 |
| V-06 | gitleaks 走査範囲差（CI git+dir だが untracked tgz は checkout 外／展開しない） | 中 | gitleaks.yml:52-56, package.json:67 | 事実＋推測。I5 と重複 |
| V-07 | pre-commit が mutable tag `v8.30.1` | 低 | .pre-commit-config.yaml:7 | 事実 |
| V-08 | `DSH_GITBASH_ALLOW_HOST_VERSION_MISMATCH=1` で guard が黙って無効化 | 低 | host-modules.js:29,344 | 事実 |
| V-09 | tgz が `scan:secrets`/`test` を運ぶが gitleaks 依存も test/ も無い | 低 | package.json:21-31 | 事実（D3 派生） |

## 第 6 ラウンドへの統合項目（新規クラスタ）

- **A. version guard の fail-open クラスタ（高）**: V-01 / R4-8 / V-02 / H-01。
  expectedVersion が null のとき無条件 pass、runningDshVersion が plugin-first、
  require chain の最初の成功を採用 → 悪意あるローカル node_modules で比較の両辺を支配可能。
  ただし「operator が plugin ディレクトリを書ける」= すでにコード実行権限がある点は考慮し、
  深刻度は「防御の形骸化」であって特権昇格ではない。
- **B. 検出メモの整合性クラスタ（中）**: R4-1 / R4-2 / R4-3 / D-01（既知）。
- **C. 設定スナップショットの分裂クラスタ（中）**: R4-5 / R4-4。
- **D. 配布物完全性クラスタ（高）**: V-05 / D2 / D3 / D9 / V-06。
- **E. status route の情報量クラスタ（中）**: SEC-02 / P1-2（前ラウンド）。

**却下した主張**: `allowMismatch:true → false` はテスト固定済みの意図でバグではない。

## 次ラウンドへの引き継ぎ

- Round 5（実現可能性と優先度の深掘り）へ。全候補を A〜E クラスタと機能案グループに
  整理し、工数・リスク・依存（上流 / 既存プラグイン）を評価する。
- 今ラウンドもコード変更なし。検証は `node --test` 111 tests / 107 pass / 0 fail / 4 skip を維持。
