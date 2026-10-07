import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { diagramFontFaces } from './content/diagram-fonts.js'
import { ContentError } from './content/errors.js'

const require = createRequire(import.meta.url)
const packages = new Map<string, string>()
export const diagramFontCss = diagramFontFaces.map(face => {
	const slug = face.package.slice('@fontsource/'.length)
	const cssPath = require.resolve(`${face.package}/${face.weight}${face.style === 'italic' ? '-italic' : ''}.css`)
	packages.set(slug, dirname(cssPath))
	return readFileSync(cssPath, 'utf8').replaceAll('./files/', `/diagram-fonts/${slug}/`)
}).join('\n')

export function readDiagramFont(slug: string, file: string): { mime: string; bytes: Buffer } {
	const directory = packages.get(slug)
	if (!directory || !/^[a-z0-9-]+\.woff2?$/.test(file)) throw new ContentError('書体ファイルが見つかりません。')
	return { mime: file.endsWith('.woff2') ? 'font/woff2' : 'font/woff', bytes: readFileSync(join(directory, 'files', file)) }
}
