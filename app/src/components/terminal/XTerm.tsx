import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTabsStore } from '../../store/useTabsStore'
import { useBrowserNavStore } from '../../store/useBrowserNavStore'
import { useT } from '../../utils/i18n'
import '@xterm/xterm/css/xterm.css'

// 진짜 임베드 터미널 — xterm.js ↔ (백엔드) node-pty가 tmux 세션에 attach. WebSocket 양방향.
// VSCode 통합 터미널처럼 패널 자체가 곧 터미널이다 — 별도 "확대" 토글 없이 패널 크기 그대로 쓴다.
export default function XTerm({ session, cwd, onClose, modelLabel }: { session: string; cwd?: string; onClose?: () => void; modelLabel?: string | null }) {
	const t = useT()
	const hostRef = useRef<HTMLDivElement>(null)
	// "이런 경우 복구가 안돼" — WS가 끊기면 [연결 오류]/[연결 종료]만 찍고 그대로 죽어있었다(재시도 없음).
	// 지수 백오프로 자동 재연결하고, 그래도 안 되면 사용자가 직접 누를 수 있게 버튼도 노출한다.
	const [disconnected, setDisconnected] = useState(false)
	const reconnectRef = useRef<() => void>(() => {})

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
		// "링크누르면 앱내 브라우저로 이동하게해줘" — 관제/지휘자 터미널 출력에 뜨는 노션 문서 링크 등을
		// 시스템 브라우저로 새 창을 띄우는 대신, 지금 활성 노드의 "브라우저" 탭에서 그대로 연다.
		term.loadAddon(
			new WebLinksAddon((event, uri) => {
				event.preventDefault()
				const nodeId = useTabsStore.getState().activeNodeId
				if (!nodeId) return
				useTabsStore.getState().openOrFocusTab(nodeId, 'browser')
				useBrowserNavStore.getState().request(nodeId, uri)
			}),
		)
		term.open(hostRef.current)
		try {
			fit.fit()
		} catch {
			/* noop */
		}

		const proto = location.protocol === 'https:' ? 'wss' : 'ws'
		// cwd 전달 → 세션이 아직 없으면 그 워크트리에서 생성(-c). 이미 있으면 attach라 무시됨.
		const cwdQ = cwd ? `&cwd=${encodeURIComponent(cwd)}` : ''
		const url = `${proto}://${location.host}/term?session=${encodeURIComponent(session)}&cols=${term.cols}&rows=${term.rows}${cwdQ}`

		let ws: WebSocket
		let disposed = false
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null
		let attempt = 0

		const sendResize = () => {
			if (ws && ws.readyState === WebSocket.OPEN) ws.send('\x00' + term.cols + ',' + term.rows)
		}

		function scheduleReconnect() {
			if (disposed) return
			attempt += 1
			const delay = Math.min(1000 * attempt, 8000)
			reconnectTimer = setTimeout(connect, delay)
		}

		function connect() {
			if (disposed) return
			ws = new WebSocket(url)
			ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '')
			ws.onopen = () => {
				attempt = 0
				setDisconnected(false)
				term.focus()
				sendResize()
			}
			ws.onclose = () => {
				if (disposed) return
				setDisconnected(true)
				term.write(`\r\n\x1b[90m[${t('연결 종료 — 자동 재연결 중…')}]\x1b[0m\r\n`)
				scheduleReconnect()
			}
			ws.onerror = () => {
				term.write(`\r\n\x1b[31m[${t('연결 오류')}]\x1b[0m\r\n`)
			}
		}

		reconnectRef.current = () => {
			if (reconnectTimer) clearTimeout(reconnectTimer)
			attempt = 0
			connect()
		}

		connect()

		const onData = term.onData((d) => {
			if (ws && ws.readyState === WebSocket.OPEN) ws.send(d)
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
			disposed = true
			if (reconnectTimer) clearTimeout(reconnectTimer)
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
		<div className="xterm-wrap">
			<div className="xterm-bar">
				<span className="xterm-name">🖥️ {session}</span>
				<span style={{ flex: 1 }} />
				{disconnected && (
					<button className="btn-dry" onClick={() => reconnectRef.current()} title={t('터미널에 다시 연결합니다')}>
						⟳ {t('재연결')}
					</button>
				)}
				{modelLabel && (
					<span className="xterm-model">
						<span className="dot" />
						{modelLabel}
					</span>
				)}
				{onClose && (
					<button className="btn-dry" onClick={onClose} title={t('패널 닫기 (세션은 유지)')}>
						✕ {t('닫기')}
					</button>
				)}
			</div>
			<div className="xterm-host" ref={hostRef} />
		</div>
	)
}
