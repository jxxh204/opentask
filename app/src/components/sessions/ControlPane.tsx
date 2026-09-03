import { useEffect, useRef, useState, type ClipboardEventHandler } from 'react'
import { marked } from 'marked'
import {
	getControlState,
	startControl,
	stopControl,
	resetControl,
	askControl,
	getControlTranscript,
	uploadImage,
	interruptControl,
	getControlLivePrompt,
	sendControlLiveAction,
} from '../../api/control'
import type { ControlState, ChatTurn, ChatPart, LivePrompt, LiveAction } from '../../api/control'
import { updateOperatorSettings } from '../../api/setup'
import { openTermExternal } from '../../api/term'
import { useSessionsStore } from '../../store/useSessionsStore'
import StatusDot from '../common/StatusDot'
import XTerm from '../terminal/XTerm'
import { useT, useTp, translate } from '../../utils/i18n'
import overmindIcon from '../../assets/overmind-icon.png'
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
// "그냥 내가 준 이미지 그대로 사용해줘" — 손그림 표본함 아이콘 대신 사용자가 준 레퍼런스 이미지
// 그대로(§ tabIcons.tsx overmindIcon). 이미지 자체가 이미 어두운 배지라 .avatar의 violet 배경은
// 걷어내고(§ ControlPane.module.css .avatar) 이미지가 원형을 꽉 채우게 한다.
const CONTROL_AVATAR_ICON = <img src={overmindIcon} alt="" className={styles.avatarImg} />
// "유저가 직접 확인하는것도 쉬워야하는데" — 헤더의 "마지막 점검" 표시용(§ OrchestratorPane.tsx 등
// 여러 곳의 같은 이름 로컬 헬퍼와 동일 패턴 — 공유 모듈로 안 뽑고 그대로 복제).
function timeAgo(ts: number) {
	const min = Math.floor((Date.now() - ts) / 60000)
	if (min < 1) return translate('방금')
	if (min < 60) return `${min}m`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}h`
	return `${Math.floor(hr / 24)}d`
}
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
// 접어둔 기술적 디테일이라, 클릭해서 펼쳐야만 뭘 하는지 보였다. 하이브마인드가 실제로 쓰는 MCP 툴
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

// "질문이 안왔는데?" — 처음엔 대화 기록(jsonl) 폴링에서 tool_use를 파싱해 버튼으로 그렸는데, 실제
// 떠 있는 세션의 jsonl 파일을 직접 열어보니 AskUserQuestion의 tool_use 레코드 자체가 **사람이
// 답하기 전까진 파일에 전혀 안 쓰인다**(2026-09-01 실측). 그래서 대화 기록으로는 "지금 질문이 떠
// 있다"를 원천적으로 감지 못 한다 — 대신 살아있는 pty 화면을 직접 읽는 전용 폴링(§ api/control.ts
// getControlLivePrompt, server/control.cjs parseLivePrompt)을 쓴다. 클릭 하나가 곧 지금 화면 기준
// 키 하나(select/toggle/next/submit/cancel)라 옵션 인덱스가 화면과 어긋날 위험이 없다 — 서버가
// 매번 방금 읽은 실제 화면으로만 키를 계산한다(§ server/control.cjs sendLiveAction).
function LivePromptPanel({
	prompt,
	session,
	cwd,
	modelLabel,
}: {
	prompt: LivePrompt
	session: string
	cwd: string
	modelLabel: string | null
}) {
	const t = useT()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [showRaw, setShowRaw] = useState(false)
	// 클릭 직후엔 폴링이 아직 그 결과를 못 봤을 수 있다(§ 위 폴링 주기) — prompt 자체가 실제로
	// 바뀐 걸 확인할 때까지 busy를 유지해, 화면과 어긋난 채로 다음 클릭이 또 나가는 걸 막는다.
	const signature = JSON.stringify(prompt)
	const appliedRef = useRef(signature)
	useEffect(() => {
		if (signature !== appliedRef.current) {
			appliedRef.current = signature
			setBusy(false)
		}
	}, [signature])

	async function act(action: LiveAction) {
		if (busy) return
		setBusy(true)
		setError(null)
		try {
			const r = await sendControlLiveAction(action)
			if (!r.ok) {
				setError(t(r.error || '전송 실패'))
				setBusy(false)
			}
			// 성공하면 busy를 유지 — 위 useEffect가 화면이 실제로 바뀐 걸 확인한 뒤에만 풀어준다.
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
			setBusy(false)
		}
	}

	if (showRaw) {
		return (
			<div className={styles.rawAnswer}>
				<div className={styles.rawAnswerLabel}>{t('터미널에서 직접 화살표·Space·Enter로 답하세요(자유 입력 등).')}</div>
				<div className={styles.rawAnswerHost}>
					<XTerm session={session} cwd={cwd} modelLabel={modelLabel} />
				</div>
			</div>
		)
	}

	const rawToggle = (
		<button type="button" className={styles.askRawToggle} onClick={() => setShowRaw(true)}>
			{t('자유 입력이 필요하면 터미널로 전환')}
		</button>
	)

	if (prompt.kind === 'review') {
		return (
			<div className={styles.askPanel}>
				<div className={styles.askQuestion}>
					<div className={styles.askQuestionText}>{t('답변을 확인하고 제출하세요.')}</div>
					{prompt.summary && <div className={styles.askOptionDesc}>{prompt.summary}</div>}
				</div>
				{error && <div className={styles.askError}>{error}</div>}
				<div className={styles.askFooter}>
					{rawToggle}
					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" className={styles.btn} disabled={busy} onClick={() => act({ type: 'cancel' })}>
							{t('취소')}
						</button>
						<button type="button" className={styles.askSubmit} disabled={busy} onClick={() => act({ type: 'submit' })}>
							{busy ? t('전송 중…') : t('답변 제출')}
						</button>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className={styles.askPanel}>
			<div className={styles.askQuestion}>
				{prompt.question && <div className={styles.askQuestionText}>{prompt.question}</div>}
				<div className={styles.askOptions}>
					{prompt.options.map((opt, oi) => (
						<button
							key={oi}
							type="button"
							className={`${styles.askOption} ${opt.checked ? styles.askOptionSelected : ''}`}
							disabled={busy}
							onClick={() => act({ type: prompt.multiSelect ? 'toggle' : 'select', index: oi })}
						>
							{prompt.multiSelect && <span className={styles.askCheckbox}>{opt.checked ? '☑' : '☐'}</span>}
							<span className={styles.askOptionLabel}>{opt.label}</span>
						</button>
					))}
				</div>
			</div>
			{error && <div className={styles.askError}>{error}</div>}
			<div className={styles.askFooter}>
				{rawToggle}
				{prompt.multiSelect && (
					<button type="button" className={styles.askSubmit} disabled={busy} onClick={() => act({ type: 'next' })}>
						{busy ? t('전송 중…') : t('다음')}
					</button>
				)}
			</div>
		</div>
	)
}

// onClose는 도킹 패널(§ SessionShell.tsx controlDock)에서만 넘어온다 — 전체 화면 노드(CONTROL_NODE_ID)나
// 폴더/태스크 탭에 끼워 넣은 경우엔 각자 자기 탭 닫기가 있어 안 넘긴다(그때는 이 버튼 자체가 안 뜬다).
export default function ControlPane({ onClose }: { onClose?: () => void } = {}) {
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

	const lastTurn = turns[turns.length - 1]
	const lastPart = lastTurn?.parts[lastTurn.parts.length - 1]
	// "질문이 안왔는데?" — AskUserQuestion은 사람이 답하기 전까진 대화 기록(jsonl)에 안 나타난다(§
	// server/control.cjs getLivePrompt 주석, 2026-09-01 실측) — 대화 기록(turns) 기반 감지는 원천적으로
	// 불가능해서 별도 폴링(§ 아래 liveTick)으로 살아있는 pty 화면을 직접 읽는다.
	const [live, setLive] = useState<{ waiting: boolean; working: boolean; prompt: LivePrompt | null }>({ waiting: false, working: false, prompt: null })
	// "멈추기도 동작안하고 채팅창도 꺠져" — 예전엔 "마지막 턴이 user로 끝나 있으면 생성 중"으로
	// 추측했는데, /compact 같은 로컬 명령 뒤엔 응답이 영영 안 온다(§ transcript.cjs
	// isSyntheticUserContent 주석) — 그러면 이 추측이 영원히 true로 굳어 점 3개가 안 꺼지고, 정지
	// 버튼(ESC 전송)도 이미 유휴인 CLI엔 먹힐 게 없다(2026-09-02 실측). live.working이 실제 pty
	// 상태(§ getLivePrompt) 기준이라 이제 이걸로만 판단한다 — pendingUser는 보낸 직후 폴링이 한 번
	// 돌기 전까지의 짧은 낙관적 표시.
	const generating = !!pendingUser || live.working
	// "작은 변화도 채팅으로 알려줘서 진행중인 느낌을 줘야해" — 지금 뭘 하고 있는지 알 수 있으면(마지막
	// 파트가 아직 진행 중인 tool 호출) 점 3개 대신 그 활동을 문장으로 보여준다.
	const activeToolLabel = !pendingUser && lastTurn?.role === 'assistant' && lastPart?.kind === 'tool' ? toolLabel(lastPart.name, t) : null
	// 대화 기록 폴링 — 세션이 떠 있는 동안만. 생성 중엔 체감 반응성을 위해 1초, 유휴 땐 2초로
	// 되돌아간다(불필요한 트래픽을 늘리지 않음) — setInterval 대신 매 tick마다 스스로 다음 지연을
	// 고르는 self-scheduling 루프라 generating이 바뀔 때마다 타이머를 새로 만들 필요가 없다.
	const generatingRef = useRef(false)
	useEffect(() => {
		generatingRef.current = generating
	})
	// live-prompt 폴링 — pty 화면 스냅샷만 읽는 가벼운 로컬 호출이라(§ server/control.cjs getLivePrompt)
	// 대화 기록 폴링과 별개로 항상 1초 고정 — 질문이 뜬 순간을 놓치지 않는 게 트래픽보다 중요하다.
	useEffect(() => {
		if (!state?.running) return
		let cancelled = false
		let timer: ReturnType<typeof setTimeout>
		const tick = () => {
			getControlLivePrompt()
				.then((r) => {
					if (cancelled || !r.ok) return
					setLive({ waiting: r.waiting, working: r.working, prompt: r.prompt })
				})
				.catch(() => {})
				.finally(() => {
					if (!cancelled) timer = setTimeout(tick, 1000)
				})
		}
		tick()
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [state?.running])
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

	// "하이브 마인드 스크롤이 계속 고정되고있어" — turns는 1~2초마다 폴링으로 새 배열 참조가 들어오고
	// (내용이 실제로 안 바뀌었어도), 그때마다 이 effect가 다시 돌아 무조건 맨 아래로 끌어내렸다 —
	// 사람이 스크롤을 올려 지난 대화를 읽는 중이어도 다음 폴링 tick에 바로 도로 끌려 내려갔다. 이미
	// 바닥 근처(=방금까지 실시간으로 지켜보던 중)일 때만 자동 스크롤하고, 위로 올려 읽고 있으면 그
	// 자리 그대로 둔다 — 일반적인 채팅 UI의 "스마트 오토스크롤" 관례.
	// "스크롤이 계속 맨 위라 작업이 어려워" — 위 nearBottom 판정은 패널을 처음 열 때도 그대로 적용돼
	// 문제였다. 마운트 직후는 scrollTop이 항상 0이라, 쌓인 대화가 길면(scrollHeight가 큼) 첫 판정부터
	// nearBottom이 false가 되어 영원히 맨 위에 멈춰 있었다 — 열 때 한 번은 판정 없이 무조건 바닥으로.
	const didInitialScrollRef = useRef(false)
	useEffect(() => {
		const el = bodyRef.current
		if (!el) return
		if (!didInitialScrollRef.current) {
			if (turns.length === 0 && !pendingUser) return // 아직 보여줄 내용이 없다 — 다음 업데이트를 기다린다
			didInitialScrollRef.current = true
			el.scrollTo({ top: el.scrollHeight })
			return
		}
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
		if (nearBottom) el.scrollTo({ top: el.scrollHeight })
	}, [turns, pendingUser, live.waiting])

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

	// "세션을 초기화하는거나.. 하이브마인드를 자주사용해서 사용성 개선이 필요해" — restart()는 이전
	// 대화를 그대로 이어받는다(claude --continue) — 이건 그 대화 자체를 안 이어받는 진짜 새 시작
	// (§ server/control.cjs reset). 되돌릴 수 없어 restart처럼 확인 없이 바로 누르면 위험하니 확인 한 번.
	async function reset() {
		if (!confirm(t('지금 대화를 초기화하고 완전히 새로 시작합니다. 계속할까요?'))) return
		setBusy(true)
		try {
			setTurns([])
			const r = await resetControl()
			if (r.ok) setState((prev) => ({ ...prev, running: true, session: r.session ?? null, cwd: r.cwd, modelLabel: r.modelLabel }))
			else setError(t(r.error || '초기화 실패'))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	// "하이브마인드 전체 운영 모드" 토글 — 값 자체는 Settings에 저장되고(server/settings.cjs opsMode),
	// getControlState()가 그대로 미러해서 돌려준다(§ state.opsMode). 이 함수는 그 값만 뒤집는다.
	const [opsModeBusy, setOpsModeBusy] = useState(false)
	async function toggleOpsMode() {
		if (opsModeBusy || !state) return
		setOpsModeBusy(true)
		const next = !state.opsMode
		try {
			await updateOperatorSettings({ opsMode: next })
			setState((prev) => (prev ? { ...prev, opsMode: next } : prev))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setOpsModeBusy(false)
		}
	}
	// "터미널을 고스티로 열수는 없는거야?" — 이미 있던 기능이다(§ XTerm.tsx openExternal, 설정의
	// "Ghostty로 보기"). 다만 지금까진 raw 터미널 폴백(질문 파싱 실패·자유 입력 전환)이 떴을 때만
	// 그 안에 끼워 넣은 XTerm의 버튼으로만 만날 수 있었다 — 채팅 뷰가 기본이라 평소엔 안 보였다.
	// 헤더에 항상 노출해 언제든 실제 Ghostty로 바로 붙을 수 있게 한다(§ term.cjs openExternal —
	// tmux면 지금 화면 그대로 attach, 아니면 그 워크트리에서 새 셸).
	const ghosttyEnabled = useSessionsStore((s) => s.terminalGhostty)
	const [openingGhostty, setOpeningGhostty] = useState(false)
	async function openInGhostty() {
		if (openingGhostty || !state?.session) return
		setOpeningGhostty(true)
		try {
			const r = await openTermExternal(state.session)
			if (!r.ok) setError(t(r.error || 'Ghostty 열기 실패'))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setOpeningGhostty(false)
		}
	}
	// "유저가 직접 확인하는것도 쉬워야하는데" — opsMode/lastOpsTickAt은 다른 창에서 토글했거나 서버의
	// 15분 tick이 방금 돌았을 수 있어, 마운트 시 한 번 받은 state로는 낡을 수 있다. 채팅 폴링만큼
	// 자주일 필요는 없어(15분 주기 이벤트라) 15초마다만 가볍게 다시 확인.
	useEffect(() => {
		if (!state?.running) return
		let cancelled = false
		const id = window.setInterval(() => {
			getControlState()
				.then((s) => {
					if (!cancelled) setState((prev) => (prev ? { ...prev, opsMode: s.opsMode, lastOpsTickAt: s.lastOpsTickAt, stalled: s.stalled } : prev))
				})
				.catch(() => {})
		}, 15000)
		return () => {
			cancelled = true
			window.clearInterval(id)
		}
	}, [state?.running])

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
				<img src={overmindIcon} alt="" className={styles.headIcon} />
				<StatusDot color={state?.running ? 'green' : 'muted'} pulse={!!state?.running} />
				<span className={styles.state}>{t('하이브마인드')}</span>
				{state?.modelLabel && <span className={`m ${styles.meta}`}>{state.modelLabel}</span>}
				{/* "계속 유지(백그라운드 실행 & 하나의 세션)" — tmux가 있을 때만(§control.cjs) 진짜로
				    서버 재시작에도 살아있다는 걸 사용자가 확인할 수 있게. */}
				{state?.persistent && <span className={`m ${styles.meta}`}>{t('· 백그라운드 유지')}</span>}
				<div style={{ flex: 1 }} />
				{/* "하이브마인드 전체 운영 모드... 유저가 직접 확인하는것도 쉬워야하는데" — 토글 상태 옆에
				    바로 "마지막 점검"을 붙여서, 채팅을 스크롤하지 않고도 정말 돌고 있는지 한눈에 확인
				    가능하게(§ server/control.cjs runOpsModeTick, lastOpsTickAt). */}
				<button
					className={`${styles.btn} ${state?.opsMode ? styles.btnActive : ''}`}
					disabled={opsModeBusy || !state}
					onClick={toggleOpsMode}
					title={t('켜면 15분마다 전체 태스크 그래프를 점검하고 막힌 태스크에 지시합니다')}
				>
					{t('운영 모드')} {state?.opsMode ? t('켜짐') : t('꺼짐')}
				</button>
				{state?.opsMode && state?.lastOpsTickAt && (
					<span className={`m ${styles.meta}`} title={new Date(state.lastOpsTickAt).toLocaleString()}>
						{tp('· 마지막 점검 {time}', { time: timeAgo(state.lastOpsTickAt) })}
					</span>
				)}
				{ghosttyEnabled && (
					<button className="btn-dry" disabled={openingGhostty || !state?.session} onClick={openInGhostty} title={t('워크트리 경로에서 Ghostty를 엽니다(tmux로 유지 중이면 지금 화면 그대로 이어봅니다)')}>
						↗ {t('고스티에서 열기')}
					</button>
				)}
				<button className={styles.btn} disabled={busy} onClick={restart} title={t('같은 대화를 이어서 세션만 새로 띄웁니다')}>
					{t('재시작')}
				</button>
				<button className={styles.btn} disabled={busy} onClick={reset} title={t('지금 대화를 버리고 완전히 새로 시작합니다')}>
					{t('초기화')}
				</button>
				{onClose && (
					<button className={styles.btn} onClick={onClose} title={t('닫기')}>
						×
					</button>
				)}
			</div>
			{state?.running ? (
				<>
					<div className={styles.body}>
						<div className={styles.threadScroll} ref={bodyRef}>
							{turns.length === 0 && !pendingUser && (
								<div className={styles.empty}>
									<span className={styles.emptyDot} />
									{t('하이브마인드에게 태스크 생성, 일정 조정, 크론잡 등을 자연어로 부탁해보세요.')}
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
								{turns.map((turn) =>
									// "명시도 해줘" — 운영 모드가 자동으로 넣은 점검 턴은 사람 말풍선이 아니라 구분선
									// 형태로(§ server/transcript.cjs auto). 채팅을 쭉 스크롤하다가도 "이건 내가 친 게
									// 아니라 자동 점검이었구나"를 바로 알 수 있게 — 새 화면 없이 이미 보는 채팅 안에서.
									turn.auto ? (
										<div key={turn.id} className={styles.autoTickRow}>
											<span className={styles.autoTickBadge}>{t('⏱ 자동 점검')}</span>
											<span className={styles.autoTickTime}>{new Date(turn.ts).toLocaleTimeString()}</span>
										</div>
									) : (
										<div key={turn.id} className={`${styles.turnRow} ${turn.role === 'user' ? styles.turnRowUser : styles.turnRowAssistant}`}>
											{turn.role === 'assistant' && <span className={styles.avatar}>{CONTROL_AVATAR_ICON}</span>}
											<div className={`${styles.bubble} ${turn.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
												{turn.parts.map((p, i) => (
													<TurnPart key={i} part={p} />
												))}
											</div>
										</div>
									),
								)}
								{pendingUser && (
									<div className={`${styles.turnRow} ${styles.turnRowUser}`}>
										<div className={`${styles.bubble} ${styles.bubbleUser}`} style={{ opacity: 0.6 }}>
											{pendingUser}
										</div>
									</div>
								)}
								{live.waiting && state?.session && live.prompt && (
									<LivePromptPanel prompt={live.prompt} session={state.session} cwd={state.cwd} modelLabel={state.modelLabel} />
								)}
								{live.waiting && state?.session && !live.prompt && (
									<div className={styles.rawAnswer}>
										<div className={styles.rawAnswerLabel}>
											{t('하이브마인드가 방향키로 답해야 하는 질문을 띄웠습니다 — 여기서 직접 클릭·키보드로 답하세요.')}
										</div>
										<div className={styles.rawAnswerHost}>
											<XTerm session={state.session} cwd={state.cwd} modelLabel={state.modelLabel} />
										</div>
									</div>
								)}
								{/* "비서가 지금 뭘 하고 있는지" — claude가 답할 때까지 몇 초~몇십 초 아무 신호도 없으면
								    멈춘 것처럼 보인다(craft-floor "States: loading"). 아직 아무 tool도 안 불렀으면
								    점 3개, tool을 부르는 중이면("작은 변화도 채팅으로 알려줘서") 그 활동을 문장으로. */}
								{generating && !live.waiting && (
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
								placeholder={t('하이브마인드에게 메시지… (이미지 붙여넣기 가능)')}
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
				<div className={styles.starting}>{error ?? t('하이브마인드 세션 시작 중…')}</div>
			)}
		</div>
	)
}
