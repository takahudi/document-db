import { SaxesParser } from 'saxes'
import { ContentError } from './errors.js'
import { parseInlineStyle, presentationProperties, validatePresentation } from './diagram-css.js'

export type SvgElement = { name: string; attrs: Record<string, string>; children: Array<SvgElement | string> }
export type SvgDocument = { root: SvgElement; ids: Map<string, SvgElement>; chains: Map<SvgElement, SvgElement[]>; refs: string[] }
const namespace = 'http://www.w3.org/2000/svg'
const idPattern = /^[A-Za-z_][A-Za-z0-9_.:-]*$/
const shared = new Set(['id', 'class', 'style', 'transform', 'xml:space', ...presentationProperties])
const attributes: Readonly<Record<string, readonly string[]>> = {
	svg: ['xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'role', 'aria-labelledby'], g: [], defs: [], title: [], desc: [],
	path: ['d', 'pathLength'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'pathLength'],
	circle: ['cx', 'cy', 'r', 'pathLength'], ellipse: ['cx', 'cy', 'rx', 'ry', 'pathLength'],
	line: ['x1', 'y1', 'x2', 'y2', 'pathLength'], polyline: ['points', 'pathLength'], polygon: ['points', 'pathLength'],
	text: ['x', 'y', 'dx', 'dy', 'rotate', 'data-break-before'], tspan: ['x', 'y', 'dx', 'dy', 'rotate'],
	use: ['href', 'xlink:href', 'x', 'y', 'width', 'height'],
	linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
	radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
	stop: ['offset'], pattern: ['x', 'y', 'width', 'height', 'patternUnits', 'patternContentUnits', 'patternTransform', 'viewBox', 'preserveAspectRatio', 'href', 'xlink:href'],
	marker: ['markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'viewBox', 'preserveAspectRatio'],
	clipPath: ['clipPathUnits'], mask: ['x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits'],
	filter: ['x', 'y', 'width', 'height', 'filterUnits', 'primitiveUnits'],
	feGaussianBlur: ['in', 'stdDeviation', 'edgeMode', 'result'], feOffset: ['in', 'dx', 'dy', 'result'],
	feDropShadow: ['in', 'dx', 'dy', 'stdDeviation', 'result'], feBlend: ['in', 'in2', 'mode', 'result'],
	feColorMatrix: ['in', 'type', 'values', 'result'], feFlood: ['result'], feMerge: ['result'], feMergeNode: ['in'],
}
const scalar = new Set(['x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'pathLength', 'markerWidth', 'markerHeight', 'refX', 'refY', 'offset'])
const units = new Set(['gradientUnits', 'patternUnits', 'patternContentUnits', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'filterUnits', 'primitiveUnits'])
function invalid(message: string): never { throw new ContentError(`図の SVG が不正です。${message}`) }
export function numbers(source: string): number[] {
	if (!source.trim()) invalid('数値がありません。')
	const tokens = source.trim().split(/[\s,]+/)
	if (tokens.some(token => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token))) invalid('数値の構文が不正です。')
	const result = tokens.map(Number)
	if (result.some(number => !Number.isFinite(number) || Math.abs(number) > 1_000_000)) invalid('数値が範囲外です。')
	return result
}
function checkTransform(source: string): void {
	let consumed = 0
	let count = 0
	for (const match of source.matchAll(/([A-Za-z]+)\s*\(([^()]*)\)/g)) {
		if (source.slice(consumed, match.index).trim().replaceAll(',', '')) invalid('変換式が不正です。')
		consumed = match.index + match[0].length
		const kind = match[1] ?? ''
		const values = numbers(match[2] ?? '')
		const permitted = kind === 'matrix' ? [6] : ['translate', 'scale'].includes(kind) ? [1, 2] : kind === 'rotate' ? [1, 3] : ['skewX', 'skewY'].includes(kind) ? [1] : []
		if (!permitted.includes(values.length) || ++count > 50) invalid('変換式が未対応です。')
	}
	if (!count || source.slice(consumed).trim()) invalid('変換式が不正です。')
}
function checkPath(source: string): void {
	const tokens: string[] = []
	let consumed = 0
	for (const match of source.matchAll(/[A-Za-z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)) {
		if (source.slice(consumed, match.index).replace(/[\s,]/g, '')) invalid('パスが不正です。')
		tokens.push(match[0]); consumed = match.index + match[0].length
	}
	if (source.slice(consumed).replace(/[\s,]/g, '') || tokens.length > 100_000 || !['M', 'm'].includes(tokens[0] ?? '')) invalid('パスが不正です。')
	const arities: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
	let index = 0
	while (index < tokens.length) {
		const command = tokens[index++]?.toUpperCase() ?? ''
		const arity = arities[command]
		if (arity === undefined) invalid('パス命令が未対応です。')
		const values: number[] = []
		while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index] ?? '')) values.push(...numbers(tokens[index++] ?? ''))
		if (arity === 0 ? values.length > 0 : values.length === 0 || values.length % arity !== 0) invalid('パスの座標数が不正です。')
		if (command === 'A') for (let offset = 0; offset < values.length; offset += 7) {
			if ((values[offset] ?? -1) < 0 || (values[offset + 1] ?? -1) < 0 || ![0, 1].includes(values[offset + 3] ?? -1) || ![0, 1].includes(values[offset + 4] ?? -1)) invalid('円弧の引数が不正です。')
		}
	}
}
function validateAttribute(element: SvgElement, name: string, value: string, refs: string[]): string {
	if (!shared.has(name) && !attributes[element.name]?.includes(name)) invalid(`${element.name} の属性 ${name} は未対応です。`)
	if (name === 'id' && (!idPattern.test(value) || value.length > 120)) invalid('ID が不正です。')
	if (name === 'class' && value.split(/\s+/).some(item => item && !idPattern.test(item))) invalid('クラス名が不正です。')
	if (name === 'xmlns' && value !== namespace) invalid('名前空間が不正です。')
	if (name === 'xmlns:xlink' && value !== 'http://www.w3.org/1999/xlink') invalid('参照の名前空間が不正です。')
	if (name === 'role' && value !== 'img') invalid('図の role は img に限ります。')
	if (name === 'aria-labelledby') {
		const ids = value.trim().split(/\s+/)
		if (ids.some(id => !idPattern.test(id))) invalid('読み上げ用の参照は図内の ID が必要です。')
		refs.push(...ids)
	}
	if (name === 'xml:space' && value !== 'preserve') invalid('文字の空白は preserve が必要です。')
	if (name === 'style') return Object.entries(parseInlineStyle(value, refs)).map(([key, entry]) => `${key}:${entry}`).join(';')
	if (presentationProperties.has(name)) return validatePresentation(name, value, refs)
	if (name === 'href' || name === 'xlink:href') {
		if (!value.startsWith('#') || !idPattern.test(value.slice(1))) invalid('参照は図内の ID に限ります。')
		refs.push(value.slice(1))
	}
	if (scalar.has(name)) {
		const parsed = numbers(value.replace(/(?:px|%)$/, ''))
		if (parsed.length !== 1) invalid('単一の数値が必要です。')
		if (['width', 'height', 'r', 'rx', 'ry', 'fr', 'pathLength', 'markerWidth', 'markerHeight'].includes(name) && (parsed[0] ?? -1) < 0) invalid('長さは非負数が必要です。')
	}
	if (['dx', 'dy', 'rotate', 'values', 'stdDeviation'].includes(name)) numbers(value)
	if (name === 'viewBox') { const box = numbers(value); if (box.length !== 4 || (box[2] ?? 0) <= 0 || (box[3] ?? 0) <= 0) invalid('viewBox が不正です。') }
	if (name === 'points' && numbers(value).length % 2 !== 0) invalid('点の座標が不正です。')
	if (['transform', 'gradientTransform', 'patternTransform'].includes(name)) checkTransform(value)
	if (name === 'd') checkPath(value)
	if (units.has(name) && !['userSpaceOnUse', 'objectBoundingBox'].includes(value)) invalid('座標系が不正です。')
	const enums: Readonly<Record<string, readonly string[]>> = {
		spreadMethod: ['pad', 'reflect', 'repeat'], markerUnits: ['strokeWidth', 'userSpaceOnUse'],
		edgeMode: ['duplicate', 'wrap', 'none'], mode: ['normal', 'multiply', 'screen', 'darken', 'lighten'],
		type: ['matrix', 'saturate', 'hueRotate', 'luminanceToAlpha'],
	}
	if (enums[name] && !enums[name].includes(value)) invalid(`${name} の値が未対応です。`)
	if (['in', 'in2', 'result'].includes(name) && !idPattern.test(value)) invalid('フィルターの参照名が不正です。')
	if (name === 'data-break-before' && !['none', 'soft', 'hard'].includes(value)) invalid('改行の種類が不正です。')
	if (name === 'orient' && !['auto', 'auto-start-reverse'].includes(value)) numbers(value)
	if (name === 'preserveAspectRatio' && !/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value)) invalid('縦横比の指定が不正です。')
	return value
}
export function parseSvg(source: string): SvgDocument {
	if (source.length > 2_000_000) invalid('原稿が大きすぎます。')
	const parser = new SaxesParser({ xmlns: true })
	const stack: SvgElement[] = []
	const ids = new Map<string, SvgElement>()
	const chains = new Map<SvgElement, SvgElement[]>()
	const refs: string[] = []
	let root: SvgElement | undefined
	let count = 0
	parser.on('doctype', () => invalid('DOCTYPE は使えません。'))
	parser.on('processinginstruction', () => invalid('処理命令は使えません。'))
	parser.on('cdata', () => invalid('CDATA は使えません。'))
	parser.on('error', () => invalid('XML の構文が不正です。'))
	parser.on('opentag', tag => {
		if (tag.uri !== namespace || tag.prefix || !Object.hasOwn(attributes, tag.local)) invalid(`要素 ${tag.name} は未対応です。`)
		if (++count > 20_000 || stack.length > 64) invalid('図の要素が多すぎます。')
		const element: SvgElement = { name: tag.local, attrs: {}, children: [] }
		for (const attribute of Object.values(tag.attributes)) {
			if (attribute.prefix && !['xml', 'xmlns', 'xlink'].includes(attribute.prefix)) invalid('属性の名前空間が未対応です。')
			if (attribute.prefix === 'xlink' && attribute.uri !== 'http://www.w3.org/1999/xlink') invalid('属性の名前空間が不正です。')
			element.attrs[attribute.name] = validateAttribute(element, attribute.name, attribute.value, refs)
		}
		if (element.attrs.id) { if (ids.has(element.attrs.id)) invalid('ID が重複しています。'); ids.set(element.attrs.id, element) }
		const parent = stack.at(-1)
		if (parent) parent.children.push(element)
		else { if (root || element.name !== 'svg') invalid('ルートは一つの SVG が必要です。'); root = element }
		if (parent && element.name === 'svg') invalid('入れ子の SVG はグループへ変換してください。')
		if (element.name === 'use' && (!element.attrs.href && !element.attrs['xlink:href'] || element.attrs.href && element.attrs['xlink:href'])) invalid('use には一つの参照が必要です。')
		stack.push(element); chains.set(element, [...stack])
	})
	parser.on('text', text => {
		const parent = stack.at(-1)
		if (!parent) { if (text.trim()) invalid('SVG 外に文字があります。'); return }
		if (['text', 'tspan', 'title', 'desc'].includes(parent.name)) parent.children.push(text)
		else if (text.trim()) invalid('文字の場所が不正です。')
	})
	parser.on('closetag', () => { stack.pop() })
	try { parser.write(source).close() } catch (error) { if (error instanceof ContentError) throw error; invalid('XML の構文が不正です。') }
	if (!root || !root.attrs.viewBox) invalid('SVG に viewBox が必要です。')
	for (const key of ['width', 'height']) if (root.attrs[key] && Number.parseFloat(root.attrs[key]) <= 0) invalid('SVG の表示寸法は正数が必要です。')
	for (const ref of refs) if (!ids.has(ref)) invalid(`参照先 ${ref} がありません。`)
	return { root, ids, chains, refs }
}
const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
export function serializeSvg(element: SvgElement): string {
	const attrs = Object.entries(element.attrs).map(([key, value]) => ` ${key}="${escapeText(value).replaceAll('"', '&quot;')}"`).join('')
	return `<${element.name}${attrs}>${element.children.map(child => typeof child === 'string' ? escapeText(child) : serializeSvg(child)).join('')}</${element.name}>`
}
export function svgText(element: SvgElement): string { return element.children.map(child => typeof child === 'string' ? child : svgText(child)).join('') }
