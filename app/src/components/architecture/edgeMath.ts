export interface Edge {
	d: string
	color: string
}

// 두 노드 카드 사이를 잇는 베지어 경로 — 왼쪽 카드 우측 중앙 → 오른쪽 카드 좌측 중앙.
export function bezierPath(a: DOMRect, b: DOMRect, container: DOMRect): string {
	const x1 = a.right - container.left
	const y1 = a.top + a.height / 2 - container.top
	const x2 = b.left - container.left
	const y2 = b.top + b.height / 2 - container.top
	const dx = Math.max(46, (x2 - x1) * 0.5)
	return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}
