import { useEffect, useRef, useState } from 'react'
import { getControlState, startControl, stopControl } from '../../api/control'
import type { ControlState } from '../../api/control'
import StatusDot from '../common/StatusDot'
import XTerm from '../terminal/XTerm'
import styles from './ControlPane.module.css'

// "관제" — 태스크 지휘자(OrchestratorPane)와 이름·자리를 분리한 최상위 에이전트. 특정 태스크가
// 아니라 앱 전체(캘린더 일정, 크론잡, 운영 설정)를 대화로 조작한다(server/control.cjs, MCP 툴
// opentask-control). OrchestratorPane의 conductor와 같은 패턴 — raw 터미널이 주 콘텐츠, 탭을 열면
// 버튼 없이 바로 세션이 뜬다.
export default function ControlPane() {
	const [state, setState] = useState<ControlState | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const startedRef = useRef(false)

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

	async function restart() {
		setBusy(true)
		try {
			await stopControl()
			const r = await startControl()
			if (r.ok) setState({ running: true, session: r.session ?? null, cwd: r.cwd, modelLabel: r.modelLabel })
			else setError(r.error || '세션 생성 실패')
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className={styles.wrap}>
			<div className={styles.head}>
				<StatusDot color={state?.running ? 'green' : 'muted'} pulse={!!state?.running} />
				<span className={styles.state}>관제</span>
				{state?.modelLabel && <span className={`m ${styles.meta}`}>{state.modelLabel}</span>}
				<div style={{ flex: 1 }} />
				<button className={styles.btn} disabled={busy} onClick={restart}>
					재시작
				</button>
			</div>
			{state?.running && state.session ? (
				<div className={styles.termHost}>
					<XTerm session={state.session} cwd={state.cwd} modelLabel={state.modelLabel} />
				</div>
			) : (
				<div className={styles.starting}>{error ?? '관제 세션 시작 중…'}</div>
			)}
		</div>
	)
}
