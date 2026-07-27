import { useState } from 'react'
import type { MonitorFinding } from '../../api/monitor'
import { dispatchMonitorAction } from '../../api/monitor'

const LEVEL_COLOR: Record<string, string> = { bad: 'var(--red)', warn: 'var(--amber)', good: 'var(--green)', info: 'var(--violet)' }

export default function AlertActionRow({ finding }: { finding: MonitorFinding }) {
	const [open, setOpen] = useState(false)
	const [instruction, setInstruction] = useState('')
	const [busy, setBusy] = useState(false)
	const [result, setResult] = useState<{ summary: string; suggestion: string | null } | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function send() {
		if (!instruction.trim() || busy) return
		setBusy(true)
		setError(null)
		try {
			const r = await dispatchMonitorAction(finding.key, instruction.trim())
			if (r.ok && r.result) {
				setResult({ summary: r.result.summary, suggestion: r.result.suggestion })
				setOpen(false)
				setInstruction('')
			} else {
				setError(r.error || '조사 실패')
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 12px', borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--line2)' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
				<span style={{ width: 7, height: 7, borderRadius: '50%', background: LEVEL_COLOR[finding.level] || 'var(--t3)', flex: 'none' }} />
				<span style={{ fontSize: 12, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{finding.title}</span>
				{!open && (
					<button
						disabled={busy}
						onClick={() => {
							setOpen(true)
							setResult(null)
							setError(null)
						}}
						style={{ height: 26, padding: '0 10px', borderRadius: 7, background: 'var(--violet)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700, flex: 'none' }}
					>
						지시
					</button>
				)}
			</div>
			{open && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
					<textarea
						className="fin"
						value={instruction}
						onChange={(e) => setInstruction(e.target.value)}
						placeholder="이 이슈에 대해 조사할 내용을 지시… (코드는 수정하지 않고 원인·제안만 회수)"
						rows={2}
						style={{ resize: 'vertical', fontFamily: 'inherit' }}
					/>
					<div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
						<button
							onClick={() => {
								setOpen(false)
								setInstruction('')
							}}
							style={{ height: 26, padding: '0 10px', borderRadius: 7, background: 'transparent', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--t2)', fontSize: 11 }}
						>
							취소
						</button>
						<button
							disabled={busy || !instruction.trim()}
							onClick={send}
							style={{ height: 26, padding: '0 10px', borderRadius: 7, background: 'var(--violet)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700, opacity: busy ? 0.6 : 1 }}
						>
							{busy ? '조사 중…' : '전송'}
						</button>
					</div>
				</div>
			)}
			{error && <div style={{ fontSize: 11, color: 'var(--red)' }}>{error}</div>}
			{result && (
				<div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.5, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
					{result.summary}
					{result.suggestion && (
						<div style={{ marginTop: 4, color: 'var(--t3)' }}>
							제안: {result.suggestion}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
