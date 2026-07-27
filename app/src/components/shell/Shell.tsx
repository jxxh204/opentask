import { Outlet } from 'react-router-dom'
import ActivityBar from './ActivityBar'
import ContextPanel from './ContextPanel'
import styles from './Shell.module.css'

// Dual-rail shell (VSCode-style): icon activity bar + page-scoped context panel,
// always mounted, wrapping every route via <Outlet/>. Desktop-only by design —
// see plan §"모바일 지원" (no responsive breakpoints, no touch-drag fallback).
export default function Shell() {
	return (
		<div className={styles.root}>
			<ActivityBar />
			<ContextPanel />
			<main className={styles.content}>
				<Outlet />
			</main>
		</div>
	)
}
