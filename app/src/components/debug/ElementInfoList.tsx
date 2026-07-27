import { useDebugStore } from '../../store/useDebugStore'
import Checkbox from '../common/Checkbox'

export default function ElementInfoList() {
	const elementInfo = useDebugStore((s) => s.elementInfo)
	const attach = useDebugStore((s) => s.attach)
	const toggleAttach = useDebugStore((s) => s.toggleAttach)

	return (
		<div className="m" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
			{elementInfo.map((r) => {
				const key = 'el:' + r.key
				const on = !!attach[key]
				return (
					<div key={r.key} onClick={() => toggleAttach(key)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 11px', borderRadius: 9, background: on ? 'var(--btint)' : 'var(--card2)', border: `1px solid ${on ? '#2a5285' : 'var(--line2)'}`, cursor: 'pointer' }}>
						<Checkbox checked={on} onChange={() => toggleAttach(key)} />
						<div style={{ minWidth: 0, flex: 1 }}>
							<div style={{ fontSize: 9, color: 'var(--t3)', letterSpacing: '.04em' }}>{r.label}</div>
							<div style={{ fontSize: 11, color: r.accent ? '#7fd8c8' : 'var(--t2)', lineHeight: 1.5, marginTop: 3, wordBreak: 'break-all' }}>{r.value}</div>
						</div>
					</div>
				)
			})}
		</div>
	)
}
