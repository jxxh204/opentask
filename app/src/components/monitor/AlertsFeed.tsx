import type { MonitorFinding } from '../../api/monitor'

const KIND_COLOR: Record<string, string> = { ci: 'var(--red)', review: 'var(--violet)', issue: 'var(--amber)', sentry: 'var(--red)' }
const KIND_LABEL: Record<string, string> = { ci: 'GitHub', review: 'GitHub', issue: 'GitHub', sentry: 'Sentry' }

function ago(ts: number): string {
	const diff = Date.now() - ts
	const min = Math.floor(diff / 60000)
	if (min < 60) return `${min}분 전`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}시간 전`
	return `${Math.floor(hr / 24)}일 전`
}

export default function AlertsFeed({ findings }: { findings: MonitorFinding[] }) {
	if (findings.length === 0) return <div style={{ fontSize: 12, color: 'var(--t3)', padding: '20px 0', textAlign: 'center' }}>알림 없음</div>
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
			{findings.slice(0, 20).map((f) => (
				<div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 2px', borderBottom: '1px solid var(--line)' }}>
					<span style={{ width: 7, height: 7, borderRadius: '50%', background: f.status === 'regression' ? 'var(--red)' : f.status === 'resolved' ? 'var(--green)' : KIND_COLOR[f.kind] || 'var(--t3)', flex: 'none' }} />
					<span style={{ fontSize: 12.5, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
						[{KIND_LABEL[f.kind] || f.kind}] {f.title}
					</span>
					<span className="m" style={{ fontSize: 10, color: 'var(--t3)' }}>{f.repo}</span>
					<span style={{ fontSize: 11, color: 'var(--t3)', width: 56, textAlign: 'right' }}>{ago(f.lastSeen)}</span>
				</div>
			))}
		</div>
	)
}
