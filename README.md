# 文書庫

自分の PC で説明資料を作り、ブラウザと外部 AI から同じ文書を編集するローカルアプリです。本文の正本は Tiptap JSON 一つです。外部 AI には本文の構造だけを表す HTML を渡します。

## 起動

Node.js 24 が必要です。確認した環境は Windows と Node.js 24.16.0 です。

```powershell
npm ci
npm run build
npm start
```

[http://127.0.0.1:4310](http://127.0.0.1:4310) を開きます。開発中は `npm run dev` を使います。同じ HTTP ポートで Vite の開発画面と API を配信します。

既定の保存先は、このプロジェクトの `.data` です。起動時の作業ディレクトリには依存しません。SQLite ファイルと `images` ディレクトリをまとめて保持してください。アプリを更新しても `.data` を削除しなければ文書と画像が残ります。実データは Git 管理に含めません。

保存先とポートは次のように指定できます。保存先には絶対パスを使います。

```powershell
npm start -- --data-dir "D:\DocumentData" --port 4310
```

環境変数 `DOCUMENT_DB_DATA_DIR` でも保存先を指定できます。HTTP と MCP に必ず同じ保存先を設定してください。

## ブラウザでの編集

「新しい文書」からタイトルと本文を入力し、「保存」で確定します。見出し、太字、斜体、リスト、表、コード、HTTP と HTTPS のリンクを追加できます。表セルを選ぶと行・列の追加と削除、見出しセルの切り替えを使えます。改行は Shift+Enter です。

「画像」から PNG、JPEG、WebP を追加できます。画像を選ぶと説明文を編集できます。画像は 20 MB、4,000 万画素までです。画像を追加した後も文書の保存が必要です。外部 AI には画像の説明文と発行済み参照を渡し、画像そのものは渡しません。

AI が保存した内容は「最新を読み直す」で確認します。未保存の変更を破棄する場合は確認を表示します。保存中に別の保存があった場合、古い版からの上書きを拒否し、編集中の内容を保持します。保存に失敗した場合も内容を保持します。

「直前の保存に戻す」はタイトルと本文を直前の状態へ戻します。未保存の変更がある間は使えません。戻した後は版が進み、その取り消しをもう一度戻すことはできません。文字入力を元に戻すツールバーの操作とは別です。

## 外部 AI の MCP 設定

stdio 対応クライアントに次の設定を登録します。パスは実際のプロジェクト位置に置き換えてください。HTTP を起動していなくても MCP は使用できます。

```json
{
  "mcpServers": {
    "document-db": {
      "command": "node",
      "args": [
        "D:/path/to/document-db/node_modules/tsx/dist/cli.mjs",
        "D:/path/to/document-db/src/mcp.ts",
        "--data-dir",
        "D:/path/to/document-db/.data"
      ]
    }
  }
}
```

この設定は `npm run` のバナーを MCP の標準出力へ混ぜません。`node` が見つからないクライアントでは `command` に Node.js の絶対パスを指定してください。

| ツール | 引数 | 結果 |
| --- | --- | --- |
| `list_documents` | なし | ID とタイトルの一覧 |
| `get_document` | `id` | `id`, `title`, `revision`, `html` |
| `create_document` | `title`, `html` | `id`, `revision` |
| `update_document` | `id`, `revision`, `title`, `html` | `revision` |

ツールの結果は text content の JSON です。`html` フィールドが本文 HTML です。更新は本文全体の置き換えで、取得時の `revision` が必要です。競合エラーになったら最新を取得し直してください。AI による修正は承認画面を挟まず保存します。画像を保持する場合は取得した `<img src="asset:UUID" alt="説明文">` を残してください。

本文 HTML は `h1`〜`h3`, `p`, `strong`, `em`, `br`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `pre`, `code`, `a`, `img` に対応します。表セル内には段落、コードは `<pre><code>...</code></pre>` を使います。属性は `a[href]` と `img[src,alt]` だけです。属性値は引用符で囲み、void 要素以外の終了タグを省略しないでください。番号リストは 1 から始めます。

CSS、イベント属性、未対応部品、任意の画像 URL、未登録の画像参照はエラーにし、保存済み文書を変更しません。コードに HTML を含める場合は `&lt;` と `&gt;` などで文字として表します。画像アップロード、画像 bytes の取得、保存の取り消しは MCP ツールとして公開しません。

## 検証

```powershell
npm run typecheck
npm run lint
npm test
npm run verify:mvp
```

`verify:mvp` は型チェック、lint、テスト、ビルドに続いて実 HTTP、別プロセスの stdio MCP、Edge、実ファイル SQLite を起動します。毎回専用の一時データディレクトリを作り、普段の文書には触れません。成功条件の一連の操作、未知 HTML と JSON の非保存、同一版の競合、古い版の取り消し、復元一度だけ、draft 保持、再起動後の文書と実画像バイトを照合します。画像・コード・表の期待内容は独立した値で比較します。

Windows の既定ブラウザ実行ファイルは `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` です。他の場所の Chromium 系ブラウザを使う場合は `DOCUMENT_DB_BROWSER` に実行ファイルを指定してください。ブラウザのダウンロードは行いません。

画面のスクリーンショット、画面 HTML、MCP 本文 HTML と同じ `gpt-tokenizer` による計測結果を `verification-artifacts` に保存します。版は lockfile に固定します。検証用データのパスは `measurement.json` に残します。成果物と一時データを普段の保存先と取り違えないでください。

設計は [docs/architecture.md](docs/architecture.md)、確定範囲は [docs/specs/mvp.md](docs/specs/mvp.md) を参照してください。
