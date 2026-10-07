import { useEffect, useReducer, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, ApiError, type Summary } from './api.js'
import { reducer, sessionOf, isDirty, isBodyDirty, diagramDraftKey } from './state.js'
import { diagramSummary, parseDiagram } from '../content/diagram.js'
import type { BodyNode } from '../content/parts.js'
import { DocumentEditor } from './editor.js'
import './style.css'

function App() {
	const [state, dispatch] = useReducer(reducer, { kind: 'empty' })
	const [list, setList] = useState<{ kind: 'loading' } | { kind: 'ready'; documents: Summary[] } | { kind: 'failed'; message: string }>({ kind: 'loading' })
	const session = sessionOf(state)
	const dirty = session ? isDirty(session) : false
	const bodyDirty = session ? isBodyDirty(session) : false
	const draftCount = session ? Object.keys(session.diagramDrafts).length : 0
	const existingSlots = new Set<string>()
	function visit(node: BodyNode) {
		if (node.type === 'diagram') {
			const diagram = diagramSummary(parseDiagram(node.attrs?.definition))
			for (const label of diagram.labels) for (const slot of label.slots) existingSlots.add(diagramDraftKey({ diagramId: diagram.id, labelId: label.id, slotId: slot.id }))
		}
		for (const child of node.content ?? []) visit(child)
	}
	if (session) visit(session.body)
	const orphanDrafts = session ? Object.entries(session.diagramDrafts).filter(([key]) => !existingSlots.has(key)) : []
	const pending = state.kind === 'saving' || state.kind === 'loading'
	async function refreshList() {
		try { setList({ kind: 'ready', documents: await api.list() }) } catch (error) { setList({ kind: 'failed', message: error instanceof Error ? error.message : '一覧を取得できませんでした。' }) }
	}
	useEffect(() => { void refreshList() }, [])
	useEffect(() => {
		const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
		window.addEventListener('beforeunload', beforeUnload)
		return () => window.removeEventListener('beforeunload', beforeUnload)
	}, [dirty])
	function allowDiscard() { return !dirty || window.confirm('未保存の変更を破棄しますか？') }
	async function open(id: string) {
		if (!allowDiscard()) return
		dispatch({ kind: 'load' })
		try { dispatch({ kind: 'loaded', document: await api.open(id), message: '最新の文書を読み込みました。' }) }
		catch (error) { dispatch({ kind: 'failed', conflict: false, message: error instanceof Error ? error.message : '文書を開けませんでした。' }) }
	}
	async function save() {
		if (!session) return
		dispatch({ kind: 'pending', operation: 'save' })
		try {
			dispatch({ kind: 'saved', document: await api.save(session.baseline, session.title, session.body), message: draftCount ? '本文を保存しました。図の未適用入力は保存していません。' : '保存しました。' })
			await refreshList()
		} catch (error) { dispatch({ kind: 'failed', conflict: error instanceof ApiError && error.kind === 'conflict', message: error instanceof Error ? error.message : '保存に失敗しました。' }) }
	}
	async function restore() {
		if (!session?.baseline) return
		dispatch({ kind: 'pending', operation: 'restore' })
		try { dispatch({ kind: 'saved', document: await api.restore(session.baseline), message: '直前の保存状態に戻しました。' }); await refreshList() }
		catch (error) { dispatch({ kind: 'failed', conflict: error instanceof ApiError && error.kind === 'conflict', message: error instanceof Error ? error.message : '取り消せませんでした。' }) }
	}
	return <div className="app-shell">
		<aside className="sidebar"><div className="brand"><span className="brand-mark">文</span><div>文書庫<small>LOCAL DOCUMENTS</small></div></div>
			<button className="new-document" disabled={pending} onClick={() => { if (allowDiscard()) dispatch({ kind: 'new' }) }}><span>＋</span> 新しい文書</button>
			<div className="list-heading">文書 <button aria-label="文書一覧を更新" title="文書一覧を更新" onClick={() => { void refreshList() }}>↻</button></div>
			<nav aria-label="文書一覧">{list.kind === 'ready' ? list.documents.length ? list.documents.map(doc => <button className={doc.id === session?.baseline?.id ? 'document-item selected' : 'document-item'} key={doc.id} disabled={pending} onClick={() => { void open(doc.id) }}><span className="document-icon">▤</span><span>{doc.title}</span></button>) : <p className="list-empty">まだ文書がありません。</p> : list.kind === 'loading' ? <p className="list-empty">読み込み中…</p> : <p role="alert" className="list-empty">{list.message}</p>}</nav>
			<div className="local-note"><span className="local-dot" />この PC に保存<small>ブラウザと AI が同じ文書を編集します。</small></div>
		</aside>
		<main className="main-area"><header className="topbar"><span>ワークスペース <span className="breadcrumb">/</span> {session ? '文書' : 'ようこそ'}</span><span className="local-badge">ローカル</span></header>
			{session && state.kind !== 'loading' ? <section className="document-workspace">
				<div className="document-actions"><div className="save-state"><span className={dirty ? 'status-dot dirty' : 'status-dot'} />{state.kind === 'saving' ? '保存処理中…' : dirty ? '未保存の変更' : 'すべて保存済み'}{session.baseline && <small>版 {session.baseline.revision}</small>}</div>
					<div className="action-buttons"><button className="secondary" disabled={pending || !session.baseline} onClick={() => { if (session.baseline) void open(session.baseline.id) }}>最新を読み直す</button><button className="secondary" disabled={pending || bodyDirty || !session.baseline?.canRestore} onClick={() => { void restore() }}>直前の保存に戻す</button><button className="primary" disabled={pending || !bodyDirty || !session.title.trim()} onClick={() => { void save() }}>保存</button></div>
				</div>
				{'message' in state && state.message && <div role={state.kind === 'conflict' || state.kind === 'save-failed' ? 'alert' : 'status'} className={state.kind === 'conflict' || state.kind === 'save-failed' ? 'message error' : 'message success'}>{state.message}{state.kind === 'conflict' && <span>編集中の内容は保持しています。「最新を読み直す」で更新を確認してください。</span>}</div>}
				<div className="document-heading"><label htmlFor="document-title">文書のタイトル</label><input id="document-title" aria-label="文書のタイトル" placeholder="タイトルを入力" value={session.title} disabled={pending} maxLength={200} onChange={event => dispatch({ kind: 'edit', title: event.target.value })} /><p>部品を組み合わせて、伝わる文書を。</p></div>
				{draftCount > 0 && <p role="status" className="diagram-draft-notice">図に未適用の入力が {draftCount} 件あります。周囲の本文は保存できます。未適用の文字は保存されません。</p>}
				{orphanDrafts.map(([key, draft]) => <div className="diagram-orphan-draft" key={key}><p>編集対象の図または文字がなくなりました。入力を保持しています。</p><textarea aria-label="編集対象のない図の未適用入力" readOnly value={draft.text} /><button className="secondary" disabled={pending} onClick={() => dispatch({ kind: 'discard-diagram-draft', key })}>この入力を破棄</button></div>)}
				<DocumentEditor key={session.editorKey} session={session} disabled={pending} onChange={body => dispatch({ kind: 'edit', body })} onDiagramDraft={draft => dispatch({ kind: 'diagram-draft', draft })} onDiscardDiagramDraft={key => dispatch({ kind: 'discard-diagram-draft', key })} />
				<footer className="editor-footer">保存ボタンで変更を確定します。AI による更新は「最新を読み直す」で確認できます。</footer>
			</section> : state.kind === 'loading' ? <div className="empty-state"><p>文書を読み込んでいます…</p></div> : <div className="empty-state"><div className="empty-illustration">▤<span>＋</span></div><small>YOUR DOCUMENT SPACE</small><h1>考えを、文書に。</h1><p>見た目のまま編集して、AI と同じ内容を共有。<br />まずは使い方をまとめる文書を作りましょう。</p><button className="primary" onClick={() => dispatch({ kind: 'new' })}>最初の文書を作る</button><div className="empty-parts"><span>見出しと本文</span><span>表とコード</span><span>画像と説明文</span></div>{state.kind === 'load-failed' && <p role="alert">{state.message}</p>}</div>}
		</main>
	</div>
}
const root = document.getElementById('root')
if (!root) throw new Error('画面の表示先がありません。')
createRoot(root).render(<App />)
