import type { ReactNode } from 'react'
import styles from './Modal.module.css'

export default function Modal({ open, onClose, width = 660, children }: { open: boolean; onClose(): void; width?: number; children: ReactNode }) {
	if (!open) return null
	return (
		<div className={styles.overlay} onClick={onClose}>
			<div className={styles.panel} style={{ width, maxWidth: '100%' }} onClick={(e) => e.stopPropagation()}>
				{children}
			</div>
		</div>
	)
}
