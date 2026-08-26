import { useEffect, useState } from 'react'
import { getOperatorSettings, updateOperatorSettings } from '../../api/setup'
import styles from './ModelPolicyPane.module.css'

// 예전엔 SettingsModal 안의 접이식 서브섹션이었다 — 16개 작업 종류 × 드롭다운이라 늘어날수록
// 모달의 86vh 높이 제한을 넘어 위쪽 테마/언어 토글이 찌그러지는 버그가 났다. "모든 메뉴는 탭에서
// 나온다" 규칙에 따라 독립 탭으로 분리(높이 제한도 자연히 해소).
const MODEL_ACTIONS: { id: string; label: string }[] = [
	{ id: 'design', label: '설계·아키텍처' },
	{ id: 'orchestrator', label: '지휘자(그룹 지휘/교차검증)' },
	{ id: 'control', label: '관제 에이전트(캘린더·크론잡·설정)' },
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
const MODEL_OPTS = [
	{ id: 'claude-fable-5', label: 'Fable 5' },
	{ id: 'claude-opus-4-8', label: 'Opus 4.8' },
	{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
	{ id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

export default function ModelPolicyPane() {
	const [modelPolicy, setModelPolicy] = useState<Record<string, string> | null>(null)

	useEffect(() => {
		getOperatorSettings()
			.then((r) => setModelPolicy(r.settings.modelPolicy || {}))
			.catch(() => {})
	}, [])

	// Settings.save()는 얕은 병합이라 항상 전체 modelPolicy를 다시 보내야 다른 액션의 오버라이드가
	// 안 날아간다 — patch가 아니라 현재 값 전체 + 바뀐 키 하나로 매번 통째로 저장.
	function setActionModel(action: string, model: string) {
		if (!modelPolicy) return
		const next = { ...modelPolicy, [action]: model }
		setModelPolicy(next) // optimistic
		updateOperatorSettings({ modelPolicy: next }).catch(() => setModelPolicy(modelPolicy))
	}

	return (
		<div className={styles.wrap}>
			<div className={styles.title}>모델 배정</div>
			<div className={styles.hint}>작업 종류별로 어떤 모델을 쓸지 확인하고 바꿉니다. 코드 재시작 없이 바로 적용됩니다.</div>
			<div className={styles.list}>
				{!modelPolicy && <div className={styles.hint}>불러오는 중…</div>}
				{modelPolicy &&
					MODEL_ACTIONS.map((a) => (
						<div key={a.id} className={styles.row}>
							<span className={styles.rowLabel}>{a.label}</span>
							<select className="fin m" style={{ width: 150, height: 28, fontSize: 11 }} value={modelPolicy[a.id] || ''} onChange={(e) => setActionModel(a.id, e.target.value)}>
								{MODEL_OPTS.map((m) => (
									<option key={m.id} value={m.id}>
										{m.label}
									</option>
								))}
							</select>
						</div>
					))}
			</div>
		</div>
	)
}
