import { useSessionsStore } from '../../store/useSessionsStore'
import Modal from '../common/Modal'
import ReviewItemCard from './ReviewItemCard'
import styles from './PrReviewModal.module.css'

export default function PrReviewModal() {
	const reviewTaskId = useSessionsStore((s) => s.reviewTaskId)
	const closeReview = useSessionsStore((s) => s.closeReview)
	const folders = useSessionsStore((s) => s.folders)
	const inbox = useSessionsStore((s) => s.inbox)

	const allTasks = [...inbox, ...folders.flatMap((f) => f.tasks)]
	const task = allTasks.find((t) => t.id === reviewTaskId) ?? null

	const primaryPr = task?.branches.find((b) => b.links.some((l) => l.kind === 'pr'))
	const prLink = primaryPr?.links.find((l) => l.kind === 'pr')
	const reviews = task?.reviews ?? []
	const openCount = reviews.filter((r) => r.state === 'open').length

	return (
		<Modal open={!!task} onClose={closeReview}>
			<div className={styles.header}>
				<span className={styles.title}>PR 리뷰</span>
				{prLink && (
					<a href={prLink.url} target="_blank" rel="noreferrer" className={`m ${styles.prLink}`}>
						PR
					</a>
				)}
				<span className={styles.taskName}>{task?.name}</span>
				<span className={`m ${styles.counter}`}>
					미처리 {openCount}/{reviews.length}
				</span>
				<button className={styles.closeBtn} onClick={closeReview}>
					✕
				</button>
			</div>
			<div className={styles.body}>
				{reviews.length === 0 && <div className={styles.emptyState}>리뷰 코멘트가 없습니다.</div>}
				{reviews.map((r) => (
					<ReviewItemCard key={r.id} review={r} />
				))}
			</div>
			<div className={styles.footer}>
				<span className={styles.footerHint}>리뷰 적용 = 워크트리 Claude에게 수정 지시 · 리뷰 항의 = 리뷰어에게 회신</span>
				<button className={styles.footerCloseBtn} onClick={closeReview}>
					닫기
				</button>
			</div>
		</Modal>
	)
}
