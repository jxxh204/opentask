import type { Review } from '../../store/types'
import { useSessionsStore } from '../../store/useSessionsStore'
import styles from './ReviewItemCard.module.css'

const SEV_COLOR: Record<string, [string, string]> = {
	P1: ['#e0655c', 'rgba(224,101,92,.14)'],
	P2: ['var(--amber)', 'rgba(224,164,54,.14)'],
	P3: ['var(--t3)', 'var(--line2)'],
}
const STATE_LABEL: Record<Review['state'], [string, string]> = {
	open: ['미처리', 'var(--amber)'],
	applied: ['적용됨', 'var(--green)'],
	disputed: ['항의', 'var(--violet)'],
}

export default function ReviewItemCard({ review }: { review: Review }) {
	const disputingReviewId = useSessionsStore((s) => s.disputingReviewId)
	const disputeText = useSessionsStore((s) => s.disputeText)
	const setDisputeText = useSessionsStore((s) => s.setDisputeText)
	const startDispute = useSessionsStore((s) => s.startDispute)
	const cancelDispute = useSessionsStore((s) => s.cancelDispute)
	const applyReview = useSessionsStore((s) => s.applyReview)
	const disputeReview = useSessionsStore((s) => s.disputeReview)
	const reviewBusy = useSessionsStore((s) => s.reviewBusy)

	const sev = review.sev || 'P3'
	const [sevFg, sevBg] = SEV_COLOR[sev] ?? SEV_COLOR.P3
	const [stLabel, stFg] = STATE_LABEL[review.state]
	const isOpen = review.state === 'open'
	const isDisputing = disputingReviewId === review.id

	return (
		<div className={styles.card} style={{ background: isOpen ? 'var(--card2)' : 'var(--card)' }}>
			<div className={styles.head}>
				<span className={`m ${styles.sevBadge}`} style={{ color: sevFg, background: sevBg }}>
					{sev}
				</span>
				<span className={styles.who}>{review.who}</span>
				{review.file && <span className={`m ${styles.file}`}>{review.file}</span>}
				<span className={styles.at}>{review.at ? new Date(review.at).toLocaleString() : ''}</span>
				<span className={styles.stateLabel} style={{ color: stFg }}>
					{stLabel}
				</span>
			</div>
			<p className={styles.body}>{review.body}</p>
			{review.reply && (
				<div className={styles.replyBox}>
					<div className={styles.replyLabel}>내 항의</div>
					<div className={styles.replyText}>{review.reply}</div>
				</div>
			)}
			{isOpen && (
				<>
					{isDisputing ? (
						<div className={styles.disputeArea}>
							<textarea className={styles.disputeTextarea} value={disputeText} onChange={(e) => setDisputeText(e.target.value)} placeholder="왜 이 리뷰가 맞지 않는지 설명… (리뷰어에게 전달)" />
							<div className={styles.actions}>
								<button className={styles.sendBtn} disabled={reviewBusy} onClick={() => disputeReview(review.id)}>
									항의 보내기
								</button>
								<button className={styles.disputeBtn} onClick={cancelDispute}>
									취소
								</button>
							</div>
						</div>
					) : (
						<div className={styles.actions}>
							<button className={styles.applyBtn} disabled={reviewBusy} onClick={() => applyReview(review.id)}>
								리뷰 적용
							</button>
							<button className={styles.disputeBtn} onClick={() => startDispute(review.id)}>
								리뷰 항의
							</button>
						</div>
					)}
				</>
			)}
		</div>
	)
}
