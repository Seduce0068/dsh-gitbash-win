# Windows 実機なしで動作確認する方法（dsh-gitbash-win）

このプラグインは Windows 専用ですが、開発機は Linux でも検証できます。
方法は 3 つあり、**組み合わせるのが一番確実**です。

| 方法 | 向いている確認 | コスト |
|---|---|---|
| **GitHub Actions `windows-smoke`**（推奨） | 実 Windows 上での検出・実行・Web host 結合・ACL 診断 | 無料・自動 |
| **手元の Kubuntu に Windows 11 VM（QEMU/KVM）** | ブラウザでの設定カード操作・実機に近い環境 | 30〜60分・ディスク64GB（qcow2 実消費は約40GB） |
| **実機/リモートデスクトップ** | 最終確認（インストール先・PATH・社内環境） | 要 Windows 機 |

## 0. 現在の実測結果（自動テスト済み）

GitHub Actions（Windows 実 runner と ubuntu-latest）で確認済み。CI は
**2026-11-11 の `240fd66` で gitleaks / linux-tests / windows-smoke の 3 workflow が
すべて green**（Windows 実機まわりは 2026-11-10 / windows-latest = Windows Server 2025 /
Git for Windows 2.56.0.windows.4）。このフォローアップ commit でも CI が再実行されます。
Linux ローカルの `node --test test/*.test.mjs` は 2026-11-11 時点で
**111 tests / 107 pass / 0 fail / 4 skipped**（Windows 専用 4 件は skip）:

| 検証 | 結果 |
|---|---|
| Linux CI（`.github/workflows/linux-tests.yml`） | **PASS（240fd66）** — ubuntu-latest でテスト一式（Windows 専用 4 件は skip）と `test/e2e.sh`（profile 合成・status route・認証・client bundle 配信）を実行 |
| Windows live tests（`test/windows-live.test.mjs`） | **4/4 pass** — 実 Git Bash 検出、私有 executor による実実行、`BASH_ENV`、unconfined facts |
| headless / TUI 構成（`test/host.test.mjs` の headless ケース） | **PASS** — Web ホストサービス無しでも `bash` ツールが登録され、実コマンドが通る（status route は登録されない） |
| Web host E2E（`test/e2e-windows.sh`） | **PASS** — 加算型の合成（公式 `pwsh` 行が残存）、実 `dsh web` 起動、status route（`platform: win32` / 実 `bash.exe`）、client bundle 配信、未認証拒否 |
| **設定カード（実ブラウザ）**（`test/browser-card.mjs`・Playwright + Edge headless） | **PASS** — 実 UI で Settings → Plugins → **Git Bash** を開き、検出パネルと 4 入力欄を確認 → タイムアウト変更して Save → profile patch に書き込み → **再読込後も値が復元** |
| ACL sandbox probe（`test/windows-sandbox-probe.mjs`・**ブロッキング**） | **fail-closed / acl-incompatible** — run により「Git Bash が restricted-token 下で `0xC0000142`（DLL 初期化失敗）」または「ACL backend が使用不可」。**どちらもコマンドは未実行**で、前景は `SANDBOX_UNAVAILABLE`（fail-closed）、バックグラウンド / プロモートされたジョブでは既知の起動クラッシュ（`0xC0000142` 等）が `runnerFailed` として通知。`UNEXPECTED` は CI 失敗、上記 3 結果は成功扱い |

つまり「検出・実行・Web host 組込み・**設定カードの実ブラウザ操作（Save/再読込）**」は
Windows 実機（CI）で動作確認済みで、**制限モード（`workspace-write` / `read-only`）
だけが Git Bash と非互換**です。
この制約は [security.md](security.md) の 3 択で運用してください。

---

## 1. GitHub Actions `windows-smoke`（Windows 機不要）

`.github/workflows/windows-smoke.yml` が **GitHub の本物の Windows runner** で
push / PR ごとに自動実行します。同じ push / PR で `.github/workflows/linux-tests.yml` が
ubuntu-latest 上でテスト一式と `test/e2e.sh` を実行し、`.github/workflows/gitleaks.yml` が
gitleaks `8.30.1`（tarball の期待 SHA-256 をワークフローに固定して照合）で全履歴 +
作業ツリーをスキャンします。

- 手動実行: GitHub の Actions タブ → `windows-smoke` → **Run workflow**、または
  `gh workflow run windows-smoke`
- 結果確認: `gh run list --workflow windows-smoke.yml`、
  `gh run watch <id> --exit-status`、または Actions UI のログ

実行内容と保証されること:

1. **`@deepseek-ai/dsh@0.2.2-rc.1` を npm から導入**（実際に配布されている版）
2. **Git for Windows の存在確認**（windows-latest は `C:\Program Files\Git\bin\bash.exe` 同梱）
3. **Windows 専用 live テスト**（`test/windows-live.test.mjs`）
   - 実 Git Bash の自動検出と `uname -s` = MINGW
   - 私有 executor が isolated cordis scope で **実際に Git Bash を spawn** し
     `echo` / `uname -s` / `pwd` が通る
   - `initScript` が `BASH_ENV` として source される
   - `sandboxFallback: unconfined` の表示・facts が正しい
4. **Web host 結合テスト**（`test/e2e-windows.sh`）
   - プラグインを bundle として合成し、**公式 `pwsh` 行が残っている**（加算型）ことを確認
   - 実 `dsh web` を起動 → token 認証 → `GET /dsh-gitbash-win/status` が
     `platform: win32` / `supported: true` / 実 `bash.exe` パス / `sandbox.available: true`
   - client bundle が `__DSH_BOOT__` に載り、実際に配信される
   - 未認証リクエストが拒否される
5. **設定カードの実ブラウザテスト**（`test/browser-card.mjs`・Playwright + Edge headless）
   - 実 UI で Settings → Plugins → **Git Bash** カードを開き、検出パネルと 4 つの入力欄を確認
   - コマンドタイムアウトを変更して **Save** → プロファイル patch への書き込みを確認
   - ページを再読込して **値が Host から復元される**ことを確認
   - 失敗時は `browser-card-failure` アーティファクト（スクリーンショット）が残ります
6. **ACL サンドボックス診断**（`test/windows-sandbox-probe.mjs`・**ブロッキング**）
   - 公式 `dsh-sandbox-local`（ACL restricted-token runner）で Git Bash を実行し、
     `confined-ok`（内側書込み OK・外側拒否）/ `fail-closed`（SANDBOX_UNAVAILABLE）/
     `acl-incompatible`（restricted-token 下で Git Bash が `0xC0000142` 等で起動失敗、
     コマンド未実行）のいずれかをログに記録。どの結果でも
     **静かに unconfined 実行はしない** ことを確認する診断です。`UNEXPECTED` は CI を
     失敗させ、`confined-ok` / `fail-closed` / `acl-incompatible` は成功扱いです。

### CI で分かること / 分からないこと

- 分かる: Linux でのテスト一式と E2E、Windows の検出ロジック、実 Git Bash 実行、
  Web host への組込み、status API 認証、client bundle 配信、**実ブラウザ
  （Edge + Playwright）での設定カード表示・Save・再読込後の復元**、ACL 経路の実挙動
  （`confined-ok` / `fail-closed` / `acl-incompatible`、前景 = `SANDBOX_UNAVAILABLE` /
  バックグラウンド = `runnerFailed`）
- 分からない: 各自の Git インストール先・PATH・レジストリの差異、passkey ゲートウェイ
  越しの運用、Windows 10/11 クライアント実機での差異（runner は Windows Server 2025）、
  実機固有の Edge/ブラウザ設定。実機で使った際の挙動は、このドキュメントの
  [3. 実機チェックリスト](#3-実機チェックリスト) の項目と突き合わせて確認してください。

---

## 2. 手元の Kubuntu に Windows 11 VM を作る（QEMU/KVM）

ブラウザでの設定カード操作まで確認したい場合の手順です。
**sudo が必要なコマンドはあなた自身で実行してください**（エージェントは実行しません）。

### 2.1 前提

- CPU 仮想化が有効（`ls -l /dev/kvm` が存在。無い場合は UEFI/BIOS で AMD-V（SVM）を
  有効化してください）
- メモリ 16GB 以上推奨（VM に 8GB）、ディスク 64GB（qcow2 の実消費は約 40GB）
- ライセンス: Microsoft の **Windows 11 Enterprise 評価版**（90日）を使うのが安全

### 2.2 ホスト側の準備（Kubuntu）

```bash
# 仮想化の確認（/dev/kvm が無い場合は UEFI/BIOS の AMD-V（SVM）を有効化）
ls -l /dev/kvm
groups | grep -q kvm || echo "kvm グループに未所属"

# インストール（要 sudo）
sudo apt update
sudo apt install -y qemu-system-x86 qemu-utils virt-manager ovmf swtpm
sudo usermod -aG kvm,libvirt "$USER"   # 反映には再ログイン
```

### 2.3 Windows 11 評価版 ISO

Microsoft Evaluation Center から **Windows 11 Enterprise** の評価版 ISO を
ダウンロードします（公式・90日・無料）:
<https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise>

### 2.4 VM 作成（virt-manager）

1. `virt-manager` → **新しい仮想マシン** → ローカル ISO を選択
2. メモリ **8192MB**、CPU **4**、ディスク **64GB**（qcow2）
3. 「インストール前に設定をカスタマイズ」で:
   - チップセット **Q35** / ファームウェア **UEFI x86_64: ... OVMF**
   - **TPM 2.0 を追加**（Windows 11 の要件。virt-manager の「TPM」追加）
   - ネットワークは既定の NAT
4. Windows を通常インストール

### 2.5 VM 内でのセットアップ

VM の Edge から GitHub にアクセスできるので、そこで完結します。

1. Git for Windows を導入（`winget install --id Git.Git -e` でも可）
2. Node.js 24 を導入（winget: `winget install OpenJS.NodeJS`、または公式 MSI）
3. PowerShell:
   ```powershell
   npm install --global @deepseek-ai/dsh@0.2.2-rc.1
   dsh --version
   git clone https://github.com/Seduce0068/dsh-gitbash-win.git C:\Tools\dsh-gitbash-win
   dsh plugin --profile web add file:C:/Tools/dsh-gitbash-win
   dsh web
   ```
4. 表示された URL（`?token=...`）を VM の Edge で開く
   → **Settings → Plugins → Git Bash** カードを開き、検出結果・各フィールド・Save を確認
5. 新規セッションでモデルに `echo $BASH_VERSION` / `uname -s` / `pwd` を実行させる
   （チャットを使う場合のみ DeepSeek の認証情報が VM 内に必要。**キーは VM 内だけに置き、
   リポジトリやホストにコピーしない**）
6. VM 内で直接テストする場合（モデル不要）:
   ```powershell
   cd C:\Tools\dsh-gitbash-win
   node --test test\windows-live.test.mjs
   node test\windows-sandbox-probe.mjs
   ```

### 2.6 後片付け

- 検証後に VM を停止し、`virt-manager` から削除（ディスクイメージも削除）
- スナップショットを取っておくと「クリーンな Windows」に戻せます

---

## 3. 実機チェックリスト

実際の Windows 機（または VM）では [install-windows.md](install-windows.md) の
「4. 動作確認」「5. 権限モードの確認」を順に実施してください。CI は Windows Server 2025
の runner で検証しているため、**Windows 10/11 クライアント実機での確認は別途必要**です
（特に設定カードの表示・Save、ACL 制限モードの挙動、Git のインストール先差異）。特に:

- カードが表示され、検出パスが正しい
- `bash` と `pwsh` が両方ツール一覧に出る
- `uname -s` が `MINGW64_NT-*`（WSL の `Linux` ではない）
- `workspace-write` での挙動（`confined-ok` か `SANDBOX_UNAVAILABLE` か）を記録

ACL の実挙動が `fail-closed` / `acl-incompatible` だった場合（Windows では現状こちら）は、README の
[サンドボックスと権限](../README.md#サンドボックスと権限重要) の 3 択から選んでください。
