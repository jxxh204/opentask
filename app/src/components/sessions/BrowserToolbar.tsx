import { useEffect, useRef, useState } from 'react'
import { useT } from '../../utils/i18n'
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
const DEVTOOLS = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M8 4L3 12l5 8M16 4l5 8-5 8M14 4l-4 16" />
	</svg>
)
const OVERFLOW = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
		<circle cx="5" cy="12" r="1.2" />
		<circle cx="12" cy="12" r="1.2" />
		<circle cx="19" cy="12" r="1.2" />
	</svg>
)

// 실제 브라우저 크롬 스타일 툴바(뒤/앞/새로고침 + 주소창) — Electron 네이티브 <webview>를 감싼다
// (§BrowserPane.tsx — 예전 Playwright 스크린샷 폴링 방식을 대체). 뒤/앞/새로고침/주소창은 이제 진짜
// webview 내비게이션에 그대로 연결된다(더 이상 흉내 UI가 아님). env 버튼은 ServerPane(워크트리별
// .env.local 실편집)을 드롭다운으로 그대로 재사용.
export default function BrowserToolbar({
	url,
	loading,
	canGoBack,
	canGoForward,
	error,
	device,
	cwd,
	onBack,
	onForward,
	onReload,
	onNavigate,
	onOpenDevtools,
	onDeviceChange,
}: {
	url: string
	loading: boolean
	canGoBack: boolean
	canGoForward: boolean
	error: string | null
	device: 'pc' | 'mobile'
	cwd: string | null
	onBack(): void
	onForward(): void
	onReload(): void
	onNavigate(url: string): void
	onOpenDevtools(): void
	onDeviceChange(d: 'pc' | 'mobile'): void
}) {
	const t = useT()
	const [draft, setDraft] = useState(url)
	const [envOpen, setEnvOpen] = useState(false)
	const [overflowOpen, setOverflowOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)

	// 사람이 주소창을 편집 중이 아닐 때만 실제 webview URL로 동기화 — 안 그러면 타이핑 중에 매 렌더마다 덮어써진다.
	useEffect(() => {
		setDraft(url)
	}, [url])

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

	const submit = () => {
		if (draft.trim()) onNavigate(draft.trim())
	}

	return (
		<div className={styles.toolbar} ref={rootRef}>
			<span className={`${styles.iconBtn} ${canGoBack ? '' : styles.disabled}`} onClick={() => canGoBack && onBack()} title={t('뒤로')}>
				{NAV_BACK}
			</span>
			<span className={`${styles.iconBtn} ${canGoForward ? '' : styles.disabled}`} onClick={() => canGoForward && onForward()} title={t('앞으로')}>
				{NAV_FWD}
			</span>
			<span className={`${styles.iconBtn} ${loading ? styles.spinning : ''}`} onClick={onReload} title={t('새로고침')}>
				{NAV_REFRESH}
			</span>
			<span className={styles.addressBar}>
				{GLOBE}
				<input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && submit()}
					onBlur={submit}
					placeholder="http://localhost:3000"
				/>
			</span>
			{error && (
				<span className={styles.error} title={error}>
					{error}
				</span>
			)}
			<span className={styles.iconBtn} onClick={onOpenDevtools} title={t('개발자 도구 열기')}>
				{DEVTOOLS}
			</span>
			<span className={styles.envAnchor}>
				<span
					className={`${styles.iconBtn} ${styles.envLabelBtn} ${envOpen ? styles.active : ''}`}
					title={t('환경변수 설정')}
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
							<div className={styles.envEmpty}>{t('워크트리가 아직 없습니다 — 오케스트레이션을 먼저 시작하세요.')}</div>
						)}
					</div>
				)}
			</span>
			<span className={styles.overflowAnchor}>
				<span
					className={styles.iconBtn}
					title={t('더보기')}
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
							<span>{t('디바이스')}</span>
							<span className={styles.deviceToggle}>
								<span className={`${styles.deviceOpt} ${device === 'pc' ? styles.deviceOptActive : ''}`} onClick={() => onDeviceChange('pc')}>
									PC
								</span>
								<span className={`${styles.deviceOpt} ${device === 'mobile' ? styles.deviceOptActive : ''}`} onClick={() => onDeviceChange('mobile')}>
									{t('모바일')}
								</span>
							</span>
						</div>
					</div>
				)}
			</span>
		</div>
	)
}
