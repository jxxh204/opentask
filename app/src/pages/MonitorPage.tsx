import { useEffect, useState } from 'react'
import { getMonitorState, getMonitorHealth, getMonitorConnectors, type MonitorState, type MonitorHealth, type ConnectorCard as ConnectorCardData } from '../api/monitor'
import { useSetupStore, isGithubConfigured } from '../store/useSetupStore'
import GithubRepoGate from '../components/common/GithubRepoGate'
import HealthStrip from '../components/monitor/HealthStrip'
import ConnectorCard from '../components/monitor/ConnectorCard'
import AlertsFeed from '../components/monitor/AlertsFeed'
import AlertActionRow from '../components/monitor/AlertActionRow'
import StatusDot from '../components/common/StatusDot'
import styles from './MonitorPage.module.css'

const POLL_MS = 30000

export default function MonitorPage() {
	const configured = useSetupStore(isGithubConfigured)
	const hydrateSetup = useSetupStore((s) => s.hydrate)
	const [state, setState] = useState<MonitorState | null>(null)
	const [health, setHealth] = useState<MonitorHealth | null>(null)
	const [connectors, setConnectors] = useState<ConnectorCardData[] | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		hydrateSetup()
	}, [hydrateSetup])

	useEffect(() => {
		if (!configured) return
		let cancelled = false
		function load() {
			Promise.all([getMonitorState(), getMonitorHealth(), getMonitorConnectors()])
				.then(([s, h, c]) => {
					if (cancelled) return
					setState(s)
					setHealth(h)
					setConnectors(c)
					setError(null)
				})
				.catch((e) => {
					if (!cancelled) setError(e instanceof Error ? e.message : String(e))
				})
		}
		load()
		const timer = setInterval(load, POLL_MS)
		return () => {
			cancelled = true
			clearInterval(timer)
		}
	}, [configured])

	const actionable = state?.findings.filter((f) => f.status !== 'resolved').slice(0, 6) ?? []

	if (!configured) return <GithubRepoGate title="GitHub 레포를 연결하세요" subtitle="PR·CI·이슈 findings를 추적할 레포입니다" />

	return (
		<div className={`scroll-y ${styles.page}`} style={{ height: '100%' }}>
			<div className={styles.header}>
				<div className={styles.titleRow}>
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
						<path d="M12 3.2a8.8 8.8 0 1 0 6.3 2.5" stroke="var(--violet)" strokeWidth={2.6} strokeLinecap="round" />
						<circle cx="18.3" cy="5.7" r="2.7" fill="var(--blue)" />
					</svg>
					<h1 className={styles.title}>모니터</h1>
				</div>
				<span className={styles.subtitle}>프론트엔드 모니터링 · 소스를 연결하면 실시간으로 채워집니다</span>
				<div className={styles.pollBadge}>
					<StatusDot color="green" pulse />
					<span className="m" style={{ fontSize: 11, color: 'var(--t3)' }}>
						30s 폴링
					</span>
				</div>
			</div>

			{error && <div className={styles.loadingState} style={{ color: 'var(--red)' }}>{error}</div>}
			{!error && !state && <div className={styles.loadingState}>불러오는 중…</div>}

			{state && (
				<>
					<div style={{ marginTop: 20 }}>
						<HealthStrip health={health} />
					</div>

					<div className={styles.sourcesHead}>
						<span className={styles.sourcesLabel}>모니터링 소스</span>
						{connectors && (
							<span className="m" style={{ fontSize: 11, color: 'var(--t3)' }}>
								{connectors.filter((c) => c.connected).length} 연결 · {connectors.filter((c) => !c.connected).length} 미연결
							</span>
						)}
						<div className={styles.sourcesRule} />
					</div>
					<div className={styles.connectorGrid}>
						{(connectors ?? []).map((c) => (
							<ConnectorCard key={c.id} id={c.id} connected={c.connected} detail={connectorDetail(c, health)} />
						))}
					</div>

					<div className={styles.feedGrid}>
						<div className={styles.panel}>
							<div className={styles.panelTitle}>알림 피드</div>
							<AlertsFeed findings={state.findings} />
						</div>
						<div className={styles.panel}>
							<div className={styles.panelTitle}>알림 → 액션</div>
							<div className={styles.panelHint}>감지된 이슈를 바로 에이전트로 넘길 수 있어요</div>
							<div className={styles.actionList}>
								{actionable.length === 0 && <div className={styles.emptyActions}>조치가 필요한 미해결 항목이 없습니다</div>}
								{actionable.map((f) => (
									<AlertActionRow key={f.key} finding={f} />
								))}
							</div>
							<div className={styles.rulesLink}>⚙ 임계치·알림 규칙 설정</div>
						</div>
					</div>
				</>
			)}
		</div>
	)
}

function connectorDetail(c: ConnectorCardData, health: MonitorHealth | null): string | undefined {
	if (!c.connected) return undefined
	if (c.id === 'sentry' && health?.sentry.recentIssues1h != null) return `${health.sentry.recentIssues1h}건 (1h)`
	if (c.id === 'aws-deploy' && c.url) return c.lastStatus != null ? `${c.url} · HTTP ${c.lastStatus}` : c.url
	return undefined
}
