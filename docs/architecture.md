# 文書の編集と保存

実装済みMVPの確定仕様は[仕様書](specs/mvp.md)に記載する。後続の[Diagram Design連携の拡張仕様](specs/diagram-design-integration.md)も実装済みで、図の構成は[設計記録](implementation/diagram-design.md)に記載する。

ブラウザとMCPは同じ文書モジュールを使い、各プロセスから同じSQLiteファイルを開く。MCPはWebサーバーの起動を必要としない。

## 利用する形

```ts
const documents = openDocuments({ dataDir });
const created = documents.create({
  title: 'このツールの使い方',
  body: { kind: 'html', value: '<h1>使い方</h1><p>保存を押します。</p>' },
});
const opened = documents.read(created.id);
const saved = documents.update({
  id: opened.id,
  expectedRevision: opened.revision,
  title: opened.title,
  body: { kind: 'editor', value: editedJson },
});
documents.restore({ id: saved.id, expectedRevision: saved.revision });
```

## 所有する判断

| モジュール | 責務 |
| --- | --- |
| 共通の部品と本文codec | 許可するTiptap部品、JSON検査、本文HTMLの読み取りと出力。HTTPとMCPの本文を同じ正本へ変換する |
| 文書モジュール | SQLite、版一致、直前保存、原子的な更新と一度だけの復元。SQLや保存順序を呼び出し側へ公開しない |
| 画像モジュール | PNG・JPEG・WebPの追加と参照、保存ファイルの読み取り |
| HTTPとstdio MCP | 入出力の検査と形式の変換。保存ルールを重複させない |
| React画面 | 見た目での編集、未保存ドラフト、保存・失敗・競合の状態、画像追加と説明文編集 |

## 不変条件

- 正本はTiptapの構造化JSON一つ。HTMLは入出力時に変換する。
- 未対応の要素・属性・画像参照を、保存前に拒否する。HTMLからDOMへの変換で消える不正入力も検査する。
- 通常本文の整形空白とコード中の空白を区別し、コードと画像の説明文を保持する。
- 作成は版1で直前保存なし。更新は現在内容を直前欄へ移して版を進める。復元は直前欄を消して版を進める。
- 更新と復元の版確認・本文・直前欄の変更は、BEGIN IMMEDIATE内で完了する。区間内にawaitを置かない。
- ブラウザは保存成功時だけ基準版を更新する。保存失敗と競合ではドラフトを保持する。
- 未保存ドラフトの読み直しや画面移動は、破棄を確認してから行う。
- 画像は共有データディレクトリ内で追加し、保存済み参照を自動削除しない。
- HTTPはループバックへ限定し、HostとOriginを検査する。MCPの標準出力はプロトコル専用とする。

## 比較と選択

候補AはHTTPとMCPが深い文書モジュールを直接使う構成。候補BはHTTPが保存を所有し、MCPがHTTPへ転送する構成だった。独立した評価者はAを15点、Bを14点としてAを推奨した。親の評価ではAの厳密codec案には検証すべき複雑さが残るが、HTTP起動依存を増やさず保存規則を一つにできる利点を採用した。

Aを基準にし、Bから未保存ドラフトの破棄・読み直し手順とHTTP Host検査を取り込む。厳密HTML検査後に別converterへ委譲し、さらに意味の木を二重に比較する案は採用しない。許可する部品の範囲内で、HTMLから同じ正本へ直接変換する。

予定した3人目の設計候補はツールのチャット数上限により開始できず、2案で比較した。独立評価には既存の読み取り担当を再利用した。

Model the Domainを使い、文書の保存版と編集中ドラフトを明示的な状態で表す。Boundary Disciplineを使い、HTML・JSON・SQL行・プロトコルの検査を境界へ集める。Separate Before Serializing Shared Stateを使い、実装担当のworktreeを分け、正本の共有が必要な実行時データだけをSQLiteで直列化する。

## 実装と検証

本文codecと実SQLiteの検証を先に行い、その契約をHTTP・MCP・画面へつなぐ。再実行できる検証スクリプトで、実stdio MCPとブラウザを使って仕様の成功条件を確認する。Prove It WorksとBuild the Leverに従い、自己申告や型チェックだけで完了とはしない。

実装中の契約変更と受け入れた理由はこの文書へ追記する。未検証の挙動は成功として記録しない。

## 実装との照合

共通部品とcodecは`src/content/parts.ts`と`html.ts`、文書操作は`src/documents.ts`、画像は`src/assets.ts`、HTTPとMCPは`src/http.ts`と`mcp.ts`、画面は`src/web/`に実装した。起動時の作業ディレクトリに依存せず、同じプロジェクトの`.data`を既定の保存先とする。

Tiptapが生成する既定の`link.title=null`と表セルの`align=null`は意味を持たない既定値として検査・正規化する。それ以外の未対応値を許可するために検査を弱めてはいない。SAXが変えるコード先頭改行は元のソース範囲から復元し、独立した期待文字列で確認する。

独立レビューで、表セルとリスト項目の編集スキーマが保存検査より広い問題を発見した。Fix Root Causesに従い、例外を抑える処理ではなく、共有部品の子要素規則を段落と許可した入れ子リストへ揃えた。変更できない書式は同じスキーマの操作可否から画面でも無効にする。回帰テストは修正前に`true !== false`で失敗し、修正後に成功した。

`npm run verify:mvp`は型チェック、lint、7テスト、production build、実Edge・HTTP・別cwdのstdio MCPによる成功条件を通した。読み直しのGET通信失敗でもドラフトが残ることを確認した。結果と画像は`verification-artifacts/`に保存する。Node内蔵SQLiteのAPI状態は仕様書に記した通りで、ここで確認したのは現在のNode 24.16.0での動作である。

## Diagram Designの拡張

図はTiptapの原子的な部品で、検査済みSVG、図用CSS、ラベル対応を同じ本文JSONへ保存する。SVG内の文字を正本とし、本文HTMLの短い参照とMCPの文字一覧はそこから生成する。既存参照の補完は文書の版一致を確認したトランザクション内で行う。DBテーブルや第二の図ストアは追加しない。

ブラウザはスクリプト権限のないiframeに図を描画し、実際のローカル書体とSVGの境界で文字を改行・適用する。未適用入力はSessionが保持する。成功した読み直しは同じ版でも編集器を作り直し、保存成功では未適用入力を保持する。初期contentを重複して設定しない。

生成HTMLの変換器は、文字の対応情報を使い、表示に必要なスタイルを静的SVGへ保存する。異なる親の座標系にある行、CSSによる変形、複雑なHTMLラベルは明示的に再生成を求める。単純なHTMLラベルと上流の静的なprint規則、対応書体のGoogle Fontsリンクには変換経路を用意する。リンクからネットワークへ書体を取得せず、固定したFontsource資源をローカル配信する。

型チェック、lint、28テストとビルドに加え、図と既存MVPを実Edge・HTTP・stdio MCPで検証した。図の検証は、変換したグラフのMCP保存、文字編集とAI更新、回転と装飾の保持、入力の適用拒否と保持、復元、再起動、外部通信の遮断、実描画書体を照合する。
