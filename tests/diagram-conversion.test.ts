import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { convertGeneratedDiagram, inspectGeneratedHtml } from '../src/diagram-conversion.js'
import { slotText } from '../src/content/diagram.js'

test('rejects executable generated HTML and remote CSS before browser work', () => {
	for (const html of ['<script>alert(1)</script>', '<svg onload="alert(1)"></svg>', '<style>@import "https://example.test/a.css";</style>', '<style>svg { fill: url(https://example.test/a) }</style>', '<iframe></iframe>', '<link rel="stylesheet" href="https://example.test/a.css">', '<style>@media print { svg { fill: url(https://example.test/a) } }</style>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unknown">']) assert.throws(() => inspectGeneratedHtml(html))
})
test('standard Google Fonts metadata and print CSS use only packaged local fonts', async () => {
	const source = await readFile(new URL('./fixtures/diagram-generated.html', import.meta.url), 'utf8')
	const html = source.replace('<head>', '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;700&amp;family=Noto+Sans+JP:wght@400&amp;display=swap"><style>@media print { body { background: white; } } @media screen and (min-width: 1px) { .label { fill: #224466; } }</style>')
	assert.doesNotMatch(inspectGeneratedHtml(html), /fonts\.googleapis\.com/)
	const manifest: unknown = JSON.parse(await readFile(new URL('./fixtures/diagram-generated.labels.json', import.meta.url), 'utf8'))
	const converted = await convertGeneratedDiagram({ html, manifest, title: '標準テンプレート' })
	const diagram = converted.diagrams[0]; assert.ok(diagram)
	assert.equal(slotText(diagram, 'save', 'caption'), '保存する')
	assert.doesNotMatch(JSON.stringify(converted), /googleapis|@media/)
})
test('converts annotated Japanese text with local fonts and checks declared bounds', async () => {
	const html = await readFile(new URL('./fixtures/diagram-generated.html', import.meta.url), 'utf8')
	const manifest: unknown = JSON.parse(await readFile(new URL('./fixtures/diagram-generated.labels.json', import.meta.url), 'utf8'))
	const converted = await convertGeneratedDiagram({ html, manifest, title: '処理' })
	const diagram = converted.diagrams[0]
	assert.ok(diagram)
	assert.equal(slotText(diagram, 'save', 'caption'), '保存する')
	assert.match(converted.html, /<h2>文書の処理<\/h2>/)
	assert.match(converted.html, /data-diagram-id="11111111-1111-4111-8111-111111111111"/)
	assert.doesNotMatch(converted.html, /background|style=/)
	assert.match(diagram.svg, /fill="rgb\(34,68,102\)"|fill="#224466"/)
	const empty = await convertGeneratedDiagram({ html: html.replace('保存する</text>', '</text>'), manifest, title: '空の文字' })
	assert.equal(slotText(empty.diagrams[0] ?? diagram, 'save', 'caption'), '')
	await assert.rejects(convertGeneratedDiagram({ html: html.replace('保存する', 'あ'.repeat(100)), manifest, title: 'あふれ' }), /あふれ/)
})
test('converts declared plain HTML label and refuses rich HTML label', async () => {
	const source = await readFile(new URL('./fixtures/diagram-generated.html', import.meta.url), 'utf8')
	const value: unknown = JSON.parse(await readFile(new URL('./fixtures/diagram-generated.labels.json', import.meta.url), 'utf8'))
	const { conversionManifestSchema } = await import('../src/diagram-conversion.js')
	const manifest = conversionManifestSchema.parse(value)
	const entry = manifest.diagrams[0]; assert.ok(entry)
	const mapping = entry.sources[0]; assert.ok(mapping); mapping.kind = 'html-text'
	const html = source.replace('<text id="source-label" class="label" x="30" y="60">保存する</text>', '<foreignObject id="source-label" x="30" y="30" width="200" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Noto Sans JP; font-size:16px;line-height:24px;color:#224466">保存する</div></foreignObject>')
	const converted = await convertGeneratedDiagram({ html, manifest, title: 'HTML ラベル' })
	const diagram = converted.diagrams[0]; assert.ok(diagram)
	assert.equal(slotText(diagram, 'save', 'caption'), '保存する')
	assert.doesNotMatch(diagram.svg, /foreignObject/)
	await assert.rejects(convertGeneratedDiagram({ html: html.replace('保存する</div>', '<b>保存する</b></div>'), manifest, title: '未対応' }), /再生成/)
})

test('conversion preserves explicit normal style and refuses coordinate-changing source mappings', async () => {
	const source = await readFile(new URL('./fixtures/diagram-generated.html', import.meta.url), 'utf8')
	const value: unknown = JSON.parse(await readFile(new URL('./fixtures/diagram-generated.labels.json', import.meta.url), 'utf8'))
	const { conversionManifestSchema } = await import('../src/diagram-conversion.js')
	const manifest = conversionManifestSchema.parse(value)
	const normal = source.replace('</style>', '#frame{font-family:"Instrument Serif";font-style:italic}.label{font-style:normal}</style>').replaceAll('保存する', 'Save')
	const converted = await convertGeneratedDiagram({ html: normal, manifest, title: '書式' })
	assert.match(converted.diagrams[0]?.svg ?? '', /font-style="normal"/)
	const entry = manifest.diagrams[0]; assert.ok(entry)
	const mapping = entry.sources[0]; assert.ok(mapping)
	mapping.sourceIds.push('other-source')
	const shifted = source.replace('</g>\n</svg>', '<g transform="translate(80 0)"><text id="other-source" x="30" y="90">次の行</text></g></g>\n</svg>')
	await assert.rejects(convertGeneratedDiagram({ html: shifted, manifest, title: '座標' }), /同じ親の座標系/)
	for (const css of ['transform:translate(80px,0px)', 'transform:none', 'transform-origin:center']) {
		assert.throws(() => inspectGeneratedHtml(source.replace('</style>', `#frame{${css}}</style>`).replace('<g id="frame">', '<g id="frame" transform="translate(10 0)">')), /SVG transform/)
	}
})
