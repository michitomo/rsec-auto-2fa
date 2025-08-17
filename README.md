# Rakuten Securities 2FA Automation System

🤖 楽天証券の画像認証（絵文字選択式2FA）を自動化するシステム

## ⚠️ 重要なセキュリティ警告

**このツールは教育目的およびセキュリティ研究用です。使用は自己責任でお願いします。**

- 本ツールの使用により生じたいかなる損害についても、作者は責任を負いません
- 第三者のアカウントへの不正アクセスは違法です
- 楽天証券の利用規約を必ず確認し、遵守してください
- 2FAは重要なセキュリティ機能です。自動化によりセキュリティリスクが増大する可能性があります

## 📋 概要

このシステムは、楽天証券のログイン時に表示される画像選択式の2段階認証を自動化します。メールで送信される認証コードを解析し、対応する絵文字画像を自動的に選択してログインを完了させます。

### 主な機能

- 📧 2FA認証メールの自動解析（ISO-2022-JP対応）
- 🖼️ 絵文字画像の自動選択
- 🔄 リアルタイムWebSocket通信
- 🚀 自動ログインボタンクリック
- 🔒 セキュアな内部通信

## 🏗️ アーキテクチャ

```
楽天証券メール → Cloudflare Email Worker → WebSocket Worker → Chrome Extension → 楽天証券ログインページ
```

### コンポーネント

1. **Cloudflare Email Worker**: メール受信・解析
2. **Cloudflare WebSocket Worker**: リアルタイム通信ハブ（Durable Objects使用）
3. **Chrome Extension**: ブラウザ自動操作

## 🚀 セットアップ

### 前提条件

- Cloudflareアカウント（Workers, Email Routing利用可能）
- 独自ドメイン（Cloudflareで管理）
- Node.js 16以上
- Chrome/Edge ブラウザ

### 1. Cloudflare Workers のデプロイ

```bash
cd cloudflare-workers
npm install

# 設定ファイルの準備
cp wrangler.toml.example wrangler.toml
cp wrangler-websocket-v2.toml.example wrangler-websocket-v2.toml

# 設定ファイルを編集（実際の値を設定）
# - Worker名
# - ドメイン
# - APIキー（ランダムな文字列を生成）
# - KV Namespace ID

# KV Namespaceの作成
wrangler kv namespace create "KV_STORE"
# 出力されたIDを wrangler-websocket-v2.toml に記載

# Workersのデプロイ
wrangler deploy --config wrangler-websocket-v2.toml
wrangler deploy --config wrangler.toml
```

### 2. Email Routingの設定

1. Cloudflareダッシュボードで Email Routing を有効化
2. カスタムアドレス（例: `2fa@yourdomain.com`）を作成
3. Email WorkerにルーティングするよEstatus設定

### 3. Chrome Extensionのインストール

```bash
# 1. Chrome で chrome://extensions を開く
# 2. 「デベロッパーモード」を有効化
# 3. 「パッケージ化されていない拡張機能を読み込む」
# 4. chrome-extension フォルダを選択
```

### 4. 拡張機能の設定

1. 拡張機能アイコンを右クリック → オプション
2. WebSocket Worker URLを入力（例: `wss://your-worker.workers.dev/websocket`）
3. 認証トークンを入力（設定している場合）
4. 保存して接続テスト

## 📝 設定

### 環境変数

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `WEBSOCKET_WORKER_URL` | WebSocket WorkerのURL | `wss://your-worker.workers.dev/websocket` |
| `INTERNAL_API_KEY` | 内部通信用APIキー | 32文字以上のランダム文字列 |
| `AUTH_TOKEN` | WebSocket認証トークン | 32文字以上のランダム文字列 |

### セキュリティ設定

- 強力なAPIキーを使用（最低32文字以上）
- HTTPSのみ使用
- CORS設定を適切に構成
- レート制限を実装

## 🔧 トラブルシューティング

### WebSocket接続エラー

- Worker URLが正しいか確認
- 認証トークンが一致しているか確認
- Cloudflare Workersのログを確認: `wrangler tail`

### メール解析エラー

- Email Routingが正しく設定されているか確認
- メールアドレスが正しいか確認
- ISO-2022-JPエンコーディングの問題を確認

### 絵文字選択エラー

- 楽天証券のページ構造が変更されていないか確認
- 絵文字マッピングが正しいか確認
- Chrome ExtensionのConsoleログを確認

## 開発

### ローカルテスト

```bash
# Cloudflare Workers
cd cloudflare-workers
wrangler dev --config wrangler-websocket-v2.toml
wrangler dev --config wrangler.toml

# ログ確認
wrangler tail --config wrangler.toml
wrangler tail --config wrangler-websocket-v2.toml
```

## 🤝 コントリビューション

バグ報告や機能要望は[Issues](https://github.com/yourusername/rsec-auto-2fa/issues)にお願いします。

プルリクエストを送る前に：
1. セキュリティへの影響を考慮
2. テストを実施
3. ドキュメントを更新

## 📄 ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照

## 🚨 免責事項

本ソフトウェアは「現状のまま」で提供され、明示的または暗黙的な保証はありません。作者は、本ソフトウェアの使用により生じたいかなる損害についても責任を負いません。

使用前に必ず：
- 楽天証券の利用規約を確認
- 自己責任で使用することを理解
- セキュリティリスクを認識

## 📚 参考資料

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Chrome Extension Development](https://developer.chrome.com/docs/extensions/)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)