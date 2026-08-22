import { useEffect, useRef, useState } from 'react'
import { useDebugStore } from '../../store/useDebugStore'
import { useSetupStore } from '../../store/useSetupStore'
import ServerPane from './ServerPane'
import styles from './BrowserToolbar.module.css'

const NAV_BACK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M15 5l-7 7 7 7" />
	</svg>
)
const NAV_FWD = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 5l7 7-7 7" />
	</svg>
)
const NAV_REFRESH = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
	</svg>
)
const GLOBE = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="9" />
		<path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
	</svg>
)
const TARGET = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="8" />
		<circle cx="12" cy="12" r="2.4" />
		<path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
	</svg>
)
const OVERFLOW = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
		<circle cx="5" cy="12" r="1.2" />
		<circle cx="12" cy="12" r="1.2" />
		<circle cx="19" cy="12" r="1.2" />
	</svg>
)

// 프로토타입의 실제 브라우저 크롬 스타일 툴바(뒤/앞/새로고침 + 주소창) — 기존 TargetPickerBar/
// HierarchyBar를 대체한다. HierarchyBar의 ENV/SERVER/SESSION 브레드크럼은 애초에 고정 fixture라
// 실데이터가 아니었고, 디바이스 토글·요소 선택은 여기 한 줄에 다시 모았다(⋯ 더보기 안 디바이스 토글).
// env 버튼은 ServerPane(워크트리별 .env.local 실편집)을 드롭다운으로 그대로 재사용 — "로컬 서버" 탭에
// 가지 않고도 바로 편집할 수 있게.
export default function BrowserToolbar({ taskId, cwd }: { taskId: string; cwd: string | null }) {
	const sessionId = useDebugStore((s) => s.sessionId)
	const connecting = useDebugStore((s) => s.connecting)
	const sessionError = useDebugStore((s) => s.sessionError)
	const startSession = useDebugStore((s) => s.startSession)
	const stopSession = useDebugStore((s) => s.stopSession)
	const device = useDebugStore((s) => s.device)
	const setDevice = useDebugStore((s) => s.setDevice)
	const selecting = useDebugStore((s) => s.selecting)
	const toggleSelect = useDebugStore((s) => s.toggleSelect)
	const screenshotNonce = useDebugStore((s) => s.screenshotNonce)
	const configuredDevUrl = useSetupStore((s) => s.connectors['dev']?.fields.devServerUrl)

	const [url, setUrl] = useState(configuredDevUrl || 'http://localhost:3000')
	const [envOpen, setEnvOpen] = useState(false)
	const [overflowOpen, setOverflowOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setEnvOpen(false)
				setOverflowOpen(false)
			}
		}
		document.addEventListener('click', onClick)
		return () => document.removeEventListener('click', onClick)
	}, [])

	return (
		<div className={styles.toolbar} ref={rootRef}>
			<span className={`${styles.iconBtn} ${styles.disabled}`}>{NAV_BACK}</span>
			<span className={`${styles.iconBtn} ${styles.disabled}`}>{NAV_FWD}</span>
			<span className={styles.iconBtn} onClick={() => sessionId && useDebugStore.setState({ screenshotNonce: screenshotNonce + 1 })} title="새로고침">
				{NAV_REFRESH}
			</span>
			<span className={styles.addressBar}>
				{GLOBE}
				<input value={url} disabled={!!sessionId} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3000" />
			</span>
			{sessionId ? (
				<button className={`${styles.sessionBtn} ${styles.stop}`} onClick={stopSession}>
					세션 종료
				</button>
			) : (
				<button className={styles.sessionBtn} disabled={connecting} onClick={() => startSession(taskId, null, url, device)}>
					{connecting ? '연결 중…' : '세션 시작'}
				</button>
			)}
			{sessionError && (
				<span className={styles.error} title={sessionError}>
					{sessionError}
				</span>
			)}
			<span className={`${styles.iconBtn} ${selecting ? styles.active : ''}`} onClick={toggleSelect} title="요소 선택">
				{TARGET}
			</span>
			<span className={styles.envAnchor}>
				<span
					className={`${styles.iconBtn} ${styles.envLabelBtn} ${envOpen ? styles.active : ''}`}
					title="환경변수 설정"
					onClick={(e) => {
						e.stopPropagation()
						setEnvOpen((o) => !o)
						setOverflowOpen(false)
					}}
				>
					env
				</span>
				{envOpen && (
					<div className={styles.envPanel}>
						{cwd ? (
							<ServerPane cwd={cwd} />
						) : (
							<div className={styles.envEmpty}>워크트리가 아직 없습니다 — 오케스트레이션을 먼저 시작하세요.</div>
						)}
					</div>
				)}
			</span>
			<span className={styles.overflowAnchor}>
				<span
					className={styles.iconBtn}
					title="더보기"
					onClick={(e) => {
						e.stopPropagation()
						setOverflowOpen((o) => !o)
						setEnvOpen(false)
					}}
				>
					{OVERFLOW}
				</span>
				{overflowOpen && (
					<div className={styles.overflowMenu}>
						<div className={styles.overflowRow}>
							<span>디바이스</span>
							<span className={styles.deviceToggle}>
								<span className={`${styles.deviceOpt} ${device === 'pc' ? styles.deviceOptActive : ''}`} onClick={() => setDevice('pc')}>
									PC
								</span>
								<span className={`${styles.deviceOpt} ${device === 'webview' ? styles.deviceOptActive : ''}`} onClick={() => setDevice('webview')}>
									웹뷰
								</span>
							</span>
						</div>
					</div>
				)}
			</span>
		</div>
	)
}
