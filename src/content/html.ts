import { SAXParser, type StartTag, type SaxToken } from 'parse5-sax-parser'
import { decodeHTML } from 'entities'
import { assetIdSchema, ContentError, safeLink, validateBody, type BodyNode, type Mark } from './parts.js'

const nodes: Record<string, BodyNode['type']> = { p: 'paragraph', h1: 'heading', h2: 'heading', h3: 'heading', ul: 'bulletList', ol: 'orderedList', li: 'listItem', table: 'table', tr: 'tableRow', td: 'tableCell', th: 'tableHeader', pre: 'codeBlock', img: 'image', br: 'hardBreak' }
const parents: Record<string, readonly string[]> = {
	p: ['doc', 'li', 'td', 'th'], h1: ['doc'], h2: ['doc'], h3: ['doc'],
	ul: ['doc', 'li'], ol: ['doc', 'li'], li: ['ul', 'ol'],
	table: ['doc'], tbody: ['table'], thead: ['table'], tr: ['table', 'tbody', 'thead'], td: ['tr'], th: ['tr'],
	pre: ['doc'], code: ['pre'], img: ['doc'], br: ['p', 'h1', 'h2', 'h3', 'strong', 'em', 'a'],
	strong: ['p', 'h1', 'h2', 'h3', 'em', 'a'], em: ['p', 'h1', 'h2', 'h3', 'strong', 'a'], a: ['p', 'h1', 'h2', 'h3', 'strong', 'em'],
}
type Frame = { tag: string; node?: BodyNode; mark?: Mark; hasCode?: boolean }
export function parseHtml(html: string): BodyNode {
	if (html.includes('\0') || html.length > 2_000_000) throw new ContentError('本文 HTML が不正または大きすぎます。')
	const body: BodyNode = { type: 'doc', content: [] }
	const stack: Frame[] = [{ tag: 'doc', node: body }]
	let consumed = 0
	function source(token: SaxToken): string {
		const location = token.sourceCodeLocation
		if (!location || location.startOffset !== consumed) throw new ContentError('HTML に未対応の構文があります。')
		consumed = location.endOffset
		return html.slice(location.startOffset, location.endOffset)
	}
	function current(): Frame {
		const frame = stack.at(-1)
		if (!frame) throw new ContentError('HTML の構造が不正です。')
		return frame
	}
	function append(node: BodyNode) {
		const parent = stack.findLast(frame => frame.node)?.node
		if (!parent) throw new ContentError('本文の親要素がありません。')
		parent.content ??= []
		parent.content.push(node)
	}
	function attrs(token: StartTag, raw: string) {
		const match = /^<([A-Za-z][A-Za-z0-9]*)([\s\S]*?)\s*\/?>$/.exec(raw)
		if (!match || match[1]?.toLowerCase() !== token.tagName) throw new ContentError('開始タグが不正です。')
		let rest = match[2] ?? ''
		const names = new Set<string>()
		while (rest.trim()) {
			const attr = /^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"[^"]*"|'[^']*')/.exec(rest)
			if (!attr || !attr[1]) throw new ContentError('属性は重複のない引用符付きの値が必要です。')
			const name = attr[1].toLowerCase()
			if (names.has(name)) throw new ContentError('HTML 属性が重複しています。')
			names.add(name)
			rest = rest.slice(attr[0].length)
		}
		const allowed = token.tagName === 'a' ? ['href'] : token.tagName === 'img' ? ['src', 'alt'] : []
		if (names.size !== token.attrs.length || token.attrs.some(attr => !allowed.includes(attr.name) || attr.namespace || attr.prefix)) throw new ContentError('未対応の HTML 属性です。')
		return Object.fromEntries(token.attrs.map(attr => [attr.name, attr.value]))
	}
	const parser = new SAXParser({ sourceCodeLocationInfo: true })
	parser.on('startTag', token => {
		const raw = source(token)
		const parent = current()
		if (!parents[token.tagName]?.includes(parent.tag)) throw new ContentError(`未対応の要素または入れ子です。${token.tagName}`)
		if (token.selfClosing && !['img', 'br'].includes(token.tagName)) throw new ContentError('終了タグが必要です。')
		const attr = attrs(token, raw)
		const frame: Frame = { tag: token.tagName }
		if (token.tagName === 'strong') frame.mark = { type: 'bold' }
		else if (token.tagName === 'em') frame.mark = { type: 'italic' }
		else if (token.tagName === 'a') frame.mark = { type: 'link', attrs: { href: safeLink(attr.href ?? '') } }
		else if (token.tagName === 'code') parent.hasCode = true
		else {
			const type = nodes[token.tagName]
			if (type) {
				const node: BodyNode = { type }
				if (type === 'heading') node.attrs = { level: Number(token.tagName.slice(1)) }
				if (type === 'hardBreak') { const marks = stack.flatMap(frame => frame.mark ? [frame.mark] : []); if (marks.length) node.marks = marks }
				if (type === 'image') {
					if (!attr.src?.startsWith('asset:') || attr.alt === undefined) throw new ContentError('画像は発行済み参照と説明文が必要です。')
					node.attrs = { assetId: assetIdSchema.parse(attr.src.slice(6)), alt: attr.alt }
				}
				append(node)
				frame.node = node
			}
		}
		if (!['img', 'br'].includes(token.tagName)) stack.push(frame)
	})
	parser.on('endTag', token => {
		const raw = source(token)
		if (!/^<\/[A-Za-z][A-Za-z0-9]*\s*>$/.test(raw) || current().tag !== token.tagName || stack.length === 1) throw new ContentError('終了タグが一致しません。')
		if (token.tagName === 'pre' && !current().hasCode) throw new ContentError('コードは pre > code が必要です。')
		stack.pop()
	})
	parser.on('text', token => {
		const raw = source(token)
		if (raw.includes('<')) throw new ContentError('文字としての < はエスケープしてください。')
		const parent = current()
		if (parent.tag !== 'code' && !['p', 'h1', 'h2', 'h3', 'strong', 'em', 'a'].includes(parent.tag)) {
			if (token.text.trim()) throw new ContentError('文字列は段落などの内部に置いてください。')
			return
		}
		const text = parent.tag === 'code' ? decodeHTML(raw).replace(/\r\n?/g, '\n') : token.text.replace(/[\t\n\r ]+/g, ' ')
		if (!text) return
		const marks = stack.flatMap(frame => frame.mark ? [frame.mark] : [])
		append({ type: 'text', text, ...(marks.length ? { marks } : {}) })
	})
	parser.on('comment', () => { throw new ContentError('HTML コメントは未対応です。') })
	parser.on('doctype', () => { throw new ContentError('DOCTYPE は本文に含められません。') })
	parser.write(html)
	parser.end()
	if (stack.length !== 1 || consumed !== html.length) throw new ContentError('HTML が途中で終わっています。')
	return validateBody(body)
}
const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAttr = (value: string) => escapeText(value).replaceAll('"', '&quot;')
export function serializeHtml(body: BodyNode): string {
	function render(node: BodyNode): string {
		const content = (node.content ?? []).map(render).join('')
		if (node.type === 'doc') return content
		if (node.type === 'text' || node.type === 'hardBreak') {
			let result = node.type === 'hardBreak' ? '<br>' : escapeText(node.text ?? '')
			for (const mark of [...(node.marks ?? [])].sort((a, b) => b.type.localeCompare(a.type))) {
				result = mark.type === 'link' ? `<a href="${escapeAttr(mark.attrs.href)}">${result}</a>` : `<${mark.type === 'bold' ? 'strong' : 'em'}>${result}</${mark.type === 'bold' ? 'strong' : 'em'}>`
			}
			return result
		}
		if (node.type === 'image') return `<img src="asset:${escapeAttr(String(node.attrs?.assetId))}" alt="${escapeAttr(String(node.attrs?.alt ?? ''))}">`
		if (node.type === 'codeBlock') return `<pre><code>${content}</code></pre>`
		if (node.type === 'table') return `<table><tbody>${content}</tbody></table>`
		if (node.type === 'heading') return `<h${String(node.attrs?.level)}>${content}</h${String(node.attrs?.level)}>`
		const tags = { paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', tableRow: 'tr', tableCell: 'td', tableHeader: 'th' }
		return `<${tags[node.type]}>${content}</${tags[node.type]}>`
	}
	return render(body)
}
