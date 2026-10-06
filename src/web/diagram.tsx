import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Node, type NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { extensions } from '../content/parts.js'
import { parseDiagram, diagramSummary, diagramViewport, slotText } from '../content/diagram.js'
import { diagramDraftKey, type DiagramDraft } from './state.js'
import { fitSlot, svgElement } from './diagram-layout.js'

type DiagramSession = {
	drafts: Record<string, DiagramDraft>; disabled: boolean;
	onDraft: (draft: DiagramDraft) => void; onDiscard: (key: string) => void;
}
const context = createContext<DiagramSession | null>(null)
export const DiagramSessionProvider = context.Provider
function useDiagramSession(): DiagramSession {
	const session = useContext(context)
	if (!session) throw new Error('図の編集セッションがありません。')
	return session
}
const iframeDocument = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'self\' \'unsafe-inline\'; font-src \'self\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'"><link rel="stylesheet" href="/diagram-fonts.css"><style>html,body{margin:0;padding:0;overflow:hidden;font-synthesis:none}svg{display:block}</style></head><body><style id="diagram-style"></style><div id="diagram-root"></div></body></html>'

function DiagramView({ node, editor, getPos, updateAttributes, deleteNode }: NodeViewProps) {
	const session = useDiagramSession()
	const diagram = useMemo(() => parseDiagram(node.attrs.definition), [node.attrs.definition])
	const summary = useMemo(() => diagramSummary(diagram), [diagram])
	const viewport = diagramViewport(diagram)
	const [selection, setSelection] = useState<{ labelId: string; slotId: string } | null>(null)
	const [loaded, setLoaded] = useState(0)
	const [applying, setApplying] = useState(false)
	const frame = useRef<HTMLIFrameElement>(null)
	const request = useRef(0)
	const current = useRef(diagram)
	current.current = diagram
	const label = summary.labels.find(label => label.id === selection?.labelId) ?? summary.labels[0]
	const slot = label?.slots.find(slot => slot.id === selection?.slotId) ?? label?.slots[0]
	const target = label && slot ? { diagramId: diagram.id, labelId: label.id, slotId: slot.id } : null
	const key = target ? diagramDraftKey(target) : ''
	const draft = session.drafts[key]
	const value = draft?.text ?? (label && slot ? slotText(diagram, label.id, slot.id) : '')
	const disabled = session.disabled
	const locked = useRef(disabled)
	locked.current = disabled
	useEffect(() => { request.current += 1; setApplying(false) }, [disabled])
	useEffect(() => {
		const element = frame.current
		if (!element) return
		const ready = () => { if (element.contentDocument?.getElementById('diagram-root')) setLoaded(value => value + 1) }
		element.addEventListener('load', ready)
		element.srcdoc = iframeDocument
		return () => { element.removeEventListener('load', ready) }
	}, [])

	useEffect(() => {
		request.current += 1
		setApplying(false)
		const document = frame.current?.contentDocument
		const root = document?.getElementById('diagram-root')
		const style = document?.getElementById('diagram-style')
		if (!document || !root || !style) return
		style.textContent = diagram.css
		const svg = svgElement(document, diagram)
		svg.setAttribute('width', String(viewport.width)); svg.setAttribute('height', String(viewport.height))
		root.replaceChildren(svg)
		function select(event: MouseEvent) {
			const view = document?.defaultView
			if (!view || !(event.target instanceof view.Element)) return
			for (const label of diagram.labels) for (const slot of label.slots) {
				if (svg.querySelector(`#${CSS.escape(slot.element)}`)?.contains(event.target)) {
					request.current += 1
					setApplying(false)
					setSelection({ labelId: label.id, slotId: slot.id })
					return
				}
			}
		}
		svg.addEventListener('click', select)
		return () => { request.current += 1; svg.removeEventListener('click', select) }
	}, [diagram, loaded, viewport.width, viewport.height])

	useEffect(() => {
		const document = frame.current?.contentDocument
		const svg = document?.querySelector('svg')
		svg?.querySelector('[data-selection-overlay]')?.remove()
		const source = diagram.labels.find(item => item.id === label?.id)?.slots.find(item => item.id === slot?.id)
		const group = source && svg?.querySelector(`#${CSS.escape(source.element)}`)
		const view = document?.defaultView
		if (!document || !view || !svg || !(group instanceof view.SVGGraphicsElement) || !source) return
		const rootMatrix = svg.getCTM(), matrix = group.getCTM()
		if (!rootMatrix || !matrix) return
		const local = rootMatrix.inverse().multiply(matrix)
		const rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
		rectangle.setAttribute('data-selection-overlay', '')
		for (const [name, value] of Object.entries(source.region)) rectangle.setAttribute(name, String(value))
		rectangle.setAttribute('transform', `matrix(${local.a} ${local.b} ${local.c} ${local.d} ${local.e} ${local.f})`)
		rectangle.setAttribute('style', 'fill:none!important;stroke:#31835b!important;stroke-width:1.5!important;pointer-events:none!important;vector-effect:non-scaling-stroke')
		svg.append(rectangle)
	}, [diagram, loaded, label?.id, slot?.id])

	async function apply() {
		if (!target || !draft || disabled || loaded === 0) return
		const token = ++request.current
		const document = frame.current?.contentDocument
		if (!document) return
		setApplying(true)
		const result = await fitSlot(diagram, target.labelId, target.slotId, draft.text, document)
		if (token !== request.current || current.current !== diagram || locked.current) return
		setApplying(false)
		if (result.kind === 'applied') {
			updateAttributes({ definition: result.diagram })
			session.onDiscard(key)
		} else session.onDraft({ ...draft, message: result.message })
	}

	function move(direction: 'up' | 'down') {
		const position = getPos()
		if (typeof position !== 'number') return
		const neighbor = direction === 'up' ? editor.state.doc.resolve(position).nodeBefore : editor.state.doc.nodeAt(position + node.nodeSize)
		if (!neighbor) return
		const destination = direction === 'up' ? position - neighbor.nodeSize : position + neighbor.nodeSize
		editor.view.dispatch(editor.state.tr.delete(position, position + node.nodeSize).insert(destination, node).scrollIntoView())
	}

	return <NodeViewWrapper as="figure" className="diagram-figure" data-diagram-id={diagram.id} contentEditable={false}>
		<div className="diagram-operations" role="group" aria-label="図の操作">
			<button type="button" disabled={disabled} onClick={() => move('up')}>上へ</button>
			<button type="button" disabled={disabled} onClick={() => move('down')}>下へ</button>
			<button type="button" disabled={disabled} onClick={() => {
				const position = getPos()
				if (typeof position === 'number') editor.commands.insertContentAt(position + node.nodeSize, { type: 'diagram', attrs: { definition: parseDiagram({ ...diagram, id: crypto.randomUUID() }) } })
			}}>図を複製</button>
			<button type="button" disabled={disabled} onClick={deleteNode}>図を削除</button>
		</div>
		<div className="diagram-viewport"><iframe ref={frame} title={diagram.description || '図'} sandbox="allow-same-origin" width={viewport.width} height={viewport.height} /></div>
		<div className="diagram-controls">
			<label>図の説明<input aria-label="図の説明" value={diagram.description} disabled={disabled} maxLength={20_000} onChange={event => { request.current += 1; updateAttributes({ definition: parseDiagram({ ...diagram, description: event.target.value }) }) }} /></label>
			{label && slot && <>
				<div className="diagram-selectors">
					<label>ラベル<select aria-label="図のラベル" value={label.id} disabled={disabled} onChange={event => { request.current += 1; setApplying(false); setSelection({ labelId: event.target.value, slotId: '' }) }}>{summary.labels.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
					<label>文字の範囲<select aria-label="図の文字範囲" value={slot.id} disabled={disabled} onChange={event => { request.current += 1; setApplying(false); setSelection({ labelId: label.id, slotId: event.target.value }) }}>{label.slots.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
				</div>
				<label>{slot.name}<textarea aria-label={`図内の文字 ${slot.name}`} value={value} disabled={disabled} rows={3} maxLength={20_000} onChange={event => {
					request.current += 1; setApplying(false)
					if (!target) return
					const text = event.target.value
					if (text === slotText(diagram, label.id, slot.id)) session.onDiscard(key)
					else session.onDraft({ ...target, text, message: '' })
				}} /></label>
				<div className="diagram-edit-actions"><button type="button" className="secondary" aria-label="文字を適用" aria-busy={loaded === 0 || applying} disabled={disabled || loaded === 0 || !draft || applying} onClick={() => { void apply() }}>{loaded === 0 ? '図を読み込んでいます…' : applying ? '文字を確認しています…' : '文字を適用'}</button><button type="button" className="secondary" disabled={disabled || !draft} onClick={() => { request.current += 1; setApplying(false); session.onDiscard(key) }}>未適用の入力を破棄</button></div>
				{draft && <p role={draft.message ? 'alert' : 'status'} className={draft.message ? 'inline-error' : 'inline-message'}>{draft.message || 'この文字はまだ図に適用していません。文書を保存しても保存されません。'}</p>}
			</>}
		</div>
	</NodeViewWrapper>
}

export const browserExtensions = extensions.map(extension => extension.name === 'diagram' && extension instanceof Node
	? extension.extend({ addNodeView() { return ReactNodeViewRenderer(DiagramView) } }) : extension)
