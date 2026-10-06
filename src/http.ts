import express from 'express'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { z } from 'zod'
import { openDocuments, DocumentError, ContentError } from './documents.js'
import { dataDirectory, projectDir, serverPort } from './config.js'

const documents = openDocuments({ dataDir: dataDirectory() })
const app = express()
app.disable('x-powered-by')
const server = createServer(app)
app.use((req, res, next) => {
	const address = server.address()
	const port = typeof address === 'object' && address ? address.port : serverPort()
	const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
	const origins = hosts.map(host => `http://${host}`)
	if (!hosts.includes(req.headers.host ?? '') || (req.headers.origin && !origins.includes(req.headers.origin))) { res.status(403).json({ kind: 'invalid', message: '接続元が許可されていません。' }); return }
	res.setHeader('X-Content-Type-Options', 'nosniff')
	next()
})
app.use('/api', (req, res, next) => {
	if (!['GET', 'HEAD'].includes(req.method) && req.path !== '/assets' && !req.is('application/json')) { res.status(415).json({ kind: 'invalid', message: 'JSON で送信してください。' }); return }
	next()
})
app.use(express.json({ limit: '3mb' }))
const draftSchema = z.object({ title: z.string(), body: z.unknown() }).strict()
const updateSchema = draftSchema.extend({ expectedRevision: z.number().int().positive() })
app.get('/api/documents', (_req, res) => { res.json(documents.list()) })
app.post('/api/documents', (req, res) => {
	const input = draftSchema.parse(req.body)
	res.status(201).json(documents.create({ title: input.title, body: { kind: 'editor', value: input.body } }))
})
app.get('/api/documents/:id', (req, res) => { res.json(documents.read(req.params.id)) })
app.put('/api/documents/:id', (req, res) => {
	const input = updateSchema.parse(req.body)
	res.json(documents.update({ id: req.params.id, expectedRevision: input.expectedRevision, title: input.title, body: { kind: 'editor', value: input.body } }))
})
app.post('/api/documents/:id/restore', (req, res) => {
	const input = z.object({ expectedRevision: z.number().int().positive() }).strict().parse(req.body)
	res.json(documents.restore({ id: req.params.id, ...input }))
})
app.post('/api/assets', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'], limit: '20mb' }), async (req, res) => {
	if (!Buffer.isBuffer(req.body)) throw new ContentError('画像ファイルを送信してください。')
	res.status(201).json(await documents.assets.add(req.body))
})
app.get('/api/assets/:id', (req, res) => {
	const asset = documents.assets.read(req.params.id)
	res.type(asset.mime).set('Cache-Control', 'private, max-age=31536000, immutable').send(asset.bytes)
})
app.use('/api', (_req, res) => { res.status(404).json({ kind: 'not-found', message: '操作が見つかりません。' }) })
if (process.argv.includes('--dev')) {
	const { createServer: createViteServer } = await import('vite')
	const vite = await createViteServer({ root: projectDir, server: { middlewareMode: true }, appType: 'spa' })
	app.use(vite.middlewares)
} else {
	app.use(express.static(join(projectDir, 'dist')))
	app.get('/{*path}', (_req, res) => { res.sendFile('index.html', { root: join(projectDir, 'dist') }) })
}
const errorHandler: express.ErrorRequestHandler = (error: unknown, _req, res, _next) => {
	if (error instanceof DocumentError) { res.status(error.kind === 'conflict' ? 409 : error.kind === 'not-found' ? 404 : error.kind === 'busy' ? 503 : 400).json({ kind: error.kind, message: error.message, currentRevision: error.currentRevision }); return }
	if (error instanceof ContentError || error instanceof z.ZodError) { res.status(400).json({ kind: 'invalid', message: error instanceof ContentError ? error.message : error.issues[0]?.message }); return }
	process.stderr.write(`${error instanceof Error ? error.stack : 'HTTP error'}\n`)
	res.status(500).json({ kind: 'storage', message: '処理に失敗しました。編集中の内容を保持してやり直してください。' })
}
app.use(errorHandler)
server.listen(serverPort(), '127.0.0.1', () => {
	const address = server.address()
	process.stderr.write(`文書庫 http://127.0.0.1:${typeof address === 'object' && address ? address.port : serverPort()}\n`)
})
function close() { server.close(() => { documents.close(); process.exit(0) }) }
process.on('SIGINT', close)
process.on('SIGTERM', close)
