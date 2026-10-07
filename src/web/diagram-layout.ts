import { parseDiagram, replaceSlotLines, type Diagram } from '../content/diagram.js'

type Line = { text: string; breakBefore: 'none' | 'soft' | 'hard' }
export type FitResult = { kind: 'applied'; diagram: Diagram } | { kind: 'refused'; message: string }

function documentView(document: Document) {
	const view = document.defaultView
	if (!view) throw new Error('図の表示先がありません。')
	return view
}

export function svgElement(document: Document, diagram: Diagram): SVGSVGElement {
	const parsed = new DOMParser().parseFromString(diagram.svg, 'image/svg+xml').documentElement
	const element = document.importNode(parsed, true)
	if (!(element instanceof documentView(document).SVGSVGElement)) throw new Error('図の SVG が不正です。')
	return element
}

async function requireFonts(document: Document, svg: SVGSVGElement, input: string) {
	for (const text of svg.querySelectorAll('text')) {
		const style = documentView(document).getComputedStyle(text)
		const sample = `${text.textContent ?? ''}${input}Aa日本語`
		for (const family of style.fontFamily.split(',')) {
			const face = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${family.trim()}`
			const fonts = await document.fonts.load(face, sample)
			if (!fonts.length || fonts.some(font => font.status !== 'loaded') || !document.fonts.check(face, sample)) throw new Error('図用の書体を読み込めません。入力を保持しています。')
		}
	}
	await document.fonts.ready
}

function slotBounds(svg: SVGSVGElement, elementId: string, document: Document) {
	const element = svg.querySelector(`#${CSS.escape(elementId)}`)
	if (!(element instanceof documentView(document).SVGGraphicsElement)) throw new Error('図の文字領域が見つかりません。')
	const box = element.getBBox()
	if (box.width === 0 && box.height === 0) return { x: box.x, y: box.y, width: 0, height: 0 }
	let stroke = 0
	for (const child of element.querySelectorAll('text')) {
		const style = documentView(document).getComputedStyle(child)
		if (style.stroke !== 'none') stroke = Math.max(stroke, Number.parseFloat(style.strokeWidth) / 2)
	}
	return { x: box.x - stroke, y: box.y - stroke, width: box.width + stroke * 2, height: box.height + stroke * 2 }
}

export async function fitSlot(diagram: Diagram, labelId: string, slotId: string, value: string, document: Document): Promise<FitResult> {
	const slot = diagram.labels.find(label => label.id === labelId)?.slots.find(slot => slot.id === slotId)
	if (!slot) return { kind: 'refused', message: '文字の編集対象が更新されています。入力を保持しています。' }
	const elementId = slot.element
	const host = document.createElement('div')
	host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none'
	document.body.append(host)
	function measure(lines: Line[]) {
		const candidate = replaceSlotLines(diagram, labelId, slotId, lines)
		const svg = svgElement(document, candidate)
		host.replaceChildren(svg)
		return { candidate, bounds: slotBounds(svg, elementId, document) }
	}
	try {
		const seed = replaceSlotLines(diagram, labelId, slotId, [{ text: '', breakBefore: 'none' }])
		const probe = svgElement(document, seed)
		host.replaceChildren(probe)
		await requireFonts(document, probe, value)
		const probeText = probe.querySelector(`#${CSS.escape(elementId)} text`)
		if (!probeText) throw new Error('図の文字領域が見つかりません。')
		const lines: Line[] = []
		const paragraphs = value.replace(/\r\n?/g, '\n').split('\n')
		if (!value.trim()) return { kind: 'applied', diagram: replaceSlotLines(diagram, labelId, slotId, paragraphs.map((text, index) => ({ text, breakBefore: index === 0 ? 'none' : 'hard' }))) }
		const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
		for (const [index, paragraph] of paragraphs.entries()) {
			let current = ''
			let breakBefore: Line['breakBefore'] = index === 0 ? 'none' : 'hard'
			for (const { segment } of segmenter.segment(paragraph)) {
				const trial = current + segment
				probeText.textContent = trial
				const bounds = slotBounds(probe, elementId, document)
				if (bounds.width <= slot.region.width + 0.25) { current = trial; continue }
				if (!current) return { kind: 'refused', message: '文字が領域に収まりません。入力を保持して、AI に配置変更を依頼してください。' }
				lines.push({ text: current, breakBefore })
				current = segment
				breakBefore = 'soft'
			}
			lines.push({ text: current, breakBefore })
		}
		const { candidate, bounds } = measure(lines)
		if (bounds.width === 0 && bounds.height === 0) return { kind: 'applied', diagram: candidate }
		const region = slot.region
		if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
			|| bounds.x < region.x - 0.25 || bounds.y < region.y - 0.25
			|| bounds.x + bounds.width > region.x + region.width + 0.25
			|| bounds.y + bounds.height > region.y + region.height + 0.25) {
			return { kind: 'refused', message: '文字が領域に収まりません。入力を保持して、AI に配置変更を依頼してください。' }
		}
		return { kind: 'applied', diagram: parseDiagram(candidate) }
	} catch (error) {
		return { kind: 'refused', message: error instanceof Error ? error.message : '文字を適用できません。入力を保持しています。' }
	} finally { host.remove() }
}
