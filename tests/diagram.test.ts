import test from 'node:test'
import assert from 'node:assert/strict'
import { diagramSchema, diagramSummary, diagramViewport, parseDiagram, replaceSlotLines, slotText } from '../src/content/diagram.js'
import { diagramFontFaces, resolveDiagramFontFamily } from '../src/content/diagram-fonts.js'

function fixture() {
	return {
		version: 1, id: 'e8d9d8ad-71cd-4d8b-bf66-88a6e10a8cb9', description: '構成図',
		svg: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220" viewBox="0 0 400 220"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M 0 0 L 6 3 L 0 6 Z" fill="#123456"/></marker></defs><path id="connection" d="M 20 150 C 100 180 200 170 350 150" stroke="#123456" fill="none" marker-end="url(#arrow)"/><g id="label" transform="translate(100 20) rotate(15)"><rect id="box" width="180" height="100" fill="#eee"/><text id="symbol" x="5" y="25" fill="red">●</text><g id="words" class="label"><text x="20" y="25" data-break-before="none">同じ文字</text><text x="20" y="45" data-break-before="soft">日本語</text><text x="20" y="65" data-break-before="hard">next</text></g></g><g id="other"><g id="other-words"><text x="0" y="20" data-break-before="none">同じ文字</text></g></g></svg>',
		css: '.label { font-family: "Noto Sans JP"; font-size: 16px; font-weight: 500; fill: #123456; }',
		labels: [
			{ id: 'a', name: '名称', frame: 'label', slots: [{ id: 'name', name: '本文', element: 'words', region: { x: 20, y: 5, width: 150, height: 90 }, lineHeight: 20, align: 'start' }], decorations: ['symbol'] },
			{ id: 'b', name: '名称', frame: 'other', slots: [{ id: 'name', name: '本文', element: 'other-words', region: { x: 0, y: 0, width: 100, height: 50 }, lineHeight: 20, align: 'start' }], decorations: [] },
		],
	}
}

test('accessible Diagram Design figures retain their image role and local title references', () => {
	const raw = fixture()
	raw.svg = raw.svg.replace('<svg ', '<svg role="img" aria-labelledby="figure-title figure-desc" ').replace('<defs>', '<title id="figure-title">構成図</title><desc id="figure-desc">サービスの関係</desc><defs>')
	const parsed = parseDiagram(raw)
	assert.match(parsed.svg, /role="img" aria-labelledby="figure-title figure-desc"/)
	assert.match(parsed.svg, /<title id="figure-title">構成図<\/title>/)
	assert.throws(() => parseDiagram({ ...raw, svg: raw.svg.replace('figure-title figure-desc', 'missing') }), /参照先/)
	assert.throws(() => parseDiagram({ ...raw, svg: raw.svg.replace('figure-title figure-desc', 'https://example.test/title') }), /読み上げ/)
	assert.throws(() => parseDiagram({ ...raw, svg: raw.svg.replace('role="img"', 'role="button"') }), /role/)
})

test('canonical source owns current text, explicit newlines and duplicate label identity', () => {
	const diagram = parseDiagram(fixture())
	assert.equal(slotText(diagram, 'a', 'name'), '同じ文字日本語\nnext')
	const transparent = fixture(); transparent.svg = transparent.svg.replace('id="words"', 'opacity="0.5" id="words"')
	const changed = replaceSlotLines(parseDiagram(transparent), 'a', 'name', [{ text: 'opacity', breakBefore: 'none' }])
	assert.equal((changed.svg.match(/opacity="0.5"/g) ?? []).length, 1)
	assert.doesNotMatch(changed.svg, /opacity:0.5/)
	assert.equal(slotText(diagram, 'b', 'name'), '同じ文字')
	assert.equal(diagramSummary(diagram).labels[0]?.slots[0]?.value, '同じ文字日本語\nnext')
	assert.deepEqual(diagramViewport(diagram), { width: 400, height: 220 })
	assert.deepEqual(parseDiagram(JSON.parse(JSON.stringify(diagram))), diagram)
	assert.deepEqual(diagramSchema.parse(diagram), diagram)
})

test('replacing lines preserves fixed decorations, shapes, rotation, style and other labels', () => {
	const diagram = parseDiagram(fixture())
	const edited = replaceSlotLines(diagram, 'a', 'name', [
		{ text: '変更 <script> & ', breakBefore: 'none' },
		{ text: 'new', breakBefore: 'soft' },
		{ text: 'line', breakBefore: 'hard' },
	])
	assert.equal(slotText(edited, 'a', 'name'), '変更 <script> & new\nline')
	assert.equal(slotText(edited, 'b', 'name'), '同じ文字')
	assert.match(edited.svg, /transform="translate\(100 20\) rotate\(15\)"/)
	assert.match(edited.svg, /<text id="symbol" x="5" y="25" fill="red">●<\/text>/)
	assert.match(edited.svg, /<path id="connection" d="M 20 150 C 100 180 200 170 350 150" stroke="#123456" fill="none" marker-end="url\(#arrow\)"><\/path>/)
	assert.match(edited.svg, /font-weight:500/)
	assert.match(edited.svg, /font-family:&quot;Noto Sans JP&quot;/)
	assert.match(edited.svg, /y="25"/)
	assert.match(edited.svg, /y="45"/)
	assert.match(edited.svg, /y="65"/)
	assert.doesNotMatch(edited.svg, /<script>/)
	assert.equal(slotText(diagram, 'a', 'name'), '同じ文字日本語\nnext')
})

test('empty slots remain editable and whitespace roundtrips without copied values', () => {
	const empty = replaceSlotLines(parseDiagram(fixture()), 'a', 'name', [])
	assert.equal(slotText(empty, 'a', 'name'), '')
	const edited = replaceSlotLines(empty, 'a', 'name', [{ text: '  a  b  ', breakBefore: 'none' }])
	assert.equal(slotText(edited, 'a', 'name'), '  a  b  ')
	assert.equal(Object.hasOwn(edited.labels[0]?.slots[0] ?? {}, 'value'), false)
	assert.throws(() => replaceSlotLines(edited, 'a', 'name', [{ text: 'a\nb', breakBefore: 'none' }]))
	const styled = fixture(); styled.svg = styled.svg.replace('<g id="other-words">', '<g id="other-words"><!-- style lives on the text -->').replace('x="0" y="20" data-break-before="none"', 'x="0" y="20" font-size="22" fill="blue" data-break-before="none"')
	const blank = replaceSlotLines(parseDiagram(styled), 'b', 'name', [])
	const restored = replaceSlotLines(blank, 'b', 'name', [{ text: 'restored', breakBefore: 'none' }])
	assert.match(restored.svg, /font-size:22px/)
	assert.match(restored.svg, /fill:blue/)
})

test('SVG execution, external resources, malformed XML, reference cycles and invalid geometry are refused', () => {
	const mutations = [
		(svg: string) => svg.replace('<defs>', '<script>alert(1)</script><defs>'),
		(svg: string) => svg.replace('<defs>', '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><defs>'),
		(svg: string) => svg.replace('<defs>', '<animate attributeName="x"/><defs>'),
		(svg: string) => svg.replace('<defs>', '<image href="https://evil.invalid/x"/><defs>'),
		(svg: string) => svg.replace('<defs>', '<use href="https://evil.invalid/x"/><defs>'),
		(svg: string) => svg.replace('<defs>', '<use href="&#106;avascript:alert(1)"/><defs>'),
		(svg: string) => svg.replace('<defs>', '<use href="#missing"/><defs>'),
		(svg: string) => svg.replace('<defs>', '<use href="#label"/><defs>'),
		(svg: string) => svg.replace('<defs>', '<use id="loop" href="#loop"/><defs>'),
		(svg: string) => svg.replace('<defs>', '<g id="recursive"><use href="#recursive"/></g><defs>'),
		(svg: string) => svg.replace('<defs>', '<g id="x"><use href="#y"/></g><g id="y"><use href="#x"/></g><defs>'),
		(svg: string) => svg.replace('<defs>', '<g onload="alert(1)"/><defs>'),
		(svg: string) => svg.replace('width="400"', 'width="400" width="2"'),
		(svg: string) => svg.replace('id="other"', 'id="words"'),
		(svg: string) => svg.replace('translate(100 20)', 'translate(NaN 20)'),
		(svg: string) => svg.replace('M 20 150', 'M 1e999 150'),
		(svg: string) => svg.replace('M 20 150', 'M 20'),
		(svg: string) => svg.replace('</svg>', '<text x="0" y="0">unowned</text></svg>'),
		(svg: string) => `<!DOCTYPE svg [<!ENTITY leak SYSTEM "file:///secret">]>${svg}`,
		(svg: string) => `<?xml-stylesheet href="https://evil.invalid/a.css"?>${svg}`,
		(svg: string) => svg.replace('http://www.w3.org/2000/svg', 'https://evil.invalid/svg'),
	]
	for (const mutate of mutations) { const raw = fixture(); raw.svg = mutate(raw.svg); assert.throws(() => parseDiagram(raw), /図/) }
})

test('CSS syntax, escaped identifiers, URLs and all non-presentation declarations are checked', () => {
	const rejected = [
		'@import "https://evil.invalid/style";', '@font-face{font-family:x;src:url(x)}',
		'.label{background:url(https://evil.invalid/x)}', '.label{fill:url(https://evil.invalid/x)}',
		'.label{fill:u\\72l(https://evil.invalid/x)}', '.label{fill:url(\\23missing)}',
		'.label{b\\61ckground:red}', '.label{fill:var(--paint)}', '.label{fill:expression(alert(1))}',
		'.label{font-family:"Uninstalled Font"}', '.label{font-weight:900}', '.label{font-size:1em}',
		'.label{stroke-width:1e999px}', '.label{fill:red!important}', '.label:hover{fill:red}',
		'.label{--fill:red}', '.label{fill:}', '.label{fill:red; garbage}',
	]
	for (const css of rejected) assert.throws(() => parseDiagram({ ...fixture(), css }), /図/)
	const diagram = parseDiagram({ ...fixture(), css: '.l\\61 bel{f\\69ll:#123456;font-family:sans-serif;font-size:16px}' })
	assert.match(diagram.css, /fill:#123456/)
	assert.match(diagram.css, /"Geist","Noto Sans JP"/)
})

test('manifest refuses unknown, duplicate and overlapping ownership and mixed editable styles', () => {
	const unknown = fixture(); unknown.labels[0]?.slots.push({ id: 'unknown', name: '', element: 'absent', region: { x: 0, y: 0, width: 1, height: 1 }, lineHeight: 1, align: 'start' })
	assert.throws(() => parseDiagram(unknown))
	const duplicate = fixture(); if (duplicate.labels[0]) duplicate.labels.push(duplicate.labels[0])
	assert.throws(() => parseDiagram(duplicate))
	const overlap = fixture(); overlap.labels[0]?.decorations.push('label')
	assert.throws(() => parseDiagram(overlap))
	const mixed = fixture(); mixed.svg = mixed.svg.replace('x="20" y="45"', 'x="20" y="45" fill="red"')
	assert.throws(() => parseDiagram(mixed))
	assert.throws(() => parseDiagram({ ...fixture(), extra: true }))
})

test('effective CSS font combinations are validated and catalog includes local Japanese and serif italic', () => {
	assert.throws(() => parseDiagram({ ...fixture(), css: 'g.label{font-family:"Instrument Serif";font-weight:600}' }))
	assert.throws(() => parseDiagram({ ...fixture(), css: '.label{font-family:"Noto Sans JP";font-style:italic}' }))
	assert.ok(diagramFontFaces.some(face => face.family === 'Noto Sans JP' && face.weight === 700))
	assert.ok(diagramFontFaces.some(face => face.family === 'Instrument Serif' && face.style === 'italic'))
	assert.deepEqual(resolveDiagramFontFamily('monospace'), ['Geist Mono', 'Noto Sans JP'])
	assert.throws(() => resolveDiagramFontFamily('__proto__'))
})

test('SVG-only presentation keywords and browser CSS specificity keep valid font styles', () => {
	const classes = '.label'.repeat(101)
	assert.doesNotThrow(() => parseDiagram({ ...fixture(), css: `#words{font-family:"Instrument Serif","Noto Sans JP";font-weight:400}${classes}{font-weight:600}` }))
	assert.doesNotThrow(() => parseDiagram({ ...fixture(), css: 'svg{color-interpolation:sRGB;color-interpolation-filters:linearRGB;alignment-baseline:auto}' }))
	assert.throws(() => parseDiagram({ ...fixture(), css: 'svg{color-interpolation:unknown}' }))
	assert.throws(() => parseDiagram({ ...fixture(), svg: fixture().svg.replace('width="400"', 'width="0"') }))
	assert.match(parseDiagram(fixture()).svg, /font-family="&quot;Geist&quot;,&quot;Noto Sans JP&quot;"/)
})

test('Japanese text requires its local glyph family instead of falling back to system fonts', () => {
	assert.throws(() => parseDiagram({ ...fixture(), css: '.label{font-family:Geist}' }), /Noto Sans JP/)
	assert.doesNotThrow(() => parseDiagram({ ...fixture(), css: '.label{font-family:Geist,"Noto Sans JP"}' }))
})
