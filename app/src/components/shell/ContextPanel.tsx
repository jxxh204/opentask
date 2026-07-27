import { useLocation } from 'react-router-dom'
import { NAV_ITEMS, SETUP_ITEM, PANEL_ITEMS } from './navRegistry'
import { useSetupStore, isSetupConfigured } from '../../store/useSetupStore'
import styles from './ContextPanel.module.css'

export default function ContextPanel() {
	const location = useLocation()
	const rootPath = useSetupStore((s) => s.rootPath)
	const configured = useSetupStore(isSetupConfigured)
	const reset = useSetupStore((s) => s.reset)
	const label = configured ? `설정됨 · ${String(rootPath).split('/').slice(-1)[0]}` : '초기 설정 필요'
	const setup = { configured, label }

	const active = [...NAV_ITEMS, SETUP_ITEM].find((n) => location.pathname.startsWith(n.route)) ?? NAV_ITEMS[0]
	const items = PANEL_ITEMS[active.id] ?? []

	return (
		<aside className={styles.panel}>
			<div className={styles.title}>{active.label}</div>

			{items.map((it, i) =>
				it.header ? (
					<div key={i} className={styles.sectionHeader}>
						{it.header}
					</div>
				) : (
					<div key={i} className={styles.itemRow}>
						<span className={styles.itemChevron}>▸</span>
						<span className={styles.itemName}>{it.name}</span>
						{it.count && <span className={styles.itemCount}>{it.count}</span>}
					</div>
				),
			)}

			<div className={styles.spacer} />

			<div className={styles.footerRow}>
				<span className={`${styles.footerDot} ${setup.configured ? styles.dotDone : styles.dotPending}`} />
				<span className={styles.footerLabel}>{setup.label}</span>
				{setup.configured && (
					<span className={styles.resetLink} onClick={reset}>
						초기화
					</span>
				)}
			</div>
			<div className={styles.licenseRow}>
				<span className={`m ${styles.licenseText}`}>Apache-2.0</span>
				<div style={{ flex: 1 }} />
				<span className={styles.liveDot} />
				<span className={styles.liveLabel}>실시간</span>
			</div>
		</aside>
	)
}
