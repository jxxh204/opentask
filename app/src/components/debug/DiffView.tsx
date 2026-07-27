export default function DiffView({ diff, spin }: { diff: string; spin: boolean }) {
	if (!diff) {
		return spin ? <div style={{ color: 'var(--t3)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>아직 변경사항이 없습니다 · 작업 중…</div> : null
	}
	return (
		<div>
			<div className="m" style={{ border: '1px solid var(--line2)', borderRadius: 10, overflow: 'hidden', fontSize: 11, lineHeight: 1.7 }}>
				<div style={{ padding: '7px 11px', background: 'var(--card2)', color: 'var(--t2)', borderBottom: '1px solid var(--line2)' }}>SendBar.tsx</div>
				<div style={{ padding: '9px 11px', color: 'var(--t2)' }}>
					<div style={{ color: 'var(--green)' }}>+ const onClick = useGuardedCallback(() =&gt; {'{'}</div>
					<div style={{ color: 'var(--green)' }}>+ &nbsp;&nbsp;if (sending) return;</div>
					<div style={{ color: 'var(--green)' }}>+ &nbsp;&nbsp;setSending(true);</div>
					<div style={{ color: 'var(--red)' }}>- const onClick = () =&gt; {'{'}</div>
					<div style={{ color: 'var(--t3)' }}>&nbsp;&nbsp;await send();</div>
				</div>
			</div>
			<div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
				<button style={{ height: 32, padding: '0 14px', borderRadius: 8, background: 'var(--green)', border: 'none', cursor: 'pointer', color: '#08240f', fontSize: 12, fontWeight: 700 }}>커밋</button>
				<button style={{ height: 32, padding: '0 13px', borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--t2)', fontSize: 12, fontWeight: 600 }}>폐기</button>
			</div>
		</div>
	)
}
