import { useEffect, useRef, useState } from 'react'
import { useSessionsStore, getOrchestration } from '../../store/useSessionsStore'
import type { FeedKind, Decision, DecisionKind } from '../../api/sessions'
import { getDecisions } from '../../api/sessions'
import StatusDot from '../common/StatusDot'
import type { DotColor } from '../common/StatusDot'
import XTerm from '../terminal/XTerm'
import styles from './OrchestratorPane.module.css'

const KIND_LABEL: Record<FeedKind, string> = { plan: '계획', dispatch: '지시', result: '보고', msg: '메시지', error: '오류' }
const DECISION_LABEL: Record<DecisionKind, string> = { repo_assign: '② 레포 분류', repo_verify_hold: '② 레포 재확인', kind_judge: '⑤ kind 판단', review_verdict: '⑧ 리뷰 판정' }

function timeAgo(ts: number) {
	const min = Math.floor((Date.now() - ts) / 60000)
	if (min < 1) return '방금'
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

	return (
		<div className={styles.wrap}>
			<div className={styles.head}>
				<StatusDot color={orch.running ? 'green' : 'muted'} pulse={orch.running} />
				<span className={styles.state}>{orch.running ? '조율 중' : '대기'}</span>
				<span className={`m ${styles.meta}`}>{orch.sessions.length}개 세션 · 웨이브 {orch.currentWaveIndex + 1}</span>
				<div style={{ flex: 1 }} />
				{orch.running && (
					<>
						<button className={styles.btn} disabled={busy} onClick={() => advance(folderId)}>
							▶ 진행
						</button>
						<button className={styles.btn} disabled={busy} onClick={() => stop(folderId)}>
							중지
						</button>
					</>
				)}
				{orch.conductor && (
					<button className={styles.btn} disabled={busy} onClick={() => stopConductor(folderId)}>
						지휘자 중지
					</button>
				)}
			</div>

			{orch.conductor ? (
				<div className={styles.termHost}>
					<XTerm session={orch.conductor.session} cwd={orch.conductor.cwd} modelLabel={orch.conductor.modelLabel} />
				</div>
			) : (
				<div className={styles.starting}>클로드 세션 시작 중…</div>
			)}

			<div className={styles.pad}>
				{orch.sessions.length > 0 && (
					<div className={styles.sessions}>
						{orch.sessions.map((s) => (
							<div key={s.taskId} className={`m ${styles.sessionRow}`}>
								<span className={styles.sessionDot} />
								{s.tmuxSession}
							</div>
						))}
					</div>
				)}

				{orch.conductor && (
					<>
						<div className={styles.logLabel}>대화 로그</div>
						<div className={styles.feedList}>
							{orch.feed.length === 0 && <div className={styles.logEmpty}>아직 대화 없음</div>}
							{orch.feed.map((e, i) => (
								<div key={i} className={styles.feedRow}>
									<div className={`m ${styles.feedMeta}`}>
										<span className={styles.feedFrom}>{e.from}</span>
										<span className={styles.feedArrow}>→</span>
										<span className={styles.feedTo}>{e.to}</span>
										<span className={`${styles.feedKind} ${styles[`kind_${e.kind}`]}`}>{KIND_LABEL[e.kind] || '메시지'}</span>
										<span className={styles.feedTime}>{timeAgo(e.ts)}</span>
									</div>
									<div className={styles.feedText}>{e.text}</div>
								</div>
							))}
						</div>
					</>
				)}

				{decisions.length > 0 && (
					<>
						<div className={styles.logLabel} title="AI 판정 근거 — 서버 재시작해도 안 지워짐(feed와 다름)">
							판정 로그
						</div>
						<div className={styles.feedList}>
							{decisions.map((d) => (
								<div key={d.id} className={styles.feedRow}>
									<div className={`m ${styles.feedMeta}`}>
										<span className={`${styles.feedKind} ${styles.kind_plan}`}>{DECISION_LABEL[d.kind] || d.kind}</span>
										<span className={styles.feedTime}>{timeAgo(d.created_at)}</span>
									</div>
									<div className={styles.feedText}>{d.reason}</div>
								</div>
							))}
						</div>
					</>
				)}

				<div className={styles.logLabel}>활동 로그</div>
				<div className={styles.log}>
					{orch.log.length === 0 && <div className={styles.logEmpty}>아직 활동 없음</div>}
					{orch.log
						.slice()
						.reverse()
						.map((l, i) => (
							<div key={i} className={styles.logRow}>
								<StatusDot color={l.dot as DotColor} size={5} />
								<span className={`m ${styles.logText}`}>{l.t}</span>
							</div>
						))}
				</div>
			</div>
		</div>
	)
}
