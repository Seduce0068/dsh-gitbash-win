# DSH 本体の更新に追従する（dsh-gitbash-win）

このプラグインは DSH 本体の内部パッケージ（`@deepseek-ai/dsh-*`）を実行時に解決して
使います。DSH を更新するときは、下の「0.2.2-rc.1 に固定している箇所」を確認し、
必要なら同じ commit で更新してください。

> この手順は DSH 本体の更新（例: `0.2.x` → `0.3.x`）向けです。プラグインの通常の
> インストールは [install-windows.md](install-windows.md) を参照してください。

## 1. 0.2.2-rc.1 に固定している箇所（更新時のチェックリスト）

| 箇所 | 内容 |
|---|---|
| `package.json` | `engines.dsh: ">=0.2.2-rc.1 <0.3.0"` と `dsh.compatibility.dshReleases` の対象版 |
| `lib/host-modules.js` | `@deepseek-ai/dsh-*` のバージョン一致チェック（実行中 DSH と版が一致しない場合は `DSH_HOST_MODULE_VERSION_MISMATCH` で失敗。`DSH_GITBASH_ALLOW_HOST_VERSION_MISMATCH=1` は明示上書き） |
| `.github/workflows/windows-smoke.yml` | `npm install --global @deepseek-ai/dsh@0.2.2-rc.1` の版 |
| `.github/workflows/linux-tests.yml` | 同上（ubuntu-latest のテスト/E2E 用） |
| `DESIGN.md` | 対象ホスト・`engines`/互換性の記述（§1・§3.1・§5） |
| `README.md` | 必要環境の DSH 版・Node 版 |
| `SECURITY.md` | サポート対象バージョン（`0.1.x` / `dsh >=0.2.2-rc.1 <0.3.0`） |
| `docs/` | 上記の版に言及している記述（本ファイル含む） |

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
