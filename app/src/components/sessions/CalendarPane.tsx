import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import type { Task } from '../../store/types'
import { getRepoColor } from '../../utils/repoColor'
import NewTaskModal from './NewTaskModal'
import styles from './CalendarPane.module.css'

// "주단위 월단위 캘린더도 있으면 좋겠어. 캘린더에 일감이 관리되어야해" 요청으로 신설. 예정일(due_date)은
// v10 마이그레이션으로 tasks에 추가됨 — 시:분 없이 "그 날"만 의미가 있어 로컬 자정 epoch ms로 저장한다.
// 드래그 재배치/칩 클릭 이동을 지원하고, 빈 칸 추가는 사이드바 "태스크 추가"와 동일한 NewTaskModal을
// 그 날짜로 열어서 만든다("작업추가는 태스크 추가와 같다" — 두 UI를 하나로 통합, 사용자 확인 완료).
// "모든 메뉴는 탭에서 나온다" 규칙에 따라 SessionShell의 전역 가짜 노드(CALENDAR_NODE_ID) 탭으로 열림.

const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토']

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
	const repos = useSessionsStore((s) => s.repos)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const setDragTask = useSessionsStore((s) => s.setDragTask)
	const updateTaskDueDate = useSessionsStore((s) => s.updateTaskDueDate)
	const openTaskDetail = useSessionsStore((s) => s.openTaskDetail)

	const [mode, setMode] = useState<Mode>('week')
	const [cursor, setCursor] = useState(() => new Date())
	const [hoverKey, setHoverKey] = useState<string | null>(null)
	const [unscheduledOpen, setUnscheduledOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [newTaskDate, setNewTaskDate] = useState<number | null>(null)

	const allTasks = useMemo(() => [...inbox, ...folders.flatMap((f) => f.tasks)], [inbox, folders])
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return q ? allTasks.filter((t) => t.name.toLowerCase().includes(q)) : allTasks
	}, [allTasks, query])

	const byDay = useMemo(() => {
		const map = new Map<string, Task[]>()
		for (const t of filtered) {
			if (!t.due_date) continue
			const key = dateKey(new Date(t.due_date))
			const arr = map.get(key)
			if (arr) arr.push(t)
			else map.set(key, [t])
		}
		return map
	}, [filtered])
	const unscheduled = useMemo(() => filtered.filter((t) => !t.due_date), [filtered])

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
	function openTask(taskId: string) {
		openTaskDetail(taskId)
	}
	function periodLabel() {
		if (mode === 'month') return `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`
		const s = startOfWeek(cursor)
		const e = addDays(s, 6)
		return s.getMonth() === e.getMonth() ? `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${s.getDate()}–${e.getDate()}일` : `${s.getMonth() + 1}월 ${s.getDate()}일 – ${e.getMonth() + 1}월 ${e.getDate()}일`
	}

	// "캘린더도 배경색이 옅게 컬러가 적용됐으면" — 레포 식별 컬러(레포 관리/사이드바 점과 같은 팔레트,
	// utils/repoColor.ts)를 그대로 재사용해 칩 배경을 그 레포색의 아주 옅은 틴트로만 준다. 왼쪽 컬러
	// 바는 뺐다 — 카드에 컬러 테두리를 다는 건 이 디자인 시스템에서 진행 상태 표시 자리라 정체성
	// 신호와 겹치면 안 되고("색 있는 border-left/right" 금지), 배경 틴트만으로도 충분히 구분된다.
	function renderChip(t: Task) {
		const repo = t.repo_id ? repos.find((r) => r.id === t.repo_id) : null
		const color = repo ? getRepoColor(repo) : null
		// "완료해도... 캘린더에는 남아있어야함" — 태스크 트리에서는 걸러내는(SessionShell.tsx) completed_at을
		// 캘린더는 무시하고 그대로 그린다. 완료됐다는 건 체크마크+취소선으로만 구분.
		const done = !!t.completed_at
		return (
			<div
				key={t.id}
				className={`${styles.chip} ${done ? styles.chipDone : ''}`}
				style={color && !done ? { background: `color-mix(in srgb, ${color} 8%, var(--card2))` } : undefined}
				draggable
				onDragStart={(e) => {
					e.dataTransfer.effectAllowed = 'move'
					e.dataTransfer.setData('text/plain', t.id)
					setDragTask(t.id)
				}}
				onDragEnd={() => setDragTask(null)}
				onClick={(e) => {
					e.stopPropagation()
					openTask(t.id)
				}}
				title={t.duration_days && t.duration_days > 1 ? `${t.name} (영업일 ${t.duration_days}일)` : t.name}
			>
				{done && <span className={styles.chipCheck}>✓</span>}
				{t.name}
				{/* 기간이 있는 태스크는 며칠짜리인지만 짧게 — 시작일 칸에 걸쳐 실제로 여러 날에 이어 그리는
				    멀티데이 바 렌더링은 이번 스코프 밖(칸 폭 재계산이 필요한 별도 작업), 배지로만 표시. */}
				{!!t.duration_days && t.duration_days > 1 && <span className={styles.chipDuration}>{t.duration_days}일</span>}
			</div>
		)
	}

	function renderDayCell(d: Date, compact: boolean) {
		const key = dateKey(d)
		const today = isSameDay(d, new Date())
		const tasks = byDay.get(key) ?? []

		return (
			<div
				key={key}
				className={[styles.cell, compact ? styles.cellCompact : styles.cellWide, today ? styles.cellToday : '', hoverKey === key ? styles.cellOver : ''].join(' ')}
				onDragOver={(e) => {
					e.preventDefault()
					if (hoverKey !== key) setHoverKey(key)
				}}
				onDragLeave={() => setHoverKey((k) => (k === key ? null : k))}
				onDrop={(e) => {
					e.preventDefault()
					setHoverKey(null)
					if (dragTaskId) updateTaskDueDate(dragTaskId, keyToLocalMidnight(key))
				}}
				// 월 칸은 좁아서 "+" 아이콘만 정확히 누르기 번거롭다 — 칸 배경 아무 데나 눌러도 그 날짜로
				// 일감 추가가 열리게(칩·버튼 클릭은 각자 stopPropagation이라 여기까지 안 올라옴).
				onClick={compact ? () => setNewTaskDate(keyToLocalMidnight(key)) : undefined}
			>
				<div className={styles.cellHead}>
					{!compact && <span className={styles.cellDow}>{DOW_LABEL[d.getDay()]}</span>}
					<span className={`${styles.cellDate} ${today ? styles.cellDateToday : ''}`}>{d.getDate()}</span>
				</div>

				{/* 월(month) 칸은 좁아서 주(week)와 다르게 처리한다 — "더보기" 대신 전부 보여주고 넘치면
				    이 목록만 내부 스크롤, "+"는 아이콘만 마우스 올렸을 때만(태스크 있으면 바로 밑,
				    없으면 칸 중앙). 주 칸은 이전 그대로(늘 보이는 "+ 작업 추가" 텍스트 버튼, 아래). */}
				{compact ? (
					<div className={`${styles.cellTasks} ${styles.cellTasksScroll} ${tasks.length === 0 ? styles.cellTasksEmpty : ''}`}>
						{tasks.map(renderChip)}
						{/* "태스크가 있으면 주캘린더와 동일한 작업 추가 ui를 노출" — 태스크가 이미 있는 칸은
						    좁은 아이콘 대신 주 캘린더와 같은 "+ 작업 추가" 텍스트 버튼으로. 빈 칸은 그대로
						    중앙 아이콘("없으면 중앙에. + 버튼" 기존 결정 유지). 둘 다 월 칸 전용이라 마우스
						    올렸을 때만 보이는 규칙은 그대로 따른다. */}
						{tasks.length > 0 ? (
							<button type="button" className={styles.addRowCompact} onClick={() => setNewTaskDate(keyToLocalMidnight(key))}>
								+ 작업 추가
							</button>
						) : (
							<button type="button" className={styles.addIconBtn} onClick={() => setNewTaskDate(keyToLocalMidnight(key))} title="일감 추가">
								+
							</button>
						)}
					</div>
				) : (
					<>
						<div className={styles.cellTasks}>{tasks.map(renderChip)}</div>
						<button type="button" className={styles.addRow} onClick={() => setNewTaskDate(keyToLocalMidnight(key))}>
							+ 작업 추가
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
		const label = firstOfMonth && firstOfMonth.getMonth() !== lastLabeledMonth ? `${firstOfMonth.getFullYear()}년 ${firstOfMonth.getMonth() + 1}월` : null
		if (firstOfMonth) lastLabeledMonth = firstOfMonth.getMonth()
		return { key: i, week, label }
	})

	// cursor(‹/›/오늘)가 바뀌면 그 달이 다시 스크롤 맨 위로 오게 리셋 — 안 그러면 이전 스크롤 위치에
	// 그대로 머물러 방금 페이지를 넘긴 달이 화면 밖에 있을 수 있다.
	const monthBodyRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (mode === 'month') monthBodyRef.current?.scrollTo({ top: 0 })
	}, [cursor, mode])

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
						오늘
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
				<input className="fin m" style={{ width: 160, height: 30 }} placeholder="검색" value={query} onChange={(e) => setQuery(e.target.value)} />
				<button type="button" className={`${styles.unscheduledBtn} ${unscheduledOpen ? styles.unscheduledBtnOpen : ''}`} onClick={() => setUnscheduledOpen((o) => !o)}>
					날짜 없음 ({unscheduled.length})
				</button>
				<div className={styles.modeTabs}>
					{(['week', 'month'] as const).map((m) => (
						<button key={m} type="button" className={`${styles.modeTab} ${mode === m ? styles.modeTabActive : ''}`} onClick={() => setMode(m)}>
							{m === 'week' ? '주' : '월'}
						</button>
					))}
				</div>
			</div>

			{unscheduledOpen && (
				<div className={styles.unscheduledStrip}>
					{unscheduled.length === 0 && <span className={styles.unscheduledEmpty}>예정일 없는 일감이 없습니다.</span>}
					{unscheduled.map(renderChip)}
				</div>
			)}

			{mode === 'week' && <div className={styles.weekGrid}>{weekDays!.map((d) => renderDayCell(d, false))}</div>}

			{mode === 'month' && (
				<div className={styles.monthGrid}>
					<div className={styles.monthDowRow}>
						{DOW_LABEL.map((l) => (
							<div key={l} className={styles.monthDowCell}>
								{l}
							</div>
						))}
					</div>
					<div className={styles.monthBody} ref={monthBodyRef}>
						{monthRows!.map(({ key, week, label }) => (
							<div key={key}>
								{label && <div className={styles.monthDivider}>{label}</div>}
								<div className={styles.monthWeekRow}>{week.map((d) => renderDayCell(d, true))}</div>
							</div>
						))}
					</div>
				</div>
			)}

			<NewTaskModal open={newTaskDate !== null} onClose={() => setNewTaskDate(null)} defaultDueDate={newTaskDate} />
		</div>
	)
}
