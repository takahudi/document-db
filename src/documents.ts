import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { openAssets } from './assets.js'
import { assetRefs, diagramsOf, ContentError, validateBody, type BodyNode } from './content/parts.js'
import { parseHtml, serializeHtml } from './content/html.js'
import { parseDiagram, diagramSummary, type Diagram } from './content/diagram.js'

const idSchema = z.string().uuid()
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1)
const titleSchema = z.string().trim().min(1, 'タイトルを入力してください。').max(200)
export type BodyInput = { kind: 'html'; value: string; diagrams?: unknown[] } | { kind: 'editor'; value: unknown }
export type Draft = { title: string; body: BodyInput }
export type Snapshot = { id: string; revision: number; title: string; body: BodyNode; html: string; diagrams: ReturnType<typeof diagramSummary>[]; canRestore: boolean }
export class DocumentError extends Error {
	constructor(readonly kind: 'not-found' | 'conflict' | 'nothing-to-restore' | 'busy' | 'storage', message: string, readonly currentRevision?: number) { super(message) }
}
const rowSchema = z.object({ id: idSchema, revision: revisionSchema, title: z.string(), body_json: z.string(), previous_json: z.string().nullable() })
const previousSchema = z.object({ title: z.string(), body: z.unknown() }).strict()
export function openDocuments({ dataDir }: { dataDir: string }) {
	if (!isAbsolute(dataDir)) throw new Error('データディレクトリは絶対パスが必要です。')
	mkdirSync(dataDir, { recursive: true })
	const db = new DatabaseSync(join(dataDir, 'documents.sqlite'))
	db.exec('PRAGMA busy_timeout = 250; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
	const version = z.object({ user_version: z.number() }).parse(db.prepare('PRAGMA user_version').get()).user_version
	if (version !== 0 && version !== 1) { db.close(); throw new Error('保存データのバージョンに対応していません。') }
	db.exec(`BEGIN IMMEDIATE;
		CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, title TEXT NOT NULL, body_json TEXT NOT NULL, previous_json TEXT);
		CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, mime TEXT NOT NULL, basename TEXT NOT NULL);
		PRAGMA user_version = 1; COMMIT;`)
	const assets = openAssets(db, dataDir)
	function row(id: string) {
		idSchema.parse(id)
		const raw = db.prepare('SELECT * FROM documents WHERE id = ?').get(id)
		if (!raw) throw new DocumentError('not-found', '文書が見つかりません。')
		return rowSchema.parse(raw)
	}
	function snapshot(value: z.infer<typeof rowSchema>): Snapshot {
		const body = validateBody(JSON.parse(value.body_json))
		return { id: value.id, revision: value.revision, title: value.title, body, html: serializeHtml(body), diagrams: diagramsOf(body).map(diagramSummary), canRestore: value.previous_json !== null }
	}
	function content(draft: Draft, current?: BodyNode) {
		const title = titleSchema.parse(draft.title)
		let body: BodyNode
		if (draft.body.kind === 'html') {
			const supplied = (draft.body.diagrams ?? []).map(parseDiagram)
			const definitions = new Map<string, Diagram>(current ? diagramsOf(current).map(diagram => [diagram.id, diagram]) : [])
			const suppliedIds = new Set<string>()
			for (const diagram of supplied) {
				if (suppliedIds.has(diagram.id)) throw new ContentError('図の定義が重複しています。')
				suppliedIds.add(diagram.id); definitions.set(diagram.id, diagram)
			}
			body = parseHtml(draft.body.value, [...definitions.values()])
			const used = new Set(diagramsOf(body).map(diagram => diagram.id.toString()))
			if ([...suppliedIds].some(id => !used.has(id))) throw new ContentError('本文から参照されない図の定義があります。')
		} else body = validateBody(draft.body.value)
		return { title, body }
	}
	function transaction<T>(work: () => T): T {
		let began = false
		try { db.exec('BEGIN IMMEDIATE'); began = true; const result = work(); db.exec('COMMIT'); return result }
		catch (error) {
			if (began) db.exec('ROLLBACK')
			if (error instanceof Error && /locked|busy/i.test(error.message)) throw new DocumentError('busy', '別の保存が進行中です。少し待ってからやり直してください。')
			throw error
		}
	}
	function checkImages(body: BodyNode) { for (const id of assetRefs(body)) assets.check(id) }
	return {
		assets,
		list() { return z.array(z.object({ id: idSchema, title: z.string() })).parse(db.prepare('SELECT id,title FROM documents ORDER BY rowid DESC').all()) },
		read(id: string) { return snapshot(row(id)) },
		readDiagram(id: string, diagramId: string) {
			const doc = snapshot(row(id))
			const diagram = diagramsOf(doc.body).find(definition => definition.id === diagramId)
			if (!diagram) throw new DocumentError('not-found', '図が見つかりません。')
			return { id: doc.id, revision: doc.revision, diagram }
		},
		create(draft: Draft) {
			const { title, body } = content(draft)
			return transaction(() => {
				checkImages(body)
				const id = randomUUID()
				db.prepare('INSERT INTO documents(id,revision,title,body_json) VALUES(?,1,?,?)').run(id, title, JSON.stringify(body))
				return snapshot(row(id))
			})
		},
		update(input: Draft & { id: string; expectedRevision: number }) {
			revisionSchema.parse(input.expectedRevision)
			return transaction(() => {
				const current = row(input.id)
				if (current.revision !== input.expectedRevision) throw new DocumentError('conflict', '文書が更新されています。最新の文書を読み直してください。', current.revision)
				const { title, body } = content(input, validateBody(JSON.parse(current.body_json)))
				checkImages(body)
				const previous = JSON.stringify({ title: current.title, body: JSON.parse(current.body_json) })
				db.prepare('UPDATE documents SET title=?,body_json=?,previous_json=?,revision=revision+1 WHERE id=?').run(title, JSON.stringify(body), previous, input.id)
				return snapshot(row(input.id))
			})
		},
		restore(input: { id: string; expectedRevision: number }) {
			revisionSchema.parse(input.expectedRevision)
			return transaction(() => {
				const current = row(input.id)
				if (current.revision !== input.expectedRevision) throw new DocumentError('conflict', '文書が更新されています。最新の文書を読み直してください。', current.revision)
				if (current.previous_json === null) throw new DocumentError('nothing-to-restore', '取り消せる保存がありません。')
				const previous = previousSchema.parse(JSON.parse(current.previous_json))
				const body = validateBody(previous.body)
				checkImages(body)
				db.prepare('UPDATE documents SET title=?,body_json=?,previous_json=NULL,revision=revision+1 WHERE id=?').run(previous.title, JSON.stringify(body), input.id)
				return snapshot(row(input.id))
			})
		},
		close() { db.close() },
	}
}
export { ContentError }
