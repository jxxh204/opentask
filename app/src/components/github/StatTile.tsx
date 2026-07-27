export default function StatTile({ dot, label, value, unit, delta, deltaColor }: { dot: string; label: string; value: string | number; unit?: string; delta?: string; deltaColor?: string }) {
	return (
		<div style={{ background: 'var(--card)', padding: '15px 16px' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
				<span style={{ width: 8, height: 8, borderRadius: 2, background: dot }} />
				<span style={{ fontSize: 11, color: 'var(--t2)' }}>{label}</span>
			</div>
			<div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--ink)', marginTop: 6 }}>
				{value}
				{unit && <span style={{ fontSize: 13, color: 'var(--t3)', fontWeight: 600 }}>{unit}</span>}
			</div>
			{delta && (
				<div style={{ fontSize: 10.5, color: deltaColor || 'var(--t3)', marginTop: 3 }}>{delta}</div>
			)}
		</div>
	)
}
