import { useState } from 'react'
import { useDebugStore } from '../../store/useDebugStore'
import { useSetupStore } from '../../store/useSetupStore'
import StatusDot from '../common/StatusDot'
import styles from './TargetPickerBar.module.css'

// taskId/branchId — 이 브라우저 세션의 "반영" 지시가 실제로 어느 살아있는 세션에 꽂힐지 결정한다
// (server/debug/inspector.cjs가 Orchestrator.findSessionForTask로 찾음). Sessions의 브라우저 탭에서
// 재사용할 땐 지금 보고 있는 실제 태스크 id를 넘긴다 — 기존 /debug 페이지는 넘기지 않아 그대로 null.
export default function TargetPickerBar({ taskId = null, branchId = null }: { taskId?: string | null; branchId?: string | null }) {
	const target = useDebugStore((s) => s.target)
	const ip = useDebugStore((s) => s.ip)
	const port = useDebugStore((s) => s.port)
	const copied = useDebugStore((s) => s.copied)
	const copyIp = useDebugStore((s) => s.copyIp)
	const sessionId = useDebugStore((s) => s.sessionId)
	const connecting = useDebugStore((s) => s.connecting)
	const sessionError = useDebugStore((s) => s.sessionError)
	const device = useDebugStore((s) => s.device)
	const startSession = useDebugStore((s) => s.startSession)
	const stopSession = useDebugStore((s) => s.stopSession)
	const configuredDevUrl = useSetupStore((s) => s.connectors['dev']?.fields.devServerUrl)

	const [url, setUrl] = useState(configuredDevUrl || 'http://localhost:3000')

	return (
		<div className={styles.bar}>
			<span className={styles.title}>디버깅</span>
			<span className={styles.divider} />
			<div className={styles.picker}>
				<span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
					<StatusDot color={sessionId ? 'green' : 'muted'} />
					<span className={styles.taskName}>{target.task}</span>
				</span>
				<span className={styles.worktree}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
						<circle cx="6" cy="6" r="2.5" />
						<circle cx="6" cy="18" r="2.5" />
						<circle cx="18" cy="8" r="2.5" />
						<path d="M6 8.5v7M18 10.5c0 3-3 4-6 4.5" />
					</svg>
					<span className="m">{target.worktree}</span>
				</span>
				<span className={`m ${styles.server}`}>{target.server}</span>
			</div>

			{!sessionId && (
				<>
					<input
						className="fin m"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="http://localhost:3000"
						style={{ width: 220, height: 32 }}
					/>
					<button onClick={() => startSession(taskId, branchId, url, device)} disabled={connecting} style={{ height: 32, padding: '0 13px', borderRadius: 8, background: 'var(--violet)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, flex: 'none' }}>
						{connecting ? '연결 중…' : '세션 시작'}
					</button>
				</>
			)}
			{sessionId && (
				<button onClick={stopSession} style={{ height: 32, padding: '0 13px', borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--t2)', fontSize: 12, fontWeight: 600, flex: 'none' }}>
					세션 종료
				</button>
			)}
			{sessionError && (
				<span className="m" style={{ fontSize: 10.5, color: 'var(--red)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sessionError}>
					{sessionError}
				</span>
			)}

			<div className={styles.spacer} />

			<div className={styles.ipChip} onClick={copyIp} title="네트워크 주소 복사">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
					<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
					<circle cx="12" cy="19.5" r="1" />
				</svg>
				<span className={`m ${styles.ipText}`}>{ip}</span>
				<span className={`m ${styles.portText}`}>{port}</span>
				{copied && <span className={styles.copiedText}>복사됨</span>}
			</div>
		</div>
	)
}
