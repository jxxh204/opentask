import { useEffect, useState } from 'react'
import { useUiStore, applyTheme } from '../../store/useUiStore'
import type { Theme, Lang } from '../../store/useUiStore'
import { useTabsStore, MODEL_POLICY_NODE_ID, TEAM_RULES_NODE_ID } from '../../store/useTabsStore'
import { useHolidayStore } from '../../store/useHolidayStore'
import { useQuickstartStore } from '../../store/useQuickstartStore'
import { useT } from '../../utils/i18n'
import Modal from '../common/Modal'
import styles from './SettingsModal.module.css'

const THEME_OPTS: { id: Theme; label: string }[] = [
	{ id: 'light', label: '라이트' },
	{ id: 'dark', label: '다크' },
	{ id: 'system', label: '시스템' },
]
const LANG_OPTS: { id: Lang; label: string }[] = [
	{ id: 'ko', label: '한글' },
	{ id: 'en', label: 'EN' },
]

export default function SettingsModal({ open, onClose }: { open: boolean; onClose(): void }) {
	const t = useT()
	const theme = useUiStore((s) => s.theme)
	const setTheme = useUiStore((s) => s.setTheme)
	const lang = useUiStore((s) => s.lang)
	const setLang = useUiStore((s) => s.setLang)
	// "캘린더에 대한민국 공휴일도 적용해줘 — 나라는 설정에서 설정되도록" — 전역 환경설정이라 캘린더
	// 툴바가 아니라 여기가 맞는 자리(§CalendarPane.tsx 주석). 기본값은 컴퓨터 언어 설정으로 자동
	// 추정된다(§useHolidayStore detectDefaultCountry) — 여기서 명시적으로 바꾸면 그 뒤로 그 값이 남는다.
	const holidayCountry = useHolidayStore((s) => s.country)
	const setHolidayCountry = useHolidayStore((s) => s.setCountry)
	const holidayCountries = useHolidayStore((s) => s.countries)
	const loadHolidayCountries = useHolidayStore((s) => s.loadCountries)
	useEffect(() => {
		if (open) loadHolidayCountries()
	}, [open, loadHolidayCountries])

	// Electron 셸에서만 의미 있는 설정 — 백엔드가 detached 프로세스로 앱 종료 후에도 계속
	// 살아있는 게 기본 동작이라(§ electron/main.cjs resolveDetachedBackendUrl), 정말 완전히
	// 끄고 싶은 사람을 위한 토글. 브라우저 dev 모드(window.openrm 없음)에서는 아예 숨긴다.
	const isElectron = !!window.openrm?.isElectron
	const [killBackendOnQuit, setKillBackendOnQuit] = useState(false)
	useEffect(() => {
		if (open && isElectron) window.openrm!.getQuitBehavior().then((s) => setKillBackendOnQuit(s.killBackendOnQuit))
	}, [open, isElectron])
	async function toggleKillBackendOnQuit() {
		const next = !killBackendOnQuit
		setKillBackendOnQuit(next)
		await window.openrm!.setQuitBehavior(next)
	}

	function openModelPolicy() {
		const s = useTabsStore.getState()
		if (!s.tabsByNode[MODEL_POLICY_NODE_ID]?.length) s.openTab(MODEL_POLICY_NODE_ID, 'modelPolicy')
		s.setActiveNode(MODEL_POLICY_NODE_ID, 'modelPolicy')
		onClose()
	}

	// "태스크 매니저처럼 팀 규칙도 탭으로" — 모델 배정과 완전히 같은 진입 패턴.
	function openTeamRules() {
		const s = useTabsStore.getState()
		if (!s.tabsByNode[TEAM_RULES_NODE_ID]?.length) s.openTab(TEAM_RULES_NODE_ID, 'teamRules')
		s.setActiveNode(TEAM_RULES_NODE_ID, 'teamRules')
		onClose()
	}

	function openQuickstart() {
		onClose()
		useQuickstartStore.getState().show()
	}

	return (
		<Modal open={open} onClose={onClose} width={380}>
			<div className={styles.head}>
				<span>설정</span>
				<span className={styles.close} onClick={onClose}>
					×
				</span>
			</div>
			<div className={styles.body}>
				<div className={styles.row}>
					<div>
						<div className={styles.rowLabel}>테마</div>
						<div className={styles.rowHint}>라이트/다크 화면을 선택합니다. 시스템은 OS 설정을 따라갑니다.</div>
					</div>
					<div className={styles.toggle}>
						{THEME_OPTS.map((o) => (
							<button
								key={o.id}
								type="button"
								className={`${styles.opt} ${theme === o.id ? styles.optActive : ''}`}
								onClick={() => {
									setTheme(o.id)
									applyTheme(o.id)
								}}
							>
								{o.label}
							</button>
						))}
					</div>
				</div>
				<div className={styles.row} style={{ marginTop: 16 }}>
					<div>
						<div className={styles.rowLabel}>내부 용어 언어</div>
						<div className={styles.rowHint}>{t('오케스트레이터·워크트리 같은 짧은 용어 라벨만 바뀝니다.')}</div>
					</div>
					<div className={styles.toggle}>
						{LANG_OPTS.map((o) => (
							<button key={o.id} type="button" className={`${styles.opt} ${lang === o.id ? styles.optActive : ''}`} onClick={() => setLang(o.id)}>
								{o.label}
							</button>
						))}
					</div>
				</div>
				<div className={styles.row} style={{ marginTop: 16 }}>
					<div>
						<div className={styles.rowLabel}>캘린더 공휴일 국가</div>
						<div className={styles.rowHint}>캘린더에 표시할 공휴일 기준 국가입니다. 기본값은 이 컴퓨터의 언어 설정으로 추정됩니다.</div>
					</div>
					<select className="fin m" style={{ width: 150, height: 28, fontSize: 11 }} value={holidayCountry} onChange={(e) => setHolidayCountry(e.target.value)}>
						{holidayCountries.length ? (
							holidayCountries.map((c) => (
								<option key={c.code} value={c.code}>
									{c.name}
								</option>
							))
						) : (
							<option value={holidayCountry}>{holidayCountry}</option>
						)}
					</select>
				</div>
				{isElectron && (
					<div className={styles.row} style={{ marginTop: 16 }}>
						<div>
							<div className={styles.rowLabel}>앱 종료 시 백엔드</div>
							<div className={styles.rowHint}>
								기본은 앱을 꺼도 백엔드가 계속 떠서 세션이 이어집니다. "완전 종료"를 켜면 앱을 끌 때 백엔드도 같이 내려갑니다(포트도 반납됨).
							</div>
						</div>
						<div className={styles.toggle}>
							<button type="button" className={`${styles.opt} ${!killBackendOnQuit ? styles.optActive : ''}`} onClick={() => killBackendOnQuit && toggleKillBackendOnQuit()}>
								유지
							</button>
							<button type="button" className={`${styles.opt} ${killBackendOnQuit ? styles.optActive : ''}`} onClick={() => !killBackendOnQuit && toggleKillBackendOnQuit()}>
								완전 종료
							</button>
						</div>
					</div>
				)}
				<div className={styles.row} style={{ marginTop: 16, cursor: 'pointer' }} onClick={openTeamRules}>
					<div>
						<div className={styles.rowLabel}>팀 규칙 →</div>
						<div className={styles.rowHint}>레포별 브랜치·문서 규칙을 탭에서 확인하고 바꿉니다.</div>
					</div>
				</div>
				<div className={styles.row} style={{ marginTop: 16, cursor: 'pointer' }} onClick={openModelPolicy}>
					<div>
						<div className={styles.rowLabel}>모델 배정 →</div>
						<div className={styles.rowHint}>작업 종류별로 어떤 모델을 쓸지 탭에서 확인하고 바꿉니다.</div>
					</div>
				</div>
				<div className={styles.row} style={{ marginTop: 16, cursor: 'pointer' }} onClick={openQuickstart}>
					<div>
						<div className={styles.rowLabel}>퀵스타트 다시 보기 →</div>
						<div className={styles.rowHint}>처음 앱을 켰을 때 봤던 사용법 안내를 다시 엽니다.</div>
					</div>
				</div>
			</div>
		</Modal>
	)
}
