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
| `get_document` | `id` | `id`, `title`, `revision`, `html`, 図の識別子・説明・最新文字一覧 `diagrams` |
| `get_diagram` | `id`, `diagramId` | 文書の `id`, `revision`, 完全な図定義 `diagram` |
| `create_document` | `title`, `html`, 新規図の `diagrams` は任意 | `id`, `revision` |
| `update_document` | `id`, `revision`, `title`, `html`, 変更する図の `diagrams` は任意 | `revision` |

ツールの結果は text content の JSON です。`html` フィールドが本文 HTML です。更新は本文全体の置き換えで、取得時の `revision` が必要です。競合エラーになったら最新を取得し直してください。AI による修正は承認画面を挟まず保存します。画像を保持する場合は取得した `<img src="asset:UUID" alt="説明文">` を残してください。

本文 HTML は `h1`〜`h3`, `p`, `strong`, `em`, `br`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `pre`, `code`, `a`, `img` に対応します。図は `<figure data-diagram-id="UUID"><figcaption>説明文</figcaption></figure>` で参照します。表セル内には段落、コードは `<pre><code>...</code></pre>` を使います。属性は `a[href]`, `img[src,alt]`, `figure[data-diagram-id]` に限ります。属性値は引用符で囲み、void 要素以外の終了タグを省略しないでください。番号リストは 1 から始めます。

CSS、イベント属性、未対応部品、任意の画像 URL、未登録の画像参照はエラーにし、保存済み文書を変更しません。コードに HTML を含める場合は `&lt;` と `&gt;` などで文字として表します。画像アップロード、画像 bytes の取得、保存の取り消しは MCP ツールとして公開しません。

## Diagram Designの図を保存・編集する

プロジェクトの [document-db-diagramsスキル](.agents/skills/document-db-diagrams/SKILL.md) は、Diagram Designの静的な図を生成し、文字の対応情報を付け、MCPで文書へ保存する手順をまとめています。通常の本文はアプリ共通の書式とし、図の見た目を保持します。アニメーションと完成ページ全体の自由編集は対象外です。

生成HTMLと対応情報のmanifestを、次のコマンドでMCP用JSONに変換します。サンプルをそのまま実行できます。

```powershell
npm run diagram:convert -- --html tests/fixtures/diagram-generated.html --manifest tests/fixtures/diagram-generated.labels.json --out document.json --title "処理"
```

出力の `title`, `html`, `diagrams` を `create_document` に渡します。既存文書では `get_document` と対象の `get_diagram` を先に取得し、最新の文字と識別子を引き継いで生成します。`update_document` には取得時の版と、変更する図の定義だけを渡します。図の参照を残して定義を省略すると現在の図を保持し、参照を取り除くと図を文書から外します。本文と図はまとめて保存・復元します。

画面で図のラベルと文字範囲を選び、文字を入力して「文字を適用」を押します。文字サイズを保って枠内で改行します。収まらなければ図を変更せず、入力を残します。周囲の本文を保存しても未適用入力は残り、保存対象外と表示します。配置の変更は外部AIへ依頼します。グラフの表示数値を直しても図形の長さは変わりません。図の説明文、複製、削除、順序も画面で操作できます。

書体は固定したFontsourceパッケージからローカル配信し、Google Fontsへの接続は不要です。日本語には `Noto Sans JP` を指定します。対応する書体は [書体一覧](src/content/diagram-fonts.ts)、生成するSVG文字とmanifestの形式は [生成契約](.agents/skills/document-db-diagrams/references/contract.md) を参照してください。書式が異なる文字は別の編集範囲に分け、複数行の元要素は同じ親の座標系へ置きます。未対応の書体や複雑なHTMLラベルは、理由を示して再生成を求めます。

## 検証

```powershell
npm run typecheck
npm run lint
npm test
npm run verify:mvp
npm run verify:diagrams
```

`verify:mvp` は型チェック、lint、テスト、ビルドに続いて実 HTTP、別プロセスの stdio MCP、Edge、実ファイル SQLite を起動します。毎回専用の一時データディレクトリを作り、普段の文書には触れません。成功条件の一連の操作、未知 HTML と JSON の非保存、同一版の競合、古い版の取り消し、復元一度だけ、draft 保持、再起動後の文書と実画像バイトを照合します。画像・コード・表の期待内容は独立した値で比較します。

`verify:diagrams` は同じチェックに加え、図の文字編集、改行、枠あふれ、未適用入力の保持、MCPの参照更新、配置更新、復元、再起動と狭い画面のスクロールを実物で確認します。外部通信を遮断したブラウザでローカル書体を使い、成果物を `verification-artifacts/diagrams` に残します。変換テストもEdgeを起動するため、`npm test` には実ブラウザが必要です。

Windows の既定ブラウザ実行ファイルは `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` です。他の場所の Chromium 系ブラウザを使う場合は `DOCUMENT_DB_BROWSER` に実行ファイルを指定してください。ブラウザのダウンロードは行いません。

画面のスクリーンショット、画面 HTML、MCP 本文 HTML と同じ `gpt-tokenizer` による計測結果を `verification-artifacts` に保存します。版は lockfile に固定します。検証用データのパスは `measurement.json` に残します。成果物と一時データを普段の保存先と取り違えないでください。

設計は [docs/architecture.md](docs/architecture.md)、MVPの範囲は [docs/specs/mvp.md](docs/specs/mvp.md)、図の拡張範囲は [Diagram Design連携仕様](docs/specs/diagram-design-integration.md) を参照してください。
