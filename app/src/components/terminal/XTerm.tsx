import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// 진짜 임베드 터미널 — xterm.js ↔ (백엔드) node-pty가 tmux 세션에 attach. WebSocket 양방향.
export default function XTerm({ session, cwd, onClose }: { session: string; cwd?: string; onClose?: () => void }) {
	const hostRef = useRef<HTMLDivElement>(null)
	const [maximized, setMaximized] = useState(false)
	// 확대 상태에서 ESC → 축소 (ResizeObserver가 크기 변화 감지해 자동 fit)
	useEffect(() => {
		if (!maximized) return
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaximized(false) }
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [maximized])

	useEffect(() => {
		if (!hostRef.current) return
		const term = new Terminal({
			// Menlo/SFMono엔 한글 글리프가 없어 한글이 빈칸으로 깨짐 → 한글 폴백(D2Coding/Apple SD Gothic Neo) 추가
			fontFamily: "'JetBrains Mono', 'D2Coding', ui-monospace, SFMono-Regular, Menlo, Monaco, 'Apple SD Gothic Neo', 'Malgun Gothic', monospace",
			fontSize: 12.5,
			theme: { background: '#05080d', foreground: '#c9d4e0', cursor: '#58a6ff' },
			cursorBlink: true,
			scrollback: 5000,
		})
		const fit = new FitAddon()
		term.loadAddon(fit)
		term.open(hostRef.current)
		try {
			fit.fit()
		} catch {
			/* noop */
		}

		const proto = location.protocol === 'https:' ? 'wss' : 'ws'
		// cwd 전달 → 세션이 아직 없으면 그 워크트리에서 생성(-c). 이미 있으면 attach라 무시됨.
		const cwdQ = cwd ? `&cwd=${encodeURIComponent(cwd)}` : ''
		const ws = new WebSocket(`${proto}://${location.host}/term?session=${encodeURIComponent(session)}&cols=${term.cols}&rows=${term.rows}${cwdQ}`)
		ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '')
		ws.onclose = () => term.write('\r\n\x1b[90m[연결 종료]\x1b[0m\r\n')
		ws.onerror = () => term.write('\r\n\x1b[31m[연결 오류]\x1b[0m\r\n')
		const sendResize = () => {
			if (ws.readyState === WebSocket.OPEN) ws.send('\x00' + term.cols + ',' + term.rows)
		}
		ws.onopen = () => {
			term.focus()
			sendResize()
		}
		const onData = term.onData((d) => {
			if (ws.readyState === WebSocket.OPEN) ws.send(d)
		})

		const ro = new ResizeObserver(() => {
			try {
				fit.fit()
				sendResize()
			} catch {
				/* noop */
			}
		})
		ro.observe(hostRef.current)

		return () => {
			ro.disconnect()
			onData.dispose()
			try {
				ws.close()
			} catch {
				/* noop */
			}
			term.dispose()
		}
	}, [session, cwd])

	return (
		<div className={`xterm-wrap ${maximized ? 'maximized' : ''}`}>
			<div className="xterm-bar">
				<span className="xterm-name">🖥️ {session}</span>
				<span style={{ flex: 1 }} />
				<button className="btn-dry xterm-max" onClick={() => setMaximized((m) => !m)} title={maximized ? '축소 (ESC)' : '전체화면으로 확대'}>
					{maximized ? '⤡ 축소' : '⤢ 확대'}
				</button>
				{onClose && (
					<button className="btn-dry" onClick={onClose} title="패널 닫기 (세션은 유지)">
						✕ 닫기
					</button>
				)}
			</div>
			<div className="xterm-host" ref={hostRef} />
		</div>
	)
}
