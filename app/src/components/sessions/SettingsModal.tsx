import { useEffect, useState } from 'react'
import { useUiStore, applyTheme } from '../../store/useUiStore'
import type { Theme, Lang } from '../../store/useUiStore'
import { getOperatorSettings, updateOperatorSettings } from '../../api/setup'
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

// server/settings.cjs MODEL_POLICY 순서·설명 그대로 — 코드 고치지 않고 설정에서 바로 실험해볼 수 있게(§06).
const MODEL_ACTIONS: { id: string; label: string }[] = [
	{ id: 'design', label: '설계·아키텍처' },
	{ id: 'orchestrator', label: '지휘자(그룹 지휘/교차검증)' },
	{ id: 'dev', label: '▶진행 제품 코딩' },
	{ id: 'review', label: 'PR 코드 리뷰' },
	{ id: 'improve', label: '리뷰대로 코드 개선' },
	{ id: 'qa', label: 'QA 테스트케이스 생성' },
	{ id: 'verify', label: 'TC 검증(playwright)' },
	{ id: 'monitor', label: '운영/PR 모니터 루프' },
	{ id: 'debug', label: '디버깅 명령' },
	{ id: 'backlog', label: '백로그 생성' },
	{ id: 'enrich', label: '스레드 정리' },
	{ id: 'classify', label: '업무 코드/비개발 판정' },
	{ id: 'ops', label: '비개발 업무 자동수행' },
	{ id: 'link', label: '배포 백로그 연결' },
	{ id: 'translate', label: '브랜치명 번역' },
	{ id: 'ppt', label: 'PPT 제작' },
]
// 실제 MODEL_POLICY가 쓰는 버전 그대로 — 새 버전이 나오면 여기만 갱신.
const MODEL_OPTS = [
	{ id: 'claude-fable-5', label: 'Fable 5' },
	{ id: 'claude-opus-4-8', label: 'Opus 4.8' },
	{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
	{ id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

export default function SettingsModal({ open, onClose }: { open: boolean; onClose(): void }) {
	const theme = useUiStore((s) => s.theme)
	const setTheme = useUiStore((s) => s.setTheme)
	const lang = useUiStore((s) => s.lang)
	const setLang = useUiStore((s) => s.setLang)

	const [modelOpen, setModelOpen] = useState(false)
	const [modelPolicy, setModelPolicy] = useState<Record<string, string> | null>(null)

	useEffect(() => {
		if (!open) return
		getOperatorSettings()
			.then((r) => setModelPolicy(r.settings.modelPolicy || {}))
			.catch(() => {})
	}, [open])

	// Settings.save()는 얕은 병합이라(§06) 항상 전체 modelPolicy를 다시 보내야 다른 액션의
	// 오버라이드가 안 날아간다 — 그래서 patch가 아니라 현재 값 전체 + 바뀐 키 하나로 매번 통째로 저장.
	function setActionModel(action: string, model: string) {
		if (!modelPolicy) return
		const next = { ...modelPolicy, [action]: model }
		setModelPolicy(next) // optimistic
		updateOperatorSettings({ modelPolicy: next }).catch(() => setModelPolicy(modelPolicy))
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
						<div className={styles.rowHint}>오케스트레이터·워크트리 같은 짧은 용어 라벨만 바뀝니다.</div>
					</div>
					<div className={styles.toggle}>
						{LANG_OPTS.map((o) => (
							<button key={o.id} type="button" className={`${styles.opt} ${lang === o.id ? styles.optActive : ''}`} onClick={() => setLang(o.id)}>
								{o.label}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className={styles.row} style={{ marginTop: 16, cursor: 'pointer' }} onClick={() => setModelOpen((o) => !o)}>
				<div>
					<div className={styles.rowLabel}>모델 배정 {modelOpen ? '▾' : '▸'}</div>
					<div className={styles.rowHint}>작업 종류별로 어떤 모델을 쓸지 확인하고 바꿉니다. 코드 재시작 없이 바로 적용됩니다.</div>
				</div>
			</div>
			{modelOpen && (
				<div className={styles.modelList}>
					{!modelPolicy && <div className={styles.rowHint}>불러오는 중…</div>}
					{modelPolicy &&
						MODEL_ACTIONS.map((a) => (
							<div key={a.id} className={styles.modelRow}>
								<span className={styles.modelRowLabel}>{a.label}</span>
								<select
									className="fin m"
									style={{ width: 132, height: 26, fontSize: 10.5 }}
									value={modelPolicy[a.id] || ''}
									onChange={(e) => setActionModel(a.id, e.target.value)}
								>
									{MODEL_OPTS.map((m) => (
										<option key={m.id} value={m.id}>
											{m.label}
										</option>
									))}
								</select>
							</div>
						))}
				</div>
			)}
		</Modal>
	)
}
