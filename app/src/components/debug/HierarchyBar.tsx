import { useDebugStore } from '../../store/useDebugStore'
import StatusDot from '../common/StatusDot'
import styles from './HierarchyBar.module.css'

const HIER = [
	{ label: 'ENV', value: '개발서버', hasDot: false },
	{ label: 'SERVER', value: 'dev6', hasDot: true },
	{ label: 'SESSION', value: '세션 A · 결제완료', hasDot: true },
]

export default function HierarchyBar() {
	const device = useDebugStore((s) => s.device)
	const setDevice = useDebugStore((s) => s.setDevice)
	const selecting = useDebugStore((s) => s.selecting)
	const toggleSelect = useDebugStore((s) => s.toggleSelect)
	const route = useDebugStore((s) => s.route)

	return (
		<div className={styles.bar}>
			{HIER.map((h, i) => (
				<span key={h.label} style={{ display: 'contents' }}>
					<span className={styles.chip}>
						{h.hasDot && <StatusDot color="green" size={6} />}
						<span className={`m ${styles.chipLabel}`}>{h.label}</span>
						<span className={styles.chipValue}>{h.value}</span>
						<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
							<path d="M6 9l6 6 6-6" />
						</svg>
					</span>
					{i < HIER.length - 1 && <span className={styles.arrow}>›</span>}
				</span>
			))}
			<div className={`m ${styles.routeChip}`}>
				<span className={styles.routeHost}>localhost:3000</span>
				<span className={styles.routePath}>/{route}</span>
			</div>
			<div className={styles.deviceToggle}>
				<button className={`${styles.deviceBtn} ${device === 'pc' ? styles.deviceBtnActive : ''}`} onClick={() => setDevice('pc')}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
						<rect x="3" y="4" width="18" height="12" rx="2" />
						<path d="M8 20h8M12 16v4" />
					</svg>
					PC
				</button>
				<button className={`${styles.deviceBtn} ${device === 'webview' ? styles.deviceBtnActive : ''}`} onClick={() => setDevice('webview')}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
						<rect x="7" y="2" width="10" height="20" rx="2.5" />
						<path d="M11 18h2" />
					</svg>
					웹뷰
				</button>
			</div>
			<button className={`${styles.selectBtn} ${selecting ? styles.selectBtnActive : ''}`} onClick={toggleSelect}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
					<circle cx="12" cy="12" r="8" />
					<circle cx="12" cy="12" r="3" />
					<path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
				</svg>
				요소 선택
			</button>
		</div>
	)
}
