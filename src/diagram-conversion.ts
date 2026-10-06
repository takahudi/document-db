import { chromium } from 'playwright'
import { SAXParser } from 'parse5-sax-parser'
import { ident, parse, walk } from 'css-tree'
import { z } from 'zod'
import { diagramSchema, parseDiagram, type Diagram } from './content/diagram.js'
import { presentationProperties } from './content/diagram-css.js'
import { diagramFontCss, readDiagramFont } from './diagram-font-assets.js'
import { diagramFontFamilies } from './content/diagram-fonts.js'
import { parseHtml, serializeHtml } from './content/html.js'

const sourceSchema = z.object({ labelId: z.string(), slotId: z.string(), sourceIds: z.array(z.string()).min(1), kind: z.enum(['svg-text', 'html-text']) }).strict()
export const conversionManifestSchema = z.object({
	version: z.literal(1), proseIds: z.array(z.string()),
	diagrams: z.array(z.object({ sourceSvgId: z.string(), definition: diagramSchema.in.omit({ svg: true, css: true }), sources: z.array(sourceSchema).default([]) }).strict()).min(1),
}).strict()
export type ConversionManifest = z.infer<typeof conversionManifestSchema>

function isFontMetadata(href: string): boolean {
	let url: URL
	try { url = new URL(href) } catch { return false }
	if (url.origin !== 'https://fonts.googleapis.com' || url.pathname !== '/css2' || url.hash || url.username || url.password || !url.searchParams.getAll('family').length || [...url.searchParams.keys()].some(key => !['family', 'display'].includes(key))) return false
	for (const family of url.searchParams.getAll('family')) {
		const name = family.split(':')[0]
		if (!name || !diagramFontFamilies.includes(name)) throw new Error(`図の書体「${name ?? family}」は利用できません。ローカル対応書体で再生成してください。`)
	}
	return true
}
export function inspectGeneratedHtml(html: string): string {
	if (html.length > 3_000_000 || html.includes('\0')) throw new Error('生成 HTML が不正または大きすぎます。')
	const removed: { start: number; end: number }[] = []
	const parser = new SAXParser({ sourceCodeLocationInfo: true })
	parser.on('startTag', token => {
		const fontMetadata = token.tagName === 'link' && token.attrs.find(attr => attr.name === 'rel')?.value === 'stylesheet' && isFontMetadata(token.attrs.find(attr => attr.name === 'href')?.value ?? '')
		if (fontMetadata && token.sourceCodeLocation) removed.push({ start: token.sourceCodeLocation.startOffset, end: token.sourceCodeLocation.endOffset })
		if (['script', 'iframe', 'object', 'embed', 'base', 'animate', 'animatetransform', 'animatemotion', 'set'].includes(token.tagName.toLowerCase()) || token.tagName === 'link' && !fontMetadata) throw new Error(`生成 HTML の ${token.tagName} は取り込めません。`)
		for (const attr of token.attrs) {
			if (attr.name.toLowerCase().startsWith('on') || attr.name === 'srcdoc') throw new Error('生成 HTML のイベント属性は取り込めません。')
			if (['src', 'href'].includes(attr.name) && !attr.value.startsWith('#') && !(token.tagName === 'a' && /^https?:\/\//.test(attr.value)) && !(fontMetadata && attr.name === 'href')) throw new Error('生成 HTML の外部参照は取り込めません。')
		}
	})
	parser.end(html)
	for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) inspectCss(match[1] ?? '')
	const styles = new SAXParser()
	styles.on('startTag', token => { for (const attr of token.attrs) if (attr.name === 'style') inspectCss(attr.value, true) })
	styles.end(html)
	for (const span of removed.reverse()) html = html.slice(0, span.start) + html.slice(span.end)
	return html
}
function inspectCss(css: string, inline = false) {
	const tree = parse(css, { context: inline ? 'declarationList' : 'stylesheet' })
	walk(tree, node => {
		if (node.type === 'Declaration' && ['transform', 'transform-origin', 'transform-box'].includes(ident.decode(node.property).toLowerCase())) throw new Error('図の CSS 変形は SVG transform 属性へ変換して再生成してください。')
		if (node.type === 'Raw' || node.type === 'Atrule' && (ident.decode(node.name).toLowerCase() !== 'media' || !node.block || !node.prelude)) throw new Error('生成 CSS は静的な media だけに対応します。外部書体や import はローカル書体で再生成してください。')
		if (node.type === 'Url' && !/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(node.value)) throw new Error('生成 CSS の外部参照は取り込めません。')
	})
}

export async function convertGeneratedDiagram(input: { html: string; manifest: unknown; title: string; browserPath?: string }): Promise<{ title: string; html: string; diagrams: Diagram[] }> {
	const sanitizedHtml = inspectGeneratedHtml(input.html)
	const manifest = conversionManifestSchema.parse(input.manifest)
	if (new Set(manifest.diagrams.map(item => item.definition.id)).size !== manifest.diagrams.length) throw new Error('図の識別子が重複しています。')
	const selections = [...manifest.proseIds, ...manifest.diagrams.map(item => item.sourceSvgId)]
	if (new Set(selections).size !== selections.length) throw new Error('取り込む生成要素が重複しています。')
	const browser = await chromium.launch({ executablePath: input.browserPath ?? process.env.DOCUMENT_DB_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
	try {
		const page = await browser.newPage()
		const origin = 'http://document-db-converter.local'
		const externalRequests: string[] = []
		await page.route('**/*', async route => {
			const url = new URL(route.request().url())
			if (url.origin !== origin) { externalRequests.push(url.href); await route.abort(); return }
			if (url.pathname === '/') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }); return }
			if (url.pathname === '/diagram-fonts.css') { await route.fulfill({ contentType: 'text/css', body: diagramFontCss }); return }
			const match = /^\/diagram-fonts\/([a-z0-9-]+)\/([a-z0-9-]+\.woff2?)$/.exec(url.pathname)
			if (match?.[1] && match[2]) { const font = readDiagramFont(match[1], match[2]); await route.fulfill({ contentType: font.mime, body: font.bytes }); return }
			await route.abort()
		})
		await page.goto(origin)
		await page.addScriptTag({ content: 'globalThis.__name = value => value;' })
		const extracted = await page.evaluate(async ({ html, manifest, properties }) => {
			const frame = document.createElement('iframe')
			frame.setAttribute('sandbox', 'allow-same-origin')
			frame.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;self&#39; &#39;unsafe-inline&#39;; font-src &#39;self&#39;; img-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><link rel="stylesheet" href="/diagram-fonts.css">' + html
			const ready = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('図の変換画面が時間切れです。')), 15_000); frame.onload = () => { clearTimeout(timer); resolve() } })
			document.body.append(frame); await ready
			const doc = frame.contentDocument
			const view = doc?.defaultView
			if (!doc || !view) throw new Error('図の変換画面を開けません。')
			const ids = new Set<string>()
			for (const element of doc.querySelectorAll('[id]')) { if (ids.has(element.id)) throw new Error(`生成 HTML の ID ${element.id} が重複しています。`); ids.add(element.id) }
			function element(id: string) { const result = doc?.getElementById(id); if (!result) throw new Error(`生成要素 ${id} がありません。`); return result }
			function freeze(target: Element, from: Element) {
				const style = view?.getComputedStyle(from)
				if (!style) throw new Error('図の書式を取得できません。')
				if (from.namespaceURI === 'http://www.w3.org/2000/svg' && style.transform !== 'none' && !from.hasAttribute('transform')) throw new Error(`図の CSS 変形 ${from.id} は SVG transform 属性へ変換してください。`)
				for (const property of properties) {
					let value = style.getPropertyValue(property).trim()
					if (value) {
						if (property.startsWith('color-interpolation')) value = value.replace('srgb', 'sRGB').replace('linearrgb', 'linearRGB')
						value = value.replace(/url\(["']?[^)"']*#([A-Za-z_][A-Za-z0-9_.:-]*)["']?\)/g, 'url(#$1)')
						target.setAttribute(property, value)
					}
				}
				target.removeAttribute('style'); target.removeAttribute('class')
			}
			const diagrams = []
			for (const entry of manifest.diagrams) {
				const svg = element(entry.sourceSvgId)
				if (svg.localName !== 'svg') throw new Error(`要素 ${entry.sourceSvgId} は SVG が必要です。`)
				const cloned = svg.cloneNode(true)
				if (!(cloned instanceof view.Element)) throw new Error('SVG を複製できません。')
				const originals = [svg, ...svg.querySelectorAll('*')]
				const copies = [cloned, ...cloned.querySelectorAll('*')]
				for (const [index, original] of originals.entries()) { const copy = copies[index]; if (copy && original.localName !== 'style') freeze(copy, original) }
				for (const style of cloned.querySelectorAll('style')) style.remove()
				for (const source of entry.sources) {
					const parent = element(source.sourceIds[0] ?? '').parentElement
					if (source.sourceIds.some(id => element(id).parentElement !== parent)) throw new Error(`編集欄 ${source.slotId} の行は同じ親の座標系で再生成してください。`)
					const label = entry.definition.labels.find(item => item.id === source.labelId)
					const slot = label?.slots.find(item => item.id === source.slotId)
					if (!slot) throw new Error(`編集欄 ${source.slotId} がありません。`)
					if (cloned.querySelector(`#${CSS.escape(slot.element)}`)) throw new Error(`編集要素 ${slot.element} は既にあります。`)
					const group = doc.createElementNS('http://www.w3.org/2000/svg', 'g'); group.id = slot.element
					for (const [index, id] of source.sourceIds.entries()) {
						const original = element(id)
						const copy = cloned.querySelector(`#${CSS.escape(id)}`)
						if (!svg.contains(original) || !copy) throw new Error(`編集する文字 ${id} は指定 SVG 内に必要です。`)
						const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text')
						if (source.kind === 'svg-text') {
							if (original.localName !== 'text' || original.children.length || original.hasAttribute('transform') || original.hasAttribute('dx') || original.hasAttribute('dy')) throw new Error(`文字 ${id} は単純な SVG text に再生成してください。`)
							text.setAttribute('x', original.getAttribute('x') ?? '0'); text.setAttribute('y', original.getAttribute('y') ?? '0'); freeze(text, original)
						} else {
							if (original.localName !== 'foreignObject' || original.children.length !== 1 || original.closest('[transform]')) throw new Error(`HTML ラベル ${id} は変形のない単一の div として再生成してください。`)
							const child = original.firstElementChild
							if (!child || child.localName !== 'div' || child.children.length || child.textContent?.includes('\n') || original.hasAttribute('transform')) throw new Error(`HTML ラベル ${id} は通常の一行文字として再生成してください。`)
							const style = view.getComputedStyle(child)
							if (style.transform !== 'none' || style.writingMode !== 'horizontal-tb' || style.padding !== '0px' || style.borderWidth !== '0px' || style.backgroundColor !== 'rgba(0, 0, 0, 0)' || !Number.isFinite(Number.parseFloat(style.lineHeight))) throw new Error(`HTML ラベル ${id} の装飾を SVG 図形へ分け、行高を px で指定してください。`)
							const box = child.getBoundingClientRect(); const bounds = original.getBoundingClientRect()
							if (child.scrollWidth > box.width + 0.25 || box.height > Number.parseFloat(style.lineHeight) + 0.25) throw new Error(`HTML ラベル ${id} は一行の文字に再生成してください。`)
							text.setAttribute('x', String(Number(original.getAttribute('x') ?? '0') + box.x - bounds.x)); text.setAttribute('y', String(Number(original.getAttribute('y') ?? '0') + box.y - bounds.y)); freeze(text, child)
							text.setAttribute('fill', style.color); text.setAttribute('dominant-baseline', 'text-before-edge'); text.setAttribute('text-anchor', slot.align)
						}
						text.textContent = original.textContent; text.setAttribute('data-break-before', index === 0 ? 'none' : 'hard')
						if (!index) copy.before(group)
						group.append(text); copy.remove()
					}
				}
				if (cloned.querySelector('foreignObject')) throw new Error('対応情報のない HTML ラベルがあります。SVG 文字へ再生成してください。')
				diagrams.push({ ...entry.definition, svg: new XMLSerializer().serializeToString(cloned), css: '' })
			}
			const body: ({ kind: 'prose'; html: string } | { kind: 'diagram'; id: string })[] = []
			const selections = [...manifest.proseIds.map(id => ({ id, diagram: null })), ...manifest.diagrams.map(entry => ({ id: entry.sourceSvgId, diagram: entry.definition.id }))]
			selections.sort((a, b) => element(a.id).compareDocumentPosition(element(b.id)) & view.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
			for (const item of selections) {
				if (item.diagram) { body.push({ kind: 'diagram', id: item.diagram }); continue }
				const id = item.id
				const selected = element(id).cloneNode(true)
				if (!(selected instanceof view.Element)) throw new Error('本文を抽出できません。')
				for (const node of [selected, ...selected.querySelectorAll('*')]) { node.removeAttribute('id'); node.removeAttribute('class'); node.removeAttribute('style') }
				body.push({ kind: 'prose', html: selected.outerHTML })
			}
			return { body, diagrams }
		}, { html: sanitizedHtml, manifest, properties: [...presentationProperties] })
		const diagrams = extracted.diagrams.map(parseDiagram)
		await page.evaluate(async diagrams => {
			const frame = document.querySelector('iframe'); const doc = frame?.contentDocument; const view = doc?.defaultView
			if (!doc || !view) throw new Error('図の検証画面がありません。')
			doc.body.replaceChildren()
			for (const diagram of diagrams) {
				const root = new DOMParser().parseFromString(diagram.svg, 'image/svg+xml').documentElement
				const svg = doc.importNode(root, true); doc.body.append(svg)
				for (const text of svg.querySelectorAll('text')) {
					const style = view.getComputedStyle(text)
					for (const family of style.fontFamily.split(',')) {
						const face = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${family.trim()}`
						const sample = `${text.textContent ?? ''}日本語 ABC`
						const fonts = await doc.fonts.load(face, sample)
						if (!fonts.length || fonts.some(font => font.status !== 'loaded') || !doc.fonts.check(face, sample)) throw new Error('図のローカル書体を読み込めません。')
					}
				}
				await doc.fonts.ready
				for (const label of diagram.labels) for (const slot of label.slots) {
					const group = svg.querySelector(`#${CSS.escape(slot.element)}`)
					if (!(group instanceof view.SVGGraphicsElement)) throw new Error('図の文字領域がありません。')
					const box = group.getBBox(); const region = slot.region
					if (box.width === 0 && box.height === 0) continue
					let stroke = 0
					for (const text of group.querySelectorAll('text')) { const style = view.getComputedStyle(text); if (style.stroke !== 'none') stroke = Math.max(stroke, Number.parseFloat(style.strokeWidth) / 2) }
					if (box.x - stroke < region.x - 0.25 || box.y - stroke < region.y - 0.25 || box.x + box.width + stroke > region.x + region.width + 0.25 || box.y + box.height + stroke > region.y + region.height + 0.25) throw new Error(`図内の文字 ${label.id}/${slot.id} が宣言領域からあふれています。`)
				}
			}
		}, diagrams)
		if (externalRequests.length) throw new Error(`生成 HTML が外部参照を要求しました。${externalRequests[0]}`)
		const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
		const html = extracted.body.map(part => {
			if (part.kind === 'prose') return serializeHtml(parseHtml(part.html))
			const diagram = diagrams.find(diagram => diagram.id === part.id)
			if (!diagram) throw new Error('図の本文参照を解決できません。')
			return `<figure data-diagram-id="${diagram.id}"><figcaption>${escape(diagram.description)}</figcaption></figure>`
		}).join('')
		return { title: input.title, html, diagrams }
	} finally { await browser.close() }
}
