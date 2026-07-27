import { useDebugStore } from '../../store/useDebugStore'
import ElementInfoList from './ElementInfoList'
import NetworkInspector from './NetworkInspector'
import ConsolePanel from './ConsolePanel'
import ClaudeCommandBar from './ClaudeCommandBar'
import styles from './InspectorDrawer.module.css'

const TABS = [
	{ id: 'element' as const, label: '요소', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/>' },
	{ id: 'network' as const, label: '네트워크', icon: '<path d="M4 7h16M4 12h16M4 17h10"/>' },
	{ id: 'console' as const, label: '콘솔', icon: '<rect x="8" y="6" width="8" height="12" rx="4"/><path d="M12 6V4M5 9l3 1M19 9l-3 1M4 15h4M16 15h4M5 20l3-2M19 20l-3-2"/>', badge: 3 },
]

export default function InspectorDrawer() {
	const drawerOpen = useDebugStore((s) => s.drawerOpen)
	const drawerTab = useDebugStore((s) => s.drawerTab)
	const openDrawerTab = useDebugStore((s) => s.openDrawerTab)
	const closeDrawer = useDebugStore((s) => s.closeDrawer)

	return (
		<div className={styles.drawer} style={{ transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)' }}>
			<div className={styles.tabBar}>
				{TABS.map((t) => (
					<button key={t.id} className={`${styles.tabBtn} ${drawerTab === t.id ? styles.tabBtnActive : ''}`} onClick={() => openDrawerTab(t.id)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: t.icon }} />
						{t.label}
						{t.badge && <span className={styles.tabBadge}>{t.badge}</span>}
					</button>
				))}
				<div style={{ flex: 1 }} />
				<button className={styles.closeBtn} onClick={closeDrawer}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>

			<div className={styles.hint}>
				체크한 항목만 Claude 명령에 <b style={{ color: 'var(--t2)' }}>컨텍스트로 첨부</b>됩니다
			</div>

			<div className={styles.content}>
				{drawerTab === 'element' && <ElementInfoList />}
				{drawerTab === 'network' && <NetworkInspector />}
				{drawerTab === 'console' && <ConsolePanel />}
			</div>

			<ClaudeCommandBar />
		</div>
	)
}
