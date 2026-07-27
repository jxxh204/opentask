import type { Edge } from './edgeMath'

export default function ArchEdgesSvg({ edges }: { edges: Edge[] }) {
	return (
		<svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
			{edges.map((e, i) => (
				<path key={i} d={e.d} fill="none" stroke={e.color} strokeWidth={2} strokeLinecap="round" opacity={0.92} />
			))}
		</svg>
	)
}
