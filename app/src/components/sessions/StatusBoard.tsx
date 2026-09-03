import { useEffect, useRef, useState } from 'react'
import { getBoardStatus } from '../../api/sessions'
import type { BoardStatusItem, BoardStatusPr, SubtaskWorkStatus, VerifyItem } from '../../api/sessions'
import { openTaskOrFolderDetail, useSessionsStore } from '../../store/useSessionsStore'
import { useGlobalTabsStore } from '../../store/useGlobalTabsStore'
import { useT, useTp } from '../../utils/i18n'
import { timeAgoLong as timeAgo } from '../../utils/timeAgo'
import { HELP } from './TaskRow'
import styles from './StatusBoard.module.css'
import taskRowStyles from './TaskRow.module.css'

// "이런 현황판? 현재 상황을 바로 볼 수 있는? ... 각 메인태스크의 현재 진행중인 서브태스크와 그것을
// 확인할 수 있는 html파일이나 url화면과 같은 실제로 개발자의 눈으로 검증할 수 있는 요소" —
// 태스크에 연결(클릭하면 태스크상세로), 깊은 내용(PR·커밋 등)은 그 상세 패널이 이미 담당하니 여기는
// "지금 뭐가 돌고 있고 어디서 눈으로 확인하나"만 압축해서 보여준다. 자리는 주캘린더 하단 절반
// (§ CalendarPane.tsx).
//
// "실제 현실에서 사용하는 현황판을 모티브로 유저들이 빠르게 접근할수있도록" — 마티가 보여준 실제
// 화이트보드 칸반(TO DO/WIP/HOLDING/DONE 4단, 프로젝트별 색 스티키노트, 카드마다 번호·체크리스트·
// 날짜)을 그대로 옮긴다. 예전엔 urgency로 정렬한 세로 카드 목록 하나였는데("한눈에 안 들어옴" 재설계
// 1차), 칸반은 "카드가 지금 어느 상태냐"를 위치 자체로 보여줘서 색 배지 하나 읽는 것보다 더 빨리
// 꽂힌다. 마커 색·펄스·아이콘은 새로 만들지 않고 TaskRow.module.css의 subChainDot* 그대로 재사용
// (§ CalendarPane.tsx subChainDotKey와 동일 관례 — 사이드바·캘린더·현황판이 항상 같은 픽셀).
// "캘린더에서 스토리북 링크를 누르면 탭으로 넘어가서 다시 돌아오기 귀찮아지는데 크롬의 탭 폴더관리
// 처럼" — 예전엔 setActiveNode로 그 태스크의 워크스페이스 자체로 화면을 통째로 바꿨다("확인하기 눌러도
// 반응 없음"을 고치려고 넣었던 것인데, 이번엔 "원래 보던 캘린더가 사라진다"는 새 불만으로 이어졌다).
// 이제 노드에 안 묶인 전역 브라우저 탭(§ useGlobalTabsStore)을 연다 — 현재 화면은 그대로 두고 탭
// 스트립에 새 탭만 뜬다. "각 프로젝트 별로 폴더처럼 관리되어야해 — 크롬에서 사용하는걸 예시로
// 들어줬자나" — groupName/groupColor로 어느 태스크에서 연 탭인지 크롬 탭 그룹처럼 묶어 보여준다.
function openVerifyUrl(folderId: string, url: string, title: string | undefined, groupName: string, groupColor: string | null) {
	useGlobalTabsStore.getState().openBrowserTab(title || url, url, folderId, groupName, groupColor)
}

// TO DO 카드의 예정일 — 화이트보드 스티키노트의 "FEB-26" 같은 짧은 날짜 라벨과 같은 자리.
function formatDueDate(ms: number) {
	const d = new Date(ms)
	return `${d.getMonth() + 1}/${d.getDate()}`
}

// PR은 github.com 링크라 인앱 브라우저가 아니라 시스템 기본 브라우저로(§ TaskRow.tsx PR 뱃지와
// 같은 관례 — target="_blank"를 electron/main.cjs의 setWindowOpenHandler가 가로챈다).
// "현황판에 각 색상도 담아서 빠르게 인지가능하게" — pr.ci(pass/fail/pending/none, § prs.cjs
// ciSummary)는 원래도 데이터엔 있었지만 화면 어디에도 안 그려지고 있었다. 색 점 하나로 훑어보기만
// 해도 CI 상태가 바로 보이게 — urgency 마커(§ MARKER_CLASS)와 같은 팔레트(red/amber/green)를 쓴다.
const CI_LABEL: Record<string, string> = { pass: 'CI 통과', fail: 'CI 실패', pending: 'CI 진행 중' }
function CiDot({ ci }: { ci: string | null }) {
	if (!ci || ci === 'none') return null
	const cls = ci === 'pass' ? styles.ciDotPass : ci === 'fail' ? styles.ciDotFail : styles.ciDotPending
	return <span className={`${styles.ciDot} ${cls}`} title={CI_LABEL[ci] ?? ci} />
}
function PrPill({ pr }: { pr: BoardStatusPr }) {
	return (
		<a href={pr.url} target="_blank" rel="noreferrer" className={pr.draft ? styles.prPillDraft : styles.prPill} onClick={(e) => e.stopPropagation()}>
			<CiDot ci={pr.ci} />
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

// "확인하기 한가지 말고 여러가지로 보여줘야할듯해" — verifyItems/notes 둘 다 이제 배열이라 항목 하나당
// 이 한 줄(설명 + 있으면 확인 버튼)을 반복해서 그린다. sourceLabel이 있으면(=notes, 태스크 전체 관점)
// 기존 .noteLine 박스(violet 톤 — "지휘/조율" 전용 색, § 위 NOTE_SOURCE_LABEL 주석)를, 없으면(=서브
// 태스크 자신의 verifyItems) 그 색과 안 섞이는 중립 톤 .verifyItemRow를 쓴다.
function VerifyRow({
	folderId,
	item,
	sourceLabel,
	groupName,
	groupColor,
}: {
	folderId: string
	item: VerifyItem
	sourceLabel?: string
	groupName: string
	groupColor: string | null
}) {
	const t = useT()
	return (
		<div className={sourceLabel ? styles.noteLine : styles.verifyItemRow}>
			{sourceLabel && <span className={styles.noteSource}>{sourceLabel}</span>}
			{item.text && (
				<span className={styles.noteText} title={item.text}>
					{item.text}
				</span>
			)}
			{item.url && (
				<button
					type="button"
					className={styles.verifyBtnGhost}
					onClick={(e) => {
						e.stopPropagation()
						openVerifyUrl(folderId, item.url!, item.text ?? undefined, groupName, groupColor)
					}}
				>
					{t('확인하기')}
				</button>
			)}
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
// alive를 stalled보다 먼저 보면 정체 신호가 영영 안 뜬다.
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

// "TO DO / WIP / HOLDING / DONE" — 화이트보드 칸반의 4단 그대로. urgency(서브태스크 하나의 지금
// 상태)와는 다른 축이다 — column은 "이 태스크 카드를 어디에 붙일까"를 정한다.
type Column = 'todo' | 'wip' | 'holding' | 'done'
const COLUMNS: { key: Column; label: string }[] = [
	{ key: 'todo', label: 'TO DO' },
	{ key: 'wip', label: 'WIP' },
	{ key: 'holding', label: 'HOLDING' },
	{ key: 'done', label: 'DONE' },
]
const COLUMN_HEAD_CLASS: Partial<Record<Column, string>> = { holding: styles.columnHeadHolding, wip: styles.columnHeadWip }
function columnOf(item: BoardStatusItem, urgency: Urgency): Column {
	if (urgency === 'blocked' || urgency === 'stalled') return 'holding'
	if (urgency === 'alive') return 'wip'
	if (item.lastDone) return 'done'
	return 'todo' // 세션도 완료 리포트도 없이 note(taskVerify)만 있는 드문 경우 — 아직 "시작 전" 취급.
}

// 캘린더가 보여주는 태스크의 이름·색·예정일(§ CalendarPane.tsx visibleTaskIds 계산부) — 현황판이
// "이번 주에 걸린 태스크"를 캘린더와 항상 같은 기준으로 알기 위해 필요하다. TO DO 카드(아직 세션을
// 하나도 안 띄운 태스크)는 getBoardStatus가 아예 모르는 태스크라, 이름·색을 여기서 받아야만 그릴 수
// 있다.
export interface VisibleTaskMeta {
	name: string
	color: string | null
	dueDate: number | null
}

interface BoardEntry {
	key: string
	taskId: string
	taskName: string
	color: string | null
	dueDate: number | null
	item: BoardStatusItem | null
	chain: SubtaskWorkStatus[]
	activeWork: SubtaskWorkStatus | undefined
	urgency: Urgency
	column: Column
}

// "태스크하나를 색하나로 보여주는거야" — CalendarPane.tsx가 캘린더 칩에 쓰는 것과 같은 관례
// (color-mix로 옅게 섞기, 진한 배경으로 덮어쓰지 않음) — 위 캘린더와 아래 현황판이 같은 태스크를
// 항상 같은 색으로 보여준다.
// "마우스 포인터 반응 색상 조정 좀 해줘 — 뭐가 눌러지는건지 모르겠어" — 처음엔 background를 인라인
// style로 직접 넣었는데, 인라인 style은 항상 stylesheet의 :hover보다 우선한다(CSS 명시도 규칙) —
// 그래서 색 있는 카드는 마우스를 올려도 .card:hover의 배경 변화가 절대 안 보였다. 색 값 자체만
// CSS 변수로 건네고, 실제 배경 계산(평상시/호버 둘 다)은 .module.css의 color-mix()가 하게 해서
// :hover가 다시 먹게 한다.
function cardAccentStyle(color: string | null): React.CSSProperties | undefined {
	return color ? ({ '--card-accent': color } as React.CSSProperties) : undefined
}

// "위계정리와 정보의 중복이 존재" — 노트(태스크 종합 관점)와 서브태스크 자신의 verifyItems가 각자
// 박스 하나씩 차지해 카드가 절반 넘게 "확인 리스트"로 덮였다. 출처 신뢰도 순(종합 관점인 note가
// 서브태스크 자신의 단발 보고보다 먼저)으로 한 목록에 합쳐, 제일 앞의 하나만 본문 굵기로 보여주고
// 나머지는 조용한 "N개 더" 텍스트로 접는다 — 스퀸트 테스트에서 "지금 뭘 봐야 하는지" 하나로 답이
// 나오게.
interface VerifyEntry {
	item: VerifyItem
	sourceLabel?: string
}
function collectVerifyEntries(item: BoardStatusItem | null): VerifyEntry[] {
	if (!item) return []
	const notes = item.notes.map((n) => ({ item: n, sourceLabel: NOTE_SOURCE_LABEL[n.source] }))
	const subtaskItems = item.active?.verifyItems.map((v) => ({ item: v })) ?? []
	return [...notes, ...subtaskItems]
}

function Card({ entry }: { entry: BoardEntry }) {
	const t = useT()
	const tp = useTp()
	const [expanded, setExpanded] = useState(false)
	const { taskId, taskName, color, dueDate, item, chain, activeWork, urgency, column } = entry
	const [primaryVerify, ...restVerify] = collectVerifyEntries(item)
	return (
		<div className={styles.card} style={cardAccentStyle(color)} onClick={() => openTaskOrFolderDetail(taskId)}>
			<span className={`${taskRowStyles.subChainDot} ${MARKER_CLASS[urgency]} ${styles.markerReset}`}>{urgency === 'blocked' ? HELP : null}</span>
			<div className={styles.cardBody}>
				<div className={styles.cardHead}>
					<span className={styles.taskName} title={taskName}>
						{taskName}
					</span>
					{column === 'holding' && (
						<span className={`${styles.urgencyChip} ${urgency === 'blocked' ? styles.chipBlocked : styles.chipStalled}`}>{URGENCY_LABEL[urgency as 'blocked' | 'stalled']}</span>
					)}
					{chain.length > 1 && (
						<div className={styles.miniChain}>
							{chain.map((w) => (
								<span key={w.id} className={`${styles.miniDot} ${miniDotClass(w)}`} title={w.name} />
							))}
						</div>
					)}
				</div>

				{item?.active && (
					<span className={styles.subtaskText} title={item.active.subtaskName}>
						{item.active.subtaskName}
					</span>
				)}

				{primaryVerify ? (
					<VerifyRow folderId={item!.folderId} item={primaryVerify.item} sourceLabel={primaryVerify.sourceLabel} groupName={taskName} groupColor={color} />
				) : (
					item?.active && <span className={styles.hint}>{t('검증 자료 없음')}</span>
				)}
				{restVerify.length > 0 &&
					(expanded ? (
						restVerify.map((v, i) => <VerifyRow key={i} folderId={item!.folderId} item={v.item} sourceLabel={v.sourceLabel} groupName={taskName} groupColor={color} />)
					) : (
						<button
							type="button"
							className={styles.moreLink}
							onClick={(e) => {
								e.stopPropagation()
								setExpanded(true)
							}}
						>
							{tp('확인 방법 {n}개 더', { n: restVerify.length })}
						</button>
					))}

				{item?.active && (
					<>
						{activeWork?.blockedReason && (
							<div className={styles.blockedReasonRow} title={activeWork.blockedReason}>
								{t('도움 요청')}: {activeWork.blockedReason}
							</div>
						)}
						<GitInfo branch={item.active.branch} pr={item.active.pr} />
					</>
				)}

				{item?.lastDone && (
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
								openVerifyUrl(item.folderId, item.lastDone!.reportUrl, tp('{name} 리포트', { name: item.lastDone!.subtaskName }), taskName, color)
							}}
						>
							{t('리포트 보기')}
						</button>
						<GitInfo branch={item.lastDone.branch} pr={item.lastDone.pr} />
					</div>
				)}

				{!item?.active && !item?.lastDone && (
					<div className={styles.primaryLine}>
						<span className={styles.hint}>{dueDate ? tp('예정 · {date}', { date: formatDueDate(dueDate) }) : t('진행 중인 서브태스크 없음')}</span>
					</div>
				)}
			</div>
		</div>
	)
}

// "현황판은 내가 보고있는 주의 업무만 보이게 해줘" — 지금 뭐가 돌고 있나 훑어보는 자리인데, 몇 주 전
// 태스크까지 계속 쌓여 있으면 지금 봐야 할 것과 안 섞이기 어렵다. 위 주캘린더가 보여주는 주(§
// CalendarPane.tsx weekDays)와 같은 창으로 좁힌다 — 그 창에 캘린더 항목이 하나도 없는 태스크(=지금
// 보고 있는 주에 일정이 없는 태스크)는 활동 중이어도 여기 안 보여준다.
export default function StatusBoard({ visibleTasks }: { visibleTasks?: Map<string, VisibleTaskMeta> }) {
	const t = useT()
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

	const visibleItems = visibleTasks ? items.filter((item) => visibleTasks.has(item.taskId)) : items
	const decorated: BoardEntry[] = visibleItems.map((item) => {
		const chain = subtaskWork[item.taskId] ?? []
		const activeWork = item.active ? chain.find((w) => w.id === item.active!.subtaskId) : undefined
		const urgency = urgencyOf(item, activeWork)
		const meta = visibleTasks?.get(item.taskId)
		return {
			key: item.taskId,
			taskId: item.taskId,
			taskName: item.taskName,
			color: meta?.color ?? null,
			dueDate: meta?.dueDate ?? null,
			item,
			chain,
			activeWork,
			urgency,
			column: columnOf(item, urgency),
		}
	})
	// "로컬서버, 스토리북 이런게 들어갈 자리가 있어야할까?"처럼 현황판은 원래 "볼 게 있는" 태스크만
	// 보여줬다(§ orchestrator.cjs getBoardStatus 주석) — 세션을 아예 안 띄운 태스크는 getBoardStatus
	// 응답에 없다. 칸반은 TO DO가 있어야 완성되니, 이번 주 일정엔 있지만 응답엔 없는 태스크를 여기서
	// 직접 만들어 넣는다(이름·색은 visibleTasks에서, 진행 상태는 처음부터 "아직 시작 전").
	const itemTaskIds = new Set(items.map((i) => i.taskId))
	const pureTodo: BoardEntry[] = visibleTasks
		? [...visibleTasks.entries()]
				.filter(([id]) => !itemTaskIds.has(id))
				.map(([id, meta]) => ({
					key: id,
					taskId: id,
					taskName: meta.name,
					color: meta.color,
					dueDate: meta.dueDate,
					item: null,
					chain: subtaskWork[id] ?? [],
					activeWork: undefined,
					urgency: 'idle' as Urgency,
					column: 'todo' as Column,
				}))
		: []
	const byColumn: Record<Column, BoardEntry[]> = { todo: [], wip: [], holding: [], done: [] }
	for (const e of [...decorated, ...pureTodo]) byColumn[e.column].push(e)
	// HOLDING 안에서는 blocked(확정 개입 필요)를 stalled(추정 정체)보다 먼저 — "한눈에 안 들어옴" 재설계
	// 때 정한 순서 그대로.
	byColumn.holding.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency])
	const totalCount = decorated.length + pureTodo.length

	return (
		<div className={styles.wrap}>
			<div className={styles.head}>
				<span>{t('현황판')}</span>
			</div>
			{loaded && totalCount === 0 && <div className={styles.empty}>{t('이번 주에 예정되었거나 진행 중이거나 최근 완료된 태스크가 없습니다.')}</div>}
			{loaded && totalCount > 0 && (
				<div className={styles.board}>
					{COLUMNS.map(({ key, label }) => (
						<div key={key} className={styles.column}>
							<div className={`${styles.columnHead} ${COLUMN_HEAD_CLASS[key] ?? ''}`}>
								<span>{label}</span>
								<span className={styles.columnCount}>{byColumn[key].length}</span>
							</div>
							<div className={styles.columnBody}>
								{byColumn[key].map((entry) => (
									<Card key={entry.key} entry={entry} />
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
