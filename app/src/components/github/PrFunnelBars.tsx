const ROWS: { key: 'merged' | 'open' | 'draft' | 'closed'; label: string; color: string }[] = [
	{ key: 'merged', label: '머지됨', color: 'var(--violet)' },
	{ key: 'open', label: '열림', color: 'var(--blue)' },
	{ key: 'draft', label: '드래프트', color: 'var(--t3)' },
	{ key: 'closed', label: '닫힘', color: 'var(--red)' },
]

export default function PrFunnelBars({ funnel }: { funnel: { merged: number; open: number; draft: number; closed: number } }) {
	const total = Math.max(funnel.merged + funnel.open + funnel.draft + funnel.closed, 1)
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
			{ROWS.map((r) => (
				<div key={r.key}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
						<span style={{ fontSize: 11.5, color: 'var(--t2)', width: 80 }}>{r.label}</span>
						<span className="m" style={{ fontSize: 11, color: 'var(--ink)', marginLeft: 'auto' }}>{funnel[r.key]}</span>
					</div>
					<div style={{ height: 8, borderRadius: 5, background: 'var(--line2)', overflow: 'hidden' }}>
						<div style={{ height: '100%', width: `${Math.round((funnel[r.key] / total) * 100)}%`, borderRadius: 5, background: r.color }} />
					</div>
				</div>
			))}
		</div>
	)
}
