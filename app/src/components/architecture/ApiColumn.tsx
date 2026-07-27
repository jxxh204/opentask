import type { ApiNode } from '../../api/architecture'
import { nodeVisual, cardStyle } from './nodeStyle'

export default function ApiColumn({
	nodes,
	dbNameById,
	hi,
	onEnter,
	registerRef,
}: {
	nodes: ApiNode[]
	dbNameById: Record<string, string>
	hi: Record<string, boolean> | null
	onEnter: (id: string) => void
	registerRef: (id: string, el: HTMLDivElement | null) => void
}) {
	return (
		<div className="scroll-y" style={{ width: 320, flex: 'none', position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 4px' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 12 }}>
				<span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>API</span>
				<span style={{ fontSize: 12, color: 'var(--t3)' }}>(src/features)</span>
				<div style={{ flex: 1 }} />
				<span className="m" style={{ fontSize: 11, fontWeight: 700, color: 'var(--arch-domain)', background: 'color-mix(in srgb, var(--arch-domain) 15%, transparent)', borderRadius: 7, padding: '2px 9px' }}>
					{nodes.length}
				</span>
			</div>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
				{nodes.map((n) => {
					const v = nodeVisual(n.id, 'var(--arch-domain)', hi)
					const meta = n.dbRefs.length ? n.dbRefs.map((id) => dbNameById[id] || id).join(', ') : 'DB 접근 없음'
					return (
						<div key={n.id} ref={(el) => registerRef(n.id, el)} onMouseEnter={() => onEnter(n.id)} style={{ ...cardStyle(v), textAlign: 'center' }}>
							<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
								<span className="m" style={{ fontSize: 9, fontWeight: 700, color: 'var(--arch-domain)', background: 'color-mix(in srgb, var(--arch-domain) 15%, transparent)', borderRadius: 5, padding: '2px 6px' }}>
									API
								</span>
								<span className="m" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{n.name}</span>
							</div>
							<div className="m" style={{ fontSize: 11, color: n.dbRefs.length ? 'var(--t2)' : 'var(--t3)', marginTop: 6 }}>
								{meta}
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}
