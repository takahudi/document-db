import { generate, ident, lexer, parse, walk, type CssNode } from 'css-tree'
import { ContentError } from './errors.js'
import { resolveDiagramFontFamily } from './diagram-fonts.js'

export const presentationProperties = new Set([
	'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
	'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
	'opacity', 'clip-path', 'clip-rule', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end',
	'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'word-spacing',
	'text-anchor', 'dominant-baseline', 'alignment-baseline', 'text-decoration', 'text-decoration-line',
	'text-decoration-color', 'text-decoration-style', 'visibility', 'display', 'white-space',
	'paint-order', 'vector-effect', 'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity',
	'color-interpolation', 'color-interpolation-filters', 'shape-rendering', 'text-rendering',
])
type MatchPart = { kind: 'id' | 'class' | 'tag'; name: string }
type Selector = { groups: MatchPart[][]; relations: string[]; specificity: [number, number, number] }
type Rule = { selectors: Selector[]; declarations: Record<string, string> }
export type DiagramCss = { css: string; rules: Rule[]; refs: string[] }
export type SvgStyleElement = { name: string; attrs: Record<string, string> }

function invalid(message: string): never { throw new ContentError(`図の CSS が不正です。${message}`) }
function value(property: string, node: CssNode, refs: string[]): string {
	if (!presentationProperties.has(property)) invalid(`未対応のプロパティ ${property}`)
	walk(node, current => {
		if (current.type === 'Raw' || current.type === 'Atrule') invalid('未対応の値です。')
		if (current.type === 'Identifier') current.name = ident.decode(current.name)
		if (current.type === 'Function') {
			current.name = ident.decode(current.name).toLowerCase()
			if (!['rgb', 'rgba', 'hsl', 'hsla'].includes(current.name)) invalid('未対応の関数です。')
		}
		if (current.type === 'Url') {
			if (!['fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end'].includes(property)
				|| !/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(current.value)) invalid('参照は図内の ID に限ります。')
			refs.push(current.value.slice(1))
		}
		if (current.type === 'Dimension' || current.type === 'Percentage' || current.type === 'Number') {
			if (!Number.isFinite(Number(current.value)) || Math.abs(Number(current.value)) > 1_000_000) invalid('数値が範囲外です。')
			if (current.type === 'Dimension' && !['px', 'deg'].includes(ident.decode(current.unit).toLowerCase())) invalid('単位は px または deg に限ります。')
		}
	})
	const svgKeywords: Readonly<Record<string, readonly string[]>> = {
		'color-interpolation': ['auto', 'sRGB', 'linearRGB'],
		'color-interpolation-filters': ['auto', 'sRGB', 'linearRGB'],
		'alignment-baseline': ['auto', 'baseline', 'before-edge', 'text-before-edge', 'middle', 'central', 'after-edge', 'text-after-edge', 'ideographic', 'alphabetic', 'hanging', 'mathematical'],
	}
	const svgGrammar = Object.hasOwn(svgKeywords, property) ? svgKeywords[property] : undefined
	if (svgGrammar ? !svgGrammar.includes(generate(node)) : !lexer.matchProperty(property, node).matched) invalid(`値が ${property} に対応しません。`)
	if (property === 'font-family') {
		if (node.type !== 'Value') invalid('書体の指定が不正です。')
		const names: string[] = []
		let words: string[] = []
		const flush = () => { if (!words.length) invalid('書体名がありません。'); names.push(...resolveDiagramFontFamily(words.join(' '))); words = [] }
		node.children.forEach(child => {
			if (child.type === 'Identifier') words.push(child.name)
			else if (child.type === 'String') words.push(child.value)
			else if (child.type === 'Operator' && child.value === ',') flush()
			else invalid('書体の指定が不正です。')
		})
		flush()
		return [...new Set(names)].map(name => `"${name}"`).join(',')
	}
	const result = generate(node)
	if (['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(result)) invalid('継承キーワードは省略か明示値に変換してください。')
	if (property === 'font-weight' && !['normal', '400', '500', '600', '700'].includes(result)) invalid('書体の太さは 400、500、600、700 に限ります。')
	if (property === 'font-style' && !['normal', 'italic'].includes(result)) invalid('書体のスタイルが未対応です。')
	if (property === 'font-size' && !/^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(result)) invalid('文字サイズは正の px 値が必要です。')
	if (property === 'font-size' && Number.parseFloat(result) <= 0) invalid('文字サイズは正数が必要です。')
	return result
}
function declarations(nodes: Iterable<CssNode>, refs: string[]): Record<string, string> {
	const result: Record<string, string> = {}
	for (const node of nodes) {
		if (node.type !== 'Declaration' || node.important) invalid('宣言と通常の優先順位だけに対応します。')
		const property = ident.decode(node.property).toLowerCase()
		result[property] = value(property, node.value, refs)
	}
	return result
}
function selector(node: CssNode): Selector {
	if (node.type !== 'Selector') invalid('セレクターが不正です。')
	const groups: MatchPart[][] = [[]]
	const relations: string[] = []
	const specificity: Selector['specificity'] = [0, 0, 0]
	for (const child of node.children) {
		if (child.type === 'Combinator') {
			if (![' ', '>'].includes(child.name) || !groups.at(-1)?.length) invalid('結合子が未対応です。')
			relations.push(child.name); groups.push([])
		} else {
			if (child.type !== 'IdSelector' && child.type !== 'ClassSelector' && child.type !== 'TypeSelector') invalid('属性や疑似セレクターは未対応です。')
			const name = ident.decode(child.name)
			if (name !== '*' && !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) invalid('セレクター名が不正です。')
			const kind = child.type === 'IdSelector' ? 'id' : child.type === 'ClassSelector' ? 'class' : 'tag'
			if (kind === 'id') specificity[0] += 1
			else if (kind === 'class') specificity[1] += 1
			else if (name !== '*') specificity[2] += 1
			groups.at(-1)?.push({ kind, name })
		}
	}
	if (!groups.at(-1)?.length || groups.length > 20) invalid('セレクターの構造が不正です。')
	return { groups, relations, specificity }
}
function parseStrict(source: string, context: 'stylesheet' | 'declarationList' | 'value'): CssNode {
	try { return parse(source, { context, onParseError: error => { throw error } }) }
	catch { return invalid('構文を解析できません。') }
}
export function parseDiagramCss(source: string): DiagramCss {
	const ast = parseStrict(source, 'stylesheet')
	if (ast.type !== 'StyleSheet') invalid('スタイルシートが必要です。')
	const refs: string[] = []
	const rules: Rule[] = []
	const rendered: string[] = []
	for (const node of ast.children) {
		if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') invalid('通常の規則だけに対応します。')
		const selectors = [...node.prelude.children].map(selector)
		const declaration = declarations(node.block.children, refs)
		rules.push({ selectors, declarations: declaration })
		rendered.push(`${generate(node.prelude)}{${Object.entries(declaration).map(([key, entry]) => `${key}:${entry}`).join(';')}}`)
	}
	if (rules.length > 2000) invalid('規則が多すぎます。')
	return { css: rendered.join('\n'), rules, refs }
}
export function parseInlineStyle(source: string, refs: string[]): Record<string, string> {
	const ast = parseStrict(source, 'declarationList')
	if (ast.type !== 'DeclarationList') invalid('宣言一覧が必要です。')
	return declarations(ast.children, refs)
}
export function validatePresentation(property: string, source: string, refs: string[]): string {
	if (property === 'font-size' && /^\d+(?:\.\d+)?$/.test(source)) source += 'px'
	return value(property, parseStrict(source, 'value'), refs)
}
function matches(selector: Selector, chain: readonly SvgStyleElement[]): boolean {
	function groupAt(groupIndex: number, elementIndex: number): boolean {
		const group = selector.groups[groupIndex]
		const element = chain[elementIndex]
		if (!group || !element) return false
		if (!group.every(part => part.kind === 'id' ? element.attrs.id === part.name
			: part.kind === 'class' ? (element.attrs.class ?? '').split(/\s+/).includes(part.name)
			: part.name === '*' || element.name === part.name)) return false
		if (groupIndex === 0) return true
		if (selector.relations[groupIndex - 1] === '>') return groupAt(groupIndex - 1, elementIndex - 1)
		for (let ancestor = elementIndex - 1; ancestor >= 0; ancestor--) if (groupAt(groupIndex - 1, ancestor)) return true
		return false
	}
	return groupAt(selector.groups.length - 1, chain.length - 1)
}
export function computedPresentation(chain: readonly SvgStyleElement[], css: DiagramCss): Record<string, string> {
	const result: Record<string, string> = { 'font-family': '"Geist","Noto Sans JP"', 'font-size': '16px', 'font-weight': '400', 'font-style': 'normal' }
	const local = ['opacity', 'clip-path', 'mask', 'filter', 'display', 'vector-effect', 'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity']
	for (let index = 0; index < chain.length; index++) {
		const current = chain[index]
		if (!current) continue
		const own: Record<string, string> = {}
		for (const [key, entry] of Object.entries(current.attrs)) if (presentationProperties.has(key)) own[key] = entry
		const applicable = css.rules.flatMap((rule, order) => rule.selectors.filter(item => matches(item, chain.slice(0, index + 1))).map(item => ({ ...rule, specificity: item.specificity, order })))
		applicable.sort((left, right) => left.specificity[0] - right.specificity[0] || left.specificity[1] - right.specificity[1] || left.specificity[2] - right.specificity[2] || left.order - right.order)
		for (const rule of applicable) Object.assign(own, rule.declarations)
		if (current.attrs.style) Object.assign(own, parseInlineStyle(current.attrs.style, []))
		for (const property of local) delete result[property]
		Object.assign(result, own)
	}
	return result
}
