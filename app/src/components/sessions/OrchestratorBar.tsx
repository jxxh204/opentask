import { useEffect, useRef } from 'react'
import { useSessionsStore, getOrchestration } from '../../store/useSessionsStore'
import StatusDot from '../common/StatusDot'
import type { DotColor } from '../common/StatusDot'
import styles from './OrchestratorBar.module.css'

const POLL_MS = 4000

export default function OrchestratorBar({ folderId, taskCount }: { folderId: string; taskCount: number }) {
	const orch = useSessionsStore((s) => getOrchestration(s, folderId))
	const busy = useSessionsStore((s) => !!s.orchBusy[folderId])
	const refresh = useSessionsStore((s) => s.refreshOrchestration)
	const start = useSessionsStore((s) => s.startOrchestration)
	const advance = useSessionsStore((s) => s.advanceOrchestration)
	const stop = useSessionsStore((s) => s.stopOrchestration)
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

	useEffect(() => {
		refresh(folderId)
	}, [folderId, refresh])

	useEffect(() => {
		if (orch.running) {
			pollRef.current = setInterval(() => refresh(folderId), POLL_MS)
			return () => {
				if (pollRef.current) clearInterval(pollRef.current)
			}
		}
	}, [orch.running, folderId, refresh])

	return (
		<div className={styles.wrap} style={{ border: `1px solid ${orch.running ? 'rgba(139,124,240,.4)' : 'rgba(139,124,240,.24)'}`, background: orch.running ? 'rgba(139,124,240,.10)' : 'rgba(139,124,240,.06)' }}>
			<div className={styles.head}>
				<span style={{ fontSize: 14 }}>🎼</span>
				<span className={styles.label}>오케스트레이션</span>
				<span className={styles.status} style={{ color: orch.running ? 'var(--green)' : 'var(--t3)' }}>
					{orch.running ? '실행 중' : '대기'}
				</span>
				{orch.running && (
					<>
						<StatusDot color="green" pulse />
						<span className={`m ${styles.managed}`}>claude code · 관리 {orch.sessions.length}</span>
					</>
				)}
				<div className={styles.spacer} />
				{orch.running ? (
					<>
						<span className={styles.runBtn} onClick={() => !busy && advance(folderId)} style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
							▶ 일괄 진행
						</span>
						<span className={styles.stopBtn} onClick={() => !busy && stop(folderId)} style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
							중지
						</span>
					</>
				) : (
					<span className={styles.startBtn} onClick={() => !busy && start(folderId)} style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
						{busy ? '시작 중…' : '🎼 오케스트레이션 시작'}
					</span>
				)}
			</div>
			{orch.running && orch.log.length > 0 && (
				<div className={styles.log}>
					{orch.log.map((l, i) => (
						<div key={i} className={styles.logRow}>
							<StatusDot color={l.dot as DotColor} size={5} />
							<span className={`m ${styles.logText}`}>{l.t}</span>
						</div>
					))}
				</div>
			)}
			{taskCount === 0 && <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 8 }}>이 폴더에 태스크가 없습니다</div>}
		</div>
	)
}
