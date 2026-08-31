import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionsStore, getOrchestration } from '../../store/useSessionsStore'
import type { FeedKind, Decision, DecisionKind } from '../../api/sessions'
import { getDecisions } from '../../api/sessions'
import StatusDot from '../common/StatusDot'
import type { DotColor } from '../common/StatusDot'
import XTerm from '../terminal/XTerm'
import { useT, translate, translateP } from '../../utils/i18n'
import styles from './OrchestratorPane.module.css'

const KIND_LABEL: Record<FeedKind, string> = { plan: '계획', dispatch: '지시', result: '보고', msg: '메시지', error: '오류', blocked: '도움요청', stalled: '응답없음' }
const DECISION_LABEL: Record<DecisionKind, string> = { repo_assign: '② 레포 분류', repo_verify_hold: '② 레포 재확인', kind_judge: '⑤ kind 판단', review_verdict: '⑧ 리뷰 판정' }

// 컴포넌트가 아닌 모듈 함수라 useT() 대신 non-hook translate를 직접 쓴다.
function timeAgo(ts: number) {
	const min = Math.floor((Date.now() - ts) / 60000)
	if (min < 1) return translate('방금')
	if (min < 60) return `${min}m`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}h`
	return `${Math.floor(hr / 24)}d`
}

// 오케스트레이터는 별도로 "시작" 버튼을 누르는 게 아니라, 이 태스크에 서브태스크가 생기는 순간
// 자동으로 통제를 시작한다(useSessionsStore.createTaskInFolder/quickStartTask에서 트리거). 여기는
// 그 기계적 상태·로그(진행/중지, 활동 로그)를 보여주는 요약 뷰다.
//
// 지휘자(conductor)도 결국 클로드 세션이다 — 다른 세션들(서브태스크, 즉석 "클로드 세션" 탭)과 동일하게
// 탭을 열면 버튼 없이 바로 뜬다(ClaudeSessionPane과 같은 패턴). raw 터미널을 이 탭에 직접 붙여서 실제
// 대화가 여기서 바로 오간다 — 별도 "메시지 전송" 인풋은 없다(터미널에 직접 타이핑하면 됨).
// "대화 로그"는 그와 별개로 지휘자가 스스로 기록한 지시/보고/계획 흐름을 구조화된 트리로 보여준다
// (raw 터미널 스크롤엔 없는, 지휘자→서브태스크 다중 세션 간 오간 요약 — orch.feed).
// "메인 태스크와 서브태스크의 대화로그로 보고싶고 서브태스크 이름은 태스크이름으로" — 서브태스크가
// 보고할 때 실려오는 from/to는 사람이 못 읽는 원시 ID다(§ orchestrator.cjs notifyConductor가
// current.id/st.id를 그대로 넘김). 이 ID가 어느 서브태스크 것인지 찾아 그 부모 태스크 이름으로
// 되돌린다 — 세부 단계(개발/QA/배포)별로 다른 이름 대신 "메인 태스크" 하나로 묶어 2인 대화처럼
// 보이게 하려는 의도적 단순화(사용자 요청).
function buildTaskNameById(tasks: { id: string; name: string; subtasks: { id: string }[] }[]) {
	const map: Record<string, string> = {}
	for (const task of tasks) {
		map[task.id] = task.name
		for (const st of task.subtasks) map[st.id] = task.name
	}
	return map
}

export default function OrchestratorPane({ folderId }: { folderId: string }) {
	const t = useT()
	const orch = useSessionsStore((s) => getOrchestration(s, folderId))
	const folder = useSessionsStore((s) => s.folders.find((f) => f.id === folderId))
	const taskNameById = useMemo(() => buildTaskNameById(folder?.tasks ?? []), [folder])
	// 발화자 판정: from이 지휘자 자신(orch/conductor)이면 왼쪽, 태스크/서브태스크 ID로 풀리면
	// 오른쪽(그 태스크 이름표), 그 외(오퍼레이터가 직접 보낸 메시지 등)는 왼쪽에 이름만 다르게.
	function speakerFor(id: string): { label: string; side: 'left' | 'right' } {
		if (id === 'orch' || id === 'conductor') return { label: t('지휘자'), side: 'left' }
		const taskName = taskNameById[id]
		if (taskName) return { label: taskName, side: 'right' }
		return { label: id, side: 'left' } // 오퍼레이터 이름·미확인 ID 등 — 이름 그대로 왼쪽에 표시
	}
	const busy = useSessionsStore((s) => !!s.orchBusy[folderId])
	const refresh = useSessionsStore((s) => s.refreshOrchestration)
	const advance = useSessionsStore((s) => s.advanceOrchestration)
	const stop = useSessionsStore((s) => s.stopOrchestration)
	const startConductor = useSessionsStore((s) => s.startConductor)
	const stopConductor = useSessionsStore((s) => s.stopConductor)
	const startedRef = useRef<string | null>(null)
	// 감사 로그(§12) — conductor.feed(인메모리, 재시작시 소실)와 별개로 SQLite에 영속된 판정 이유.
	const [decisions, setDecisions] = useState<Decision[]>([])

	useEffect(() => {
		refresh(folderId)
	}, [folderId, refresh])

	useEffect(() => {
		let cancelled = false
		getDecisions(folderId)
			.then((r) => !cancelled && setDecisions(r.decisions || []))
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [folderId, orch.feed.length])

	useEffect(() => {
		if (!orch.running && !orch.conductor) return
		const id = setInterval(() => refresh(folderId), 4000)
		return () => clearInterval(id)
	}, [orch.running, orch.conductor, folderId, refresh])

	// ClaudeSessionPane과 동일한 자동 시작 패턴 — 탭을 열었을 때 지휘자가 없으면(그리고 아직 이
	// 폴더에서 시도 안 했으면) 곧바로 띄운다. folderId가 바뀌면(다른 태스크로 이동) 다시 시도 가능.
	useEffect(() => {
		if (orch.conductor || busy || startedRef.current === folderId) return
		startedRef.current = folderId
		startConductor(folderId)
	}, [folderId, orch.conductor, busy, startConductor])

	// orch.running은 서버(orchestrator.cjs)가 "서브태스크 세션이 하나라도 떴는가"만 보는 값이라
	// (▶ 진행/advance가 헛돌지 않게 하려는 의도적 정의), 지휘자가 막 시작해 계획을 세우는 중이라
	// 서브태스크를 아직 하나도 안 띄운 구간엔 running=false다 — 그 상태를 그대로 "대기"로 보여주면
	// 터미널에선 지휘자가 뻔히 살아서 "Considering…" 중인데 헤더만 "대기"라고 해서 어색해 보였다
	// (사용자가 스크린샷으로 신고). 지휘자 생존 여부(orch.conductor)를 더해 3단계로 구분한다.
	const isActive = orch.running || !!orch.conductor
	const stateLabel = t(orch.running ? '조율 중' : orch.conductor ? '태스크 매니저 작업 중' : '대기')
	return (
		<div className={styles.wrap}>
			<div className={styles.head}>
				<StatusDot color={isActive ? 'green' : 'muted'} pulse={isActive} />
				<span className={styles.state}>{stateLabel}</span>
				<span className={`m ${styles.meta}`}>{translateP('{n}개 세션 · 웨이브 {wave}', { n: orch.sessions.length, wave: orch.currentWaveIndex + 1 })}</span>
				<div style={{ flex: 1 }} />
				{orch.running && (
					<>
						<button className={styles.btn} disabled={busy} onClick={() => advance(folderId)}>
							{t('▶ 진행')}
						</button>
						<button className={styles.btn} disabled={busy} onClick={() => stop(folderId)} title={t('웨이브 진행만 멈춥니다 — 태스크 매니저 세션은 그대로 유지됩니다')}>
							{t('웨이브 중지')}
						</button>
					</>
				)}
				{orch.conductor && (
					<button className={styles.btn} disabled={busy} onClick={() => stopConductor(folderId)} title={t('태스크 매니저 세션 자체를 종료합니다 — 다시 시작하려면 탭을 새로 열어야 합니다')}>
						{t('태스크 매니저 중지')}
					</button>
				)}
			</div>

			{orch.conductor ? (
				<div className={styles.termHost}>
					<XTerm session={orch.conductor.session} cwd={orch.conductor.cwd} modelLabel={orch.conductor.modelLabel} />
				</div>
			) : (
				<div className={styles.starting}>{t('클로드 세션 시작 중…')}</div>
			)}

			<div className={styles.pad}>
				{orch.sessions.length > 0 && (
					<div className={styles.sessionStrip}>
						{orch.sessions.map((s) => (
							<span key={s.taskId} className={`m ${styles.sessionChip}`}>
								<span className={styles.sessionDot} />
								{s.tmuxSession}
							</span>
						))}
					</div>
				)}

				{/* "서로 대화하는것처럼 연출... 메인 태스크와 서브태스크와의 대화로그로 보고싶어" — from→to
				    화살표+원시 ID 나열은 안 읽힌다는 피드백을 받고 실제 메신저처럼 좌우 말풍선으로
				    바꿨다: 지휘자(메인 태스크)는 왼쪽, 서브태스크는(§ speakerFor — 부모 태스크 이름으로
				    표시) 오른쪽. 종류(kind) 배지는 말풍선 안 메타줄에 그대로 유지해 도움요청/응답없음
				    같은 신호는 계속 놓치지 않게 한다. */}
				{orch.conductor && (
					<>
						<div className={styles.logLabel}>{t('대화 로그')}</div>
						{orch.feed.length === 0 ? (
							<div className={styles.logEmpty}>{t('아직 대화 없음')}</div>
						) : (
							<div className={styles.chatLog}>
								{orch.feed.map((e, i) => {
									const speaker = speakerFor(e.from)
									return (
										<div key={i} className={`${styles.chatRow} ${speaker.side === 'right' ? styles.chatRowRight : styles.chatRowLeft}`}>
											<div className={`${styles.chatBubble} ${speaker.side === 'right' ? styles.chatBubbleRight : styles.chatBubbleLeft}`}>
												<div className={`m ${styles.chatMeta}`}>
													<span className={styles.chatSpeaker}>{speaker.label}</span>
													<span className={`${styles.chatKind} ${styles[`kind_${e.kind}`]}`}>{t(KIND_LABEL[e.kind] || '메시지')}</span>
													<span className={styles.chatTime}>{timeAgo(e.ts)}</span>
												</div>
												<div className={styles.chatText}>{e.text}</div>
											</div>
										</div>
									)
								})}
							</div>
						)}
					</>
				)}

				{/* 판정 로그·활동 로그는 실제 오간 대화가 아니라 기계적 감사·이벤트 기록이라, 위 대화 로그와
				    같은 무게로 그리면(전엔 똑같은 feedList) "뭐가 중요한 정보인지" 위계가 안 잡혔다. 두
				    로그를 하나의 조용한 스트림으로 묶어 대화 로그보다 한 단 낮은 시각적 무게로 둔다. */}
				{(decisions.length > 0 || orch.log.length > 0) && (
					<>
						<div className={styles.logLabel}>{t('시스템 로그')}</div>
						<div className={styles.log}>
							{decisions.map((d) => (
								<div key={`d-${d.id}`} className={styles.logRow}>
									<StatusDot color="violet" size={5} />
									<span className={`m ${styles.logText}`}>
										<span className={styles.logKind} title={t('AI 판정 근거 — 서버 재시작해도 안 지워짐')}>
											{t(DECISION_LABEL[d.kind] || d.kind)}
										</span>
										{d.reason}
									</span>
									<span className={styles.logTime}>{timeAgo(d.created_at)}</span>
								</div>
							))}
							{orch.log
								.slice()
								.reverse()
								.map((l, i) => (
									<div key={`a-${i}`} className={styles.logRow}>
										<StatusDot color={l.dot as DotColor} size={5} />
										<span className={`m ${styles.logText}`}>{l.t}</span>
									</div>
								))}
						</div>
					</>
				)}
			</div>
		</div>
	)
}
