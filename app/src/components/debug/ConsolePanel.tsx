import { useDebugStore } from '../../store/useDebugStore'

export default function ConsolePanel() {
	const consoleErrors = useDebugStore((s) => s.consoleErrors)

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
			{consoleErrors.map((c, i) => (
				<div key={c.id} style={{ background: '#241a1a', border: '1px solid rgba(224,101,92,.35)', borderRadius: 10, padding: '12px 13px' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--red)' }} />
						<span style={{ fontSize: 11.5, fontWeight: 700, color: '#ec8d87' }}>{c.title}</span>
						<span style={{ fontSize: 9.5, color: 'var(--t3)', marginLeft: 'auto' }}>
							{i + 1} / {consoleErrors.length}
						</span>
					</div>
					<div style={{ fontSize: 11, color: '#e79b96', lineHeight: 1.6, marginTop: 9 }}>{c.body}</div>
				</div>
			))}
		</div>
	)
}
