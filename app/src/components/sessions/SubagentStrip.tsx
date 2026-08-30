import { useEffect, useState } from 'react'
import { getWorktreeSubagents } from '../../api/subagents'
import type { SubagentEntry } from '../../api/subagents'
import { useSessionsStore } from '../../store/useSessionsStore'
import StatusDot from '../common/StatusDot'
import { translate, useTp } from '../../utils/i18n'
import styles from './SubagentStrip.module.css'

const CLAUDE_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M4 4h16v12H8l-4 4V4z" />
	</svg>
)

// 컴포넌트가 아닌 모듈 함수라 useT() 대신 non-hook translate를 직접 쓴다.
function timeAgo(iso: string | null) {
	if (!iso) return ''
	const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
	if (min < 1) return translate('방금')
	if (min < 60) return `${min}m`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}h`
	return `${Math.floor(hr / 24)}d`
}

const POLL_MS = 8000

// 이 워크트리의 살아있는 클로드 세션이 Task 툴로 띄운 서브에이전트 목록 — ~/.claude/projects의
// 실제 트랜스크립트를 읽어온다(서버에서 파싱). 세션이 진행되며 새로 생기니 짧게 폴링.
// compact: 탭 상단의 전체너비 툴바(기본)가 아니라 TaskRow처럼 좁은 사이드바 행 안에 끼워 넣을 때 —
// 프로토타입의 subagent-toggle처럼 테두리/배경 없이 칩 한 줄만 남긴다.
// "관제도 서브에이전트도 진행중은 circle 표기로 바꿔주자" — 관제 사이드바 항목과 같은 소스
// (termStatus, /api/term이 이미 계산해주는 값)를 이 스트립을 소유한 세션 이름으로 조인해 헤더의
// 정적 클로드 배지를 실제 생사/작업 상태를 반영하는 점으로 바꾼다. sessionName 없이 쓰는 호출부는
// (아직) 없지만 옵셔널로 둬 하위호환.
export default function SubagentStrip({ cwd, sessionName, compact }: { cwd: string; sessionName?: string; compact?: boolean }) {
	const tp = useTp()
	const [items, setItems] = useState<SubagentEntry[]>([])
	const [open, setOpen] = useState(false)
	const termStatus = useSessionsStore((s) => (sessionName ? s.termStatus[sessionName] : undefined))

	useEffect(() => {
		let alive = true
		const tick = () => {
			getWorktreeSubagents(cwd)
				.then((r) => {
					if (alive) setItems(r.subagents)
				})
				.catch(() => {})
		}
		tick()
		const id = setInterval(tick, POLL_MS)
		return () => {
			alive = false
			clearInterval(id)
		}
	}, [cwd])

	if (items.length === 0) return null

	return (
		<div className={`${styles.strip} ${compact ? styles.compact : ''}`}>
			<div className={`${styles.head} ${compact ? styles.headCompact : ''}`} onClick={() => setOpen((o) => !o)}>
				<span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>▸</span>
				<span className={styles.badge}>{CLAUDE_ICON}</span>
				{termStatus?.exists && (
					<StatusDot color={termStatus.needsAuth ? 'red' : termStatus.waiting ? 'amber' : 'green'} pulse={!!termStatus.working} size={6} />
				)}
				<span className={styles.label}>{tp('서브에이전트 {n}건', { n: items.length })}</span>
				<span className={`m ${styles.time}`}>{timeAgo(items[0]?.at)}</span>
			</div>
			{open && (
				<div className={`${styles.list} ${compact ? styles.listCompact : ''}`}>
					{items.map((it, i) => (
						<div key={i} className={styles.row}>
							<span className={`${styles.badge} ${styles.small}`}>{CLAUDE_ICON}</span>
							<span className={`m ${styles.name}`}>{it.subagentType}</span>
							<span className={styles.desc}>{it.description}</span>
							<span className={`m ${styles.time}`}>{timeAgo(it.at)}</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
