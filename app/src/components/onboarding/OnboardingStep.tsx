import ConnectorLogo from '../common/ConnectorLogo'
import FolderPicker from '../sessions/FolderPicker'
import styles from './OnboardingStep.module.css'

export interface OnboardingFieldVM {
	label: string
	placeholder: string
	value: string
	onChange(v: string): void
	/** renders a live-validated FolderPicker instead of a plain input (used by the 'paths' step) */
	folderKind?: 'root' | 'worktree'
}

export interface OnboardingStepVM {
	id: string
	title: string
	tag: string
	tagColorRgb: string // "139,124,240" — matches prototype's `rgba(${color},.14)` pattern
	logo?: string
	used: string
	cta: string
	hint: string
	optional: boolean
	done: boolean
	fields: OnboardingFieldVM[]
	/** extra explanatory content shown above the fields (e.g. per-OS install commands) */
	note?: string
	/** overrides the default "연결됨" done-badge label (e.g. "설치됨" for an environment check step) */
	doneLabel?: string
}

export default function OnboardingStep({ step, open, onToggle, onConnect, onSkip }: { step: OnboardingStepVM; open: boolean; onToggle(): void; onConnect(): void; onSkip(): void }) {
	return (
		<div className={`${styles.card} ${open ? styles.cardOpen : ''} ${step.done ? styles.cardDone : ''}`}>
			<div className={styles.head} onClick={onToggle}>
				<ConnectorLogo src={step.logo} alt={step.title} />
				<div className={styles.headMain}>
					<div className={styles.headTitleRow}>
						<span className={styles.headTitle}>{step.title}</span>
						<span className={`m ${styles.tag}`} style={{ color: `rgb(${step.tagColorRgb})`, background: `rgba(${step.tagColorRgb},.14)` }}>
							{step.tag}
						</span>
					</div>
					<div className={styles.used}>{step.used}</div>
				</div>
				{step.done ? (
					<span className={styles.doneBadge}>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
							<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						{step.doneLabel ?? '연결됨'}
					</span>
				) : (
					<span className={styles.pendingBadge}>미설정</span>
				)}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}>
					<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</div>
			{open && (
				<div className={styles.body}>
					<div className={styles.bodyInner}>
						{step.note && <pre className={styles.note}>{step.note}</pre>}
						<div className={styles.fields}>
							{step.fields.map((f, i) => (
								<div key={i}>
									<div className={styles.fieldLabel}>{f.label}</div>
									{f.folderKind ? <FolderPicker label={f.label} value={f.value} onChange={f.onChange} kind={f.folderKind} /> : <input className={`fin m`} value={f.value} placeholder={f.placeholder} onChange={(e) => f.onChange(e.target.value)} />}
								</div>
							))}
						</div>
						<div className={styles.actions}>
							<button className={styles.connectBtn} onClick={onConnect}>
								{step.cta}
							</button>
							{step.optional && (
								<button className={styles.skipBtn} onClick={onSkip}>
									나중에
								</button>
							)}
							<span className={styles.hint}>{step.hint}</span>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
