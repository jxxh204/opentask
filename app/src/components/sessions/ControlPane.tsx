import { useEffect, useMemo, useRef, useState, type ClipboardEventHandler } from 'react'
import { marked } from 'marked'
import { getControlState, startControl, stopControl, askControl, getControlTranscript, uploadImage, interruptControl } from '../../api/control'
import type { ControlState, ChatTurn, ChatPart } from '../../api/control'
import StatusDot from '../common/StatusDot'
import { useT, useTp } from '../../utils/i18n'
import styles from './ControlPane.module.css'

marked.setOptions({ breaks: true })

// "비서"(구 "관제") — 태스크 지휘자(OrchestratorPane)와 이름·자리를 분리한 최상위 에이전트. 특정 태스크가
// 아니라 앱 전체(캘린더 일정, 크론잡, 운영 설정)를 대화로 조작한다(server/control.cjs, MCP 툴
// opentask-control).
//
// "비서라는 이름에 맞게 클로드 세션을 보여주기보다 대화형이면 어떨까" → "대화형으로 가자" — 예전엔
// raw 터미널(XTerm)로 claude CLI의 TUI 화면을 그대로 보여줬다. 이젠 그 화면 대신 claude가 디스크에
// 쓰는 진짜 대화 기록(jsonl)을 폴링해서 채팅 말풍선으로 보여준다(§ server/transcript.cjs). 입력은
// 여전히 같은 pty에 타이핑해 넣는다(askControl → server/control.cjs ask — MCP 등록·seed 주입이 이미
// 검증된 기존 경로 그대로, 화면만 바꿨다).
// 이모지(🔧) 대신 이 시스템의 그려진 아이콘 관례를 그대로(§tabIcons.tsx terminal 아이콘 재사용 —
// "기술적인 동작"을 표현하는 자리에 이미 이 시스템이 쓰던 바로 그 아이콘).
// "대화할때 아이콘은 상자속 뇌를 연상하는 그림으로" — 사이드바·탭과 같은 표본함+뇌 실루엣(§
// SessionShell.tsx CONTROL_ICON, tabIcons.tsx control)이지만, 이 아바타는 배경 자체가 이미
// violet(.avatar)이라 안쪽 채움을 같은 violet으로 두면 배경에 묻힌다 — 흰 반투명 채움으로 바꿔
// violet 배경 위에서 도드라지게 하고, 같은 은은한 명멸(§ControlPane.module.css avatarBrainPulse)을 준다.
const CONTROL_AVATAR_ICON = (
	<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<rect className={styles.avatarBrainPulse} x="8" y="7.2" width="8" height="12" rx="3.4" fill="rgba(255,255,255,0.4)" stroke="none" />
		<rect x="10.6" y="3.4" width="2.8" height="2.2" rx="0.6" />
		<rect x="7" y="6.2" width="10" height="14" rx="4.2" />
		<path d="M12 8.6v10.4" />
		<path d="M9.6 11h.01M14.4 13.6h.01" />
	</svg>
)
const TOOL_ICON = (
	<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		<rect x="3" y="4" width="18" height="16" rx="2.2" />
		<path d="M7 9.5l3 2.5-3 2.5M12.5 14.5h4.5" />
	</svg>
)
const CHEVRON_ICON = (
	<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 6l6 6-6 6" />
	</svg>
)
// "일반적인 챗봇 디자인처럼" — ChatGPT/Claude.ai의 원형 아이콘 전송 버튼 관례. 같은 그려진 아이콘
// 규칙(24x24, stroke 2, round cap/join)으로 위쪽 화살표만 새로 그린다.
const SEND_ICON = (
	<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 19V6M6 11l6-6 6 6" />
	</svg>
)
// "중간에 대화 정지 기능도 있어야함" — 생성 중일 때 전송 버튼 자리에 대신 뜨는 정지 아이콘. 채워진
// 사각형은 ChatGPT/Claude.ai가 공통으로 쓰는 "생성 중단" 관례 그대로.
const STOP_ICON = (
	<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
		<rect x="5" y="5" width="14" height="14" rx="2" />
	</svg>
)

// "작은 변화도 채팅으로 알려줘서 진행중인 느낌을 줘야해" — 지금까지는 tool 호출이 원문 이름+JSON을
// 접어둔 기술적 디테일이라, 클릭해서 펼쳐야만 뭘 하는지 보였다. 오버마인드가 실제로 쓰는 MCP 툴
// (§ control.cjs controlSeed의 목록)만 사람이 읽는 문장으로 매핑 — 모르는 tool은 지어내지 않고
// 원문 이름을 그대로 노출한다(크론잡 상태 배지 때와 같은 원칙).
const TOOL_LABELS: Record<string, string> = {
	list_tasks: '보드 조회 중',
	create_task: '태스크 생성 중',
	update_task: '태스크 정보 수정 중',
	delete_task: '태스크 삭제 중',
	start_task: '태스크 착수 중',
	reschedule_task: '마감일 조정 중',
	create_subtask: '서브태스크 생성 중',
	update_subtask: '서브태스크 수정 중',
	delete_subtask: '서브태스크 삭제 중',
	list_blocked_periods: '차단 기간 확인 중',
	create_blocked_period: '차단 기간 생성 중',
	delete_blocked_period: '차단 기간 삭제 중',
	list_cron_jobs: '크론잡 목록 확인 중',
	create_cron_job: '크론잡 생성 중',
	update_cron_job: '크론잡 수정 중',
	delete_cron_job: '크론잡 삭제 중',
	run_cron_job_now: '크론잡 실행 중',
	read_settings: '설정 조회 중',
	update_setting: '설정 변경 중',
	Bash: '명령 실행 중',
	Read: '파일 확인 중',
	Write: '파일 작성 중',
	Edit: '파일 수정 중',
	WebSearch: '웹 검색 중',
	WebFetch: '웹 페이지 확인 중',
}
function toolLabel(name: string, t: ReturnType<typeof useT>): string {
	// MCP 툴 이름은 "mcp__opentask-control__read_settings"처럼 서버 접두가 붙는다 — 매핑은 접두 뗀
	// 짧은 이름 기준으로 하나만 관리.
	const bare = name.replace(/^mcp__[\w-]+__/, '')
	const known = TOOL_LABELS[bare] ?? TOOL_LABELS[name]
	return known ? t(known) : name
}

// "왼쪽 오른쪽 공간이 남는데... 관련 내용이 아주 단순하게 떠오르면서 위로쌓이는 구조" — 중앙 정렬
// 읽기 폭 컬럼(§ .thread) 옆의 빈 여백을, 오버마인드가 실제로 만지는 태스크/크론잡/캘린더를 실시간
// 미니어처로 보여주는 자리로 쓴다. 완전히 새 일러스트 대신 이 시스템에 이미 있는 아이콘(§
// SessionShell.tsx CALENDAR_ICON/AUTOMATIONS_ICON, tabIcons.tsx subtask 점)을 축소 재사용하고, 색은
// Signal-Only Rule을 지키기 위해 전부 시그널 바이올렛(에이전트가 한 일이라는 신호) 하나로 통일한다.
// 데이터 소스는 새 추적 코드 없이 이미 파싱돼 있는 tool_use part(§ transcript.cjs)를 그대로 읽는다.
type CanvasKind = 'task' | 'subtask' | 'cron' | 'blocked'
interface CanvasItem {
	id: string
	kind: CanvasKind
	label: string
	title: string
	meta: string | null
}

function fmtDate(v: unknown): string | null {
	if (v == null) return null
	const ms = typeof v === 'string' ? new Date(/^\d+$/.test(v) ? Number(v) : v + 'T00:00:00').getTime() : Number(v)
	if (!Number.isFinite(ms)) return null
	const d = new Date(ms)
	return `${d.getMonth() + 1}/${d.getDate()}`
}

const SCHEDULE_TYPE_LABEL: Record<string, string> = { interval: '반복 간격', daily: '매일', weekly: '매주' }

const CANVAS_ICON: Record<CanvasKind, React.ReactNode> = {
	task: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="5.5" />
		</svg>
	),
	subtask: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="4" />
		</svg>
	),
	cron: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<rect x="3" y="5" width="18" height="16" rx="2.5" />
			<path d="M3 10h18M8 3v4M16 3v4" />
			<circle cx="15.5" cy="15.5" r="3.2" />
			<path d="M15.5 14v1.6l1.1.9" />
		</svg>
	),
	blocked: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<rect x="3" y="5" width="18" height="16" rx="2.5" />
			<path d="M3 10h18M8 3v4M16 3v4" />
			<path d="M7.5 14h1M11.5 14h1M15.5 14h1M7.5 17.5h1M11.5 17.5h1" />
		</svg>
	),
}

// tool_use 파트 하나 → 캔버스 카드 하나(그릴 게 없으면 null). result는 실제 API 응답(§
// mcpControl.cjs ok() — JSON.stringify(data))이라 input보다 신뢰할 수 있는 값이면 그쪽을 우선한다.
// 삭제류 툴은 카드로 그릴 대상이 사라지는 액션이라(등장 연출과 안 어울림) 의도적으로 제외한다.
function canvasItemFor(turnId: string, partIndex: number, name: string, input: unknown, result: string | null, t: ReturnType<typeof useT>): CanvasItem | null {
	const bare = name.replace(/^mcp__[\w-]+__/, '')
	const inp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
	let data: Record<string, unknown> | null = null
	if (result) {
		try {
			const parsed = JSON.parse(result)
			if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
		} catch {
			/* ignore */
		}
	}
	const id = `${turnId}-${partIndex}`
	const pick = (key: string) => (data && data[key] != null ? data[key] : inp[key])

	switch (bare) {
		case 'create_task':
		case 'update_task':
			return { id, kind: 'task', label: t('태스크'), title: String(pick('name') ?? t('태스크')), meta: fmtDate(pick('due_date') ?? pick('dueDate')) }
		case 'reschedule_task':
			return { id, kind: 'task', label: t('태스크'), title: String(data?.name ?? t('일정 조정')), meta: fmtDate(pick('due_date') ?? pick('dueDate')) }
		case 'start_task':
			return { id, kind: 'task', label: t('태스크'), title: String(inp.taskName ?? t('태스크')), meta: t('착수') }
		case 'create_subtask':
		case 'update_subtask':
			return { id, kind: 'subtask', label: t('서브태스크'), title: String(pick('name') ?? t('서브태스크')), meta: fmtDate(pick('due_date') ?? pick('dueDate')) }
		case 'create_blocked_period':
			return {
				id,
				kind: 'blocked',
				label: t('차단 기간'),
				title: String(pick('name') ?? t('차단 기간')),
				meta: [fmtDate(pick('start_date') ?? pick('startDate')), fmtDate(pick('end_date') ?? pick('endDate'))].filter(Boolean).join(' ~ ') || null,
			}
		case 'create_cron_job':
		case 'update_cron_job': {
			const scheduleType = String(pick('schedule_type') ?? pick('scheduleType') ?? '')
			return { id, kind: 'cron', label: t('크론잡'), title: String(pick('name') ?? t('크론잡')), meta: SCHEDULE_TYPE_LABEL[scheduleType] ? t(SCHEDULE_TYPE_LABEL[scheduleType]) : null }
		}
		case 'run_cron_job_now':
			return { id, kind: 'cron', label: t('크론잡'), title: t('지금 실행'), meta: null }
		default:
			return null
	}
}

function deriveCanvasItems(turns: ChatTurn[], t: ReturnType<typeof useT>): CanvasItem[] {
	const items: CanvasItem[] = []
	for (const turn of turns) {
		if (turn.role !== 'assistant') continue
		turn.parts.forEach((p, i) => {
			if (p.kind !== 'tool') return
			const item = canvasItemFor(turn.id, i, p.name, p.input, p.result, t)
			if (item) items.push(item)
		})
	}
	return items.reverse() // 최신이 위로 쌓이게(§ "위로쌓이는 구조") — 배열 맨 앞이 가장 최근
}

function CanvasCard({ item }: { item: CanvasItem }) {
	return (
		<div className={styles.canvasCard}>
			<div className={styles.canvasCardHead}>
				<span className={styles.canvasCardIcon}>{CANVAS_ICON[item.kind]}</span>
				<span className={styles.canvasCardKind}>{item.label}</span>
			</div>
			<div className={styles.canvasCardTitle}>{item.title}</div>
			{item.meta && <div className={`m ${styles.canvasCardMeta}`}>{item.meta}</div>}
		</div>
	)
}

function ToolPart({ name, input, result }: { name: string; input: unknown; result: string | null }) {
	const t = useT()
	const inputStr = (() => {
		try {
			return JSON.stringify(input)
		} catch {
			return String(input)
		}
	})()
	return (
		<details className={styles.tool}>
			<summary className={styles.toolSummary}>
				<span className={styles.toolIcon}>{TOOL_ICON}</span>
				{toolLabel(name, t)}
				<span className={styles.toolChevron}>{CHEVRON_ICON}</span>
			</summary>
			<div className={styles.toolBody}>
				<span className={styles.toolName}>{name}</span>
				<div className={styles.toolBodyLabel}>{t('입력')}</div>
				{inputStr}
				{result != null && (
					<>
						<div className={styles.toolBodyLabel} style={{ marginTop: 6 }}>
							{t('결과')}
						</div>
						{result}
					</>
				)}
			</div>
		</details>
	)
}

function TurnPart({ part }: { part: ChatPart }) {
	if (part.kind === 'text') return <div className={styles.md} dangerouslySetInnerHTML={{ __html: marked.parse(part.text, { async: false }) as string }} />
	return <ToolPart name={part.name} input={part.input} result={part.result} />
}

export default function ControlPane() {
	const t = useT()
	const tp = useTp()
	const [state, setState] = useState<ControlState | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [turns, setTurns] = useState<ChatTurn[]>([])
	const [draft, setDraft] = useState('')
	const [sending, setSending] = useState(false)
	const [pendingUser, setPendingUser] = useState<string | null>(null)
	const [uploadingImage, setUploadingImage] = useState(false)
	const startedRef = useRef(false)
	const turnCountAtSendRef = useRef(0)
	const bodyRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		let cancelled = false
		getControlState()
			.then((s) => {
				if (cancelled) return
				setState(s)
				if (!s.running && !startedRef.current) {
					startedRef.current = true
					startControl()
						.then(
							(r) =>
								!cancelled &&
								(r.ok ? setState({ ...s, running: true, session: r.session ?? null, cwd: r.cwd, modelLabel: r.modelLabel }) : setError(t(r.error || '세션 생성 실패'))),
						)
						.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
				}
			})
			.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
		return () => {
			cancelled = true
		}
	}, [])

	// 마지막 턴이 사람 쪽이거나(또는 방금 보낸 게 아직 안 도착했으면), 비서 턴이 텍스트가 아니라
	// tool 호출로 끝나 있으면(더 이어질 여지가 있음) 아직 응답이 안 끝난 것 — "정지" 버튼, 점 3개,
	// 폴링 주기가 전부 이 하나의 판단을 공유한다.
	const lastTurn = turns[turns.length - 1]
	const lastPart = lastTurn?.parts[lastTurn.parts.length - 1]
	const generating = !!pendingUser || !lastTurn || lastTurn.role === 'user' || lastPart?.kind !== 'text'
	// "작은 변화도 채팅으로 알려줘서 진행중인 느낌을 줘야해" — 지금 뭘 하고 있는지 알 수 있으면(마지막
	// 파트가 아직 진행 중인 tool 호출) 점 3개 대신 그 활동을 문장으로 보여준다.
	const activeToolLabel = !pendingUser && lastTurn?.role === 'assistant' && lastPart?.kind === 'tool' ? toolLabel(lastPart.name, t) : null
	const canvasItems = useMemo(() => deriveCanvasItems(turns, t), [turns, t])

	// 대화 기록 폴링 — 세션이 떠 있는 동안만. 생성 중엔 체감 반응성을 위해 1초, 유휴 땐 2초로
	// 되돌아간다(불필요한 트래픽을 늘리지 않음) — setInterval 대신 매 tick마다 스스로 다음 지연을
	// 고르는 self-scheduling 루프라 generating이 바뀔 때마다 타이머를 새로 만들 필요가 없다.
	const generatingRef = useRef(false)
	useEffect(() => {
		generatingRef.current = generating
	})
	useEffect(() => {
		if (!state?.running) return
		let cancelled = false
		let timer: ReturnType<typeof setTimeout>
		const tick = () => {
			getControlTranscript()
				.then((r) => {
					if (cancelled || !r.ok) return
					setTurns(r.turns)
					if (r.turns.length > turnCountAtSendRef.current) setPendingUser(null)
				})
				.catch(() => {})
				.finally(() => {
					if (!cancelled) timer = setTimeout(tick, generatingRef.current ? 1000 : 2000)
				})
		}
		tick()
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [state?.running])

	useEffect(() => {
		bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
	}, [turns, pendingUser])

	async function restart() {
		setBusy(true)
		try {
			await stopControl()
			setTurns([])
			const r = await startControl()
			if (r.ok) setState((prev) => ({ ...prev, running: true, session: r.session ?? null, cwd: r.cwd, modelLabel: r.modelLabel }))
			else setError(t(r.error || '세션 생성 실패'))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	async function send() {
		const text = draft.trim()
		if (!text || sending) return
		setSending(true)
		setDraft('')
		setPendingUser(text)
		turnCountAtSendRef.current = turns.length
		try {
			const r = await askControl(text)
			if (!r.ok) setError(t(r.error || '전송 실패'))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setSending(false)
		}
	}

	// "중간에 대화 정지 기능도 있어야함" — 세션은 안 죽인다, 지금 생성 중인 응답만 ESC로 끊는다
	// (§ server/control.cjs interrupt). 끊긴 뒤 반응은 다음 폴링 tick(대화 기록)이 그대로 반영한다 —
	// 여기서 로컬 state를 따로 되돌릴 필요 없음.
	const [interrupting, setInterrupting] = useState(false)
	async function interrupt() {
		if (interrupting) return
		setInterrupting(true)
		try {
			const r = await interruptControl()
			if (!r.ok) setError(t(r.error || '정지 실패'))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setInterrupting(false)
		}
	}

	// "비서에서 이미지가 안 붙여넣어져. 일반 클로드세션처럼 사용할 수 있어야해" — raw 터미널
	// (XTerm)에 붙여넣으면 claude CLI 자신이 클립보드 이미지를 잡아서 처리하지만, 비서는 그 화면
	// 대신 채팅 UI라(§ 위 "대화형으로 가자") 일반 <textarea>는 이미지 자체를 못 받는다. 저장 후
	// 절대경로를 텍스트로 얹어 보내면 비서(claude)가 자기 Read 툴로 그 파일을 직접 열어본다 —
	// 눈에 보이는 이미지 미리보기 대신 텍스트 참조라 단순하지만, 실제로 보게 하는 목적은 같다.
	const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = async (e) => {
		const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'))
		if (!item) return
		e.preventDefault()
		const file = item.getAsFile()
		if (!file) return
		setUploadingImage(true)
		try {
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader()
				reader.onload = () => resolve(String(reader.result))
				reader.onerror = () => reject(reader.error)
				reader.readAsDataURL(file)
			})
			const r = await uploadImage(dataUrl)
			if (!r.ok || !r.path) {
				setError(t(r.error || '이미지 업로드 실패'))
				return
			}
			const insertText = tp('[이미지 첨부: {path}]', { path: r.path })
			const ta = textareaRef.current
			setDraft((d) => {
				const start = ta ? (ta.selectionStart ?? d.length) : d.length
				const end = ta ? (ta.selectionEnd ?? d.length) : d.length
				return d.slice(0, start) + insertText + d.slice(end)
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setUploadingImage(false)
		}
	}

	return (
		<div className={styles.wrap}>
			<div className={styles.head}>
				<StatusDot color={state?.running ? 'green' : 'muted'} pulse={!!state?.running} />
				<span className={styles.state}>{t('오버마인드')}</span>
				{state?.modelLabel && <span className={`m ${styles.meta}`}>{state.modelLabel}</span>}
				{/* "계속 유지(백그라운드 실행 & 하나의 세션)" — tmux가 있을 때만(§control.cjs) 진짜로
				    서버 재시작에도 살아있다는 걸 사용자가 확인할 수 있게. */}
				{state?.persistent && <span className={`m ${styles.meta}`}>{t('· 백그라운드 유지')}</span>}
				<div style={{ flex: 1 }} />
				<button className={styles.btn} disabled={busy} onClick={restart}>
					{t('재시작')}
				</button>
			</div>
			{state?.running ? (
				<>
					<div className={styles.body}>
						<div className={styles.threadScroll} ref={bodyRef}>
							{turns.length === 0 && !pendingUser && (
								<div className={styles.empty}>
									<span className={styles.emptyDot} />
									{t('오버마인드에게 태스크 생성, 일정 조정, 크론잡 등을 자연어로 부탁해보세요.')}
								</div>
							)}
							{/* "일반적인 챗봇 디자인처럼" — ChatGPT/Claude.ai 웹 챗 기준(구도만, 색·토큰은
							    OpenTask 것 그대로 § PRODUCT.md Brand Commitments). 좁은 탭 폭에 꽉 채워
							    읽던 것을 중앙 정렬된 읽기 폭 컬럼(.thread)으로 — 넓은 창에서도 한 줄이
							    너무 길어지지 않는다. 사람 턴만 말풍선(우측 정렬 pill), 비서 턴은 카드
							    없이 평문(좌측, 컬럼 폭 그대로) — Claude.ai가 쓰는 비대칭 관례를 따른다.
							    "비서가 말했다는걸 더 티나게해줘 잘 안보여" — 작은 점+글자 라벨은 카드가
							    없어지니 눈에 잘 안 띄었다. 탭 아이콘에 이미 쓰던 비서 아이콘(§ tabIcons.tsx
							    control — 말풍선, 이 시스템에서 이미 "비서"를 뜻하는 그 아이콘)을 그대로
							    가져와 ChatGPT/Claude.ai식 좌측 아바타로 키운다 — 새 도상 발명 대신 이미
							    있는 신호를 더 크게. */}
							<div className={styles.thread}>
								{turns.map((t) => (
									<div key={t.id} className={`${styles.turnRow} ${t.role === 'user' ? styles.turnRowUser : styles.turnRowAssistant}`}>
										{t.role === 'assistant' && <span className={styles.avatar}>{CONTROL_AVATAR_ICON}</span>}
										<div className={`${styles.bubble} ${t.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
											{t.parts.map((p, i) => (
												<TurnPart key={i} part={p} />
											))}
										</div>
									</div>
								))}
								{pendingUser && (
									<div className={`${styles.turnRow} ${styles.turnRowUser}`}>
										<div className={`${styles.bubble} ${styles.bubbleUser}`} style={{ opacity: 0.6 }}>
											{pendingUser}
										</div>
									</div>
								)}
								{/* "비서가 지금 뭘 하고 있는지" — claude가 답할 때까지 몇 초~몇십 초 아무 신호도 없으면
								    멈춘 것처럼 보인다(craft-floor "States: loading"). 아직 아무 tool도 안 불렀으면
								    점 3개, tool을 부르는 중이면("작은 변화도 채팅으로 알려줘서") 그 활동을 문장으로. */}
								{generating && (
									<div className={`${styles.turnRow} ${styles.turnRowAssistant}`}>
										<span className={styles.avatar}>{CONTROL_AVATAR_ICON}</span>
										<div className={`${styles.bubble} ${styles.bubbleAssistant} ${styles.thinking}`}>
											{activeToolLabel ? (
												<span className={styles.thinkingLabel}>{activeToolLabel}…</span>
											) : (
												<>
													<span className={styles.thinkingDot} />
													<span className={styles.thinkingDot} />
													<span className={styles.thinkingDot} />
												</>
											)}
										</div>
									</div>
								)}
							</div>
						</div>
						{canvasItems.length > 0 && (
							<div className={styles.canvasRail}>
								{canvasItems.map((item) => (
									<CanvasCard key={item.id} item={item} />
								))}
							</div>
						)}
					</div>
					<div className={styles.inputArea}>
						{uploadingImage && <div className={styles.imageUploading}>{t('이미지 업로드 중…')}</div>}
						{/* "일반적인 챗봇 디자인처럼" — ChatGPT/Claude.ai의 떠 있는 pill형 입력창 관례.
						    구분선 딸린 평평한 바 대신 elevation 있는 둥근 컴포저, 전송은 아이콘 원형
						    버튼으로. */}
						<div className={styles.composer}>
							<textarea
								ref={textareaRef}
								className={styles.textarea}
								value={draft}
								placeholder={t('오버마인드에게 메시지… (이미지 붙여넣기 가능)')}
								onChange={(e) => setDraft(e.target.value)}
								onPaste={handlePaste}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault()
										send()
									}
								}}
							/>
							{generating ? (
								<button className={styles.sendBtn} disabled={interrupting} onClick={interrupt} title={t('정지')}>
									{STOP_ICON}
								</button>
							) : (
								<button className={styles.sendBtn} disabled={!draft.trim() || sending} onClick={send} title={t('보내기 (Enter)')}>
									{SEND_ICON}
								</button>
							)}
						</div>
					</div>
				</>
			) : (
				<div className={styles.starting}>{error ?? t('오버마인드 세션 시작 중…')}</div>
			)}
		</div>
	)
}
