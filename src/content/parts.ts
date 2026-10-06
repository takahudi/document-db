import { Node, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { ListItem } from '@tiptap/extension-list'
import Link from '@tiptap/extension-link'
import { z } from 'zod'

export const assetIdSchema = z.string().uuid()
const image = Node.create({
	name: 'image', group: 'block', atom: true,
	addAttributes: () => ({ assetId: { default: null }, alt: { default: '' } }),
	parseHTML: () => [{ tag: 'img[data-asset-id]' }],
	renderHTML: ({ node }) => ['img', { src: `/api/assets/${String(node.attrs.assetId)}`, alt: String(node.attrs.alt), 'data-asset-id': String(node.attrs.assetId) }],
})
export const extensions = [
	StarterKit.configure({ heading: { levels: [1, 2, 3] }, listItem: false, blockquote: false, horizontalRule: false, strike: false, code: false, link: false, underline: false, trailingNode: false }),
	ListItem.extend({ content: 'paragraph (paragraph | bulletList | orderedList)*' }),
	Link.configure({ openOnClick: false, protocols: ['http', 'https'], HTMLAttributes: { target: null, rel: null } }),
	Table.configure({ resizable: false }), TableRow, TableHeader.extend({ content: 'paragraph+' }), TableCell.extend({ content: 'paragraph+' }), image,
]
const types = ['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow', 'tableCell', 'tableHeader', 'codeBlock', 'image', 'text', 'hardBreak'] as const
const markSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('bold') }).strict(),
	z.object({ type: z.literal('italic') }).strict(),
	z.object({ type: z.literal('link'), attrs: z.object({ href: z.string(), target: z.null().optional(), rel: z.null().optional(), class: z.null().optional(), title: z.null().optional() }).strict() }).strict(),
])
export type Mark = z.infer<typeof markSchema>
type Attribute = string | number | null | number[]
export interface BodyNode {
	type: typeof types[number]
	attrs?: Record<string, Attribute>
	content?: BodyNode[]
	text?: string
	marks?: Mark[]
}
const nodeSchema: z.ZodType<BodyNode> = z.lazy(() => z.object({
	type: z.enum(types), attrs: z.record(z.string(), z.union([z.string(), z.number(), z.null(), z.array(z.number())])).optional(),
	content: z.array(nodeSchema).optional(), text: z.string().optional(), marks: z.array(markSchema).optional(),
}).strict())
const attributes: Partial<Record<BodyNode['type'], z.ZodType<Record<string, Attribute>>>> = {
	heading: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
	orderedList: z.object({ start: z.literal(1).default(1), type: z.null().optional() }).strict(),
	codeBlock: z.object({ language: z.null().optional() }).strict(),
	tableCell: z.object({ colspan: z.literal(1).default(1), rowspan: z.literal(1).default(1), colwidth: z.null().default(null), align: z.null().default(null) }).strict(),
	tableHeader: z.object({ colspan: z.literal(1).default(1), rowspan: z.literal(1).default(1), colwidth: z.null().default(null), align: z.null().default(null) }).strict(),
	image: z.object({ assetId: assetIdSchema, alt: z.string() }).strict(),
}
export class ContentError extends Error {
	readonly kind = 'invalid'
}
export function safeLink(value: string): string {
	let url: URL
	try { url = new URL(value) } catch { throw new ContentError('リンクは HTTP または HTTPS の絶対 URL を指定してください。') }
	if (!['http:', 'https:'].includes(url.protocol)) throw new ContentError('未対応のリンクです。')
	return value
}
export function validateBody(raw: unknown): BodyNode {
	const result = nodeSchema.safeParse(raw)
	if (!result.success) throw new ContentError(`未対応の本文です。${result.error.issues[0]?.message ?? ''}`)
	const body = result.data
	if (body.type !== 'doc') throw new ContentError('本文のルートは doc が必要です。')
	function visit(node: BodyNode, parent: BodyNode | undefined) {
		const schema = attributes[node.type] ?? z.object({}).strict()
		const parsed = schema.safeParse(node.attrs ?? {})
		if (!parsed.success) throw new ContentError(`${node.type} に未対応の属性があります。`)
		if (Object.keys(parsed.data).length) node.attrs = parsed.data
		else delete node.attrs
		if (node.type !== 'text' && node.text !== undefined) throw new ContentError('文字列の場所が不正です。')
		if (node.marks?.length && node.type !== 'text' && node.type !== 'hardBreak') throw new ContentError('装飾の場所が不正です。')
		if (['text', 'image', 'hardBreak'].includes(node.type) && node.content !== undefined) throw new ContentError('この部品は子要素を持てません。')
		if (node.type === 'text' && parent?.type !== 'codeBlock') node.text = node.text?.replace(/[\t\n\r ]+/g, ' ')
		if (parent?.type === 'codeBlock' && (node.type !== 'text' || node.marks?.length)) throw new ContentError('コードブロックに装飾は使えません。')
		if (node.marks) {
			if (new Set(node.marks.map(mark => mark.type)).size !== node.marks.length) throw new ContentError('装飾が重複しています。')
			for (const mark of node.marks) if (mark.type === 'link') mark.attrs = { href: safeLink(mark.attrs.href) }
			node.marks.sort((a, b) => a.type.localeCompare(b.type))
		}
		if (node.type === 'listItem' && node.content?.some(child => !['paragraph', 'bulletList', 'orderedList'].includes(child.type))) throw new ContentError('リスト項目は段落とリストだけに対応します。')
		if (['tableCell', 'tableHeader'].includes(node.type) && node.content?.some(child => child.type !== 'paragraph')) throw new ContentError('表セルは段落だけに対応します。')
		if (node.type === 'table') {
			const widths = node.content?.map(row => row.content?.length ?? 0) ?? []
			if (!widths.length || widths[0] === 0 || widths.some(width => width !== widths[0])) throw new ContentError('表の各行は同じ列数が必要です。')
		}
		for (const child of node.content ?? []) visit(child, node)
	}
	if (!body.content?.length) body.content = [{ type: 'paragraph' }]
	visit(body, undefined)
	try { const node = getSchema(extensions).nodeFromJSON(body); node.check() }
	catch (error) { throw new ContentError(`本文の構造が不正です。${error instanceof Error ? error.message : ''}`) }
	return body
}
export const emptyBody = (): BodyNode => ({ type: 'doc', content: [{ type: 'paragraph' }] })
export function assetRefs(body: BodyNode): string[] {
	const refs = new Set<string>()
	function visit(node: BodyNode) {
		if (node.type === 'image') refs.add(assetIdSchema.parse(node.attrs?.assetId))
		for (const child of node.content ?? []) visit(child)
	}
	visit(body)
	return [...refs]
}
