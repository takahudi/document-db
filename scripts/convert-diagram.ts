import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { convertGeneratedDiagram } from '../src/diagram-conversion.js'

const { values } = parseArgs({ options: { html: { type: 'string' }, manifest: { type: 'string' }, out: { type: 'string' }, title: { type: 'string' }, 'browser-path': { type: 'string' } } })
if (!values.html || !values.manifest || !values.out || !values.title) throw new Error('必要な引数: --html drawing.html --manifest drawing.labels.json --out document.json --title 文書タイトル')
const document = await convertGeneratedDiagram({ html: await readFile(values.html, 'utf8'), manifest: JSON.parse(await readFile(values.manifest, 'utf8')), title: values.title, browserPath: values['browser-path'] })
await writeFile(values.out, JSON.stringify(document, null, 2) + '\n')
process.stderr.write(`変換しました。図 ${document.diagrams.length} 件。${values.out}\n`)
