import { NavLink } from 'react-router-dom'
import { NAV_ITEMS, SETUP_ITEM } from './navRegistry'
import { useSetupStore, isSetupConfigured } from '../../store/useSetupStore'
import styles from './ActivityBar.module.css'

export default function ActivityBar() {
	const configured = useSetupStore(isSetupConfigured)

	return (
		<aside className={styles.rail}>
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" className={styles.logo}>
				<path d="M12 3.2a8.8 8.8 0 1 0 6.3 2.5" stroke="var(--violet)" strokeWidth="2.6" strokeLinecap="round" />
				<circle cx="18.3" cy="5.7" r="2.7" fill="var(--blue)" />
			</svg>

			{NAV_ITEMS.map((item) => (
				<NavLink key={item.id} to={item.route} title={item.label} className={({ isActive }) => `${styles.item} ${isActive ? styles.itemActive : ''}`}>
					{({ isActive }) => (
						<>
							<span className={`${styles.bar} ${isActive ? styles.barActive : ''}`} />
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: item.icon }} />
						</>
					)}
				</NavLink>
			))}

			<div className={styles.spacer} />

			<NavLink to={SETUP_ITEM.route} title={SETUP_ITEM.label} className={({ isActive }) => `${styles.item} ${isActive ? styles.itemActive : ''}`}>
				<span className={`${styles.setupDot} ${configured ? styles.dotDone : styles.dotPending}`} />
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: SETUP_ITEM.icon }} />
			</NavLink>
		</aside>
	)
}
