import { z } from 'zod'
import { ContentError } from './errors.js'
import { checkDiagramFontFace } from './diagram-fonts.js'
import { computedPresentation, parseDiagramCss, parseInlineStyle, type DiagramCss } from './diagram-css.js'
import { numbers, parseSvg, serializeSvg, svgText, type SvgDocument, type SvgElement } from './diagram-svg.js'

const identity = z.string().min(1).max(120).regex(/^[A-Za-z_][A-Za-z0-9_.:-]*$/)
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000)
const length = z.number().finite().positive().max(1_000_000)
const rectSchema = z.object({ x: coordinate, y: coordinate, width: length, height: length }).strict()
const slotSchema = z.object({
	id: identity, name: z.string().max(500), element: identity, region: rectSchema,
	lineHeight: length, align: z.enum(['start', 'middle', 'end']),
}).strict()
const labelSchema = z.object({
	id: identity, name: z.string().max(500), frame: identity,
	slots: z.array(slotSchema).min(1).max(2000), decorations: z.array(identity).max(2000),
}).strict()
const structureSchema = z.object({
	version: z.literal(1), id: z.string().uuid(), description: z.string().max(20_000),
	svg: z.string().min(1).max(2_000_000), css: z.string().max(200_000),
	labels: z.array(labelSchema).max(2000),
}).strict()
type Definition = z.infer<typeof structureSchema>
type Slot = z.infer<typeof slotSchema>
export type DiagramLine = { text: string; breakBefore: 'none' | 'soft' | 'hard' }
function invalid(message: string): never { throw new ContentError(`図の編集情報が不正です。${message}`) }
function elementById(document: SvgDocument, id: string): SvgElement {
	const element = document.ids.get(id)
	if (!element) invalid(`要素 ${id} がありません。`)
	return element
}
function elementLines(element: SvgElement): SvgElement[] {
	return element.children.map(child => { if (typeof child === 'string' || child.name !== 'text') invalid('編集するグループには text の行だけを置いてください。'); return child })
}
function ownedBy(document: SvgDocument, child: SvgElement, parent: SvgElement): boolean {
	return document.chains.get(child)?.includes(parent) ?? false
}
function face(style: Record<string, string>, text: string): void {
	const families = (style['font-family'] ?? '').split(',').map(family => family.trim().replace(/^"|"$/g, ''))
	if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text) && !families.includes('Noto Sans JP')) invalid('日本語の文字にはローカルの Noto Sans JP を書体または代替書体として指定してください。')
	const weight = style['font-weight'] === 'normal' ? 400 : Number(style['font-weight'])
	for (const family of families) checkDiagramFontFace({ family, weight, style: style['font-style'] ?? 'normal' })
}
function lineStyle(document: SvgDocument, element: SvgElement, css: DiagramCss): Record<string, string> {
	const chain = document.chains.get(element)
	if (!chain) invalid('文字の親要素がありません。')
	const style = computedPresentation(chain, css)
	face(style, svgText(element))
	for (let index = 0; index < chain.length; index++) {
		const ancestorStyle = computedPresentation(chain.slice(0, index + 1), css)
		if (['filter', 'mask', 'clip-path'].some(property => ancestorStyle[property] && ancestorStyle[property] !== 'none')) invalid('編集する文字の効果は通常の SVG 装飾へ変換してください。')
	}
	return style
}
function validateSlot(document: SvgDocument, element: SvgElement, slot: Slot, css: DiagramCss): void {
	if (element.name !== 'g') invalid('編集対象は g 要素が必要です。')
	const lines = elementLines(element)
	let signature: string | undefined
	for (const [index, line] of lines.entries()) {
		if (line.children.some(child => typeof child !== 'string') || /[\r\n]/.test(svgText(line))) invalid('文字の行は通常の文字だけにしてください。')
		if (['transform', 'rotate', 'dx', 'dy'].some(name => line.attrs[name] !== undefined)) invalid('文字の回転と移動はグループに指定してください。')
		if (numbers(line.attrs.x ?? '').length !== 1 || numbers(line.attrs.y ?? '').length !== 1) invalid('文字の座標は単一の値が必要です。')
		if (!line.attrs['data-break-before'] || (index === 0 && line.attrs['data-break-before'] !== 'none')) invalid('文字の行に改行の対応情報が必要です。')
		const style = lineStyle(document, line, css)
		if ((style['text-anchor'] ?? 'start') !== slot.align) invalid('文字の寄せ方と編集情報が一致しません。')
		const current = JSON.stringify(Object.entries(style).sort(([a], [b]) => a.localeCompare(b)))
		if (signature !== undefined && signature !== current) invalid('異なる書式の文字は別の編集欄に分けてください。')
		signature = current
	}
	if (!lines.length) lineStyle(document, element, css)
}
function rejectReferenceCycles(document: SvgDocument, css: DiagramCss): void {
	const graph = new Map<string, Set<string>>()
	for (const [element, chain] of document.chains) {
		const references: string[] = []
		for (const key of ['href', 'xlink:href']) if (element.attrs[key]) references.push(element.attrs[key].slice(1))
		const style = computedPresentation(chain, css)
		for (const value of Object.values(style)) for (const match of value.matchAll(/url\(#([A-Za-z_][A-Za-z0-9_.:-]*)\)/g)) if (match[1]) references.push(match[1])
		for (const ancestor of chain) {
			const id = ancestor.attrs.id
			if (!id) continue
			const edges = graph.get(id) ?? new Set<string>()
			for (const reference of references) edges.add(reference)
			graph.set(id, edges)
		}
	}
	const complete = new Set<string>()
	const active = new Set<string>()
	function visit(id: string, depth: number) {
		if (active.has(id) || depth > 64) invalid('図内の参照が循環しているか深すぎます。')
		if (complete.has(id)) return
		active.add(id)
		for (const target of graph.get(id) ?? []) visit(target, depth + 1)
		active.delete(id); complete.add(id)
	}
	for (const id of graph.keys()) visit(id, 0)
}
function validated(definition: Definition): Definition {
	const document = parseSvg(definition.svg)
	document.root.attrs['font-family'] ??= '"Geist","Noto Sans JP"'
	document.root.attrs['font-size'] ??= '16px'
	diagramViewport(definition)
	const css = parseDiagramCss(definition.css)
	if (document.chains.size * Math.max(1, css.rules.length) > 200_000) invalid('SVG と CSS の組み合わせが複雑すぎます。')
	for (const id of css.refs) if (!document.ids.has(id)) invalid(`CSS の参照先 ${id} がありません。`)
	const labelIds = new Set<string>()
	const owners = new Map<SvgElement, 'slot' | 'decoration'>()
	for (const label of definition.labels) {
		if (labelIds.has(label.id)) invalid('ラベル ID が重複しています。')
		labelIds.add(label.id)
		const frame = elementById(document, label.frame)
		if (!['g', 'svg'].includes(frame.name)) invalid('ラベルの座標系はグループが必要です。')
		const slotIds = new Set<string>()
		for (const slot of label.slots) {
			if (slotIds.has(slot.id)) invalid('編集欄の ID が重複しています。')
			slotIds.add(slot.id)
			const element = elementById(document, slot.element)
			if (owners.has(element) || !ownedBy(document, element, frame)) invalid('編集欄が重複しているかラベルの外にあります。')
			if (document.chains.get(element)?.some(ancestor => ['defs', 'pattern', 'marker', 'clipPath', 'mask'].includes(ancestor.name))) invalid('編集する文字は複製用の定義の外に配置してください。')
			owners.set(element, 'slot'); validateSlot(document, element, slot, css)
		}
		for (const id of label.decorations) {
			const element = elementById(document, id)
			if (owners.has(element) || !ownedBy(document, element, frame)) invalid('装飾が重複しているかラベルの外にあります。')
			owners.set(element, 'decoration')
		}
	}
	for (const [element, chain] of document.chains) {
		const ownership = chain.filter(ancestor => owners.has(ancestor))
		if (ownership.length > 1) invalid('文字や装飾の所有範囲が重複しています。')
		if (element.name === 'text' || element.name === 'tspan') {
			if (!ownership.length) invalid('すべての文字に編集欄か固定装飾の対応情報が必要です。')
			face(computedPresentation(chain, css), svgText(element))
		}
		if (element.name === 'use') {
			const target = elementById(document, (element.attrs.href ?? element.attrs['xlink:href'] ?? '').slice(1))
			for (const [owned, kind] of owners) if (kind === 'slot' && (ownedBy(document, target, owned) || ownedBy(document, owned, target))) invalid('編集する文字を use で複製できません。独立したラベルへ変換してください。')
		}
	}
	rejectReferenceCycles(document, css)
	return { ...definition, svg: serializeSvg(document.root), css: css.css }
}
export const diagramSchema = structureSchema.transform((definition, context) => {
	try { return validated(definition) }
	catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '図が不正です。' }); return z.NEVER }
})
export type Diagram = z.infer<typeof diagramSchema>
export function parseDiagram(raw: unknown): Diagram {
	const parsed = diagramSchema.safeParse(raw)
	if (!parsed.success) throw new ContentError(parsed.error.issues[0]?.message ?? '図が不正です。')
	return parsed.data
}
function findSlot(diagram: Diagram, labelId: string, slotId: string): Slot {
	const slot = diagram.labels.find(label => label.id === labelId)?.slots.find(slot => slot.id === slotId)
	if (!slot) invalid('編集欄が見つかりません。')
	return slot
}
function readSlot(document: SvgDocument, slot: Slot): string {
	return elementLines(elementById(document, slot.element)).map(line => `${line.attrs['data-break-before'] === 'hard' ? '\n' : ''}${svgText(line)}`).join('')
}
export function slotText(diagram: Diagram, labelId: string, slotId: string): string {
	return readSlot(parseSvg(diagram.svg), findSlot(diagram, labelId, slotId))
}
export function diagramSummary(diagram: Diagram) {
	const document = parseSvg(diagram.svg)
	return { id: diagram.id, description: diagram.description, labels: diagram.labels.map(label => ({
		id: label.id, name: label.name,
		slots: label.slots.map(slot => ({ id: slot.id, name: slot.name, value: readSlot(document, slot) })),
	})) }
}
export function replaceSlotLines(diagram: Diagram, labelId: string, slotId: string, lines: readonly DiagramLine[]): Diagram {
	const parsed = z.array(z.object({ text: z.string().max(20_000).refine(value => !/[\r\n]/.test(value)), breakBefore: z.enum(['none', 'soft', 'hard']) }).strict()).max(2000).safeParse(lines)
	if (!parsed.success || (parsed.data[0] && parsed.data[0].breakBefore !== 'none')) invalid('変更する文字の行が不正です。')
	const slot = findSlot(diagram, labelId, slotId)
	const document = parseSvg(diagram.svg)
	const element = elementById(document, slot.element)
	const first = elementLines(element)[0]
	const baseline = first ? Number(first.attrs.y) : slot.region.y + slot.lineHeight * 0.8
	const x = slot.region.x + (slot.align === 'middle' ? slot.region.width / 2 : slot.align === 'end' ? slot.region.width : 0)
	const attrs = { ...(first?.attrs ?? {}) }
	delete attrs.id
	delete attrs.class
	const css = parseDiagramCss(diagram.css)
	const style = computedPresentation(document.chains.get(first ?? element) ?? [], css)
	const direct = first?.attrs.style ? parseInlineStyle(first.attrs.style, []) : {}
	Object.assign(direct, style, { 'text-anchor': slot.align, 'white-space': 'pre' })
	attrs.style = Object.entries(direct).map(([key, entry]) => `${key}:${entry}`).join(';')
	const replacement = parsed.data.length ? parsed.data : [{ text: '', breakBefore: 'none' }]
	element.children = replacement.map((line, index) => ({
		name: 'text', attrs: { ...attrs, x: String(x), y: String(baseline + index * slot.lineHeight), 'data-break-before': line.breakBefore, 'xml:space': 'preserve' }, children: [line.text],
	}))
	return parseDiagram({ ...diagram, svg: serializeSvg(document.root) })
}
export function diagramViewport(diagram: Diagram): { width: number; height: number } {
	const { root } = parseSvg(diagram.svg)
	const viewBox = numbers(root.attrs.viewBox ?? '')
	const width = root.attrs.width && !root.attrs.width.endsWith('%') ? Number(root.attrs.width.replace(/px$/, '')) : viewBox[2]
	const height = root.attrs.height && !root.attrs.height.endsWith('%') ? Number(root.attrs.height.replace(/px$/, '')) : viewBox[3]
	if (!width || !height || width <= 0 || height <= 0) invalid('表示寸法が不正です。')
	return { width, height }
}
