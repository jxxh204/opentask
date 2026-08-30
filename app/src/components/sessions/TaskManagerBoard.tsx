import { useEffect, useState } from 'react'
import type { Task, Subtask } from '../../store/types'
import type { SubtaskWorkStatus } from '../../api/sessions'
import { getSubtaskWorkState } from '../../api/sessions'
import { useTabsStore } from '../../store/useTabsStore'
import { addBusinessDays } from '../../utils/businessDays'
import { useT } from '../../utils/i18n'
import styles from './TaskManagerBoard.module.css'

// "태스크 매니저(오케스트레이터가 아닌)" — 지휘자 터미널·대화 로그(OrchestratorPane 본문)와는 다른,
// 이 태스크의 서브태스크 체인을 왼쪽→오른쪽 조립 라인처럼 보여주는 요약판. 실제 코드 작업은 전부
// 서브태스크 단위 워크트리에서만 일어나야 하므로(메인 태스크 자신은 오케스트레이션만), 여기서
// "서브태스크가 뭐가 있고 워크트리가 뭔지 어떤 작업을 했는지"를 한눈에 확인할 수 있게 한다.
// task.subtasks가 바뀌면(생성/삭제) props가 바뀌어 자동으로 다시 그려진다 — 별도 갱신 로직 불필요.
//
// "구글 개발자가 포스트잇을 붙여가며 그래프를 그리듯" — 화이트보드 위 계획 스케치를 은유하되(옅은
// 점자 배경, 살짝 기운 포스트잇, 접힌 모서리) "더 전문적인 디자인"이라는 요청에 맞춰 장식은 최소로
// 절제한다 — 색은 여전히 이 앱의 시맨틱 팔레트(violet/green/amber)만 쓰고, 손글씨 폰트나 낙서체는
// 쓰지 않는다.
function StatusPin({ st }: { st: SubtaskWorkStatus | undefined }) {
	const t = useT()
	if (!st || !st.started) return <span className={`${styles.pin} ${styles.pinIdle}`} title={t('대기')} />
	if (st.alive) return <span className={`${styles.pin} ${styles.pinAlive}`} title={t('진행 중')} />
	return <span className={`${styles.pin} ${styles.pinDone}`} title={t('세션 종료')} />
}

// TaskDetailModal의 "~ M월 D일 종료" 표기와 같은 규칙 — 기간이 잡혀있을 때만 보여준다.
function periodLabel(st: Subtask) {
	if (!st.due_date) return null
	const start = new Date(st.due_date)
	const startLabel = `${start.getMonth() + 1}/${start.getDate()}`
	if (!st.duration_days || st.duration_days <= 1) return startLabel
	const end = new Date(addBusinessDays(st.due_date, st.duration_days))
	return `${startLabel} ~ ${end.getMonth() + 1}/${end.getDate()}`
}

// 손으로 살짝 붙인 듯한 느낌 — 완전 랜덤이면 리렌더마다 흔들리므로 인덱스 기반 고정 패턴(3칸 주기로
// -1.1deg/0.4deg/1.3deg 반복)만 쓴다. 과하지 않게 절제된 각도.
const TILTS = [-1.1, 0.6, 1.3, -0.7]
function tiltFor(i: number) {
	return TILTS[i % TILTS.length]
}

// 노트 사이를 잇는 연결선 — 화살표 텍스트 대신, 손으로 그은 듯 살짝 휜 SVG 곡선 커넥터(고정 크기라
// flex 레이아웃 안에서 위치 계산 없이 그냥 끼워 넣을 수 있다).
function Connector() {
	return (
		<svg className={styles.connector} width="30" height="16" viewBox="0 0 30 16" fill="none">
			<path d="M1 12C8 12 10 4 29 4" stroke="var(--t3)" strokeWidth="1.6" strokeLinecap="round" />
			<path d="M23 1L29 4L23 8" stroke="var(--t3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
		</svg>
	)
}

function TaskLane({ task }: { task: Task }) {
	const t = useT()
	const activeNodeId = useTabsStore((s) => s.activeNodeId)
	const openSubtaskTab = useTabsStore((s) => s.openSubtaskTab)
	const [work, setWork] = useState<SubtaskWorkStatus[]>([])

	useEffect(() => {
		let cancelled = false
		async function poll() {
			const r = await getSubtaskWorkState(task.id)
			if (!cancelled && r.ok) setWork(r.subtasks)
		}
		poll()
		const id = window.setInterval(poll, 5000)
		return () => {
			cancelled = true
			window.clearInterval(id)
		}
	}, [task.id])

	return (
		<div className={styles.lane}>
			<div className={styles.laneHead}>{task.name}</div>
			{task.subtasks.length === 0 ? (
				<div className={styles.empty}>{t('아직 서브태스크 없음 — AI 검토가 끝나면 자동 생성되거나, 상세페이지에서 직접 추가할 수 있습니다.')}</div>
			) : (
				<div className={styles.board}>
					<div className={styles.chain}>
						{task.subtasks.map((st, i) => {
							const w = work.find((x) => x.id === st.id)
							const period = periodLabel(st)
							return (
								<div key={st.id} className={styles.step}>
									{i > 0 && <Connector />}
									<div
										className={styles.note}
										style={{ transform: `rotate(${tiltFor(i)}deg)` }}
										onClick={() => activeNodeId && openSubtaskTab(activeNodeId, st.id, task.id, st.name)}
										title={t('클릭하면 이 서브태스크의 세션 탭이 열립니다')}
									>
										<StatusPin st={w} />
										<div className={styles.noteName}>{st.name}</div>
										<div className={styles.noteWorktree} title={w?.worktreePath || undefined}>
											{w?.worktreePath ? w.worktreePath.split('/').slice(-1)[0] : t('worktree 없음')}
										</div>
										{w?.branch && <div className={styles.noteBranch}>⎇ {w.branch}</div>}
										{period && <div className={styles.notePeriod}>{period}</div>}
										<div className={styles.popover}>
											<div className={styles.popoverLabel}>{st.name}</div>
											<div className={styles.popoverText}>{st.desc || t('설명 없음')}</div>
										</div>
									</div>
								</div>
							)
						})}
					</div>

					{/* "전체화면을 사용해서 내용을 구체적으로 표현해줘" — 위 조립 라인은 한눈에 훑는 용도라
					    설명이 호버 팝오버에 숨어 있다. 그 아래 남는 큰 공간을 실제 정보로 채우는 상세
					    타임라인 — 이름·설명 전문·워크트리 전체 경로·브랜치·기간·상태를 전부 펼쳐 보여준다. */}
					<div className={styles.timeline}>
						{task.subtasks.map((st, i) => {
							const w = work.find((x) => x.id === st.id)
							const period = periodLabel(st)
							return (
								<div key={st.id} className={styles.timelineRow}>
									<div className={styles.timelineRail}>
										<span className={styles.timelineIndex}>{i + 1}</span>
										{i < task.subtasks.length - 1 && <span className={styles.timelineLine} />}
									</div>
									<div className={styles.timelineBody}>
										<div className={styles.timelineHead}>
											<span className={styles.timelineName}>{st.name}</span>
											<StatusPin st={w} />
											{period && <span className={styles.timelinePeriod}>{period}</span>}
										</div>
										<p className={styles.timelineDesc}>{st.desc || t('설명 없음')}</p>
										<div className={styles.timelineMeta}>
											<span>worktree: {w?.worktreePath || t('아직 없음')}</span>
											{w?.branch && <span>⎇ {w.branch}</span>}
										</div>
									</div>
								</div>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}

export default function TaskManagerBoard({ tasks }: { tasks: Task[] }) {
	if (!tasks.length) return null
	return (
		<div className={styles.wrap}>
			{tasks.map((t) => (
				<TaskLane key={t.id} task={t} />
			))}
		</div>
	)
}
