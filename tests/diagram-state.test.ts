import test from 'node:test'
import assert from 'node:assert/strict'
import { reducer, sessionOf, isDirty, isBodyDirty, diagramDraftKey, type DiagramDraft } from '../src/web/state.js'
import type { Snapshot } from '../src/web/api.js'

const snapshot: Snapshot = { id: 'document', revision: 1, title: '文書', body: { type: 'doc', content: [{ type: 'paragraph' }] }, html: '<p></p>', canRestore: true }
const draft: DiagramDraft = { diagramId: 'diagram', labelId: 'label', slotId: 'slot', text: '収まらない長い文字', message: '領域に収まりません。' }

test('unapplied diagram input survives body save and editor remount without enabling another save', () => {
	let state = reducer({ kind: 'empty' }, { kind: 'loaded', document: snapshot, message: '' })
	state = reducer(state, { kind: 'diagram-draft', draft })
	state = reducer(state, { kind: 'edit', title: '本文を変更' })
	const before = sessionOf(state)
	assert.ok(before)
	assert.equal(isBodyDirty(before), true)
	state = reducer(state, { kind: 'pending', operation: 'save' })
	state = reducer(state, { kind: 'saved', document: { ...snapshot, title: '本文を変更', revision: 2 }, message: '保存しました。' })
	const session = sessionOf(state)
	assert.ok(session)
	assert.notEqual(session.editorKey, before.editorKey)
	assert.deepEqual(session.diagramDrafts[diagramDraftKey(draft)], draft)
	assert.equal(isBodyDirty(session), false)
	assert.equal(isDirty(session), true)
})

test('conflicts, save failure and failed reload preserve canonical edits and pending diagram input', () => {
	for (const operation of ['conflict', 'save-failed', 'reload-failed']) {
		let state = reducer({ kind: 'empty' }, { kind: 'loaded', document: snapshot, message: '' })
		state = reducer(state, { kind: 'edit', title: 'まだ保存していない本文' })
		state = reducer(state, { kind: 'diagram-draft', draft })
		state = operation === 'reload-failed' ? reducer(state, { kind: 'load' }) : reducer(state, { kind: 'pending', operation: 'save' })
		state = reducer(state, { kind: 'failed', conflict: operation === 'conflict', message: '拒否されました。' })
		const session = sessionOf(state)
		assert.ok(session)
		assert.equal(session.title, 'まだ保存していない本文')
		assert.deepEqual(session.diagramDrafts[diagramDraftKey(draft)], draft)
	}
})

test('applying one slot removes only its draft; body replacement retains other input', () => {
	const other = { ...draft, slotId: 'other', text: '別の入力' }
	let state = reducer({ kind: 'empty' }, { kind: 'loaded', document: snapshot, message: '' })
	state = reducer(state, { kind: 'diagram-draft', draft })
	state = reducer(state, { kind: 'diagram-draft', draft: other })
	state = reducer(state, { kind: 'edit', body: snapshot.body })
	assert.equal(Object.keys(sessionOf(state)?.diagramDrafts ?? {}).length, 2)
	state = reducer(state, { kind: 'discard-diagram-draft', key: diagramDraftKey(draft) })
	assert.deepEqual(sessionOf(state)?.diagramDrafts, { [diagramDraftKey(other)]: other })
})

test('a confirmed new document or successful reload starts a clean draft session', () => {
	let state = reducer({ kind: 'empty' }, { kind: 'loaded', document: snapshot, message: '' })
	state = reducer(state, { kind: 'diagram-draft', draft })
	state = reducer(state, { kind: 'loaded', document: snapshot, message: '' })
	assert.deepEqual(sessionOf(state)?.diagramDrafts, {})
	state = reducer(state, { kind: 'diagram-draft', draft })
	state = reducer(state, { kind: 'new' })
	assert.deepEqual(sessionOf(state)?.diagramDrafts, {})
})
