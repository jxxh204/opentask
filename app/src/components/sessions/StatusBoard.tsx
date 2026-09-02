import { useEffect, useRef, useState } from 'react'
import { getBoardStatus } from '../../api/sessions'
import type { BoardStatusItem, BoardStatusPr, SubtaskWorkStatus } from '../../api/sessions'
import { openTaskOrFolderDetail, useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { useBrowserNavStore } from '../../store/useBrowserNavStore'
import { useT, useTp, translate } from '../../utils/i18n'
import { HELP } from './TaskRow'
import styles from './StatusBoard.module.css'
import taskRowStyles from './TaskRow.module.css'

// "이런 현황판? 현재 상황을 바로 볼 수 있는? ... 각 메인태스크의 현재 진행중인 서브태스크와 그것을
// 확인할 수 있는 html파일이나 url화면과 같은 실제로 개발자의 눈으로 검증할 수 있는 요소" —
// 태스크에 연결(클릭하면 태스크상세로), 깊은 내용(PR·커밋 등)은 그 상세 패널이 이미 담당하니 여기는
// "지금 뭐가 돌고 있고 어디서 눈으로 확인하나"만 압축해서 보여준다. 자리는 주캘린더 하단 절반
// (§ CalendarPane.tsx).
//
// "한눈에 안 들어옴 / 막힘·정체 신호 부재 / 정보 밀도가 낮음" — 재설계 핵심. 기존엔 3열 표(태스크명·
// 진행중·완료) 한 줄이라 전부 동급으로 평평하게 보였다. 이제는 "지금 사람이 봐야 할 것부터" 정렬한
// 세로 카드 목록 — blocked(확정 개입 필요) → stalled(추정 정체) → alive(정상 진행) → idle(진행중
// 없음) 순. 마커 색·펄스·아이콘은 새로 만들지 않고 TaskRow.module.css의 subChainDot* 그대로 재사용
// (§ CalendarPane.tsx subChainDotKey와 동일 관례 — 사이드바·캘린더·현황판 셋이 항상 같은 픽셀).
// 현황판은 지금 화면에 열려 있지 않은 다른 태스크의 카드도 함께 보여준다 — openOrFocusTab만
// 호출하면 activeNodeId가 안 바뀌어 탭이 "보이지 않는 곳에" 열리고, 사용자 눈엔 버튼이 아무 반응도
// 없는 것처럼 보인다(§ openTaskOrFolderDetail·SubtaskDetailPanel openSession과 동일하게 setActiveNode
// 로 먼저 그 폴더 워크스페이스로 전환한 뒤에 탭을 열어야 한다).
function openVerifyUrl(folderId: string, url: string) {
	useTabsStore.getState().setActiveNode(folderId, 'orchestrator')
	useTabsStore.getState().openOrFocusTab(folderId, 'browser')
	useBrowserNavStore.getState().request(folderId, url)
}

function timeAgo(ts: number) {
	const min = Math.floor((Date.now() - ts) / 60000)
	if (min < 1) return translate('방금')
	if (min < 60) return `${min}분 전`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}시간 전`
	return `${Math.floor(hr / 24)}일 전`
}

// PR은 github.com 링크라 인앱 브라우저가 아니라 시스템 기본 브라우저로(§ TaskRow.tsx PR 뱃지와
// 같은 관례 — target="_blank"를 electron/main.cjs의 setWindowOpenHandler가 가로챈다).
function PrPill({ pr }: { pr: BoardStatusPr }) {
	return (
		<a href={pr.url} target="_blank" rel="noreferrer" className={pr.draft ? styles.prPillDraft : styles.prPill} onClick={(e) => e.stopPropagation()}>
			{pr.draft ? `PR #${pr.number} draft` : `PR #${pr.number}`}
		</a>
	)
}
function GitInfo({ branch, pr }: { branch: string | null; pr: BoardStatusPr | null }) {
	if (!branch && !pr) return null
	return (
		<div className={styles.gitRow}>
			{branch && (
				<span className={styles.branchText} title={branch}>
					⎇ {branch}
				</span>
			)}
			{pr && <PrPill pr={pr} />}
		</div>
	)
}

type Urgency = 'blocked' | 'stalled' | 'alive' | 'idle'
const URGENCY_RANK: Record<Urgency, number> = { blocked: 0, stalled: 1, alive: 2, idle: 3 }
const MARKER_CLASS: Record<Urgency, string> = {
	blocked: taskRowStyles.subChainDotAlert,
	stalled: taskRowStyles.subChainDotStalled,
	alive: taskRowStyles.subChainDotAlive,
	idle: styles.markerIdle,
}
const URGENCY_LABEL: Record<'blocked' | 'stalled', string> = { blocked: '도움 필요', stalled: '정체' }
// "여기 들어가는 정보들이 여러 단계에서 적용되어야할것같은데 서브태스크, 메인태스크, 하이브마인드가
// 만들어갈 수 있도록" — note는 특정 서브태스크가 아니라 태스크 매니저(지휘자)나 하이브마인드가 종합한
// 관점(§ orchestrator.cjs reportTaskVerify). 누가 보고했는지 라벨로 남긴다 — 안 그러면 "여러 단계가
// 함께 만든다"는 게 안 보인다.
const NOTE_SOURCE_LABEL: Record<'conductor' | 'hivemind', string> = { conductor: '태스크 매니저', hivemind: '하이브마인드' }

// blocked는 report-blocked로 스스로 보고한 확정 신호, stalled는 침묵 추정 신호 — 항상 blocked를
// 먼저 본다(§ orchestrator.cjs checkStalledSubtasks: "이미 명시적으로 막힘 보고됨 — 중복 알림 방지"와
// 같은 우선순위). "업무가 어떻든간에" stalled는 세션이 살아있는 채로도 켜질 수 있어(§ 서버 주석) —
// alive를 stalled보다 먼저 보면 정체 신호가 영영 안 뜬다. CalendarPane.tsx의 subtaskRowState는
// alive를 먼저 봐서 이 문제가 있다 — 현황판은 "막힘/정체 신호 부재"를 고치는 게 목적이라 여기서는
// 순서를 바로잡는다(제일 시급한 두 신호부터).
function urgencyOf(item: BoardStatusItem, activeWork: SubtaskWorkStatus | undefined): Urgency {
	if (!item.active) return 'idle'
	if (activeWork?.blocked) return 'blocked'
	if (activeWork?.stalled) return 'stalled'
	return 'alive'
}

function miniDotClass(w: SubtaskWorkStatus): string {
	if (w.blocked) return styles.miniBlocked
	if (w.stalled) return styles.miniStalled
	if (w.alive) return styles.miniAlive
	if (w.done) return styles.miniDone
	if (w.started) return styles.miniDead
	return styles.miniWaiting
}

export default function StatusBoard() {
	const t = useT()
	const tp = useTp()
	const [items, setItems] = useState<BoardStatusItem[]>([])
	const [loaded, setLoaded] = useState(false)
	const loadedRef = useRef(false)
	// 전역 15초 폴링(§ SessionShell의 refreshAllSubtaskWork)을 그대로 구독 — 사이드바/캘린더 일간뷰와
	// 완전히 같은 데이터라 현황판만의 별도 요청이 필요 없다.
	const subtaskWork = useSessionsStore((s) => s.subtaskWork)

	useEffect(() => {
		let cancelled = false
		let timer: ReturnType<typeof setTimeout>
		const tick = () => {
			getBoardStatus()
				.then((r) => {
					if (cancelled || !r.ok) return
					setItems(r.items)
					if (!loadedRef.current) {
						loadedRef.current = true
						setLoaded(true)
					}
				})
				.catch(() => {})
				.finally(() => {
					// 세션 생존·검증 자료 여부는 채팅만큼 자주 안 바뀐다 — 15초면 충분하고 트래픽도 덜 쓴다.
					if (!cancelled) timer = setTimeout(tick, 15000)
				})
		}
		tick()
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [])

	const decorated = items.map((item) => {
		const chain = subtaskWork[item.taskId] ?? []
		const activeWork = item.active ? chain.find((w) => w.id === item.active!.subtaskId) : undefined
		return { item, chain, activeWork, urgency: urgencyOf(item, activeWork) }
	})
	// "한눈에 안 들어옴" — 지금 사람이 봐야 할 것부터: blocked → stalled → alive → idle. Array.sort는
	// stable이라 같은 등급 안에서는 원래 순서(폴더 등록 순) 그대로 유지된다.
	const sorted = [...decorated].sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency])
	const counts = decorated.reduce(
		(acc, d) => {
			if (d.urgency === 'blocked' || d.urgency === 'stalled' || d.urgency === 'alive') acc[d.urgency]++
			return acc
		},
		{ blocked: 0, stalled: 0, alive: 0 },
	)

	return (
		<div className={styles.wrap}>
			<div className={styles.head}>
				<span>{t('현황판')}</span>
				{loaded && items.length > 0 && (
					<div className={styles.headCounts}>
						{counts.blocked > 0 && (
							<span className={`${styles.countChip} ${styles.countBlocked}`}>
								{t('도움 필요')} {counts.blocked}
							</span>
						)}
						{counts.stalled > 0 && (
							<span className={`${styles.countChip} ${styles.countStalled}`}>
								{t('정체')} {counts.stalled}
							</span>
						)}
						<span className={`${styles.countChip} ${styles.countAlive}`}>
							{t('진행 중')} {counts.alive}
						</span>
					</div>
				)}
			</div>
			<div className={styles.body}>
				{loaded && items.length === 0 && <div className={styles.empty}>{t('지금 진행 중이거나 최근 완료된 서브태스크가 없습니다.')}</div>}
				{sorted.map(({ item, chain, activeWork, urgency }) => (
					<div key={item.taskId} className={styles.card} onClick={() => openTaskOrFolderDetail(item.taskId)}>
						<span className={`${taskRowStyles.subChainDot} ${MARKER_CLASS[urgency]} ${styles.markerReset}`}>{urgency === 'blocked' ? HELP : null}</span>
						<div className={styles.cardBody}>
							<div className={styles.cardHead}>
								<span className={styles.taskName} title={item.taskName}>
									{item.taskName}
								</span>
								{(urgency === 'blocked' || urgency === 'stalled') && (
									<span className={`${styles.urgencyChip} ${urgency === 'blocked' ? styles.chipBlocked : styles.chipStalled}`}>{URGENCY_LABEL[urgency]}</span>
								)}
								{chain.length > 1 && (
									<div className={styles.miniChain}>
										{chain.map((w) => (
											<span key={w.id} className={`${styles.miniDot} ${miniDotClass(w)}`} title={w.name} />
										))}
									</div>
								)}
							</div>

							{item.note && (
								<div className={styles.noteLine}>
									<span className={styles.noteSource}>{NOTE_SOURCE_LABEL[item.note.source]}</span>
									<span className={styles.noteText} title={item.note.text}>
										{item.note.text}
									</span>
									{item.note.url && (
										<button
											type="button"
											className={styles.verifyBtnGhost}
											onClick={(e) => {
												e.stopPropagation()
												openVerifyUrl(item.folderId, item.note!.url!)
											}}
										>
											{t('확인하기')}
										</button>
									)}
								</div>
							)}

							{item.active ? (
								<>
									<div className={styles.primaryLine}>
										<span className={styles.subtaskText} title={item.active.subtaskName}>
											{item.active.subtaskName}
										</span>
										{item.active.verifyUrl ? (
											<button
												type="button"
												className={styles.verifyBtn}
												onClick={(e) => {
													e.stopPropagation()
													openVerifyUrl(item.folderId, item.active!.verifyUrl!)
												}}
											>
												{t('확인하기')}
											</button>
										) : !item.active.verifyText ? (
											<span className={styles.hint}>{t('검증 자료 없음')}</span>
										) : null}
									</div>
									{item.active.verifyText && (
										<div className={styles.verifyTextRow} title={item.active.verifyText}>
											{item.active.verifyText}
										</div>
									)}
									{activeWork?.blockedReason && (
										<div className={styles.blockedReasonRow} title={activeWork.blockedReason}>
											{t('도움 요청')}: {activeWork.blockedReason}
										</div>
									)}
									<GitInfo branch={item.active.branch} pr={item.active.pr} />
								</>
							) : (
								<div className={styles.primaryLine}>
									<span className={styles.hint}>{t('진행 중인 서브태스크 없음')}</span>
								</div>
							)}

							{item.lastDone && (
								<div className={styles.doneLine}>
									<span className={styles.dotDoneMini} />
									<span className={styles.doneText} title={item.lastDone.subtaskName}>
										{tp('완료: {name}', { name: item.lastDone.subtaskName })} · {timeAgo(item.lastDone.endedAt)}
									</span>
									<button
										type="button"
										className={styles.verifyBtnGhost}
										onClick={(e) => {
											e.stopPropagation()
											openVerifyUrl(item.folderId, item.lastDone!.reportUrl)
										}}
									>
										{t('리포트 보기')}
									</button>
								</div>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
