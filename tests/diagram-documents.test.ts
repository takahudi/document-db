import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDocuments, DocumentError, type BodyInput } from '../src/documents.js'
import { parseDiagram, replaceSlotLines, slotText } from '../src/content/diagram.js'
import { parseHtml, serializeHtml } from '../src/content/html.js'
import { diagramFixture, diagramId, figureHtml } from './fixtures/diagrams.js'

test('図の本文HTMLは短い参照で往復し、SVGを含めない', () => {
	const definition = parseDiagram(diagramFixture())
	const body = parseHtml(`<p>説明</p>${figureHtml()}`, [definition])
	const html = serializeHtml(body)
	assert.equal(html, `<p>説明</p>${figureHtml()}`)
	assert.doesNotMatch(html, /<svg|font-family/)
	assert.deepEqual(parseHtml(html, [definition]), body)
	for (const invalid of [figureHtml() + figureHtml(), '<figure data-diagram-id="missing"><figcaption>図</figcaption></figure>', `<figure data-diagram-id="${diagramId}"></figure>`, `<figure data-diagram-id="${diagramId}"><figcaption><strong>図</strong></figcaption></figure>`]) {
		assert.throws(() => parseHtml(invalid, [definition]))
	}
})

test('人間の文字を参照だけの更新で保持し、配置更新・復元・再起動で同じ正本を使う', () => {
	const dataDir = mkdtempSync(join(tmpdir(), 'document-db-diagrams-'))
	const documents = openDocuments({ dataDir })
	const other = openDocuments({ dataDir })
	try {
		const initial = documents.create({ title: '図の文書', body: { kind: 'html', value: figureHtml(), diagrams: [diagramFixture()] } })
		const changed = replaceSlotLines(documents.readDiagram(initial.id, diagramId).diagram, 'auth', 'name', [{ text: '人間の修正', breakBefore: 'none' }])
		const human = documents.update({ id: initial.id, expectedRevision: 1, title: initial.title, body: { kind: 'html', value: initial.html, diagrams: [changed] } })
		assert.equal(human.diagrams[0]?.labels[0]?.slots[0]?.value, '人間の修正')
		const prose = other.update({ id: initial.id, expectedRevision: human.revision, title: initial.title, body: { kind: 'html', value: `<p>AIの文章</p>${human.html}` } })
		assert.deepEqual(other.readDiagram(initial.id, diagramId).diagram, changed)
		const layout = { ...changed, svg: changed.svg.replace('translate(352 48)', 'translate(368 48)') }
		const saved = documents.update({ id: initial.id, expectedRevision: prose.revision, title: initial.title, body: { kind: 'html', value: prose.html, diagrams: [layout] } })
		assert.equal(slotText(documents.readDiagram(initial.id, diagramId).diagram, 'auth', 'name'), '人間の修正')
		assert.throws(() => other.update({ id: initial.id, expectedRevision: prose.revision, title: '古い保存', body: { kind: 'html', value: prose.html } }), (error: unknown) => error instanceof DocumentError && error.kind === 'conflict')
		assert.equal(documents.read(initial.id).revision, saved.revision)
		const restored = documents.restore({ id: initial.id, expectedRevision: saved.revision })
		assert.deepEqual(documents.readDiagram(initial.id, diagramId).diagram, changed)
		documents.close()
		const restarted = openDocuments({ dataDir })
		try { assert.deepEqual(restarted.read(initial.id), restored) } finally { restarted.close() }
	} finally { other.close() }
})

test('未知・重複・未参照・危険な図を拒否して本文・版・直前保存を変更しない', () => {
	const documents = openDocuments({ dataDir: mkdtempSync(join(tmpdir(), 'document-db-diagram-refusal-')) })
	try {
		const definition = diagramFixture()
		const initial = documents.create({ title: '保持', body: { kind: 'html', value: figureHtml(), diagrams: [definition] } })
		const saved = documents.update({ id: initial.id, expectedRevision: 1, title: initial.title, body: { kind: 'html', value: initial.html } })
		const invalidInputs: BodyInput[] = [
			{ kind: 'html' satisfies 'html', value: figureHtml('12b0be7f-cf8c-4d98-bf2e-fdc3ea26e07c') },
			{ kind: 'html' satisfies 'html', value: initial.html, diagrams: [definition, definition] },
			{ kind: 'html' satisfies 'html', value: '<p>図を参照しない</p>', diagrams: [definition] },
			{ kind: 'html' satisfies 'html', value: initial.html, diagrams: [{ ...definition, svg: definition.svg.replace('</svg>', '<script>alert(1)</script></svg>') }] },
		]
		for (const body of invalidInputs) {
			assert.throws(() => documents.update({ id: initial.id, expectedRevision: saved.revision, title: '不正', body }))
			assert.deepEqual(documents.read(initial.id), saved)
		}
		assert.deepEqual(documents.restore({ id: initial.id, expectedRevision: saved.revision }).body, initial.body)
	} finally { documents.close() }
})
