import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { validateBody, safeLink } from '../content/parts.js'
import type { BodyNode } from '../content/parts.js'
import { api } from './api.js'
import type { Session, DiagramDraft } from './state.js'
import { browserExtensions, DiagramSessionProvider } from './diagram.js'

function Tool({ label, active = false, disabled = false, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
	return <button type="button" className={active ? 'tool active' : 'tool'} aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</button>
}
function Toolbar({ editor, disabled, chooseImage }: { editor: Editor; disabled: boolean; chooseImage: () => void }) {
	const [, refresh] = useState(0)
	useEffect(() => { const update = () => refresh(value => value + 1); editor.on('transaction', update); return () => { editor.off('transaction', update) } }, [editor])
	return <div className="toolbar" role="toolbar" aria-label="本文の編集">
		<select aria-label="見出し" disabled={disabled} value={editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : '0'} onChange={event => {
			const value = event.target.value
			if (value === '1') editor.chain().focus().setHeading({ level: 1 }).run()
			else if (value === '2') editor.chain().focus().setHeading({ level: 2 }).run()
			else if (value === '3') editor.chain().focus().setHeading({ level: 3 }).run()
			else editor.chain().focus().setParagraph().run()
		}}><option value="0">本文</option><option value="1" disabled={!editor.can().setHeading({ level: 1 })}>見出し 1</option><option value="2" disabled={!editor.can().setHeading({ level: 2 })}>見出し 2</option><option value="3" disabled={!editor.can().setHeading({ level: 3 })}>見出し 3</option></select>
		<Tool label="太字" active={editor.isActive('bold')} disabled={disabled} onClick={() => { editor.chain().focus().toggleBold().run() }}><strong>B</strong></Tool>
		<Tool label="斜体" active={editor.isActive('italic')} disabled={disabled} onClick={() => { editor.chain().focus().toggleItalic().run() }}><em>I</em></Tool>
		<span className="tool-divider" />
		<Tool label="箇条書き" active={editor.isActive('bulletList')} disabled={disabled || !editor.can().toggleBulletList()} onClick={() => { editor.chain().focus().toggleBulletList().run() }}>• リスト</Tool>
		<Tool label="番号付きリスト" active={editor.isActive('orderedList')} disabled={disabled || !editor.can().toggleOrderedList()} onClick={() => { editor.chain().focus().toggleOrderedList().run() }}>1. リスト</Tool>
		<Tool label="コードブロック" active={editor.isActive('codeBlock')} disabled={disabled || !editor.can().toggleCodeBlock()} onClick={() => { editor.chain().focus().toggleCodeBlock().run() }}>&lt;/&gt;</Tool>
		<Tool label="リンク" active={editor.isActive('link')} disabled={disabled} onClick={() => {
			const value = window.prompt('HTTP または HTTPS のリンク URL', String(editor.getAttributes('link').href ?? 'https://'))
			if (value === null) return
			if (!value) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
			try { editor.chain().focus().extendMarkRange('link').setLink({ href: safeLink(value) }).run() } catch (error) { window.alert(error instanceof Error ? error.message : 'リンクが不正です。') }
		}}>リンク</Tool>
		<Tool label="表を追加" disabled={disabled} onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() }}>表</Tool>
		<Tool label="画像を追加" disabled={disabled} onClick={chooseImage}>画像</Tool>
		<span className="tool-divider" />
		<Tool label="文字入力を元に戻す" disabled={disabled || !editor.can().undo()} onClick={() => { editor.chain().focus().undo().run() }}>↶</Tool>
		<Tool label="文字入力をやり直す" disabled={disabled || !editor.can().redo()} onClick={() => { editor.chain().focus().redo().run() }}>↷</Tool>
		{editor.isActive('table') && <div className="table-tools" role="group" aria-label="表の操作">
			{[
				{ label: '行を追加', run: () => editor.chain().focus().addRowAfter().run() },
				{ label: '行を削除', run: () => editor.chain().focus().deleteRow().run() },
				{ label: '列を追加', run: () => editor.chain().focus().addColumnAfter().run() },
				{ label: '列を削除', run: () => editor.chain().focus().deleteColumn().run() },
				{ label: '見出しセルを切り替え', run: () => editor.chain().focus().toggleHeaderCell().run() },
				{ label: '表を削除', run: () => editor.chain().focus().deleteTable().run() },
			].map(tool => <Tool key={tool.label} label={tool.label} disabled={disabled} onClick={tool.run}>{tool.label}</Tool>)}
		</div>}
	</div>
}
export function DocumentEditor({ session, disabled, onChange, onDiagramDraft, onDiscardDiagramDraft }: { session: Session; disabled: boolean; onChange: (body: BodyNode) => void; onDiagramDraft: (draft: DiagramDraft) => void; onDiscardDiagramDraft: (key: string) => void }) {
	const fileInput = useRef<HTMLInputElement>(null)
	const [upload, setUpload] = useState<{ kind: 'idle' } | { kind: 'uploading' } | { kind: 'failed'; message: string }>({ kind: 'idle' })
	const [selectedImage, selectImage] = useState<{ assetId: string; alt: string } | null>(null)
	const editor = useEditor({ extensions: browserExtensions, content: session.body, editorProps: { attributes: { 'aria-label': '文書の本文', role: 'textbox', 'aria-multiline': 'true' } },
		onUpdate: ({ editor: instance }) => { onChange(validateBody(instance.getJSON())) },
		onSelectionUpdate: ({ editor: instance }) => {
			const attrs = instance.isActive('image') ? instance.getAttributes('image') : null
			selectImage(attrs ? { assetId: String(attrs.assetId), alt: String(attrs.alt) } : null)
		},
	})
	useEffect(() => { editor?.setEditable(!disabled && upload.kind !== 'uploading', false) }, [editor, disabled, upload.kind])
	if (!editor) return null
	const locked = disabled || upload.kind === 'uploading'
	return <DiagramSessionProvider value={{ drafts: session.diagramDrafts, disabled: locked, onDraft: onDiagramDraft, onDiscard: onDiscardDiagramDraft }}>
		<Toolbar editor={editor} disabled={locked} chooseImage={() => fileInput.current?.click()} />
		<input ref={fileInput} type="file" aria-label="画像ファイル" accept="image/png,image/jpeg,image/webp" hidden onChange={async event => {
			const file = event.currentTarget.files?.[0]
			event.currentTarget.value = ''
			if (!file) return
			setUpload({ kind: 'uploading' })
			try {
				const asset = await api.upload(file)
				editor.chain().focus().insertContent({ type: 'image', attrs: { assetId: asset.id, alt: '' } }).run()
				selectImage({ assetId: asset.id, alt: '' }); setUpload({ kind: 'idle' })
			} catch (error) { setUpload({ kind: 'failed', message: error instanceof Error ? error.message : '画像を追加できませんでした。' }) }
		}} />
		{upload.kind === 'uploading' && <p role="status" className="inline-message">画像を追加しています…</p>}
		{upload.kind === 'failed' && <p role="alert" className="inline-error">{upload.message}</p>}
		{selectedImage && <div className="image-description"><label htmlFor="image-alt">画像の説明文</label><input id="image-alt" value={selectedImage.alt} disabled={locked} onChange={event => {
			const alt = event.target.value
			editor.commands.updateAttributes('image', { alt }); selectImage({ ...selectedImage, alt })
		}} /><p>AI にはこの説明文と画像の参照を渡します。</p></div>}
		<EditorContent editor={editor} className="editor-paper" />
	</DiagramSessionProvider>
}
