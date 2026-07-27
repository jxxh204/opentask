export default function ProgressBar({ pct }: { pct: number }) {
	return (
		<div style={{ height: 8, borderRadius: 5, background: 'var(--bg)', overflow: 'hidden' }}>
			<div style={{ height: '100%', width: `${pct}%`, borderRadius: 5, background: 'linear-gradient(90deg, var(--violet), var(--blue))', transition: 'width .3s' }} />
		</div>
	)
}
