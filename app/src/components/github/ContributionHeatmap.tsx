const LEVEL_COLOR = ['#191921', '#213a2c', '#2b6b45', '#37a862', '#3ecf8e']

function levelFor(count: number, max: number): number {
	if (count === 0) return 0
	const ratio = count / Math.max(max, 1)
	if (ratio > 0.75) return 4
	if (ratio > 0.5) return 3
	if (ratio > 0.25) return 2
	return 1
}

export default function ContributionHeatmap({ data }: { data: { date: string; count: number }[] }) {
	const max = Math.max(...data.map((d) => d.count), 1)
	return (
		<div>
			<div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 14px)', gridAutoFlow: 'column', gridAutoColumns: '14px', gap: 3 }}>
				{data.map((d, i) => (
					<div key={i} title={`${d.date}: ${d.count}`} style={{ width: 14, height: 14, borderRadius: 3, background: LEVEL_COLOR[levelFor(d.count, max)] }} />
				))}
			</div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 10.5, color: 'var(--t3)' }}>
				적음
				{LEVEL_COLOR.map((c) => (
					<span key={c} style={{ width: 14, height: 14, borderRadius: 3, background: c }} />
				))}
				많음
			</div>
		</div>
	)
}
