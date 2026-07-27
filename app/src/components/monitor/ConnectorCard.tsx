const META: Record<string, { icon: string; label: string; bg: string }> = {
	sentry: { icon: '🐞', label: 'Sentry', bg: 'rgba(224,101,92,.14)' },
	'pr-ci': { icon: '🔀', label: 'PR / CI', bg: 'rgba(139,124,240,.14)' },
	'aws-deploy': { icon: '☁️', label: 'AWS · 배포', bg: 'rgba(224,164,54,.14)' },
	vitals: { icon: '⚡', label: 'Web Vitals', bg: 'rgba(87,157,255,.14)' },
	bundle: { icon: '📦', label: '번들 사이즈', bg: '#1c1c20' },
	lighthouse: { icon: '🏮', label: 'Lighthouse', bg: '#1c1c20' },
}

export default function ConnectorCard({ id, connected, headline, detail }: { id: string; connected: boolean; headline?: string | null; detail?: string | null }) {
	const m = META[id] || { icon: '🔌', label: id, bg: '#1c1c20' }
	if (!connected) {
		return (
			<div style={{ background: 'var(--card2)', border: '1px dashed var(--line2)', borderRadius: 13, padding: '15px 16px', display: 'flex', flexDirection: 'column' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
					<span style={{ width: 26, height: 26, borderRadius: 8, background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{m.icon}</span>
					<span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)' }}>{m.label}</span>
				</div>
				<div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 12, flex: 1 }}>{detail || '연결되지 않음'}</div>
				<button style={{ height: 30, marginTop: 10, borderRadius: 8, background: 'transparent', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--violet)', fontSize: 11.5, fontWeight: 600 }}>+ 연결</button>
			</div>
		)
	}
	return (
		<div style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 13, padding: '15px 16px' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
				<span style={{ width: 26, height: 26, borderRadius: 8, background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{m.icon}</span>
				<span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{m.label}</span>
				<span style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />
			</div>
			{headline && <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginTop: 12 }}>{headline}</div>}
			{detail && (
				<div className="m" style={{ fontSize: 11, color: 'var(--t3)', marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{detail}
				</div>
			)}
		</div>
	)
}
