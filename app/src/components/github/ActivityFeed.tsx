export default function ActivityFeed({ items }: { items: { fg: string; text: string; repo: string; ago: string }[] }) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
			{items.map((a, i) => (
				<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 2px' }}>
					<span style={{ width: 8, height: 8, borderRadius: '50%', background: a.fg, flex: 'none' }} />
					<span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.text}</span>
					<span className="m" style={{ fontSize: 10.5, color: 'var(--t3)', flex: 'none' }}>{a.repo}</span>
					<span style={{ fontSize: 11, color: 'var(--t3)', flex: 'none', width: 64, textAlign: 'right' }}>{a.ago}</span>
				</div>
			))}
		</div>
	)
}
