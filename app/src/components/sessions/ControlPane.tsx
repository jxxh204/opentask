import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { getControlState, startControl, stopControl, askControl, getControlTranscript } from '../../api/control'
import type { ControlState, ChatTurn, ChatPart } from '../../api/control'
import StatusDot from '../common/StatusDot'
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
function ToolPart({ name, input, result }: { name: string; input: unknown; result: string | null }) {
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
				{name}
				{inputStr && inputStr !== '{}' ? ` — ${inputStr.slice(0, 80)}${inputStr.length > 80 ? '…' : ''}` : ''}
			</summary>
			<div className={styles.toolBody}>
				<div className={styles.toolBodyLabel}>입력</div>
				{inputStr}
				{result != null && (
					<>
						<div className={styles.toolBodyLabel} style={{ marginTop: 6 }}>
							결과
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
	const [state, setState] = useState<ControlState | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [turns, setTurns] = useState<ChatTurn[]>([])
	const [draft, setDraft] = useState('')
	const [sending, setSending] = useState(false)
	const [pendingUser, setPendingUser] = useState<string | null>(null)
	const startedRef = useRef(false)
	const turnCountAtSendRef = useRef(0)
	const bodyRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		let cancelled = false
		getControlState()
			.then((s) => {
				if (cancelled) return
				setState(s)
				if (!s.running && !startedRef.current) {
					startedRef.current = true
					startControl()
						.then((r) => !cancelled && (r.ok ? setState({ running: true, session: r.session ?? null, cwd: r.cwd, modelLabel: r.modelLabel }) : setError(r.error || '세션 생성 실패')))
						.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
				}
			})
			.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
		return () => {
			cancelled = true
		}
	}, [])

	// 대화 기록 폴링 — 세션이 떠 있는 동안만. claude가 응답을 다 쓰기까지 몇 초 걸리니 2초 주기로 충분하다.
	useEffect(() => {
		if (!state?.running) return
		let cancelled = false
		const tick = () => {
			getControlTranscript()
				.then((r) => {
					if (cancelled || !r.ok) return
					setTurns(r.turns)
					if (r.turns.length > turnCountAtSendRef.current) setPendingUser(null)
				})
				.catch(() => {})
		}
		tick()
		const id = setInterval(tick, 2000)
		return () => {
			cancelled = true
			clearInterval(id)
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
			if (r.ok) setState({ running: true, session: r.session ?? null, cwd: r.cwd, modelLabel: r.modelLabel })
			else setError(r.error || '세션 생성 실패')
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
			if (!r.ok) setError(r.error || '전송 실패')
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setSending(false)
		}
	}

	return (
		<div className={styles.wrap}>
			<div className={styles.head}>
				<StatusDot color={state?.running ? 'green' : 'muted'} pulse={!!state?.running} />
				<span className={styles.state}>비서</span>
				{state?.modelLabel && <span className={`m ${styles.meta}`}>{state.modelLabel}</span>}
				<div style={{ flex: 1 }} />
				<button className={styles.btn} disabled={busy} onClick={restart}>
					재시작
				</button>
			</div>
			{state?.running ? (
				<>
					<div className={styles.body} ref={bodyRef}>
						{turns.length === 0 && !pendingUser && <div className={styles.empty}>비서에게 태스크 생성, 일정 조정, 크론잡 등을 자연어로 부탁해보세요.</div>}
						{turns.map((t) => (
							<div key={t.id} className={`${styles.turnRow} ${t.role === 'user' ? styles.turnRowUser : styles.turnRowAssistant}`}>
								<div className={styles.turnLabel}>{t.role === 'user' ? '나' : '비서'}</div>
								<div className={`${styles.bubble} ${t.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
									{t.parts.map((p, i) => (
										<TurnPart key={i} part={p} />
									))}
								</div>
							</div>
						))}
						{pendingUser && (
							<div className={`${styles.turnRow} ${styles.turnRowUser}`}>
								<div className={styles.turnLabel}>나</div>
								<div className={`${styles.bubble} ${styles.bubbleUser}`} style={{ opacity: 0.6 }}>
									{pendingUser}
								</div>
							</div>
						)}
					</div>
					<div className={styles.inputRow}>
						<textarea
							className={styles.textarea}
							value={draft}
							placeholder="비서에게 메시지…"
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault()
									send()
								}
							}}
						/>
						<button className={styles.sendBtn} disabled={!draft.trim() || sending} onClick={send}>
							보내기
						</button>
					</div>
				</>
			) : (
				<div className={styles.starting}>{error ?? '비서 세션 시작 중…'}</div>
			)}
		</div>
	)
}
