import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { encode } from 'gpt-tokenizer'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'
import { projectDir } from '../src/config.js'

const dataDir = await mkdtemp(join(tmpdir(), 'document-db-mvp-'))
const artifacts = join(projectDir, 'verification-artifacts')
await mkdir(artifacts, { recursive: true })
const sample = '<h1>文書庫の使い方</h1><h2>本文の編集</h2><h3>保存する</h3><p>本文 <strong>太字</strong> <em>斜体</em><br><a href="https://example.test/help?q=a&amp;lang=ja">手順</a></p><ul><li><p>項目</p><ol><li><p>番号項目</p></li></ol></li></ul><table><tbody><tr><th><p>操作</p></th><th><p>結果</p></th></tr><tr><td><p>保存</p></td><td><p>確定</p></td></tr></tbody></table><pre><code>\n  &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp;\n&lt;/code&gt;\n</code></pre>'
let http: ChildProcess | undefined
async function launchHttp() {
	const child = spawn(process.execPath, ['--import', 'tsx', join(projectDir, 'src/http.ts'), '--data-dir', dataDir, '--port', '0'], { cwd: projectDir, stdio: ['ignore', 'ignore', 'pipe'] })
	http = child
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => { reject(new Error('HTTP 起動が時間切れです。')) }, 15000)
		child.on('error', error => { clearTimeout(timer); reject(error) })
		child.on('exit', code => { clearTimeout(timer); reject(new Error(`HTTP が終了しました。${code}`)) })
		child.stderr?.on('data', (chunk: Buffer) => {
			const match = /http:\/\/127\.0\.0\.1:\d+/.exec(chunk.toString())
			if (match) { clearTimeout(timer); resolve(match[0]) }
			else process.stderr.write(chunk)
		})
	})
}
async function stopHttp() { if (http && http.exitCode === null) { const exited = once(http, 'exit'); http.kill(); await exited } }
const client = new Client({ name: 'mvp-verification', version: '1.0.0' })
const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', pathToFileURL(join(projectDir, 'node_modules/tsx/dist/loader.mjs')).href, join(projectDir, 'src/mcp.ts'), '--data-dir', dataDir], cwd: tmpdir(), stderr: 'pipe' })
transport.stderr?.on('data', chunk => { process.stderr.write(chunk) })
const docSchema = z.object({ id: z.string().uuid(), revision: z.number(), title: z.string(), html: z.string() })
const savedSchema = z.object({ id: z.string().uuid(), revision: z.number() })
async function tool(name: string, args: Record<string, unknown> = {}, expectError = false): Promise<unknown> {
	const reply = await client.callTool({ name, arguments: args })
	assert.equal(reply.isError === true, expectError, JSON.stringify(reply))
	const parsed = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })) }).parse(reply)
	const text = parsed.content[0]?.text
	assert.ok(text)
	return JSON.parse(text)
}
const browser = await chromium.launch({ executablePath: process.env.DOCUMENT_DB_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors: string[] = []
page.on('pageerror', error => { pageErrors.push(error.message); process.stderr.write(`Browser error ${error.stack}\n`) })
try {
	let base = await launchHttp()
	await client.connect(transport)
	assert.equal((await client.listTools()).tools.length, 4)
	await page.goto(base)
	await page.getByRole('heading', { name: '考えを、文書に。' }).waitFor()
	await page.screenshot({ path: join(artifacts, 'empty.png'), fullPage: true })
	const created = savedSchema.parse(await tool('create_document', { title: '文書庫の使い方', html: sample }))
	await page.getByRole('button', { name: '文書一覧を更新' }).click()
	await page.getByRole('button', { name: '文書庫の使い方', exact: false }).click()
	await page.getByRole('textbox', { name: '文書のタイトル' }).waitFor()
	assert.equal(await page.locator('.tiptap pre code').textContent(), '\n  <script>alert("x")</script> &\n</code>\n')
	await page.locator('.tiptap > p').first().click()
	await page.keyboard.press('Home'); await page.keyboard.insertText('人間の追記 ')
	await page.locator('.tiptap td p').first().click()
	await page.keyboard.press('End'); await page.keyboard.insertText(' 人間セル')
	await page.getByRole('button', { name: '行を追加', exact: true }).click()
	await page.locator('.tiptap tr').last().locator('td').first().click()
	await page.getByRole('button', { name: '行を削除', exact: true }).click()
	await page.locator('.tiptap td').first().click()
	await page.getByRole('button', { name: '列を追加', exact: true }).click()
	await page.locator('.tiptap tr').last().locator('td').nth(1).click()
	await page.getByRole('button', { name: '列を削除', exact: true }).click()
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('保存しました。', { exact: true }).waitFor()
	const human = docSchema.parse(await tool('get_document', { id: created.id }))
	assert.match(human.html, /人間の追記/); assert.match(human.html, /人間セル/)
	assert.equal((human.html.match(/<tr>/g) ?? []).length, 2)
	assert.equal((human.html.match(/<t[hd]>/g) ?? []).length, 4)
	const png = await page.screenshot()
	await page.locator('.tiptap').click(); await page.keyboard.press('Control+End')
	await page.getByLabel('画像ファイル').setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: png })
	await page.getByLabel('画像の説明文', { exact: true }).fill('設定 & 保存 "完了"')
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByText('保存しました。', { exact: true }).waitFor()
	const withImage = docSchema.parse(await tool('get_document', { id: created.id }))
	assert.match(withImage.html, /alt="設定 &amp; 保存 &quot;完了&quot;"/)
	const imageRef = /asset:([a-f0-9-]+)/.exec(withImage.html)?.[1]
	assert.ok(imageRef)
	assert.deepEqual(Buffer.from(await (await fetch(`${base}/api/assets/${imageRef}`)).arrayBuffer()), png)
	const race = savedSchema.parse(await tool('create_document', { title: '競合検証', html: '<p>初期</p>' }))
	const raceBody: unknown = await (await fetch(`${base}/api/documents/${race.id}`)).json()
	const raceSnapshot = z.object({ body: z.unknown() }).parse(raceBody)
	const [httpRace, mcpRace] = await Promise.all([
		fetch(`${base}/api/documents/${race.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1, title: 'HTTP', body: raceSnapshot.body }) }),
		client.callTool({ name: 'update_document', arguments: { id: race.id, revision: 1, title: 'MCP', html: '<p>初期</p>' } }),
	])
	assert.equal(Number(httpRace.ok) + Number(mcpRace.isError !== true), 1)
	if (!httpRace.ok) assert.equal(httpRace.status, 409)
	else assert.match(JSON.stringify(mcpRace), /conflict/)
	const raceSaved = docSchema.parse(await tool('get_document', { id: race.id }))
	assert.equal(raceSaved.revision, 2)
	const raceRestore = await fetch(`${base}/api/documents/${race.id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2 }) })
	assert.equal(z.object({ title: z.string() }).parse(await raceRestore.json()).title, '競合検証')
	const afterAI = withImage.html.replace('人間の追記', 'AI の追記')
	await tool('update_document', { id: created.id, revision: withImage.revision, title: withImage.title, html: afterAI })
	await page.getByRole('button', { name: '最新を読み直す' }).click()
	await page.getByText('最新の文書を読み込みました。', { exact: true }).waitFor()
	assert.match(await page.locator('.tiptap').innerText(), /AI の追記/)
	assert.equal(await page.locator('.tiptap img').getAttribute('alt'), '設定 & 保存 "完了"')
	const beforeRestore = docSchema.parse(await tool('get_document', { id: created.id }))
	const staleRestore = await fetch(`${base}/api/documents/${created.id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: beforeRestore.revision - 1 }) })
	assert.equal(staleRestore.status, 409)
	await page.getByRole('button', { name: '直前の保存に戻す' }).click()
	await page.getByText('直前の保存状態に戻しました。', { exact: true }).waitFor()
	const restored = docSchema.parse(await tool('get_document', { id: created.id }))
	assert.equal(restored.html, withImage.html); assert.equal(restored.revision, beforeRestore.revision + 1)
	const repeated = await fetch(`${base}/api/documents/${created.id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: restored.revision }) })
	assert.equal(repeated.status, 400)
	for (const invalid of ['<p style="color:red">欠落</p>', '<p><a href="https://safe.test" href="javascript:x">重複</a></p>', '<p><a href="jav&#x61;script:x">不正</a></p>', '<p>前<s>削除</s>後</p>', '<img src="asset:22222222-2222-4222-8222-222222222222" alt="未登録">']) {
		const error = z.object({ kind: z.string() }).parse(await tool('update_document', { id: created.id, revision: restored.revision, title: '不正更新', html: invalid }, true))
		assert.equal(error.kind, 'invalid'); assert.deepEqual(await tool('get_document', { id: created.id }), restored)
	}
	const unknownJson = await fetch(`${base}/api/documents/${created.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: restored.revision, title: '不正', body: { type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'red' } }] } }) })
	assert.equal(unknownJson.status, 400); assert.deepEqual(await tool('get_document', { id: created.id }), restored)
	await page.locator('.tiptap > p').first().click(); await page.keyboard.press('Home'); await page.keyboard.insertText('保持するドラフト ')
	const draftText = await page.locator('.tiptap').innerText()
	await page.route('**/api/documents/*', async route => { if (route.request().method() === 'PUT') await route.abort('failed'); else await route.continue() })
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByRole('alert').waitFor()
	assert.match(await page.getByRole('alert').innerText(), /接続できません/)
	assert.equal(await page.locator('.tiptap').innerText(), draftText)
	assert.deepEqual(await tool('get_document', { id: created.id }), restored)
	await page.unroute('**/api/documents/*')
	page.once('dialog', dialog => { void dialog.dismiss() })
	await page.getByRole('button', { name: '最新を読み直す' }).click()
	assert.equal(await page.locator('.tiptap').innerText(), draftText)
	await page.route('**/api/documents/*', async route => { if (route.request().method() === 'GET') await route.abort('failed'); else await route.continue() })
	page.once('dialog', dialog => { void dialog.accept() })
	await page.getByRole('button', { name: '最新を読み直す' }).click()
	await page.getByRole('alert').waitFor()
	assert.match(await page.getByRole('alert').innerText(), /接続できません/)
	assert.equal(await page.locator('.tiptap').innerText(), draftText)
	await page.unroute('**/api/documents/*')
	await tool('update_document', { id: created.id, revision: restored.revision, title: restored.title, html: afterAI })
	await page.getByRole('button', { name: '保存', exact: true }).click()
	await page.getByRole('alert').waitFor()
	assert.equal(await page.locator('.tiptap').innerText(), draftText)
	await page.screenshot({ path: join(artifacts, 'conflict.png'), fullPage: true })
	page.once('dialog', dialog => { void dialog.accept() })
	await page.getByRole('button', { name: '最新を読み直す' }).click()
	await page.getByText('最新の文書を読み込みました。', { exact: true }).waitFor()
	const latest = docSchema.parse(await tool('get_document', { id: created.id }))
	assert.match(latest.html, /AI の追記/); assert.match(latest.html, /人間セル/)
	for (const preserved of ['<h1>文書庫の使い方</h1>', '<h2>本文の編集</h2>', '<h3>保存する</h3>', '<strong>太字</strong>', '<em>斜体</em>', '<ul><li><p>項目</p><ol><li><p>番号項目</p>', '<th><p>操作</p></th><th><p>結果</p></th>', 'href="https://example.test/help?q=a&amp;lang=ja"', `src="asset:${imageRef}"`]) assert.ok(latest.html.includes(preserved), preserved)
	const uiHtml = await page.content()
	await writeFile(join(artifacts, 'ui.html'), uiHtml)
	await writeFile(join(artifacts, 'mcp.html'), latest.html)
	const measurement = { tokenizer: 'gpt-tokenizer 4.0.0 default encoding', uiTokens: encode(uiHtml).length, mcpTokens: encode(latest.html).length, meaningChecks: ['見出し三段階', '装飾と改行', 'リスト', '表と人間セル', 'HTTP リンク', 'コード全文', '画像説明と参照'], dataDir }
	assert.ok(measurement.uiTokens > measurement.mcpTokens)
	assert.equal(await page.locator('.tiptap pre code').textContent(), '\n  <script>alert("x")</script> &\n</code>\n')
	await page.screenshot({ path: join(artifacts, 'document.png'), fullPage: true })
	await writeFile(join(artifacts, 'measurement.json'), JSON.stringify(measurement, null, 2))
	await client.close(); await stopHttp()
	base = await launchHttp()
	const restartedClient = new Client({ name: 'restart-verification', version: '1.0.0' })
	await restartedClient.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp.ts', '--data-dir', dataDir], cwd: projectDir }))
	const restarted = await restartedClient.callTool({ name: 'get_document', arguments: { id: created.id } })
	const restartedText = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })) }).parse(restarted).content[0]?.text
	assert.ok(restartedText); assert.deepEqual(JSON.parse(restartedText), latest)
	assert.deepEqual(Buffer.from(await (await fetch(`${base}/api/assets/${imageRef}`)).arrayBuffer()), png)
	await page.goto(base); await page.getByRole('button', { name: latest.title, exact: false }).click(); await page.locator('.tiptap img').waitFor()
	assert.equal(await page.locator('.tiptap img').getAttribute('alt'), '設定 & 保存 "完了"')
	await restartedClient.close()
	assert.deepEqual(pageErrors, [])
	process.stderr.write(`MVP verification passed. ${JSON.stringify(measurement)}\n`)
} catch (error) {
	await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true })
	await writeFile(join(artifacts, 'failure.html'), await page.content())
	throw error
} finally { await client.close(); await stopHttp(); await browser.close() }
