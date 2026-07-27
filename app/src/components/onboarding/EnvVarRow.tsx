import type { EnvVar } from '../../store/useSetupStore'
import styles from './EnvVarRow.module.css'

export default function EnvVarRow({ row, onUpdate, onRemove }: { row: EnvVar; onUpdate(patch: Partial<EnvVar>): void; onRemove(): void }) {
	const masked = row.secret && row.masked
	const shown = masked ? '•'.repeat(Math.min(20, row.value.length || 8)) : row.value

	return (
		<div className={styles.row}>
			<input className="fin m" value={row.key} placeholder="NEXT_PUBLIC_API_URL" onChange={(e) => onUpdate({ key: e.target.value })} />
			<div className={styles.valueCell}>
				<input className="fin m" value={shown} placeholder="값" style={masked ? { letterSpacing: 1 } : undefined} onChange={(e) => onUpdate({ value: e.target.value })} readOnly={masked} />
				{row.secret && (
					<span className={styles.maskToggle} title="표시/가리기" onClick={() => onUpdate({ masked: !row.masked })}>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
							<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" />
							<circle cx="12" cy="12" r="3" />
						</svg>
					</span>
				)}
			</div>
			<div className={styles.actions}>
				<span
					className={`${styles.iconBtn} ${styles.secretBtn}`}
					title="시크릿 표시"
					style={{ color: row.secret ? 'var(--amber)' : 'var(--t3)', background: row.secret ? 'color-mix(in srgb, var(--amber) 16%, transparent)' : 'transparent' }}
					onClick={() => onUpdate({ secret: !row.secret, masked: !row.secret })}
				>
					🔒
				</span>
				<span className={`${styles.iconBtn} ${styles.removeBtn}`} title="삭제" onClick={onRemove}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
						<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>
			</div>
		</div>
	)
}
