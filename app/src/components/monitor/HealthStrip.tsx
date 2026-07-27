import type { MonitorHealth } from '../../api/monitor'

export default function HealthStrip({ health }: { health: MonitorHealth | null }) {
	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
			<div style={{ background: 'var(--card)', padding: '15px 16px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
					<span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)' }} />
					<span style={{ fontSize: 11, color: 'var(--t2)' }}>프로덕션</span>
				</div>
				<div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--green)', marginTop: 6 }}>{health?.prod.status || '알수없음'}</div>
				<div className="m" style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 3 }}>{health?.prod.uptimePct != null ? `uptime ${health.prod.uptimePct}%` : '데이터 없음'}</div>
			</div>
			<div style={{ background: 'var(--card)', padding: '15px 16px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
					<span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--red)' }} />
					<span style={{ fontSize: 11, color: 'var(--t2)' }}>에러율 (1h)</span>
				</div>
				<div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--ink)', marginTop: 6 }}>{health?.errorRate1h != null ? `${health.errorRate1h}%` : '—'}</div>
			</div>
			<div style={{ background: 'var(--card)', padding: '15px 16px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
					<span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--blue)' }} />
					<span style={{ fontSize: 11, color: 'var(--t2)' }}>배포 (오늘)</span>
				</div>
				<div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--ink)', marginTop: 6 }}>{health?.deploysToday ?? '—'}</div>
			</div>
			<div style={{ background: 'var(--card)', padding: '15px 16px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
					<span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--violet)' }} />
					<span style={{ fontSize: 11, color: 'var(--t2)' }}>리뷰 대기 PR</span>
				</div>
				<div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--ink)', marginTop: 6 }}>{health?.prsAwaitingReview ?? '—'}</div>
			</div>
		</div>
	)
}
