export default function WeeklyBarChart({ data }: { data: { week: string; count: number }[] }) {
	const max = Math.max(...data.map((d) => d.count), 1)
	return (
		<div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, height: 130 }}>
			{data.map((d, i) => (
				<div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
					<div style={{ width: '100%', borderRadius: '3px 3px 0 0', height: Math.round((d.count / max) * 120), background: i === data.length - 1 ? 'var(--green)' : 'var(--blue)' }} />
					<span className="m" style={{ fontSize: 8.5, color: 'var(--t3)' }}>
						{d.week}
					</span>
				</div>
			))}
		</div>
	)
}
