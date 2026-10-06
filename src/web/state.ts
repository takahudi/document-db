import { emptyBody, type BodyNode } from '../content/parts.js'
import type { Snapshot } from './api.js'
export type Session = { baseline: Snapshot | null; title: string; body: BodyNode; editorKey: string }
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
	| { kind: 'edit'; title?: string; body?: BodyNode }
	| { kind: 'pending'; operation: 'save' | 'restore' | 'reload' }
	| { kind: 'failed'; message: string; conflict: boolean }
export function sessionOf(state: EditState): Session | null { return 'session' in state ? state.session : state.kind === 'loading' ? state.previous : null }
export function isDirty(session: Session): boolean { return !session.baseline || session.title !== session.baseline.title || JSON.stringify(session.body) !== JSON.stringify(session.baseline.body) }
export function reducer(state: EditState, action: Action): EditState {
	const session = sessionOf(state)
	switch (action.kind) {
		case 'new': return { kind: 'editing', session: { baseline: null, title: '', body: emptyBody(), editorKey: crypto.randomUUID() }, message: '' }
		case 'load': return { kind: 'loading', previous: session }
		case 'loaded': return { kind: 'editing', session: { baseline: action.document, title: action.document.title, body: action.document.body, editorKey: `${action.document.id}:${action.document.revision}` }, message: action.message }
		case 'edit': return session ? { kind: 'editing', session: { ...session, title: action.title ?? session.title, body: action.body ?? session.body }, message: '' } : state
		case 'pending': return session ? { kind: 'saving', session, operation: action.operation } : state
		case 'failed': return session ? { kind: action.conflict ? 'conflict' : 'save-failed', session, message: action.message } : { kind: 'load-failed', message: action.message }
	}
}
