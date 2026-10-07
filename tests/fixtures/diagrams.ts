export const diagramId = '9ab61890-7196-480b-8a53-1630c1e20a67'
export function diagramFixture(id = diagramId) {
	return {
		version: 1, id, description: 'サービス間の関係',
		svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240"><title>サービス間の関係</title><desc>認証サービスと保存サービス</desc><defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#4f5d75"/></marker></defs><rect width="640" height="240" fill="#f5f5f5"/><path d="M 240 100 L 352 100" stroke="#4f5d75" fill="none" marker-end="url(#arrow)"/><g id="auth" transform="translate(40 48)"><rect width="200" height="112" rx="6" fill="#fff" stroke="#4f5d75"/><g id="auth-name" font-family="Geist, Noto Sans JP" font-size="16" font-weight="600"><text x="16" y="36" data-break-before="none">認証サービス</text></g><text id="auth-dot" x="176" y="36" font-family="Geist, Noto Sans JP" font-size="16" fill="#eb6c36">●</text></g><g id="store" transform="translate(352 48)"><rect width="240" height="112" rx="6" fill="#fff" stroke="#4f5d75"/><g id="store-name" font-family="Geist, Noto Sans JP" font-size="16" font-weight="600"><text x="16" y="36" data-break-before="none">認証サービス</text></g></g></svg>`,
		css: '.accent { fill: #eb6c36; } p { font-size: 90px; }',
		labels: [
			{ id: 'auth', name: '認証の名称', frame: 'auth', slots: [{ id: 'name', name: '名称', element: 'auth-name', region: { x: 16, y: 16, width: 152, height: 80 }, lineHeight: 22, align: 'start' }], decorations: ['auth-dot'] },
			{ id: 'store', name: '保存の名称', frame: 'store', slots: [{ id: 'name', name: '名称', element: 'store-name', region: { x: 16, y: 16, width: 200, height: 80 }, lineHeight: 22, align: 'start' }], decorations: [] },
		],
	}
}
export const figureHtml = (id = diagramId, description = 'サービス間の関係') => `<figure data-diagram-id="${id}"><figcaption>${description}</figcaption></figure>`

export function chartFixture() {
	return {
		version: 1, id: '1d4f7009-ac82-4be3-8e9c-bdfd9d9601ab', description: '処理量のグラフ',
		svg: '<svg id="chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320" font-family="Noto Sans JP" font-size="16"><rect id="bar" x="80" y="96" width="80" height="140" fill="#eb6c36"/><path d="M 40 256 L 560 256" stroke="#4f5d75" fill="none"/><g id="metric" transform="translate(64 48)"><g id="metric-value"><text x="8" y="28" data-break-before="none">140</text></g></g><g id="axis" transform="translate(256 236) rotate(-90)"><g id="axis-text"><text x="8" y="28" data-break-before="none">処理量</text></g><text id="axis-symbol" x="8" y="88" fill="#eb6c36">●</text></g></svg>',
		css: '',
		labels: [
			{ id: 'metric', name: '表示数値', frame: 'metric', slots: [{ id: 'value', name: '数値', element: 'metric-value', region: { x: 4, y: 8, width: 80, height: 48 }, lineHeight: 22, align: 'start' }], decorations: [] },
			{ id: 'axis', name: '回転ラベル', frame: 'axis', slots: [{ id: 'title', name: '軸の名称', element: 'axis-text', region: { x: 4, y: 8, width: 160, height: 48 }, lineHeight: 22, align: 'start' }], decorations: ['axis-symbol'] },
		],
	}
}
