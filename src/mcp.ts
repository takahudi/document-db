import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { openDocuments, DocumentError, ContentError } from './documents.js'
import { dataDirectory } from './config.js'

const documents = openDocuments({ dataDir: dataDirectory() })
const server = new McpServer({ name: 'document-db', version: '0.1.0' })
function result(work: () => unknown) {
	try { return { content: [{ type: 'text' as const, text: JSON.stringify(work()) }] } }
	catch (error) {
		const failure = error instanceof DocumentError ? { kind: error.kind, message: error.message, currentRevision: error.currentRevision } : { kind: error instanceof ContentError || error instanceof z.ZodError ? 'invalid' : 'storage', message: error instanceof Error ? error.message : '保存に失敗しました。' }
		return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(failure) }] }
	}
}
const id = z.string().uuid()
const title = z.string()
const html = z.string().describe('部品だけの本文 HTML。画像は asset:UUID と alt を保持します。')
server.registerTool('list_documents', { description: '文書の ID とタイトルを一覧します。' }, () => result(() => documents.list()))
server.registerTool('get_document', { description: '最新の版と本文 HTML を取得します。', inputSchema: { id } }, input => result(() => {
	const doc = documents.read(input.id)
	return { id: doc.id, title: doc.title, revision: doc.revision, html: doc.html, diagrams: doc.diagrams }
}))
server.registerTool('get_diagram', { description: '文書の最新版から図のSVG、CSS、ラベルの対応情報を取得します。', inputSchema: { id, diagramId: id } }, input => result(() => documents.readDiagram(input.id, input.diagramId)))
const diagrams = z.array(z.unknown()).max(100).optional().describe('新規または変更する図の定義。既存の参照を保持する更新では省略できます。')
server.registerTool('create_document', { description: 'タイトルと本文 HTML から文書を作成します。', inputSchema: { title, html, diagrams } }, input => result(() => {
	const doc = documents.create({ title: input.title, body: { kind: 'html', value: input.html, diagrams: input.diagrams } })
	return { id: doc.id, revision: doc.revision }
}))
server.registerTool('update_document', { description: '取得時の版が一致する場合だけ文書全体を保存します。', inputSchema: { id, revision: z.number().int().positive(), title, html, diagrams } }, input => result(() => {
	const doc = documents.update({ id: input.id, expectedRevision: input.revision, title: input.title, body: { kind: 'html', value: input.html, diagrams: input.diagrams } })
	return { revision: doc.revision }
}))
await server.connect(new StdioServerTransport())
process.stdin.on('end', () => { documents.close() })
