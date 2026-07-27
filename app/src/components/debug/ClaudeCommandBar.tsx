import { useDebugStore } from '../../store/useDebugStore'
import ThreadRow from './ThreadRow'

export default function ClaudeCommandBar() {
	const target = useDebugStore((s) => s.target)
	const attach = useDebugStore((s) => s.attach)
	const cmd = useDebugStore((s) => s.cmd)
	const setCmd = useDebugStore((s) => s.setCmd)
	const send = useDebugStore((s) => s.send)
	const threads = useDebugStore((s) => s.threads)
	const openThread = useDebugStore((s) => s.openThread)
	const drawerTab = useDebugStore((s) => s.drawerTab)

	const attachCount = Object.values(attach).filter(Boolean).length
	const canSend = !!cmd.trim() || attachCount > 0

	return (
		<div style={{ flex: 'none', borderTop: '1px solid var(--line2)', background: 'var(--card2)', padding: '11px 13px' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 9px', borderRadius: 7, background: 'rgba(155,130,232,.13)', border: '1px solid rgba(155,130,232,.3)' }}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
						<circle cx="6" cy="6" r="2.5" />
						<circle cx="6" cy="18" r="2.5" />
						<circle cx="18" cy="8" r="2.5" />
						<path d="M6 8.5v7M18 10.5c0 3-3 4-6 4.5" />
					</svg>
					<span className="m" style={{ fontSize: 10, color: '#c3b6f2' }}>
						{target.worktree}
					</span>
					<span style={{ fontSize: 9, color: 'var(--violet)' }}>의 Claude</span>
				</span>
				<span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
				<span style={{ fontSize: 10, color: 'var(--t3)' }}>연결됨</span>
				<span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: attachCount > 0 ? 'var(--blue)' : 'var(--t3)' }}>첨부 {attachCount}</span>
			</div>

			{threads.length > 0 && (
				<div className="scroll-y" style={{ maxHeight: 190, display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 10 }}>
					{threads.map((t) => (
						<ThreadRow key={t.id} thread={t} onOpen={() => openThread(t.id)} />
					))}
				</div>
			)}

			<textarea
				value={cmd}
				onChange={(e) => setCmd(e.target.value)}
				placeholder={drawerTab === 'network' ? '예) 이 요청 실패 원인 찾아서 고쳐줘 (체크한 네트워크 정보 첨부)' : '예) 이 버튼 로딩 상태 추가하고 중복 클릭 막아줘'}
				style={{ width: '100%', height: 60, padding: '9px 11px', borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--line2)', color: 'var(--ink)', fontSize: 11.5, lineHeight: 1.5, resize: 'none', outline: 'none', fontFamily: 'inherit' }}
			/>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
				<span style={{ fontSize: 9.5, color: 'var(--t3)', flex: 1 }}>체크한 {attachCount}개 컨텍스트가 함께 전송</span>
				<button onClick={send} disabled={!canSend} style={{ height: 32, padding: '0 16px', borderRadius: 8, background: canSend ? 'var(--violet)' : 'var(--line2)', border: 'none', cursor: canSend ? 'pointer' : 'default', color: canSend ? '#fff' : 'var(--t3)', fontSize: 12, fontWeight: 700 }}>
					전송
				</button>
			</div>
		</div>
	)
}
