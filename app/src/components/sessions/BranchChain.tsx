import type { Branch, TaskKind } from '../../store/types'
import { LINK_LABEL } from '../../utils/linkDetect'
import styles from './BranchChain.module.css'

const KIND_LABEL: Record<TaskKind, string> = { chain: '스택 PR', parallel: '병렬 분기', single: '단일' }
const RING_COLOR = 'var(--violet)' // real per-branch PR/CI color join lands in Phase 3.3

export default function BranchChain({ branches, kind, groupBase }: { branches: Branch[]; kind: TaskKind; groupBase: string | null }) {
	const railBg = kind === 'parallel' ? 'var(--line2)' : 'linear-gradient(var(--violet), var(--blue))'

	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
				<span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--t3)' }}>브랜치 체인</span>
				<span className="m" style={{ fontSize: 9.5, color: kind === 'parallel' ? 'var(--green)' : 'var(--violet)', background: kind === 'parallel' ? 'rgba(62,207,142,.14)' : 'var(--vtint)', borderRadius: 5, padding: '1px 7px' }}>
					{KIND_LABEL[kind]}
				</span>
			</div>
			<div className={styles.wrap}>
				<div className={styles.rail} style={{ background: railBg }} />
				{branches.map((b) => (
					<div key={b.id} className={styles.node}>
						<span className={styles.nodeDot} style={{ borderColor: RING_COLOR }} />
						{!!b.forked && <span className={styles.forkTick} />}
						<div className={styles.card}>
							<div className={styles.cardHead}>
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={RING_COLOR} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
									<circle cx="6" cy="6" r="2.5" />
									<circle cx="6" cy="18" r="2.5" />
									<circle cx="18" cy="8" r="2.5" />
									<path d="M6 8.5v7M18 10.5c0 3-3 4-6 4.5" />
								</svg>
								<span className={`m ${styles.name}`}>{b.name}</span>
								<span className={`m ${styles.rel}`}>{b.repo || ''}</span>
							</div>
							{b.links.length > 0 && (
								<div className={styles.links}>
									{b.links.map((lk) => (
										<a key={lk.id} href={lk.url} target="_blank" rel="noreferrer" className={styles.linkChip} onClick={(e) => e.stopPropagation()}>
											<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
												<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
												<path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
											</svg>
											{LINK_LABEL[lk.kind]}
										</a>
									))}
								</div>
							)}
						</div>
					</div>
				))}
				{groupBase && (
					<span className={`m ${styles.groupBase}`}>↳ {groupBase}</span>
				)}
			</div>
		</div>
	)
}
