import { ContentError } from './errors.js'

export type DiagramFontFace = {
	family: string
	package: string
	weight: number
	style: 'normal' | 'italic'
}
const families = [
	{ family: 'Geist', package: '@fontsource/geist', weights: [400, 500, 600, 700], italic: false },
	{ family: 'Geist Mono', package: '@fontsource/geist-mono', weights: [400, 500, 600, 700], italic: false },
	{ family: 'Instrument Serif', package: '@fontsource/instrument-serif', weights: [400], italic: true },
	{ family: 'Noto Sans JP', package: '@fontsource/noto-sans-jp', weights: [400, 500, 600, 700], italic: false },
	{ family: 'Noto Serif', package: '@fontsource/noto-serif', weights: [400, 500, 600, 700], italic: true },
]
export const diagramFontFaces: readonly DiagramFontFace[] = families.flatMap(font => {
	const normal: DiagramFontFace[] = font.weights.map(weight => ({ family: font.family, package: font.package, weight, style: 'normal' }))
	const italic: DiagramFontFace[] = font.italic ? [{ family: font.family, package: font.package, weight: 400, style: 'italic' }] : []
	return [...normal, ...italic]
})
export const diagramFontFamilies = families.map(font => font.family)
const aliases: Readonly<Record<string, readonly string[]>> = {
	'sans-serif': ['Geist', 'Noto Sans JP'],
	'serif': ['Noto Serif', 'Noto Sans JP'],
	'monospace': ['Geist Mono', 'Noto Sans JP'],
}
export function resolveDiagramFontFamily(family: string): readonly string[] {
	const alias = Object.hasOwn(aliases, family.toLowerCase()) ? aliases[family.toLowerCase()] : undefined
	if (alias) return alias
	const font = families.find(font => font.family.toLowerCase() === family.toLowerCase())
	if (!font) throw new ContentError(`図の書体「${family}」は利用できません。対応書体で生成してください。`)
	return [font.family]
}
export function checkDiagramFontFace(input: { family: string; weight: number; style: string }): void {
	if (!diagramFontFaces.some(face => face.family === input.family && face.weight === input.weight && face.style === input.style)) {
		throw new ContentError(`図の書体「${input.family}」の ${input.weight} ${input.style} は利用できません。`)
	}
}
