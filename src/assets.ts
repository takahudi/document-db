import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { assetIdSchema, ContentError } from './content/parts.js'

const assetSchema = z.object({ id: assetIdSchema, mime: z.string(), basename: z.string() })
export function openAssets(db: DatabaseSync, dataDir: string) {
	const directory = join(dataDir, 'images')
	mkdirSync(directory, { recursive: true })
	function read(id: string) {
		assetIdSchema.parse(id)
		const value = db.prepare('SELECT id, mime, basename FROM assets WHERE id = ?').get(id)
		if (!value) throw new ContentError('画像参照が見つかりません。')
		const asset = assetSchema.parse(value)
		return { bytes: readFileSync(join(directory, asset.basename)), mime: asset.mime }
	}
	return {
		read,
		check(id: string) { read(id) },
		async add(bytes: Buffer) {
			if (bytes.length > 20_000_000) throw new ContentError('画像は 20 MB 以下にしてください。')
			const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()
			const formats = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
			const format = z.enum(['png', 'jpeg', 'webp']).safeParse(metadata.format)
			if (!format.success) throw new ContentError('PNG、JPEG、WebP の画像を選択してください。')
			await sharp(bytes, { limitInputPixels: 40_000_000 }).raw().toBuffer()
			const id = randomUUID()
			const basename = `${id}.${format.data}`
			const temporary = join(directory, `${id}.tmp`)
			writeFileSync(temporary, bytes, { flag: 'wx' })
			renameSync(temporary, join(directory, basename))
			db.prepare('INSERT INTO assets(id,mime,basename) VALUES(?,?,?)').run(id, formats[format.data], basename)
			return { id, reference: `asset:${id}` }
		},
	}
}
