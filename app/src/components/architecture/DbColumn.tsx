import type { DbGroup } from '../../api/architecture'
import { nodeVisual, cardStyle } from './nodeStyle'

const KIND_COLOR: Record<string, string> = { table: 'var(--arch-table)', fn: 'var(--arch-fn)' }
const KIND_BADGE: Record<string, string> = { table: 'TABLE', fn: 'FN' }
const GROUP_DOT: Record<string, string> = { table: 'var(--arch-table)', fn: 'var(--arch-fn)' }

export default function DbColumn({
	groups,
	hi,
	onEnter,
	registerRef,
}: {
	groups: DbGroup[]
	hi: Record<string, boolean> | null
	onEnter: (id: string) => void
	registerRef: (id: string, el: HTMLDivElement | null) => void
}) {
	const total = groups.reduce((n, g) => n + g.nodes.length, 0)
	return (
		<div className="scroll-y" style={{ width: 334, flex: 'none', position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', minHeight: 0, paddingRight: 4 }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 12 }}>
				<span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>DB</span>
				<div style={{ flex: 1 }} />
				<span className="m" style={{ fontSize: 11, fontWeight: 700, color: 'var(--arch-table)', background: 'color-mix(in srgb, var(--arch-table) 15%, transparent)', borderRadius: 7, padding: '2px 9px' }}>
					{total}
				</span>
			</div>
			{groups.map((g) => (
				<div key={g.label}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 4px 8px' }}>
						<span style={{ width: 7, height: 7, borderRadius: '50%', background: GROUP_DOT[g.kind] }} />
						<span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--t3)' }}>{g.label}</span>
					</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
						{g.nodes.map((n) => {
							const v = nodeVisual(n.id, KIND_COLOR[n.kind], hi)
							return (
								<div key={n.id} ref={(el) => registerRef(n.id, el)} onMouseEnter={() => onEnter(n.id)} style={cardStyle(v)}>
									<div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
										<span className="m" style={{ fontSize: 9, fontWeight: 700, color: v.badgeFg, background: v.badgeBg, borderRadius: 5, padding: '2px 6px', flex: 'none' }}>
											{KIND_BADGE[n.kind]}
										</span>
										<span className="m" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{n.name}</span>
										{n.ko && <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>{n.ko}</span>}
									</div>
									<div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>{n.meta}</div>
								</div>
							)
						})}
					</div>
				</div>
			))}
		</div>
	)
}
