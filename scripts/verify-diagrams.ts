import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'
import { projectDir } from '../src/config.js'
import { diagramSchema, slotText } from '../src/content/diagram.js'
import { chartFixture, diagramFixture, diagramId, figureHtml } from '../tests/fixtures/diagrams.js'
import { convertGeneratedDiagram, conversionManifestSchema } from '../src/diagram-conversion.js'

const dataDir = await mkdtemp(join(tmpdir(), 'document-db-diagrams-'))
const artifacts = join(projectDir, 'verification-artifacts', 'diagrams')
await mkdir(artifacts, { recursive: true })
const savedSchema = z.object({ id: z.string().uuid(), revision: z.number() })
const docSchema = z.object({ id: z.string().uuid(), revision: z.number(), title: z.string(), html: z.string(), diagrams: z.array(z.object({ id: z.string(), description: z.string(), labels: z.array(z.object({ id: z.string(), slots: z.array(z.object({ id: z.string(), value: z.string() })) })) })) })
const fullSchema = z.object({ id: z.string().uuid(), revision: z.number(), diagram: diagramSchema })
let http: ChildProcess | undefined
let client = new Client({ name: 'diagram-verification', version: '1.0.0' })
async function launchHttp() {
	const child = spawn(process.execPath, ['--import', 'tsx', join(projectDir, 'src/http.ts'), '--data-dir', dataDir, '--port', '0'], { cwd: projectDir, stdio: ['ignore', 'ignore', 'pipe'] })
	http = child
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('HTTP起動が時間切れです。')), 15000)
		child.on('error', error => { clearTimeout(timer); reject(error) })
		child.on('exit', code => { clearTimeout(timer); reject(new Error(`HTTPが終了しました。${code}`)) })
		child.stderr?.on('data', (chunk: Buffer) => {
			const match = /http:\/\/127\.0\.0\.1:\d+/.exec(chunk.toString())
			if (match) { clearTimeout(timer); resolve(match[0]) } else process.stderr.write(chunk)
		})
	})
}
async function stopHttp() {
	if (http && http.exitCode === null) { const exited = once(http, 'exit'); http.kill(); await exited }
}
async function connectMcp() {
	const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', pathToFileURL(join(projectDir, 'node_modules/tsx/dist/loader.mjs')).href, join(projectDir, 'src/mcp.ts'), '--data-dir', dataDir], cwd: tmpdir(), stderr: 'pipe' })
	transport.stderr?.on('data', chunk => process.stderr.write(chunk))
	await client.connect(transport)
}
async function tool(name: string, args: Record<string, unknown>, expectError = false): Promise<unknown> {
	const reply = await client.callTool({ name, arguments: args })
	assert.equal(reply.isError === true, expectError, JSON.stringify(reply))
	const content = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })) }).parse(reply).content[0]
	assert.ok(content)
	return JSON.parse(content.text)
}
const browser = await chromium.launch({ executablePath: process.env.DOCUMENT_DB_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors: string[] = [], externalRequests: string[] = []
page.on('pageerror', error => errors.push(error.message))
let base = ''
await page.route('**/*', async route => {
	if (route.request().url().startsWith(`${base}/`)) await route.continue()
	else { externalRequests.push(route.request().url()); await route.abort() }
})
try {
	base = await launchHttp()
	await connectMcp()
	const secondId = 'e949c11d-5d46-4720-ac2a-6d3444a95f15'
	const created = savedSchema.parse(await tool('create_document', { title: '図の検証', html: `<h1>図の編集</h1><p>周囲の本文</p>${figureHtml()}${figureHtml(secondId)}`, diagrams: [diagramFixture(), diagramFixture(secondId)] }))
	await page.goto(base)
	await page.getByRole('button', { name: '図の検証', exact: false }).click()
	const input = page.getByRole('textbox', { name: '図内の文字 名称', exact: true }).first()
	await input.waitFor()
	assert.equal(await input.inputValue(), '認証サービス')
	await input.fill('人間の修正')
	await page.getByRole('button', { name: '文字を適用', exact: true }).first().click()
	await page.waitForFunction(() => !document.querySelector('.diagram-draft-notice'))
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('保存しました。', { exact: true }).waitFor()
	let doc = docSchema.parse(await tool('get_document', { id: created.id }))
	assert.equal(doc.diagrams[0]?.labels[0]?.slots[0]?.value, '人間の修正')
	assert.equal(doc.diagrams[0]?.labels[1]?.slots[0]?.value, '認証サービス')
	assert.doesNotMatch(doc.html, /<svg|font-family/)
	let full = fullSchema.parse(await tool('get_diagram', { id: created.id, diagramId }))
	assert.equal(slotText(full.diagram, 'auth', 'name'), '人間の修正')
	assert.match(full.diagram.svg, /auth-dot/)
	assert.match(full.diagram.svg, /●/)
	await page.locator('.tiptap > p').first().click()
	await page.keyboard.press('Home'); await page.keyboard.insertText('同じ版で破棄する本文 ')
	page.once('dialog', dialog => { void dialog.accept() })
	await page.getByRole('button', { name: '最新を読み直す', exact: true }).click()
	await page.getByText('最新の文書を読み込みました。', { exact: true }).waitFor()
	assert.doesNotMatch(await page.locator('.tiptap > p').first().innerText(), /同じ版で破棄する本文/)
	await input.fill('')
	await page.getByRole('button', { name: '文字を適用', exact: true }).first().click()
	await page.waitForFunction(() => !document.querySelector('.diagram-draft-notice'))
	assert.equal(await input.inputValue(), '')
	await input.fill('認証\n保存')
	await page.getByRole('button', { name: '文字を適用', exact: true }).first().click()
	await page.waitForFunction(() => !document.querySelector('.diagram-draft-notice'))
	assert.equal(await input.inputValue(), '認証\n保存')

	await input.fill('認証サービスと保存サービスの関係を説明')
	await page.getByRole('button', { name: '文字を適用', exact: true }).first().click()
	await page.waitForFunction(() => !document.querySelector('.diagram-draft-notice'))
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('保存しました。', { exact: true }).waitFor()
	full = fullSchema.parse(await tool('get_diagram', { id: created.id, diagramId }))
	assert.equal(slotText(full.diagram, 'auth', 'name'), '認証サービスと保存サービスの関係を説明')
	assert.match(full.diagram.svg, /data-break-before="soft"/)
	const beforeOverflow = full.diagram
	const overflow = '枠を越える長い説明'.repeat(80)
	await input.fill(overflow)
	await page.getByRole('button', { name: '文字を適用', exact: true }).first().click()
	await page.locator('.diagram-controls .inline-error').first().waitFor()
	assert.match(await page.locator('.diagram-controls .inline-error').first().innerText(), /収ま|枠|領域/)
	await page.locator('.tiptap > p').first().click()
	await page.keyboard.press('Home'); await page.keyboard.insertText('本文だけ保存 ')
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('本文を保存しました。図の未適用入力は保存していません。', { exact: true }).waitFor()
	assert.equal(await input.inputValue(), overflow)
	assert.deepEqual(fullSchema.parse(await tool('get_diagram', { id: created.id, diagramId })).diagram, beforeOverflow)
	page.once('dialog', dialog => { void dialog.dismiss() })
	await page.getByRole('button', { name: '最新を読み直す', exact: true }).click()
	assert.equal(await input.inputValue(), overflow)

	doc = docSchema.parse(await tool('get_document', { id: created.id }))
	await tool('update_document', { id: created.id, revision: doc.revision, title: doc.title, html: doc.html.replace('本文だけ保存', 'AIの本文') })
	assert.deepEqual(fullSchema.parse(await tool('get_diagram', { id: created.id, diagramId })).diagram, beforeOverflow)
	await page.locator('.tiptap > p').first().click()
	await page.keyboard.press('Home'); await page.keyboard.insertText('競合ドラフト ')
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByRole('alert').filter({ hasText: '文書が更新されています' }).waitFor()
	assert.equal(await input.inputValue(), overflow)
	assert.match(await page.locator('.tiptap > p').first().innerText(), /競合ドラフト/)
	await page.getByRole('button', { name: '未適用の入力を破棄', exact: true }).first().click()
	page.once('dialog', dialog => { void dialog.accept() })
	await page.getByRole('button', { name: '最新を読み直す', exact: true }).click()
	await page.getByText('最新の文書を読み込みました。', { exact: true }).waitFor()
	doc = docSchema.parse(await tool('get_document', { id: created.id }))
	const changedLayout = { ...beforeOverflow, svg: beforeOverflow.svg.replace('translate(352 48)', 'translate(368 48)') }
	await tool('update_document', { id: created.id, revision: doc.revision, title: doc.title, html: doc.html, diagrams: [changedLayout] })
	await page.getByRole('button', { name: '最新を読み直す', exact: true }).click()
	await page.getByText('最新の文書を読み込みました。', { exact: true }).waitFor()
	assert.equal(await input.inputValue(), '認証サービスと保存サービスの関係を説明')
	assert.match(fullSchema.parse(await tool('get_diagram', { id: created.id, diagramId })).diagram.svg, /translate\(368 48\)/)
	await page.getByRole('button', { name: '直前の保存に戻す', exact: true }).click()
	await page.getByText('直前の保存状態に戻しました。', { exact: true }).waitFor()
	assert.deepEqual(fullSchema.parse(await tool('get_diagram', { id: created.id, diagramId })).diagram, beforeOverflow)

	doc = docSchema.parse(await tool('get_document', { id: created.id }))
	for (const diagrams of [
		[{ ...diagramFixture(), svg: diagramFixture().svg.replace('</svg>', '<script>alert(1)</script></svg>') }],
		[{ ...diagramFixture(), css: '@import url("https://example.test/unsafe.css");' }],
		[{ ...diagramFixture(), css: 'text { font-family: UnknownFont; }' }],
	]) {
		await tool('update_document', { id: created.id, revision: doc.revision, title: '不正更新', html: doc.html, diagrams }, true)
		assert.deepEqual(docSchema.parse(await tool('get_document', { id: created.id })), doc)
	}
	assert.equal(await page.locator('iframe').count(), 2)
	const paragraphSize = await page.locator('.tiptap > p').first().evaluate(element => getComputedStyle(element).fontSize)
	assert.equal(paragraphSize, '14px')
	await page.screenshot({ path: join(artifacts, 'diagram-edit.png'), fullPage: true })
	await page.setViewportSize({ width: 390, height: 900 })
	const scrolling = await page.locator('.diagram-viewport').first().evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }))
	assert.ok(scrolling.scroll > scrolling.width)
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
	await page.setViewportSize({ width: 1440, height: 1000 })
	assert.deepEqual(externalRequests, [])
	assert.deepEqual(errors, [])

	await client.close(); await stopHttp()
	base = await launchHttp()
	client = new Client({ name: 'diagram-restart-verification', version: '1.0.0' })
	await connectMcp()
	assert.deepEqual(docSchema.parse(await tool('get_document', { id: created.id })), doc)
	await page.goto(base)
	await page.getByRole('button', { name: '図の検証', exact: false }).click()
	await input.waitFor()
	await input.fill('再起動後の日本語')
	await page.getByRole('button', { name: '文字を適用', exact: true }).first().click()
	await page.waitForFunction(() => !document.querySelector('.diagram-draft-notice'))
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('保存しました。', { exact: true }).waitFor()
	assert.equal(fullSchema.parse(await tool('get_diagram', { id: created.id, diagramId })).diagram.labels.length, 2)
	assert.equal(slotText(fullSchema.parse(await tool('get_diagram', { id: created.id, diagramId })).diagram, 'auth', 'name'), '再起動後の日本語')
	await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#auth-name text')?.textContent === '再起動後の日本語')
	await page.evaluate(async () => { const doc = document.querySelector('iframe')?.contentDocument; if (doc) await doc.fonts.ready })
	assert.deepEqual(externalRequests, [])
	const chart = chartFixture()
	const svg = chart.svg
	const chartDefinition = { version: chart.version, id: chart.id, description: chart.description, labels: chart.labels }
	const convertedChart = await convertGeneratedDiagram({ html: `<html><body><h2 id="intro">グラフ</h2>${svg}</body></html>`, manifest: { version: 1, proseIds: ['intro'], diagrams: [{ sourceSvgId: 'chart', definition: chartDefinition }] }, title: '変換グラフ' })
	const importedChart = savedSchema.parse(await tool('create_document', convertedChart))
	await page.getByRole('button', { name: '文書一覧を更新', exact: true }).click()
	await page.getByRole('button', { name: '変換グラフ', exact: false }).click()
	const chartInput = page.locator('.diagram-controls textarea').first()
	await chartInput.fill('150')
	await page.getByRole('button', { name: '文字を適用', exact: true }).click()
	await page.waitForFunction(() => !document.querySelector('.diagram-draft-notice'))
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('保存しました。', { exact: true }).waitFor()
	let chartFull = fullSchema.parse(await tool('get_diagram', { id: importedChart.id, diagramId: chart.id }))
	assert.equal(slotText(chartFull.diagram, 'metric', 'value'), '150')
	assert.match(chartFull.diagram.svg, /height="140"/)
	await page.getByRole('combobox', { name: '図のラベル', exact: true }).selectOption('axis')
	await chartInput.fill('処理量（件）')
	await page.getByRole('button', { name: '文字を適用', exact: true }).click()
	await page.waitForFunction(() => !document.querySelector('.diagram-draft-notice'))
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('保存しました。', { exact: true }).waitFor()
	chartFull = fullSchema.parse(await tool('get_diagram', { id: importedChart.id, diagramId: chart.id }))
	assert.equal(slotText(chartFull.diagram, 'axis', 'title'), '処理量（件）')
	assert.match(chartFull.diagram.svg, /rotate\(-90\)/)
	assert.match(chartFull.diagram.svg, /●/)
	const chartDocument = docSchema.parse(await tool('get_document', { id: importedChart.id }))
	await tool('update_document', { id: importedChart.id, revision: chartDocument.revision, title: chartDocument.title, html: chartDocument.html, diagrams: [{ ...chartFull.diagram, svg: chartFull.diagram.svg.replace('height="140"', 'height="150"') }] })
	await page.getByRole('button', { name: '最新を読み直す', exact: true }).click()
	await page.getByText('最新の文書を読み込みました。', { exact: true }).waitFor()
	assert.match(fullSchema.parse(await tool('get_diagram', { id: importedChart.id, diagramId: chart.id })).diagram.svg, /height="150"/)
	await page.screenshot({ path: join(artifacts, 'converted-chart.png'), fullPage: true })
	const generated = await readFile(join(projectDir, 'tests/fixtures/diagram-generated.html'), 'utf8')
	const labelManifest = conversionManifestSchema.parse(JSON.parse(await readFile(join(projectDir, 'tests/fixtures/diagram-generated.labels.json'), 'utf8')))
	const sourceEntry = labelManifest.diagrams[0], sourceMapping = sourceEntry?.sources[0]
	assert.ok(sourceMapping)
	sourceMapping.kind = 'html-text'
	const htmlLabel = generated.replace('<text id="source-label" class="label" x="30" y="60">保存する</text>', '<foreignObject id="source-label" x="30" y="30" width="200" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Noto Sans JP;font-size:16px;line-height:24px;color:#224466">保存する</div></foreignObject>')
	const convertedHtml = await convertGeneratedDiagram({ html: htmlLabel, manifest: labelManifest, title: 'HTML変換の検証' })
	const importedHtml = savedSchema.parse(await tool('create_document', convertedHtml))
	await page.getByRole('button', { name: '文書一覧を更新', exact: true }).click()
	await page.getByRole('button', { name: 'HTML変換の検証', exact: false }).click()
	await page.locator('.diagram-controls textarea').first().fill('HTMLから修正')
	await page.getByRole('button', { name: '文字を適用', exact: true }).click()
	await page.waitForFunction(() => !document.querySelector('.diagram-draft-notice'))
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('保存しました。', { exact: true }).waitFor()
	assert.equal(slotText(fullSchema.parse(await tool('get_diagram', { id: importedHtml.id, diagramId: sourceEntry.definition.id })).diagram, 'save', 'caption'), 'HTMLから修正')
	await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#save-slot text')?.textContent === 'HTMLから修正')
	await page.evaluate(async () => { const doc = document.querySelector('iframe')?.contentDocument; if (doc) await doc.fonts.ready })
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
	await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
	const remote = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("iframe").contentDocument.querySelector("#save-slot text")' })
	assert.ok(remote.result.objectId)
	const fontNode = await cdp.send('DOM.requestNode', { objectId: remote.result.objectId })
	const platformFonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: fontNode.nodeId })
	assert.ok(platformFonts.fonts.length)
	assert.ok(platformFonts.fonts.every(font => font.isCustomFont), JSON.stringify(platformFonts.fonts))
	await cdp.detach()
	assert.deepEqual(errors, [])
	assert.deepEqual(externalRequests, [])
	await writeFile(join(artifacts, 'result.json'), JSON.stringify({ dataDir, verified: ['MCP create/get/ref-only update/layout update', 'human labels and duplicate identity', 'local-font wrapping', 'overflow input survives body save and conflict', 'restore and restart', 'invalid input non-save', 'iframe isolation and mobile scrolling', 'external network blocked', 'converter to MCP to browser to AI update', 'chart values do not resize bars on human edit', 'rotated labels retain decoration', 'plain HTML labels convert and remain editable'], pageErrors: errors, externalRequests, platformFonts: platformFonts.fonts }, null, 2))
	process.stdout.write(`Diagram verification passed. Artifacts: ${artifacts}\n`)
} catch (error) {
	process.stderr.write(`Diagram alerts: ${JSON.stringify(await page.locator('.diagram-controls .inline-error').allTextContents())}\n`)
	process.stderr.write(`Diagram controls: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.diagram-figure')].map(figure => ({ attributes: Object.fromEntries([...figure.attributes].filter(attribute => attribute.name.startsWith('data-')).map(attribute => [attribute.name, attribute.value])), buttons: [...figure.querySelectorAll('button')].map(button => ({ text: button.textContent, disabled: button.disabled })), notice: document.querySelector('.diagram-draft-notice')?.textContent }))))}\n`)
	process.stderr.write(`Diagram frames: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('iframe')].map(frame => ({ srcdoc: frame.srcdoc.length, connected: frame.isConnected, src: frame.src, url: frame.contentDocument?.URL, ready: frame.contentDocument?.readyState, sheets: frame.contentDocument?.styleSheets.length, body: frame.contentDocument?.body?.innerHTML.slice(0, 700) }))))}\n`)
	await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true })
	await writeFile(join(artifacts, 'result.json'), JSON.stringify({ status: 'failed', message: error instanceof Error ? error.message : String(error), dataDir, pageErrors: errors, externalRequests }, null, 2))
	throw error
} finally {
	await browser.close(); await client.close(); await stopHttp()
}
