import { emptyBody, type BodyNode } from '../content/parts.js'
import type { Snapshot } from './api.js'
export type DiagramDraft = { diagramId: string; labelId: string; slotId: string; text: string; message: string }
export type Session = { baseline: Snapshot | null; title: string; body: BodyNode; editorKey: string; diagramDrafts: Record<string, DiagramDraft> }
export type EditState =
	| { kind: 'empty' }
	| { kind: 'loading'; previous: Session | null }
	| { kind: 'load-failed'; message: string }
	| { kind: 'editing'; session: Session; message: string }
	| { kind: 'saving'; session: Session; operation: 'save' | 'restore' | 'reload' }
	| { kind: 'save-failed' | 'conflict'; session: Session; message: string }
type Action =
	| { kind: 'new' }
	| { kind: 'load' }
	| { kind: 'loaded'; document: Snapshot; message: string }
	| { kind: 'saved'; document: Snapshot; message: string }
	| { kind: 'edit'; title?: string; body?: BodyNode }
	| { kind: 'diagram-draft'; draft: DiagramDraft }
	| { kind: 'discard-diagram-draft'; key: string }
	| { kind: 'pending'; operation: 'save' | 'restore' | 'reload' }
	| { kind: 'failed'; message: string; conflict: boolean }
export function sessionOf(state: EditState): Session | null { return 'session' in state ? state.session : state.kind === 'loading' ? state.previous : null }
export function diagramDraftKey(draft: Pick<DiagramDraft, 'diagramId' | 'labelId' | 'slotId'>): string { return JSON.stringify([draft.diagramId, draft.labelId, draft.slotId]) }
export function isBodyDirty(session: Session): boolean { return !session.baseline || session.title !== session.baseline.title || JSON.stringify(session.body) !== JSON.stringify(session.baseline.body) }
export function isDirty(session: Session): boolean { return isBodyDirty(session) || Object.keys(session.diagramDrafts).length > 0 }
export function reducer(state: EditState, action: Action): EditState {
	const session = sessionOf(state)
	switch (action.kind) {
		case 'new': return { kind: 'editing', session: { baseline: null, title: '', body: emptyBody(), editorKey: crypto.randomUUID(), diagramDrafts: {} }, message: '' }
		case 'load': return { kind: 'loading', previous: session }
		case 'loaded': return { kind: 'editing', session: { baseline: action.document, title: action.document.title, body: action.document.body, editorKey: crypto.randomUUID(), diagramDrafts: {} }, message: action.message }
		case 'saved': return { kind: 'editing', session: { baseline: action.document, title: action.document.title, body: action.document.body, editorKey: `${action.document.id}:${action.document.revision}`, diagramDrafts: session?.diagramDrafts ?? {} }, message: action.message }
		case 'edit': return session ? { kind: 'editing', session: { ...session, title: action.title ?? session.title, body: action.body ?? session.body }, message: '' } : state
		case 'diagram-draft': return session ? { kind: 'editing', session: { ...session, diagramDrafts: { ...session.diagramDrafts, [diagramDraftKey(action.draft)]: action.draft } }, message: '' } : state
		case 'discard-diagram-draft': {
			if (!session) return state
			const diagramDrafts = { ...session.diagramDrafts }
			delete diagramDrafts[action.key]
			return { kind: 'editing', session: { ...session, diagramDrafts }, message: '' }
		}
		case 'pending': return session ? { kind: 'saving', session, operation: action.operation } : state
		case 'failed': return session ? { kind: action.conflict ? 'conflict' : 'save-failed', session, message: action.message } : { kind: 'load-failed', message: action.message }
	}
}
