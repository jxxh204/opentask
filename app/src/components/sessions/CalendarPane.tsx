import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSessionsStore, openTaskOrFolderDetail } from '../../store/useSessionsStore'
import { useHolidayStore } from '../../store/useHolidayStore'
import { useUiStore } from '../../store/useUiStore'
import { useTabsStore } from '../../store/useTabsStore'
import { useBrowserNavStore } from '../../store/useBrowserNavStore'
import { useT, useTp, translate } from '../../utils/i18n'
import type { Task, BlockedPeriod } from '../../store/types'
import type { SubtaskWorkStatus } from '../../api/sessions'
import { businessDayRange } from '../../utils/businessDays'
import NewTaskModal from './NewTaskModal'
import BlockPeriodModal from './BlockPeriodModal'
import StatusBoard from './StatusBoard'
import { CHECK, HELP } from './TaskRow'
import styles from './CalendarPane.module.css'
import taskRowStyles from './TaskRow.module.css'

// "태스크 하나에 개발, 개발자테스트, QA, 배포 이런식으로 나뉠 수 있거든... 서브태스크 일정은
// 기존처럼 옮길수있어 각각 일정이 별도" — 캘린더가 실제로 그리는 최소 단위. 서브태스크가 예정일을
// 가지면 그 서브태스크들이 태스크의 진짜 일정이 되고(태스크 자신은 더 안 그림), 없으면 태스크
// 자신이 그대로 하나의 항목이 된다. "태스크하나를 색하나로... 각 단계를 같은색으로" — color는
// 항상 부모 태스크의 색이라 서브태스크별로 다르지 않다.
interface CalItem {
	id: string
	name: string
	parentName: string
	due_date: number | null
	duration_days: number | null
	completed_at: number | null
	color: string | null
	openId: string // 클릭 시 열 태스크 id(항상 부모 태스크)
	subtaskId: string | null // 이 항목이 서브태스크면 그 id(드래그로 예정일 바꿀 때 어느 API를 부를지 구분)
}
function taskToCalItem(t: Task): CalItem {
	return { id: t.id, name: t.name, parentName: t.name, due_date: t.due_date, duration_days: t.duration_days, completed_at: t.completed_at, color: t.color, openId: t.id, subtaskId: null }
}
function flattenCalendarItems(tasks: Task[]): CalItem[] {
	const items: CalItem[] = []
	for (const t of tasks) {
		const scheduled = t.subtasks.filter((st) => !!st.due_date)
		if (scheduled.length > 0) {
			// "메인 태스크의 기간은 전체 일정의 기간산정으로... 캘린더에 표기는 안되야할것같아" — 태스크
			// 자신의 마감일/기간은 이제 서브태스크 전체를 아우르는 자동 산정값(recomputeFromSubtasks)일
			// 뿐이라, 캘린더엔 서브태스크만 그린다(태스크 자신은 절대 안 그림 — 중복·혼동 방지).
			for (const st of scheduled) {
				items.push({
					id: st.id,
					name: st.name,
					parentName: t.name,
					due_date: st.due_date,
					duration_days: st.duration_days,
					// "서브태스크 완료 버튼 필요" — 서브태스크 자신이 완료 처리됐거나, 부모 태스크 전체가
					// 완료 처리됐으면(기존 동작 유지) 둘 다 done으로 그린다.
					completed_at: st.completed_at || t.completed_at,
					color: t.color,
					openId: t.id,
					subtaskId: st.id,
				})
			}
		} else {
			items.push(taskToCalItem(t))
		}
	}
	return items
}
// 태스크 자신에게 예정일이 있거나, 서브태스크 중 하나라도 예정일이 있으면 "일정이 있다"고 본다 —
// 안 그러면 서브태스크에만 날짜를 준 태스크가 "날짜 없음" 스트립에도 잘못 걸린다.
function hasSchedule(t: Task) {
	return !!t.due_date || t.subtasks.some((st) => !!st.due_date)
}

// "마우스를 올렸을때 팝오버로 현재 진행중인 작업이 보였으면 좋겠어" + "관련 메인태스크 하위로
// 서브태스크 쭉 나열하고 현재 마우스 올린 태스크 강조로" — 캘린더 칩 하나는 태스크의 서브태스크
// 체인 중 한 칸일 뿐이라, 그 칸만 보여주면 전체 진행 상황을 알 수 없다. 사이드바(TaskRow)의
// subChain 목록과 완전히 같은 데이터(subtaskWork, § refreshAllSubtaskWork 15초 폴링)로 그 태스크의
// 서브태스크 전체를 나열하고, 지금 가리키고 있는 칸만 강조 + 상세(브랜치/워크트리/막힌 이유/리포트)를
// 펼친다. 색·아이콘도 TaskRow.module.css의 subChainDot* 그대로 재사용 — 같은 상태는 사이드바와
// 항상 같은 픽셀로 보여야 한다.
type WorkRowState = 'alive' | 'blocked' | 'stalled' | 'done' | 'dead' | 'waiting'
function workStateLabel(state: WorkRowState): string {
	switch (state) {
		case 'alive':
			return translate('지금 실행 중')
		case 'blocked':
			return translate('도움 필요')
		case 'stalled':
			return translate('한동안 응답 없음')
		case 'done':
			return translate('완료 처리됨')
		case 'dead':
			return translate('세션 종료 (완료 처리 안 됨)')
		default:
			return translate('대기 중')
	}
}
function subtaskRowState(w: SubtaskWorkStatus | undefined): WorkRowState {
	if (!w) return 'waiting'
	if (w.blocked) return 'blocked'
	if (w.alive) return 'alive'
	if (w.stalled) return 'stalled'
	if (w.done) return 'done'
	if (w.started) return 'dead' // 세션이 완료 신호 없이 그냥 죽음
	return 'waiting'
}
// TaskRow.module.css의 subChainDot 변형 클래스 이름 — 색/애니메이션은 거기서 그대로 가져오고,
// position:absolute(사이드바 레일 전용 좌표)만 CalendarPane.module.css의 .chainDotReset으로 되돌린다.
function subChainDotKey(state: WorkRowState): string {
	switch (state) {
		case 'blocked':
			return 'subChainDotAlert'
		case 'alive':
			return 'subChainDotAlive'
		case 'done':
			return 'subChainDotComplete'
		case 'dead':
			return 'subChainDotDone'
		case 'stalled':
			return 'subChainDotStalled'
		default:
			return ''
	}
}
// 통짜 태스크 칩(서브태스크 없음)의 "지금 뭔가 활발한 게 있나"만 보는 요약 — 개별 칩 점(chipDotState)
// 전용. 체인 팝오버는 항상 전체를 보여주므로 이 필터를 안 쓴다.
function chipDotState(item: CalItem, subtaskWork: Record<string, SubtaskWorkStatus[]>): WorkRowState | null {
	if (item.completed_at) return null // 이미 체크마크로 표시됨(§ renderChip)
	const work = subtaskWork[item.openId] ?? []
	if (item.subtaskId) {
		const state = subtaskRowState(work.find((w) => w.id === item.subtaskId))
		return state === 'waiting' ? null : state
	}
	if (work.some((w) => w.blocked)) return 'blocked'
	if (work.some((w) => w.alive)) return 'alive'
	if (work.some((w) => w.stalled)) return 'stalled'
	return null
}
// "이 html파일은 해당 서브태스크 상세에서 계속 볼 수 있도록해줘"(§ SubtaskDetailPanel.openReport)와
// 완전히 같은 방식 — reportUrl은 앱 서버가 서빙하는 상대 경로라 <a href>가 아니라 내부 브라우저
// 탭으로 열어야 한다.
function openSubtaskReport(task: Task | undefined, w: SubtaskWorkStatus) {
	if (!task?.folder_id || !w.reportUrl) return
	const port = window.location.port || '18771'
	// 캘린더는 지금 열려 있지 않은 다른 태스크의 칩도 함께 보여준다 — openOrFocusTab만 부르면
	// activeNodeId가 안 바뀌어 탭이 보이지 않는 곳에 열린다(§ StatusBoard.tsx openVerifyUrl과 동일한
	// 원인의 동일한 버그 — setActiveNode로 먼저 그 폴더 워크스페이스로 전환해야 한다).
	useTabsStore.getState().setActiveNode(task.folder_id, 'orchestrator')
	useTabsStore.getState().openOrFocusTab(task.folder_id, 'browser')
	useBrowserNavStore.getState().request(task.folder_id, `http://localhost:${port}${w.reportUrl}`)
}
// 팝오버는 document.body로 포탈된다(§ CalendarPane 렌더) — 캘린더 칸(.cell/.cellTasksScroll)이
// overflow:hidden/auto라 그 안에 그냥 넣으면 잘려서 안 보인다. 그래서 뷰포트 기준 고정 좌표가 필요.
// 리포트 링크를 실제로 누를 수 있어야 해서(pointer-events:auto) 칩→팝오버 사이 틈을 최소로 둔다.
function popoverPosition(rect: { top: number; bottom: number; left: number }) {
	const width = 250
	const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8)
	const openUp = window.innerHeight - rect.bottom < 220 && rect.top > 220
	return openUp ? { left, bottom: window.innerHeight - rect.top + 4, width } : { left, top: rect.bottom + 4, width }
}
// "적용해서 5일로 확정됐으면 주/월 캘린더에서도 그만큼 길어져야해... 완전히 이어지게해줘... 중간에
// 일감이 있을때도 자동으로 처리가 되어야해" — 각 날 칸이 독립적으로 자기 몫만 그리는 방식(칸마다
// 목록 순서가 달라 안 이어져 보임)은 버리고, 진짜 겹치지 않는 레인(Gantt) 오버레이로 다시 만들었다.
// 한 주(week) 단위로: 그 주와 겹치는 여러 날짜짜리 태스크들을 시작 열~끝 열로 계산하고, 겹치는
// 것끼리는 다른 레인(줄)에 배정한다(고전적인 구간 스케줄링 그리디) — 그래서 같은 태스크는 항상 같은
// 레인·같은 세로 위치에서 이어지고, 그 자리에 다른 일감이 있어도 자동으로 다음 레인으로 밀린다.
// 하루짜리 태스크는 기존처럼 각 날 칸 안에 그대로 둔다(레인 배너는 여러 날짜짜리만).
const LANE_H = 20 // px — 레인 막대 1개 높이(막대+간격)
const CELL_HEAD_H = 24 // px — 월 칸(compact) 날짜 헤더 높이(한 줄, 레인 배너가 그 아래부터 시작하도록)
// "겹친다" — 주 칸(wide)은 요일 라벨 + 날짜가 두 줄로 쌓이고(.cellWide .cellHead가 column) 위아래
// 패딩도 더 커서, 월 칸과 같은 CELL_HEAD_H를 쓰면 레인 배너가 날짜 숫자 위에 겹쳐 그려졌다.
const WEEK_CELL_HEAD_H = 60 // px — .cellWide 패딩(12) + 요일줄+간격+날짜줄(~38) + 헤드 margin-bottom(10)

interface LaneEntry {
	item: CalItem
	startCol: number
	endCol: number
	lane: number
	continuesLeft: boolean
	continuesRight: boolean
}
// windowDays 안에서 여러 날짜짜리 항목(태스크 또는 서브태스크)들의 시작~끝 열과 레인을 계산 —
// 그리디 구간 스케줄링: 시작 열 순으로 정렬 후, 지금까지 쓰인 레인 중 이 항목 시작 열 이전에 이미
// 끝난 레인이 있으면 재사용하고, 없으면 새 레인을 연다.
function computeLanes(windowDays: Date[], items: CalItem[]): { entries: LaneEntry[]; laneCount: number } {
	const windowStart = windowDays[0].getTime()
	const last = windowDays[windowDays.length - 1]
	const windowEnd = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime()
	const raw: { item: CalItem; startCol: number; endCol: number; continuesLeft: boolean; continuesRight: boolean }[] = []
	for (const it of items) {
		if (!it.due_date || !it.duration_days || it.duration_days <= 1) continue
		const range = businessDayRange(it.due_date, it.duration_days)
		const rangeStartMs = range[0].getTime()
		const rangeEndMs = range[range.length - 1].getTime()
		if (rangeEndMs < windowStart || rangeStartMs > windowEnd) continue // 이 창과 안 겹침
		const startCol = Math.max(0, Math.round((rangeStartMs - windowStart) / 86400000))
		const endCol = Math.min(windowDays.length - 1, Math.round((rangeEndMs - windowStart) / 86400000))
		raw.push({ item: it, startCol, endCol, continuesLeft: rangeStartMs < windowStart, continuesRight: rangeEndMs > windowEnd })
	}
	raw.sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol)
	const laneEndCols: number[] = []
	const entries: LaneEntry[] = []
	for (const r of raw) {
		let lane = laneEndCols.findIndex((end) => end < r.startCol)
		if (lane === -1) {
			lane = laneEndCols.length
			laneEndCols.push(r.endCol)
		} else {
			laneEndCols[lane] = r.endCol
		}
		entries.push({ ...r, lane })
	}
	return { entries, laneCount: laneEndCols.length }
}

// "막기가 가려야해" — 차단 기간 이름표가 일반 문서 흐름(cellHead 아래)에 있고 여러 날짜 태스크
// 레인 배너는 그 위에 절대위치로 겹쳐 그려져서, 같은 자리를 두고 서로 가려버렸다. 차단 기간도
// computeLanes와 똑같은 레인 배정 로직을 타게 해서(§ 아래) 절대 겹치지 않는 자기 레인을 갖게
// 한다 — 항상 태스크 레인보다 앞(위쪽 레인)에 배정해 차단 기간이 항상 먼저 보인다.
interface BlockedLaneEntry {
	period: BlockedPeriod
	startCol: number
	endCol: number
	lane: number
	continuesLeft: boolean
	continuesRight: boolean
}
function computeBlockedLanes(windowDays: Date[], periods: BlockedPeriod[]): { entries: BlockedLaneEntry[]; laneCount: number } {
	const windowStart = windowDays[0].getTime()
	const last = windowDays[windowDays.length - 1]
	const windowEnd = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime()
	const raw = periods
		.filter((p) => p.end_date >= windowStart && p.start_date <= windowEnd)
		.map((p) => ({
			period: p,
			startCol: Math.max(0, Math.round((p.start_date - windowStart) / 86400000)),
			endCol: Math.min(windowDays.length - 1, Math.round((p.end_date - windowStart) / 86400000)),
			continuesLeft: p.start_date < windowStart,
			continuesRight: p.end_date > windowEnd,
		}))
	raw.sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol)
	const laneEndCols: number[] = []
	const entries: BlockedLaneEntry[] = []
	for (const r of raw) {
		let lane = laneEndCols.findIndex((end) => end < r.startCol)
		if (lane === -1) {
			lane = laneEndCols.length
			laneEndCols.push(r.endCol)
		} else {
			laneEndCols[lane] = r.endCol
		}
		entries.push({ ...r, lane })
	}
	return { entries, laneCount: laneEndCols.length }
}

// "주단위 월단위 캘린더도 있으면 좋겠어. 캘린더에 일감이 관리되어야해" 요청으로 신설. 예정일(due_date)은
// v10 마이그레이션으로 tasks에 추가됨 — 시:분 없이 "그 날"만 의미가 있어 로컬 자정 epoch ms로 저장한다.
// 드래그 재배치/칩 클릭 이동을 지원하고, 빈 칸 추가는 사이드바 "태스크 추가"와 동일한 NewTaskModal을
// 그 날짜로 열어서 만든다("작업추가는 태스크 추가와 같다" — 두 UI를 하나로 통합, 사용자 확인 완료).
// "모든 메뉴는 탭에서 나온다" 규칙에 따라 SessionShell의 전역 가짜 노드(CALENDAR_NODE_ID) 탭으로 열림.

const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토']
// '월'은 DOW_LABEL(월요일)과 아래 모드 탭('주'/'월' = 주간/월간) 둘 다에서 쓰이는데 의미가 다르다
// (요일 vs 기간 단위) — 전역 t() 사전에 bare 한 글자 키로 넣으면 두 의미가 충돌하므로, 이 두 enum은
// 전역 사전을 안 거치고 파일 로컬 배열/맵으로 직접 번역한다.
const DOW_LABEL_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad(n: number) {
	return String(n).padStart(2, '0')
}
function dateKey(d: Date) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function keyToLocalMidnight(key: string) {
	const [y, m, d] = key.split('-').map(Number)
	return new Date(y, m - 1, d).getTime()
}
function startOfWeek(d: Date) {
	const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
	x.setDate(x.getDate() - x.getDay())
	return x
}
function addDays(d: Date, n: number) {
	const x = new Date(d)
	x.setDate(x.getDate() + n)
	return x
}
function isSameDay(a: Date, b: Date) {
	return dateKey(a) === dateKey(b)
}
// "그냥 위아래 스크롤이 됐으면 좋겠어"(2주 차이나는 날짜를 한 화면에 못 봐서 불편) — 월 하나만
// 딱 잘라 보여주던 monthGrid 대신, cursor의 달부터 monthsAfter개월 뒤까지를 이어붙인 주(week) 목록
// 하나를 만든다. 페이지 넘기기(‹/›) 없이도 그 안에서 자유롭게 위아래 스크롤하면 여러 달이 이어 보인다.
function monthWindow(cursor: Date, monthsAfter: number) {
	const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
	const last = new Date(cursor.getFullYear(), cursor.getMonth() + monthsAfter + 1, 0)
	const gridStart = startOfWeek(first)
	const gridEnd = startOfWeek(last)
	const weeks: Date[][] = []
	for (let cur = gridStart; cur <= gridEnd; cur = addDays(cur, 7)) {
		weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)))
	}
	return weeks
}

type Mode = 'week' | 'month'

export default function CalendarPane() {
	const inbox = useSessionsStore((s) => s.inbox)
	const folders = useSessionsStore((s) => s.folders)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const setDragTask = useSessionsStore((s) => s.setDragTask)
	const updateTaskDueDate = useSessionsStore((s) => s.updateTaskDueDate)
	const updateSubtaskDueDate = useSessionsStore((s) => s.updateSubtaskDueDate)
	const openSubtaskDetail = useSessionsStore((s) => s.openSubtaskDetail)
	// "마우스를 올렸을때 팝오버로 현재 진행중인 작업이 보였으면 좋겠어" — FolderCard/TaskRow와 같은
	// 전역 폴링 데이터(§ SessionShell의 15초 refreshAllSubtaskWork)를 그대로 구독.
	const subtaskWork = useSessionsStore((s) => s.subtaskWork)
	// "좋아. 이것 그대로 두고 이게 캘린더에도 적용되게 해줘" — 사이드바(SessionShell)의 레포 체크박스
	// 필터를 그대로 공유한다(§ useSessionsStore.repoFilters) — 캘린더 자체 필터 UI는 만들지 않는다.
	const repoFilters = useSessionsStore((s) => s.repoFilters)
	// "일정 막기 기능이 필요해. 중간에 QA기간같은게 있어서 다른걸 못할 수 있거든"
	const blockedPeriods = useSessionsStore((s) => s.blockedPeriods)
	const removeBlockedPeriod = useSessionsStore((s) => s.removeBlockedPeriod)
	// "캘린더에 대한민국 공휴일도 적용해줘" — 나라 선택은 설정 모달로 옮겼다(§SettingsModal "캘린더
	// 공휴일 국가" — 전역 환경설정이라 캘린더 툴바 안 붐비게 하는 것보다 설정이 맞는 자리).
	const holidayByDate = useHolidayStore((s) => s.byDate)
	const ensureHolidayYears = useHolidayStore((s) => s.ensureYears)
	const t = useT()
	const tp = useTp()
	const lang = useUiStore((s) => s.lang)
	const dowLabel = (i: number) => (lang === 'en' ? DOW_LABEL_EN[i] : DOW_LABEL[i])
	const modeLabel = (m: Mode) => (lang === 'en' ? (m === 'week' ? 'Week' : 'Month') : m === 'week' ? '주' : '월')

	const [mode, setMode] = useState<Mode>('week')
	const [cursor, setCursor] = useState(() => new Date())
	const [hoverKey, setHoverKey] = useState<string | null>(null)
	const [unscheduledOpen, setUnscheduledOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [newTaskDate, setNewTaskDate] = useState<number | null>(null)
	const [blockModalOpen, setBlockModalOpen] = useState(false)
	const [blockDefaultDate, setBlockDefaultDate] = useState<number | null>(null)
	// "서브태스크 일정은 기존처럼 옮길수있어 각각 일정이 별도" — 태스크 드래그(dragTaskId, 전역 스토어)와
	// 별개로, 서브태스크 드래그는 이 컴포넌트 로컬 상태로만 추적한다(사이드바 등 다른 곳은 서브태스크를
	// 안 다루니 전역일 필요가 없다).
	const [dragSubtaskId, setDragSubtaskId] = useState<string | null>(null)
	const [hoverWork, setHoverWork] = useState<{ item: CalItem; rect: { top: number; bottom: number; left: number } } | null>(null)
	function hoverProps(item: CalItem) {
		return {
			onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
				const r = e.currentTarget.getBoundingClientRect()
				setHoverWork({ item, rect: { top: r.top, bottom: r.bottom, left: r.left } })
			},
			onMouseLeave: () => setHoverWork((h) => (h?.item === item ? null : h)),
		}
	}

	const allTasks = useMemo(() => {
		// "눈모양으로 안보이게 표시하면 캘린더에서도 안보이게해줘" — 예전엔 숨김(folder.hidden)이 사이드바
		// 트리에서만 적용되고 캘린더는 이 값을 안 봤다(§types.ts Folder.hidden 주석, completed_at과 같은
		// 원칙으로 의도적으로 배제했던 것). 이제 캘린더도 같이 걸러낸다 — inbox 항목은 폴더 밖이라
		// hidden 필드 자체가 없어 그대로 둔다.
		const all = [...inbox, ...folders.filter((f) => !f.hidden).flatMap((f) => f.tasks)]
		return repoFilters ? all.filter((t) => !!t.repo_id && repoFilters.has(t.repo_id)) : all
	}, [inbox, folders, repoFilters])
	// 팝오버가 칩 하나(item.openId)에서 그 태스크의 서브태스크 전체 체인을 찾아 보여주는 데 쓴다
	// (§ 아래 hoverWork 팝오버) — filtered(검색으로 좁혀짐)가 아니라 allTasks 기준이면 충분하다,
	// 검색에 걸러진 태스크의 칩은 애초에 캘린더에 안 그려지니 호버될 일이 없다.
	const tasksById = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks])
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return q ? allTasks.filter((t) => t.name.toLowerCase().includes(q)) : allTasks
	}, [allTasks, query])
	// "태스크 하나에 개발, 개발자테스트, QA, 배포 이런식으로 나뉠 수 있거든" — 서브태스크에 예정일이
	// 있으면 그게 실제 캘린더 항목이 되고, 없으면 태스크 자신이 항목이 된다(§ flattenCalendarItems).
	const calendarItems = useMemo(() => flattenCalendarItems(filtered), [filtered])

	// 여러 날짜짜리(duration_days > 1) 항목은 이제 이 목록에 안 들어간다 — 레인 배너(computeLanes/
	// renderLaneBar)가 따로 그린다. 여기는 하루짜리만.
	const byDay = useMemo(() => {
		const map = new Map<string, CalItem[]>()
		for (const it of calendarItems) {
			if (!it.due_date) continue
			if (it.duration_days && it.duration_days > 1) continue
			const key = dateKey(new Date(it.due_date))
			const arr = map.get(key)
			if (arr) arr.push(it)
			else map.set(key, [it])
		}
		return map
	}, [calendarItems])
	const unscheduled = useMemo(() => filtered.filter((t) => !hasSchedule(t)), [filtered])

	function go(dir: 1 | -1) {
		setCursor((c) => (mode === 'week' ? addDays(c, dir * 7) : new Date(c.getFullYear(), c.getMonth() + dir, 1)))
	}
	// "마우스 내리면 다음달 볼 수 있게" — 태스크를 드래그해서 지금 화면에 없는 날짜에 놓고 싶을 때,
	// 클릭 없이 이 화살표 위에서 잠깐 멈추면 자동으로 넘어간다(드래그 중에만 — onDragOver는 실제
	// 네이티브 드래그가 진행 중일 때만 발생하므로 별도 상태 체크 없이 자연히 그 조건을 만족한다).
	const navHoverTimer = useRef<number | null>(null)
	function clearNavHoverTimer() {
		if (navHoverTimer.current !== null) {
			window.clearTimeout(navHoverTimer.current)
			navHoverTimer.current = null
		}
	}
	function armNavHover(dir: 1 | -1) {
		if (navHoverTimer.current !== null) return
		navHoverTimer.current = window.setTimeout(() => {
			navHoverTimer.current = null
			go(dir)
		}, 550)
	}
	// 예전엔 칩을 누르면 바로 터미널 탭으로 점프했다 — 아직 태스크로 등록도 안 한 미분류 일감까지
	// 그렇게 되니 어색했다("캘린더의 일감을 눌렀을 때 해당 일감의 내용이 나왔으면" 피드백). 이제 상세
	// 모달을 먼저 열고, 실제 작업 공간으로 가는 건 그 모달 안 "작업 열기" 버튼이 맡는다.
	// TaskDetailModal의 열림 상태는 스토어로 옮겨졌다(§ "사이드바에서 진행상황 보여주고 클릭하면
	// 상세로" — 사이드바의 AI 검토 진행 목록도 같은 드로어를 열어야 해서 여기 로컬 state로는 부족).
	// "월/주캘린더에서도 서브태스크를 누르면 서브태스크 상세로 갔으면좋겠어" — item이 서브태스크에서
	// 나온 칩/막대(item.subtaskId)면 서브태스크 전용 드로어를 연다. 아니면 태스크 상세인데, "메인
	// 태스크는 이제 사이드바에서 상세페이지를 띄우지말고 탭으로" — 폴더로 승격된 태스크면 모달 대신
	// 그 폴더의 탭으로 이동한다(openTaskOrFolderDetail).
	function openTask(item: CalItem) {
		if (item.subtaskId) openSubtaskDetail(item.subtaskId, item.openId)
		else openTaskOrFolderDetail(item.openId)
	}
	function periodLabel() {
		if (mode === 'month') return tp('{year}년 {month}월', { year: cursor.getFullYear(), month: cursor.getMonth() + 1 })
		const s = startOfWeek(cursor)
		const e = addDays(s, 6)
		return s.getMonth() === e.getMonth()
			? tp('{year}년 {month}월 {d1}–{d2}일', { year: s.getFullYear(), month: s.getMonth() + 1, d1: s.getDate(), d2: e.getDate() })
			: tp('{m1}월 {d1}일 – {m2}월 {d2}일', { m1: s.getMonth() + 1, d1: s.getDate(), m2: e.getMonth() + 1, d2: e.getDate() })
	}

	// "태스크하나를 색하나로 보여주는거야" — 배경은 그 항목이 속한 태스크의 커스텀 색(item.color,
	// 없으면 기본 배경 그대로). "레포의 색상은... 텍스트색상이든 뭔가 다른걸로 표시해야할것같아" —
	// 배경 자리를 태스크 색에 내주는 대신 레포 식별은 텍스트 색으로 옮겼다. 왼쪽 컬러 바는 안 쓴다 —
	// 이 디자인 시스템에서 컬러 테두리는 진행 상태 표시 자리라 정체성 신호와 겹치면 안 된다.
	function itemDrag(item: CalItem) {
		return {
			draggable: true,
			onDragStart: (e: React.DragEvent) => {
				e.dataTransfer.effectAllowed = 'move'
				e.dataTransfer.setData('text/plain', item.id)
				if (item.subtaskId) setDragSubtaskId(item.subtaskId)
				else setDragTask(item.id)
			},
			onDragEnd: () => {
				setDragTask(null)
				setDragSubtaskId(null)
			},
		}
	}
	function renderChip(item: CalItem) {
		// "캘린더 레포 색상을 텍스트에 적용하는건 제거해줘" — 레포 식별은 이제 캘린더에서 안 보여준다.
		// "완료해도... 캘린더에는 남아있어야함" — 태스크 트리에서는 걸러내는(SessionShell.tsx) completed_at을
		// 캘린더는 무시하고 그대로 그린다. 완료됐다는 건 체크마크+취소선으로만 구분.
		const done = !!item.completed_at
		// "캘린더화면에서 각 태스크의 상태를 보여주면 좋을듯해. 한눈에 현재 상황이 보일테니까" —
		// 완료(체크마크)는 이미 있으니, 지금 활발한(실행/도움필요/정지의심) 것만 점으로 더한다 —
		// 조용한 기본 상태(대기 중)까지 점을 켜면 신호가 묽어진다.
		const dot = chipDotState(item, subtaskWork)
		return (
			<div
				key={item.id}
				className={`${styles.chip} ${done ? styles.chipDone : ''}`}
				style={{
					background: item.color && !done ? `color-mix(in srgb, ${item.color} 14%, var(--card2))` : undefined,
				}}
				{...itemDrag(item)}
				{...hoverProps(item)}
				onClick={(e) => {
					e.stopPropagation()
					openTask(item)
				}}
			>
				{done && <span className={styles.chipCheck}>✓</span>}
				{dot && <span className={`${taskRowStyles.subChainDot} ${taskRowStyles[subChainDotKey(dot)] ?? ''} ${styles.chainDotReset} ${styles.chipDot}`} />}
				{item.name}
			</div>
		)
	}

	// 한 주(windowDays) 안에서 겹치지 않게 레인 배정된 여러 날짜짜리 항목 막대 하나를 그린다.
	// continuesLeft/Right는 이 창 밖에서 이어진다는 뜻 — 잘린 게 아니라 "이 창 경계 밖으로도 계속됨"을
	// ‹ › 화살표로 알려준다(진짜 잘림과 구분). laneOffset — 차단 기간 레인이 항상 위쪽을 차지하므로
	// (§ computeBlockedLanes) 태스크 레인은 그 개수만큼 아래로 밀려서 그려진다.
	function renderLaneBar(e: LaneEntry, cols: number, laneOffset = 0) {
		const item = e.item
		const done = !!item.completed_at
		const dot = chipDotState(item, subtaskWork)
		return (
			<div
				key={item.id}
				className={`${styles.laneBar} ${done ? styles.chipDone : ''}`}
				style={{
					left: `${(e.startCol / cols) * 100}%`,
					width: `${((e.endCol - e.startCol + 1) / cols) * 100}%`,
					top: (e.lane + laneOffset) * LANE_H,
					background: item.color && !done ? `color-mix(in srgb, ${item.color} 16%, var(--card2))` : undefined,
				}}
				{...itemDrag(item)}
				{...hoverProps(item)}
				onClick={(ev) => {
					ev.stopPropagation()
					openTask(item)
				}}
			>
				{done && <span className={styles.chipCheck}>✓</span>}
				{dot && <span className={`${taskRowStyles.subChainDot} ${taskRowStyles[subChainDotKey(dot)] ?? ''} ${styles.chainDotReset} ${styles.chipDot}`} />}
				{e.continuesLeft ? '‹ ' : ''}
				{item.name}
				<span className={styles.chipDuration}>{tp('{days}일', { days: item.duration_days ?? 0 })}</span>
				{e.continuesRight ? ' ›' : ''}
			</div>
		)
	}

	// "막기가 가려야해" — 차단 기간 막대. 항상 레인 0부터 채워(위쪽 우선) 태스크 막대에 가려지지 않는다.
	function renderBlockedBar(e: BlockedLaneEntry, cols: number) {
		const p = e.period
		return (
			<div
				key={p.id}
				className={styles.blockedBar}
				style={{ left: `${(e.startCol / cols) * 100}%`, width: `${((e.endCol - e.startCol + 1) / cols) * 100}%`, top: e.lane * LANE_H }}
				title={p.name}
			>
				<span className={styles.blockedBarText}>
					🚫 {e.continuesLeft ? '‹ ' : ''}
					{p.name}
					{e.continuesRight ? ' ›' : ''}
				</span>
				<span
					className={styles.blockedBarClose}
					onClick={(ev) => {
						ev.stopPropagation()
						removeBlockedPeriod(p.id)
					}}
					title={t('삭제')}
				>
					×
				</span>
			</div>
		)
	}

	// "일정 막기... QA기간같은게 있어서" — 이 날짜가 속한 차단 기간(있으면, 배경 줄무늬용).
	// start_date <= d <= end_date 둘 다 로컬 자정 epoch ms라 날짜 단위로만 비교하면 된다.
	function blockedPeriodFor(d: Date) {
		const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
		return blockedPeriods.find((p) => t >= p.start_date && t <= p.end_date)
	}

	// reserveTop — 이 칸이 속한 주(week)에 레인 배너가 몇 줄 떠 있는지에 맞춰 태스크 목록 시작 위치를
	// 아래로 밀어준다(레인 배너는 칸들 위에 절대위치로 겹쳐 그려지므로, 안 밀면 하루짜리 칩과 겹친다).
	function renderDayCell(d: Date, compact: boolean, reserveTop = 0) {
		const key = dateKey(d)
		const today = isSameDay(d, new Date())
		const tasks = byDay.get(key) ?? []
		// "막기가 가려야해" — 이름표+삭제 버튼은 이제 레인 배너 쪽 renderBlockedBar가 그린다(§ 위).
		// 여기서는 그 날이 차단 중인지만 알아 배경 줄무늬(ambient 신호)만 준다.
		const blocked = blockedPeriodFor(d)

		// "주말 표기 필요" — 요일 라벨/날짜 숫자 색으로만 구분(토=blue, 일=red), 배경은 안 건드려
		// cellToday/cellBlocked 배경 레이어와 안 겹치게 한다(§ CalendarPane.module.css .cellSat/.cellSun).
		const dow = d.getDay()
		// "캘린더에 대한민국 공휴일도 적용해줘" — 평일에 낀 공휴일도 잡아야 해서 요일이 아니라 날짜로 조회.
		const holiday = holidayByDate[key]

		return (
			<div
				key={key}
				className={[
					styles.cell,
					compact ? styles.cellCompact : styles.cellWide,
					today ? styles.cellToday : '',
					hoverKey === key ? styles.cellOver : '',
					blocked ? styles.cellBlocked : '',
					dow === 0 ? styles.cellSun : dow === 6 ? styles.cellSat : '',
					holiday ? styles.cellHoliday : '',
				].join(' ')}
				onDragOver={(e) => {
					e.preventDefault()
					if (hoverKey !== key) setHoverKey(key)
				}}
				onDragLeave={() => setHoverKey((k) => (k === key ? null : k))}
				onDrop={(e) => {
					e.preventDefault()
					setHoverKey(null)
					// "서브태스크 일정은 기존처럼 옮길수있어 각각 일정이 별도" — 서브태스크를 끌고 있었으면
					// 그 서브태스크만 옮기고, 아니면 기존처럼 태스크 자체를 옮긴다.
					if (dragSubtaskId) {
						updateSubtaskDueDate(dragSubtaskId, keyToLocalMidnight(key))
						setDragSubtaskId(null)
					} else if (dragTaskId) {
						updateTaskDueDate(dragTaskId, keyToLocalMidnight(key))
					}
				}}
				// 월 칸은 좁아서 "+" 아이콘만 정확히 누르기 번거롭다 — 칸 배경 아무 데나 눌러도 그 날짜로
				// 일감 추가가 열리게(칩·버튼 클릭은 각자 stopPropagation이라 여기까지 안 올라옴).
				onClick={compact ? () => setNewTaskDate(keyToLocalMidnight(key)) : undefined}
			>
				<div className={styles.cellHead}>
					{!compact && <span className={styles.cellDow}>{dowLabel(d.getDay())}</span>}
					<span className={`${styles.cellDate} ${today ? styles.cellDateToday : ''}`}>{d.getDate()}</span>
					{holiday && <span className={styles.holidayLabel}>{holiday}</span>}
				</div>
				{/* 월(month) 칸은 좁아서 주(week)와 다르게 처리한다 — "더보기" 대신 전부 보여주고 넘치면
				    이 목록만 내부 스크롤, "+"는 아이콘만 마우스 올렸을 때만(태스크 있으면 바로 밑,
				    없으면 칸 중앙). 주 칸은 이전 그대로(늘 보이는 "+ 작업 추가" 텍스트 버튼, 아래). */}
				{compact ? (
					<div
						className={`${styles.cellTasks} ${styles.cellTasksScroll} ${tasks.length === 0 ? styles.cellTasksEmpty : ''}`}
						style={reserveTop ? { marginTop: reserveTop } : undefined}
					>
						{tasks.map((task) => renderChip(task))}
						{/* "태스크가 있으면 주캘린더와 동일한 작업 추가 ui를 노출" — 태스크가 이미 있는 칸은
						    좁은 아이콘 대신 주 캘린더와 같은 "+ 작업 추가" 텍스트 버튼으로. 빈 칸은 그대로
						    중앙 아이콘("없으면 중앙에. + 버튼" 기존 결정 유지). 둘 다 월 칸 전용이라 마우스
						    올렸을 때만 보이는 규칙은 그대로 따른다. */}
						{tasks.length > 0 ? (
							<button type="button" className={styles.addRowCompact} onClick={() => setNewTaskDate(keyToLocalMidnight(key))}>
								+ {t('작업 추가')}
							</button>
						) : (
							<button type="button" className={styles.addIconBtn} onClick={() => setNewTaskDate(keyToLocalMidnight(key))} title={t('일감 추가')}>
								+
							</button>
						)}
					</div>
				) : (
					<>
						<div className={styles.cellTasks} style={reserveTop ? { marginTop: reserveTop } : undefined}>
							{tasks.map((task) => renderChip(task))}
						</div>
						<button type="button" className={styles.addRow} onClick={() => setNewTaskDate(keyToLocalMidnight(key))}>
							+ {t('작업 추가')}
						</button>
					</>
				)}
			</div>
		)
	}

	const weekDays = mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i)) : null
	// cursor의 달을 맨 위에 두고 4개월 더 이어붙인다 — ‹/›로 페이지를 넘기면 그 달이 다시 맨 위로 오고,
	// 그 안에서는 스크롤만으로 몇 달을 더 훑어볼 수 있다("2주 차이나는데 한번에 못봐서" 문제 해결).
	const monthWeeks = mode === 'month' ? monthWindow(cursor, 4) : null
	// 이어붙인 주 목록 안에서 달이 바뀌는 지점마다 "2026년 9월" 같은 라벨을 끼워 넣는다 — 페이지 구분이
	// 없어진 대신 스크롤하다 지금 몇 월을 보고 있는지 알 수 있게.
	let lastLabeledMonth = -1
	const monthRows = monthWeeks?.map((week, i) => {
		const firstOfMonth = week.find((d) => d.getDate() === 1)
		const label = firstOfMonth && firstOfMonth.getMonth() !== lastLabeledMonth ? tp('{year}년 {month}월', { year: firstOfMonth.getFullYear(), month: firstOfMonth.getMonth() + 1 }) : null
		if (firstOfMonth) lastLabeledMonth = firstOfMonth.getMonth()
		return { key: i, week, label }
	})

	// cursor(‹/›/오늘)가 바뀌면 그 달이 다시 스크롤 맨 위로 오게 리셋 — 안 그러면 이전 스크롤 위치에
	// 그대로 머물러 방금 페이지를 넘긴 달이 화면 밖에 있을 수 있다.
	const monthBodyRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (mode === 'month') monthBodyRef.current?.scrollTo({ top: 0 })
	}, [cursor, mode])

	// 지금 화면에 걸쳐 있는 연도(들)의 공휴일만 받아온다 — 월 뷰는 몇 달이 이어붙어 연말/연초에
	// 두 해에 걸칠 수 있다. 이미 받은 연도는 ensureHolidayYears 내부에서 알아서 건너뛴다.
	useEffect(() => {
		const days = weekDays ?? monthWeeks?.flat() ?? []
		const years = Array.from(new Set(days.map((d) => d.getFullYear())))
		if (years.length) ensureHolidayYears(years)
		// eslint-disable-next-line react-hooks/exhaustive-deps -- weekDays/monthWeeks are recomputed every
		// render (not memoized); depend on the primitives that actually determine their contents instead.
	}, [cursor, mode, ensureHolidayYears])

	return (
		<div className={styles.wrap}>
			<div className={styles.toolbar}>
				<div className={styles.navGroup}>
					<button
						type="button"
						className={styles.navBtn}
						onClick={() => go(-1)}
						onDragOver={(e) => {
							e.preventDefault()
							armNavHover(-1)
						}}
						onDragLeave={clearNavHoverTimer}
						onDrop={clearNavHoverTimer}
					>
						‹
					</button>
					<button type="button" className={styles.todayBtn} onClick={() => setCursor(new Date())}>
						{t('오늘')}
					</button>
					<button
						type="button"
						className={styles.navBtn}
						onClick={() => go(1)}
						onDragOver={(e) => {
							e.preventDefault()
							armNavHover(1)
						}}
						onDragLeave={clearNavHoverTimer}
						onDrop={clearNavHoverTimer}
					>
						›
					</button>
				</div>
				<div className={styles.periodLabel}>{periodLabel()}</div>
				<div className={styles.spacer} />
				<input className="fin m" style={{ width: 160, height: 30 }} placeholder={t('검색')} value={query} onChange={(e) => setQuery(e.target.value)} />
				<button type="button" className={`${styles.unscheduledBtn} ${unscheduledOpen ? styles.unscheduledBtnOpen : ''}`} onClick={() => setUnscheduledOpen((o) => !o)}>
					{tp('날짜 없음 ({count})', { count: unscheduled.length })}
				</button>
				{/* "일정 막기 기능이 필요해. 중간에 QA기간같은게 있어서 다른걸 못할 수 있거든" */}
				<button
					type="button"
					className={styles.unscheduledBtn}
					onClick={() => {
						setBlockDefaultDate(null)
						setBlockModalOpen(true)
					}}
				>
					+ {t('일정 막기')}
				</button>
				<div className={styles.modeTabs}>
					{(['week', 'month'] as const).map((m) => (
						<button key={m} type="button" className={`${styles.modeTab} ${mode === m ? styles.modeTabActive : ''}`} onClick={() => setMode(m)}>
							{modeLabel(m)}
						</button>
					))}
				</div>
			</div>

			{unscheduledOpen && (
				<div className={styles.unscheduledStrip}>
					{unscheduled.length === 0 && <span className={styles.unscheduledEmpty}>{t('예정일 없는 일감이 없습니다.')}</span>}
					{unscheduled.map((t) => renderChip(taskToCalItem(t)))}
				</div>
			)}

			{mode === 'week' &&
				(() => {
					// "주캘린더 이거 눈에 안띄니까 그냥 주캘린더에 합쳐주고 이부분 제거해줘" — 아래 별도
					// 구역으로 내렸던 걸 되돌려, 월 뷰와 같은 방식(요일 칸 위에 겹쳐 띄우는 레인 배너)으로
					// 합친다. reserveTop으로 요일 칸의 태스크 목록을 그만큼 밀어 겹치지 않게 한다.
					// "막기가 가려야해" — 차단 기간 레인을 항상 앞(위쪽)에 두고, 태스크 레인은 그만큼
					// laneOffset으로 밀어서 그린다 — 같은 레인 배정 로직이라 절대 겹치지 않는다.
					const blocked = computeBlockedLanes(weekDays!, blockedPeriods)
					const tasks = computeLanes(weekDays!, calendarItems)
					const laneCount = blocked.laneCount + tasks.laneCount
					// "주캘린더가 위에있는게 낫겠어" — 위 절반은 주캘린더, 아래 절반이 현황판(§ StatusBoard.tsx).
					// 월 뷰는 이미 정보 밀도가 높아 그대로 둠.
					return (
						<div className={styles.weekSplit}>
							<div className={styles.weekGrid}>
								{weekDays!.map((d) => renderDayCell(d, false, laneCount * LANE_H))}
								{laneCount > 0 && (
									<div
										className={styles.monthLanesBanner}
										style={{ top: WEEK_CELL_HEAD_H, height: laneCount * LANE_H }}
										onClick={(e) => {
											if (e.target !== e.currentTarget) return
											setBlockDefaultDate(weekDays![0].getTime())
											setBlockModalOpen(true)
										}}
									>
										{blocked.entries.map((e) => renderBlockedBar(e, weekDays!.length))}
										{tasks.entries.map((e) => renderLaneBar(e, weekDays!.length, blocked.laneCount))}
									</div>
								)}
							</div>
							<StatusBoard />
						</div>
					)
				})()}

			{mode === 'month' && (
				<div className={styles.monthGrid}>
					<div className={styles.monthDowRow}>
						{DOW_LABEL.map((l, i) => (
							<div key={l} className={styles.monthDowCell}>
								{dowLabel(i)}
							</div>
						))}
					</div>
					<div className={styles.monthBody} ref={monthBodyRef}>
						{monthRows!.map(({ key, week, label }) => {
							const blocked = computeBlockedLanes(week, blockedPeriods)
							const tasks = computeLanes(week, calendarItems)
							const laneCount = blocked.laneCount + tasks.laneCount
							return (
								<div key={key}>
									{label && <div className={styles.monthDivider}>{label}</div>}
									<div className={styles.monthWeekRow}>
										{week.map((d) => renderDayCell(d, true, laneCount * LANE_H))}
										{laneCount > 0 && (
											<div
												className={styles.monthLanesBanner}
												style={{ top: CELL_HEAD_H, height: laneCount * LANE_H }}
												onClick={(e) => {
													if (e.target !== e.currentTarget) return
													setBlockDefaultDate(week[0].getTime())
													setBlockModalOpen(true)
												}}
											>
												{blocked.entries.map((e) => renderBlockedBar(e, week.length))}
												{tasks.entries.map((e) => renderLaneBar(e, week.length, blocked.laneCount))}
											</div>
										)}
									</div>
								</div>
							)
						})}
					</div>
				</div>
			)}

			<NewTaskModal open={newTaskDate !== null} onClose={() => setNewTaskDate(null)} defaultDueDate={newTaskDate} />
			<BlockPeriodModal open={blockModalOpen} onClose={() => setBlockModalOpen(false)} defaultStartDate={blockDefaultDate} />

			{hoverWork &&
				createPortal(
					<div className={styles.workPopover} style={popoverPosition(hoverWork.rect)} onMouseLeave={() => setHoverWork(null)}>
						<div className={styles.workPopoverTitle}>{hoverWork.item.parentName}</div>
						{(() => {
							const item = hoverWork.item
							const task = tasksById.get(item.openId)
							const work = subtaskWork[item.openId] ?? []
							// "관련 메인태스크 하위로 서브태스크 쭉 나열하고 현재 마우스 올린 태스크 강조로" —
							// 사이드바 TaskRow와 같은 필터(완료된 건 숨기되, 아직 alive인 건 예외로 보여줌).
							const chain = (task?.subtasks ?? []).filter((st) => !st.completed_at || work.find((w) => w.id === st.id)?.alive)
							// 서브태스크가 아예 없는 태스크(taskToCalItem 케이스) — 태스크 자신을 한 줄로.
							if (chain.length === 0) {
								const state: WorkRowState = item.completed_at ? 'done' : 'waiting'
								return (
									<div className={styles.workRow}>
										<span className={`${taskRowStyles.subChainDot} ${taskRowStyles[subChainDotKey(state)] ?? ''} ${styles.chainDotReset}`}>{state === 'done' ? CHECK : null}</span>
										<span className={styles.workRowLabel}>{item.name}</span>
										<span className={styles.workRowState}>{workStateLabel(state)}</span>
									</div>
								)
							}
							return chain.map((st) => {
								const w = work.find((x) => x.id === st.id)
								const state = subtaskRowState(w)
								const active = st.id === item.subtaskId
								return (
									<div key={st.id} className={`${styles.workRow} ${active ? styles.workRowActive : ''}`}>
										<span className={`${taskRowStyles.subChainDot} ${taskRowStyles[subChainDotKey(state)] ?? ''} ${styles.chainDotReset}`}>{state === 'blocked' ? HELP : state === 'done' ? CHECK : null}</span>
										<div className={styles.workRowBody}>
											<div className={styles.workRowTop}>
												<span className={styles.workRowLabel}>{st.name}</span>
												<span className={styles.workRowState}>{workStateLabel(state)}</span>
											</div>
											{active && w && (
												<div className={styles.workRowDetail}>
													{w.branch && <div className={styles.workDetailLine}>⎇ {w.branch}</div>}
													{w.worktreePath && <div className={styles.workDetailLine}>{w.worktreePath.split('/').slice(-1)[0]}</div>}
													{w.blocked && w.blockedReason && <div className={styles.workDetailLine}>{tp('도움 요청: {reason}', { reason: w.blockedReason })}</div>}
													{w.done && w.reportUrl && (
														<button
															type="button"
															className={styles.workReportLink}
															onClick={(ev) => {
																ev.stopPropagation()
																openSubtaskReport(task, w)
																setHoverWork(null)
															}}
														>
															{t('완료 리포트 보기')}
														</button>
													)}
												</div>
											)}
										</div>
									</div>
								)
							})
						})()}
					</div>,
					document.body,
				)}
		</div>
	)
}
