import { useDebugStore } from '../../store/useDebugStore'
import Checkbox from '../common/Checkbox'

export default function NetworkInspector() {
	const network = useDebugStore((s) => s.network)
	const attach = useDebugStore((s) => s.attach)
	const toggleAttach = useDebugStore((s) => s.toggleAttach)
	const netHover = useDebugStore((s) => s.netHover)
	const netOpen = useDebugStore((s) => s.netOpen)
	const setNetHover = useDebugStore((s) => s.setNetHover)
	const toggleNetOpen = useDebugStore((s) => s.toggleNetOpen)

	return (
		<div className="m" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
			{network.map((n) => {
				const key = 'net:' + n.id
				const on = !!attach[key]
				const opened = !!netOpen[n.id]
				const tip = netHover === n.id && !opened
				return (
					<div key={n.id} onMouseEnter={() => setNetHover(n.id)} onMouseLeave={() => setNetHover(null)} style={{ borderRadius: 9, background: on ? 'rgba(91,157,246,.07)' : 'var(--card2)', border: `1px solid ${on ? '#2a5285' : 'var(--line2)'}`, overflow: 'hidden' }}>
						<div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px' }}>
							<Checkbox checked={on} onChange={() => toggleAttach(key)} size={16} />
							<div onClick={() => toggleNetOpen(n.id)} style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}>
								<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
									<span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t2)' }}>{n.method}</span>
									<span style={{ fontSize: 10.5, color: n.status >= 500 ? '#ec8d87' : '#5fd08e' }}>{n.status}</span>
									<span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 'auto' }}>{n.ms}ms</span>
									<span style={{ fontSize: 9, fontWeight: 700, color: n.mswOn ? 'var(--amber)' : 'var(--t3)' }}>{n.mswOn ? 'MSW' : '실서버'}</span>
								</div>
								<div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.url}</div>
							</div>
						</div>
						{tip && (
							<div style={{ padding: '0 11px 9px 36px', display: 'flex', gap: 12, fontSize: 9.5, color: 'var(--t3)' }}>
								<span>req {n.reqSize}</span>
								<span>res {n.resSize}</span>
								<span>{n.type}</span>
								<span style={{ color: 'var(--blue)' }}>클릭 → 상세</span>
							</div>
						)}
						{opened && (
							<div style={{ padding: '2px 11px 11px 36px', display: 'flex', flexDirection: 'column', gap: 5 }}>
								{n.fields.map((fd) => {
									const fkey = 'netf:' + n.id + ':' + fd.key
									const fon = !!attach[fkey]
									return (
										<div key={fd.key} onClick={() => toggleAttach(fkey)} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px', borderRadius: 8, background: fon ? 'var(--btint)' : 'var(--bg)', border: `1px solid ${fon ? '#2a5285' : 'var(--line2)'}`, cursor: 'pointer' }}>
											<Checkbox checked={fon} onChange={() => toggleAttach(fkey)} size={15} />
											<div style={{ minWidth: 0, flex: 1 }}>
												<div style={{ fontSize: 9, color: 'var(--t3)' }}>{fd.label}</div>
												<div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.5, marginTop: 2, wordBreak: 'break-all' }}>{fd.value}</div>
											</div>
										</div>
									)
								})}
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}
