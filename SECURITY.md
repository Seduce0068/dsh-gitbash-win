# セキュリティポリシー（dsh-gitbash-win）

## サポート対象バージョン

セキュリティ修正は次の範囲に対して行います。

| プラグイン | DSH 本体 |
|---|---|
| `0.1.x` | `>=0.2.2-rc.1 <0.3.0`（`0.2.2-rc.1` で検証） |

それ以外の組み合わせ（将来の DSH `0.3.x` など）は、動作したとしてもサポート対象外です。
ホストの `@deepseek-ai/*` パッケージの実バージョンが実行中 DSH と一致しない場合、既定で
ロードは失敗します（`DSH_GITBASH_ALLOW_HOST_VERSION_MISMATCH=1` はオペレーターによる
明示上書きでのみ使用してください）。実行中 DSH のバージョンを特定できない場合は
このチェックをスキップします。

## 脆弱性の報告

**公開の Issue に脆弱性の詳細を書かないでください。** 次のいずれかの非公開経路で
報告してください。

1. GitHub の **Security → Report a vulnerability**（Security Advisories / 非公開報告）
   <https://github.com/Seduce0068/dsh-gitbash-win/security/advisories/new>
2. リポジトリ所有者への非公開連絡（GitHub プロフィールの連絡先）

報告には、影響するバージョン、再現手順、想定される影響（例: サンドボックス回避、
権限昇格、情報漏えい）を含めてください。DSH 本体や Git for Windows 側の問題と思われる
場合は、それぞれのプロジェクトの開示ポリシーも確認してください。

**API キー・トークン・Cookie・認証情報・個人情報を Issue / ログ / 添付ファイルへ
貼らないでください。** 誤って含めた場合は、報告前に無効化（失効）してください。

## このプラグインのセキュリティ境界（要約）

詳細は [docs/security.md](docs/security.md) を参照してください。

- このプラグインは DSH の権限モード・承認フロー・ファイルサンドボックス・credential
  scrubbing を置き換えたり迂回したりしません。Git Bash 実行器を**追加**するだけです。
- Windows の `read-only` / `workspace-write` では、公式 ACL restricted-token runner と
  Git Bash の組み合わせは**実測で非互換**です（`0xC0000142` 等）。既定は fail-closed で、
  コマンドは実行されません（前景は `SANDBOX_UNAVAILABLE`、バックグラウンド /
  プロモートされたジョブは `runnerFailed` として通知）。
- `sandboxFallback: unconfined` は**明示オプトイン**の安全設定です。制限モードが要求
  されていても bash の書き込み・削除は制限されません。既定は `fail` で、カードからは
  変更できません（`cordis.patch.yml` のみ。反映は行の再読込（HMR 有効な Web プロファイル）
  またはホスト再起動）。
- `initScript`（`BASH_ENV`）はオペレーターが用意した**信頼済みコード**で、bash の実行
  ごとに読み込まれます。モデル入力からは変更できませんが、内容はレビューしてから設定
  してください。
- status route（`GET /dsh-gitbash-win/status`）は認証フェンス付きですが、検出のための
  固定 `uname -s` probe を GET ごとに実行し、候補のファイルシステムパスを認証済み
  呼び出し元へ返します。レート制限は提供しません。環境変数・トークン・認証情報は
  返しません。
- ホスト DSH と `@deepseek-ai/*` パッケージのバージョン不一致は既定でロード失敗
  （`DSH_GITBASH_ALLOW_HOST_VERSION_MISMATCH=1` はオペレーターが内容を理解した上での
  明示上書き。通常は設定しないでください）。
- ローカルでの秘密スキャン: `gitleaks git --no-banner --redact .` を推奨します
  （CI の gitleaks が全履歴と作業ツリーをスキャンします）。
