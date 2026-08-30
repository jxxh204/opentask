import { useEffect, useRef, useState } from 'react'
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
export default function OrchestratorPane({ folderId }: { folderId: string }) {
	const t = useT()
	const orch = useSessionsStore((s) => getOrchestration(s, folderId))
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

				{/* "대화 로그가 그냥 평문 나열이라 안 읽힘" — 지휘자↔서브태스크·오퍼레이터 사이 실제 오간
				    대화라 이 패널에서 가장 자주, 가장 먼저 읽는 정보다. BranchChain의 시그널 레일과 같은
				    타임라인 지오메트리를 빌려 순서를 눈으로 따라갈 수 있게 하고, 각 항목을 흐르는 평문이
				    아니라 자기 카드로 담아 종류(kind)별 색이 레일 노드+칩 두 군데서 동시에 신호한다. */}
				{orch.conductor && (
					<>
						<div className={styles.logLabel}>{t('대화 로그')}</div>
						{orch.feed.length === 0 ? (
							<div className={styles.logEmpty}>{t('아직 대화 없음')}</div>
						) : (
							<div className={styles.feedTimeline}>
								<div className={styles.feedRail} />
								{orch.feed.map((e, i) => (
									<div key={i} className={styles.feedEntry}>
										<span className={`${styles.feedNode} ${styles[`node_${e.kind}`]}`} />
										<div className={styles.feedCard}>
											<div className={`m ${styles.feedMeta}`}>
												<span className={styles.feedFrom}>{e.from}</span>
												<span className={styles.feedArrow}>→</span>
												<span className={styles.feedTo}>{e.to}</span>
												<span className={`${styles.feedKind} ${styles[`kind_${e.kind}`]}`}>{t(KIND_LABEL[e.kind] || '메시지')}</span>
												<span className={styles.feedTime}>{timeAgo(e.ts)}</span>
											</div>
											<div className={styles.feedText}>{e.text}</div>
										</div>
									</div>
								))}
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
