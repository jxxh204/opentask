import type { Task } from '../../store/types'
import { useSessionsStore } from '../../store/useSessionsStore'
import StatusDot from '../common/StatusDot'
import BranchChain from './BranchChain'
import styles from './TaskRow.module.css'

// PR/CI-derived status dot is NOT shown yet — it requires the live git/gh join
// planned for a later hardening pass. The review badge IS real (Phase 3.3).
export default function TaskRow({ task, folderBase, dragBeforeTaskId }: { task: Task; folderBase: string | null; dragBeforeTaskId: (e: React.DragEvent) => void }) {
	const open = useSessionsStore((s) => !!s.openTasks[task.id])
	const toggleTask = useSessionsStore((s) => s.toggleTask)
	const setDragTask = useSessionsStore((s) => s.setDragTask)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const openReview = useSessionsStore((s) => s.openReview)

	const nb = task.branches.length
	const openReviewCount = task.reviews.filter((r) => r.state === 'open').length
	const hasReviews = task.reviews.length > 0
	const reviewLabel = openReviewCount > 0 ? `리뷰 ${openReviewCount}` : '리뷰 완료'
	const reviewFg = openReviewCount > 0 ? 'var(--amber)' : 'var(--green)'
	const reviewBg = openReviewCount > 0 ? 'rgba(224,164,54,.14)' : 'rgba(62,207,142,.14)'
	const reviewBd = openReviewCount > 0 ? 'rgba(224,164,54,.32)' : 'rgba(62,207,142,.3)'
	const chainGlyph = nb > 1 ? (task.kind === 'parallel' ? `⑂ ${nb}` : '●─●─○') : ''
	const chainColor = task.kind === 'parallel' ? 'var(--green)' : 'var(--violet)'

	return (
		<div
			className={styles.row}
			draggable
			style={{ background: open ? 'var(--card2)' : 'var(--card)', border: `1px solid ${open ? 'var(--line2)' : 'var(--line)'}`, opacity: dragTaskId === task.id ? 0.4 : 1 }}
			onDragStart={(e) => {
				e.dataTransfer.effectAllowed = 'move'
				e.dataTransfer.setData('text/plain', task.id)
				setDragTask(task.id)
			}}
			onDragEnd={() => setDragTask(null)}
			onDragOver={(e) => e.preventDefault()}
			onDrop={dragBeforeTaskId}
		>
			<div className={styles.head} onClick={() => toggleTask(task.id)}>
				<svg className={styles.grip} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
					<circle cx="9" cy="6" r="1.5" />
					<circle cx="15" cy="6" r="1.5" />
					<circle cx="9" cy="12" r="1.5" />
					<circle cx="15" cy="12" r="1.5" />
					<circle cx="9" cy="18" r="1.5" />
					<circle cx="15" cy="18" r="1.5" />
				</svg>
				<svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
					<path d="M9 6l6 6-6 6" />
				</svg>
				<StatusDot color="muted" />
				<span className={styles.name}>{task.name}</span>
				{hasReviews && (
					<span
						className="m"
						style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: reviewFg, background: reviewBg, border: `1px solid ${reviewBd}`, flex: 'none' }}
						onClick={(e) => {
							e.stopPropagation()
							openReview(task.id)
						}}
					>
						{reviewLabel}
					</span>
				)}
				{chainGlyph && (
					<span className={`m ${styles.chainGlyph}`} style={{ color: chainColor }}>
						{chainGlyph}
					</span>
				)}
			</div>
			{open && (
				<div className={styles.body}>
					<div className={styles.bodyInner}>
						<p className={styles.desc}>{task.desc || '설명 없음'}</p>
						{nb > 0 && <BranchChain branches={task.branches} kind={task.kind} groupBase={folderBase} />}
					</div>
				</div>
			)}
		</div>
	)
}
