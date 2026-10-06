import { resolve, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
export const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function dataDirectory(): string {
	const index = process.argv.indexOf('--data-dir')
	const selected = index >= 0 ? process.argv[index + 1] : process.env.DOCUMENT_DB_DATA_DIR
	if (selected && !isAbsolute(selected)) throw new Error('データディレクトリは絶対パスを指定してください。')
	return selected ?? resolve(projectDir, '.data')
}
export function serverPort(): number {
	const index = process.argv.indexOf('--port')
	const port = Number(index >= 0 ? process.argv[index + 1] : process.env.PORT ?? '4310')
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('ポート番号が不正です。')
	return port
}
