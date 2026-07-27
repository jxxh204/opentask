import type { ReactNode } from 'react'
import styles from './SetupGate.module.css'

export default function SetupGate({
	icon,
	title,
	subtitle,
	canSave,
	busy,
	error,
	saveLabel = '열기',
	onSave,
	children,
}: {
	icon: ReactNode
	title: string
	subtitle: string
	canSave: boolean
	busy?: boolean
	error?: string | null
	saveLabel?: string
	onSave: () => void
	children: ReactNode
}) {
	return (
		<div className={styles.wrap}>
			<div className={styles.card}>
				<div className={styles.head}>
					<span className={styles.icon}>{icon}</span>
					<div>
						<div className={styles.title}>{title}</div>
						<div className={styles.sub}>{subtitle}</div>
					</div>
				</div>
				<div className={styles.fields}>{children}</div>
				{error && <div className={styles.error}>{error}</div>}
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
					<button className={`${styles.goBtn} ${canSave ? styles.goBtnReady : ''}`} disabled={!canSave || busy} onClick={onSave}>
						{busy ? '저장 중…' : saveLabel}
					</button>
					<span style={{ fontSize: 11, color: 'var(--t3)' }}>로컬에만 저장</span>
				</div>
			</div>
		</div>
	)
}
