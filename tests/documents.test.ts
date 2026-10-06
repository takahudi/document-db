import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDocuments, DocumentError } from '../src/documents.js'
test('別接続の保存、競合、復元、再起動を実ファイルで確認する', () => {
	const dataDir = mkdtempSync(join(tmpdir(), 'document-db-test-'))
	const first = openDocuments({ dataDir }), second = openDocuments({ dataDir })
	const draft = { title: '最初', body: { kind: 'html' as const, value: '<p>本文</p>' } }
	const created = first.create(draft)
	assert.equal(created.revision, 1); assert.equal(created.canRestore, false)
	const saved = second.update({ ...draft, title: 'AI 更新', id: created.id, expectedRevision: 1 })
	assert.equal(saved.revision, 2)
	const conflict = (error: unknown) => error instanceof DocumentError && error.kind === 'conflict'
	assert.throws(() => first.update({ ...draft, id: created.id, expectedRevision: 1 }), conflict)
	assert.throws(() => first.restore({ id: created.id, expectedRevision: 1 }), conflict)
	assert.throws(() => first.update({ ...draft, id: created.id, expectedRevision: 2, body: { kind: 'html', value: '<p style="x">bad</p>' } }))
	assert.deepEqual(first.read(created.id), saved)
	const restored = first.restore({ id: created.id, expectedRevision: 2 })
	assert.equal(restored.title, '最初'); assert.equal(restored.revision, 3); assert.equal(restored.canRestore, false)
	assert.throws(() => second.restore({ id: created.id, expectedRevision: 3 }), error => error instanceof DocumentError && error.kind === 'nothing-to-restore')
	first.close(); second.close()
	const reopened = openDocuments({ dataDir }); assert.deepEqual(reopened.read(created.id), restored); reopened.close()
})
test('途中の SQL 失敗とロック保持は現在・直前・版を変更しない', () => {
	const dataDir = mkdtempSync(join(tmpdir(), 'document-db-atomic-'))
	const docs = openDocuments({ dataDir })
	const initial = docs.create({ title: '初期', body: { kind: 'html', value: '<p>保持</p>' } })
	const separate = new DatabaseSync(join(dataDir, 'documents.sqlite'))
	separate.exec("CREATE TRIGGER fail_update AFTER UPDATE ON documents BEGIN SELECT RAISE(ABORT, 'injected failure'); END;")
	assert.throws(() => docs.update({ id: initial.id, expectedRevision: 1, title: '失敗', body: { kind: 'html', value: '<p>失敗</p>' } }))
	assert.deepEqual(docs.read(initial.id), initial)
	separate.exec('DROP TRIGGER fail_update; BEGIN IMMEDIATE;')
	assert.throws(() => docs.update({ id: initial.id, expectedRevision: 1, title: 'ロック', body: { kind: 'html', value: '<p>失敗</p>' } }), error => error instanceof DocumentError && error.kind === 'busy')
	separate.exec('ROLLBACK'); separate.close(); docs.close()
})
