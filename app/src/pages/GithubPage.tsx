import { useEffect, useState } from 'react'
import { getGithubStats, type GithubStats } from '../api/github'
import StatTile from '../components/github/StatTile'
import ContributionHeatmap from '../components/github/ContributionHeatmap'
import WeeklyBarChart from '../components/github/WeeklyBarChart'
import PrFunnelBars from '../components/github/PrFunnelBars'
import RepoChurnBars from '../components/github/RepoChurnBars'
import ActivityFeed from '../components/github/ActivityFeed'
import styles from './GithubPage.module.css'

const RANGES = [30, 90, 365] as const

export default function GithubPage() {
	const [range, setRange] = useState<(typeof RANGES)[number]>(90)
	const [stats, setStats] = useState<GithubStats | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		setError(null)
		getGithubStats(range)
			.then((s) => {
				if (!cancelled) setStats(s)
			})
			.catch((e) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e))
			})
		return () => {
			cancelled = true
		}
	}, [range])

	return (
		<div className={`scroll-y ${styles.page}`} style={{ height: '100%' }}>
			<div className={styles.header}>
				<div className={styles.titleRow}>
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
						<path d="M12 3.2a8.8 8.8 0 1 0 6.3 2.5" stroke="var(--violet)" strokeWidth={2.6} strokeLinecap="round" />
						<circle cx="18.3" cy="5.7" r="2.7" fill="var(--blue)" />
					</svg>
					<h1 className={styles.title}>GitHub</h1>
				</div>
				<span className={styles.subtitle}>
					작업률 추적 · 최근 {range}일
				</span>
				<div className={styles.rangeToggle}>
					{RANGES.map((r) => (
						<button key={r} className={`${styles.rangeBtn} ${r === range ? styles.rangeBtnActive : ''}`} onClick={() => setRange(r)}>
							{r === 365 ? '1년' : `${r}일`}
						</button>
					))}
				</div>
			</div>

			{error && <div className={styles.loadingState} style={{ color: 'var(--red)' }}>{error}</div>}
			{!error && !stats && <div className={styles.loadingState}>불러오는 중…</div>}

			{stats && (
				<>
					{stats.errors && stats.errors.length > 0 && (
						<div style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 14 }}>
							일부 레포 집계 실패: {stats.errors.join(', ')}
						</div>
					)}
					<div className={styles.statGrid}>
						<StatTile dot="var(--green)" label="커밋" value={stats.commits} />
						<StatTile dot="var(--blue)" label="PR 머지" value={stats.prsMerged} />
						<StatTile dot="var(--amber)" label="활동일" value={stats.activeDays} unit="일" />
						<StatTile dot="var(--violet)" label="평균 리드타임" value={stats.avgLeadTimeDays.toFixed(1)} unit="일" />
						<StatTile dot="var(--red)" label="야간 작업" value={(stats.nightRatio * 100).toFixed(1)} unit="%" />
					</div>

					<div className={styles.panel}>
						<div className={styles.panelTitle}>기여 히트맵</div>
						<ContributionHeatmap data={stats.heatmap} />
					</div>

					<div className={styles.grid2}>
						<div className={styles.panel} style={{ margin: 0 }}>
							<div className={styles.panelTitle}>주간 커밋</div>
							<WeeklyBarChart data={stats.weeklyCommits} />
						</div>
						<div className={styles.panel} style={{ margin: 0 }}>
							<div className={styles.panelTitle}>PR 처리 (열림 → 머지)</div>
							<PrFunnelBars funnel={stats.prFunnel} />
						</div>
					</div>

					<div className={styles.panel}>
						<div className={styles.panelTitle}>레포별 변경량</div>
						<RepoChurnBars repos={stats.perRepoDiff} />
					</div>

					<div className={styles.panel}>
						<div className={styles.panelTitle}>최근 활동</div>
						<ActivityFeed items={stats.recentActivity} />
					</div>
				</>
			)}
		</div>
	)
}
