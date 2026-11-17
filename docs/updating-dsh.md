# DSH 本体の更新に追従する（dsh-gitbash-win）

このプラグインは DSH 本体の内部パッケージ（`@deepseek-ai/dsh-*`）を実行時に解決して
使います。DSH を更新するときは、下の「0.2.2-rc.x に固定している箇所」を確認し、
必要なら同じ commit で更新してください。

> この手順は DSH 本体の更新（例: `0.2.x` → `0.3.x`）向けです。プラグインの通常の
> インストールは [install-windows.md](install-windows.md) を参照してください。
> 現在のプラグインは DSH `0.2.2-rc.3` で検証済みです（`engines.dsh` は `>=0.2.2-rc.1 <0.3.0`）。

## 1. 0.2.2-rc.x に固定している箇所（更新時のチェックリスト）

| 箇所 | 内容 |
|---|---|
| `package.json` | 互換範囲の 3 箇所（`engines.dsh` / `dsh.compatibility.dsh` / `peerDependencies['@deepseek-ai/dsh']`）と `dsh.compatibility.dshReleases` の対象版。3 箇所の文字列は必ず同一（`test/compat-matrix.test.mjs` が検査） |
| `lib/host-modules.js` | `@deepseek-ai/*` のバージョン一致チェック（DSH release は DSH 版、cordis/schemastery は DSH 自身の依存ツリーを基準。不一致は `DSH_HOST_MODULE_VERSION_MISMATCH`。`DSH_GITBASH_ALLOW_HOST_VERSION_MISMATCH=1` は明示上書き）。解決失敗メッセージに版を埋め込まないこと |
| `.github/workflows/windows-smoke.yml` | `dsh-version` matrix（rc.1 / rc.2 / rc.3）と `npm install` の `${{ matrix.dsh-version }}` 参照 |
| `.github/workflows/linux-tests.yml` | 同上（ubuntu-latest のテスト/E2E 用） |
| `test/compat-matrix.test.mjs` | 互換宣言・CI matrix・互換範囲の期待値。版を変えたらここも更新 |
| `DESIGN.md` | 対象ホスト・アーキテクチャ（§1）、executor 設定（§3.1）、ホスト解決とバージョン一致（§5）、パッチ設定（§8） |
| `README.md` | 必要環境の DSH 版・Node 版 |
| `SECURITY.md` | サポート対象バージョン（`0.1.x` / `dsh >=0.2.2-rc.1 <0.3.0`） |
| `docs/` | 上記の版に言及している記述（本ファイル含む） |
| `CHANGELOG.md` | `[Unreleased]` の版言及（過去エントリは履歴として書き換えない） |
| `test/*.test.mjs` | 版・実測コードを固定したコメント／assert（例: NTSTATUS `0xC0000142`、互換 range の期待値） |

補足:

- `dsh.compatibility.dshReleases` は**宣言的メタデータ**であり、実行時の動作を変える
  ものではありません。実際の互換性は `engines.dsh`（DSH 本体の検査）と
  `lib/host-modules.js` のバージョン一致チェックが担います。
- プラグイン側の互換表を更新するだけで DSH 本体の更新に追従できるとは限りません。
  DSH の内部 API（`ctx.shell` / `ctx.sandbox` / `ctx.subprocess` / `ctx.slots` など）の
  変更を確認し、`node --test test/*.test.mjs` と E2E を再実行してください。

## 2. 更新手順（開発者向け）

```bash
cd work/dsh-gitbash-win
# 1) 対象 DSH 版を決めて、上の表の箇所を更新
# 2) テスト（Linux では Windows 専用 4 件が skip される）
node --test test/*.test.mjs
# 3) Linux の Web host E2E（一時 DSH_HOME を使う）
bash test/e2e.sh
# 4) Windows 実機/CI の live テスト（CI は windows-smoke が実行）
#    node --test test/windows-live.test.mjs
```

CI が green になったことを確認してからリリースします（`windows-smoke` は ACL probe を
含めてブロッキング）。

## 3. 手動配置（`dsh plugin add` を使わない）場合の追加確認

手動配置は pnpm を経由しないため、**`engines.dsh` の強制を通りません**。DSH 本体を
更新したら、次を必ず確認してください。

1. `GET /dsh-gitbash-win/status` が 200 を返し、`platform: win32` /
   `supported: true` / `bashPath.resolved` が実在の `bash.exe` を指す
   （Settings → Plugins → Git Bash カードの検出パネルでも可）。
2. 新規セッションのツール一覧に `bash` と `pwsh` の両方が出る。
3. `node --test test/windows-live.test.mjs` が Windows 実機/VM で通る
   （検出・実実行・`BASH_ENV`・unconfined facts）。
4. `bash` ツールで `echo $BASH_VERSION` / `uname -s` を実行し、MINGW 系の出力になる。

問題がある場合は DSH のバージョンを戻すか、プラグインを更新してください。
