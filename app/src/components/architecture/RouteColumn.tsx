import type { RouteNode } from '../../api/architecture'
import { nodeVisual, cardStyle } from './nodeStyle'

const KIND_COLOR: Record<string, string> = { page: 'var(--arch-page)', route: 'var(--arch-route)' }
const KIND_BADGE: Record<string, string> = { page: 'PAGE', route: 'API' }

export default function RouteColumn({
	nodes,
	hi,
	onEnter,
	registerRef,
}: {
	nodes: RouteNode[]
	hi: Record<string, boolean> | null
	onEnter: (id: string) => void
	registerRef: (id: string, el: HTMLDivElement | null) => void
}) {
	return (
		<div className="scroll-y" style={{ width: 334, flex: 'none', position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', minHeight: 0, paddingLeft: 4 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 12 }}>
				<span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>Next.js</span>
				<span style={{ fontSize: 12, color: 'var(--t3)' }}>(src/app)</span>
				<div style={{ flex: 1 }} />
				<span className="m" style={{ fontSize: 11, fontWeight: 700, color: 'var(--arch-page)', background: 'color-mix(in srgb, var(--arch-page) 15%, transparent)', borderRadius: 7, padding: '2px 9px' }}>
					{nodes.length}
				</span>
			</div>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
				{nodes.map((n) => {
					const v = nodeVisual(n.id, KIND_COLOR[n.kind], hi)
					return (
						<div key={n.id} ref={(el) => registerRef(n.id, el)} onMouseEnter={() => onEnter(n.id)} style={cardStyle(v)}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'flex-end' }}>
								<span className="m" style={{ fontSize: 9, fontWeight: 700, color: v.badgeFg, background: v.badgeBg, borderRadius: 5, padding: '2px 6px' }}>
									{KIND_BADGE[n.kind]}
								</span>
								<span className="m" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{n.name}</span>
							</div>
							<div className="m" style={{ fontSize: 11, color: n.apiRefs.length ? 'var(--t2)' : 'var(--t3)', marginTop: 6, textAlign: 'left', lineHeight: 1.55 }}>
								{n.meta}
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}
