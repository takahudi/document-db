import test from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { setBlockType } from '@tiptap/pm/commands'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { parseHtml, serializeHtml } from '../src/content/html.js'
import { extensions, validateBody } from '../src/content/parts.js'
export const sample = '<h1>文書庫</h1><h2>編集</h2><h3>保存</h3><p>本文 <strong>太字</strong><em>斜体</em><br><a href="https://example.com">リンク</a></p><ul><li><p>項目</p><ol><li><p>入れ子</p></li></ol></li></ul><table><thead><tr><th><p>操作</p></th><th><p>結果</p></th></tr></thead><tbody><tr><td><p>保存</p></td><td><p>確定</p></td></tr></tbody></table><pre><code>\n  &lt;script&gt;文字&lt;/script&gt;\n\n x &amp; y\n</code></pre>'
test('全部品とコードの空白を HTML 往復で保持する', () => {
	const body = parseHtml(sample)
	const html = serializeHtml(body)
	assert.match(html, /<code>\n {2}&lt;script&gt;文字&lt;\/script&gt;\n\n x &amp; y\n<\/code>/)
	assert.deepEqual(parseHtml(html), body)
})
test('補正される属性・構文・未対応部品を拒否する', () => {
	for (const html of ['<p style="color:red">a</p>', '<p onclick="x">a</p>', '<p id="a" id="b">a</p>', '<p><a href="https://a" HREF="javascript:x">a</a></p>', '<p><strong>x</p></strong>', '<p>x', '<script>x</script>', '<p><a href="java&#115;cript:x">x</a></p>', '<p><a href="/x">x</a></p>', '<p a=b>x</p>', '<p>x</p><!--x-->', '<table><tr><td>text</td></tr></table>', '<pre>code</pre>', '<p>x</p garbage>', '<p>x\0</p>']) assert.throws(() => parseHtml(html), html)
})
test('JSON の未知属性とセル結合を黙って落とさない', () => {
	assert.throws(() => validateBody({ type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'red' } }] }))
	assert.throws(() => validateBody({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph' }] }] }] }] }))
})
test('表セルとリスト項目では保存できない部品へ変更しない', () => {
	const schema = getSchema(extensions)
	const heading = schema.nodes.heading
	const code = schema.nodes.codeBlock
	assert.ok(heading && code)
	for (const html of [
		'<table><tr><th><p>見出しセル</p></th><td><p>本文セル</p></td></tr></table>',
		'<ul><li><p>リスト項目</p></li></ul>',
	]) {
		const doc = schema.nodeFromJSON(parseHtml(html))
		doc.descendants((node, position) => {
			if (node.type.name !== 'paragraph') return
			const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, position + 1) })
			assert.equal(setBlockType(heading, { level: 1 })(state), false, `${html}: heading`)
			assert.equal(setBlockType(code)(state), false, `${html}: codeBlock`)
		})
	}
	const doc = schema.nodeFromJSON(parseHtml('<p>通常の本文</p>'))
	const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1) })
	assert.equal(setBlockType(heading, { level: 1 })(state), true)
	assert.equal(setBlockType(code)(state), true)
})
test('入れ子の装飾と文字参照は対象の文字だけに付く', () => {
	const body = parseHtml('<p>前<strong>太字<em>両方</em>太字続き</strong>後<br>次 &amp; &lt;値&gt;</p>')
	assert.deepEqual(body.content?.[0]?.content, [
		{ type: 'text', text: '前' }, { type: 'text', text: '太字', marks: [{ type: 'bold' }] },
		{ type: 'text', text: '両方', marks: [{ type: 'bold' }, { type: 'italic' }] },
		{ type: 'text', text: '太字続き', marks: [{ type: 'bold' }] }, { type: 'text', text: '後' },
		{ type: 'hardBreak' }, { type: 'text', text: '次 & <値>' },
	])
	assert.deepEqual(parseHtml(serializeHtml(body)), body)
	const link = parseHtml('<p><a href="h&#116;tps://example.test/a?x=1&amp;y=2">参照先</a></p>')
	assert.equal(link.content?.[0]?.content?.[0]?.marks?.[0]?.type, 'link')
	assert.match(serializeHtml(link), /href="https:\/\/example.test\/a\?x=1&amp;y=2"/)
})
