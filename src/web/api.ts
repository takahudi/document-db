import { z } from 'zod'
import { validateBody } from '../content/parts.js'
import type { BodyNode } from '../content/parts.js'
const snapshotSchema = z.object({ id: z.string().uuid(), revision: z.number().int(), title: z.string(), body: z.unknown(), html: z.string(), canRestore: z.boolean() })
export type Snapshot = Omit<z.infer<typeof snapshotSchema>, 'body'> & { body: BodyNode }
export type Summary = { id: string; title: string }
export class ApiError extends Error {
	constructor(readonly kind: string, message: string) { super(message) }
}
async function request(path: string, init?: RequestInit): Promise<unknown> {
	let response: Response
	try { response = await fetch(`/api${path}`, init) } catch { throw new ApiError('network', 'アプリに接続できません。編集中の内容は保持しています。') }
	const value: unknown = await response.json()
	if (!response.ok) {
		const error = z.object({ kind: z.string(), message: z.string() }).safeParse(value)
		throw new ApiError(error.success ? error.data.kind : 'request', error.success ? error.data.message : '保存に失敗しました。')
	}
	return value
}
function snapshot(value: unknown): Snapshot { const doc = snapshotSchema.parse(value); return { ...doc, body: validateBody(doc.body) } }
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export const api = {
	async list(): Promise<Summary[]> { return z.array(z.object({ id: z.string().uuid(), title: z.string() })).parse(await request('/documents')) },
	async open(id: string) { return snapshot(await request(`/documents/${id}`)) },
	async save(baseline: Snapshot | null, title: string, body: BodyNode) {
		return snapshot(await request(baseline ? `/documents/${baseline.id}` : '/documents', json(baseline ? 'PUT' : 'POST', { title, body, ...(baseline ? { expectedRevision: baseline.revision } : {}) })))
	},
	async restore(doc: Snapshot) { return snapshot(await request(`/documents/${doc.id}/restore`, json('POST', { expectedRevision: doc.revision }))) },
	async upload(file: File) { return z.object({ id: z.string().uuid(), reference: z.string() }).parse(await request('/assets', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })) },
}
