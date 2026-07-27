import { useDebugStore } from '../../store/useDebugStore'

const HANDLES: { tab: 'element' | 'network' | 'console'; label: string; icon: string; badge?: number }[] = [
	{ tab: 'element', label: '요소', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/>' },
	{ tab: 'network', label: '네트워크', icon: '<path d="M4 7h16M4 12h16M4 17h10"/>' },
	{ tab: 'console', label: '콘솔', icon: '<rect x="8" y="6" width="8" height="12" rx="4"/><path d="M12 6V4M5 9l3 1M19 9l-3 1M4 15h4M16 15h4M5 20l3-2M19 20l-3-2"/>', badge: 3 },
]

export default function CollapsedInspectorHandles() {
	const openDrawerTab = useDebugStore((s) => s.openDrawerTab)

	return (
		<div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
			{HANDLES.map((h) => (
				<button
					key={h.tab}
					onClick={() => openDrawerTab(h.tab)}
					style={{ position: 'relative', width: 44, height: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: '1px solid var(--line2)', borderRight: 'none', borderRadius: '11px 0 0 11px', background: 'var(--card2)', cursor: 'pointer', color: 'var(--t2)' }}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: h.icon }} />
					<span style={{ fontSize: 8.5, fontWeight: 600 }}>{h.label}</span>
					{h.badge && (
						<span style={{ position: 'absolute', top: 5, right: 6, minWidth: 14, height: 14, padding: '0 4px', borderRadius: 7, background: 'var(--red)', color: '#fff', fontSize: 8.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{h.badge}</span>
					)}
				</button>
			))}
		</div>
	)
}
