import type { Review } from '../../store/types'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useUiStore } from '../../store/useUiStore'
import { useT, localeFor } from '../../utils/i18n'
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
	const t = useT()
	const lang = useUiStore((s) => s.lang)
	const disputingReviewId = useSessionsStore((s) => s.disputingReviewId)
	const disputeText = useSessionsStore((s) => s.disputeText)
	const setDisputeText = useSessionsStore((s) => s.setDisputeText)
	const startDispute = useSessionsStore((s) => s.startDispute)
	const cancelDispute = useSessionsStore((s) => s.cancelDispute)
	const confirmingApplyId = useSessionsStore((s) => s.confirmingApplyId)
	const startApply = useSessionsStore((s) => s.startApply)
	const cancelApply = useSessionsStore((s) => s.cancelApply)
	const applyReview = useSessionsStore((s) => s.applyReview)
	const disputeReview = useSessionsStore((s) => s.disputeReview)
	const reviewBusy = useSessionsStore((s) => s.reviewBusy)

	const sev = review.sev || 'P3'
	const [sevFg, sevBg] = SEV_COLOR[sev] ?? SEV_COLOR.P3
	const [stLabel, stFg] = STATE_LABEL[review.state]
	const isOpen = review.state === 'open'
	const isDisputing = disputingReviewId === review.id
	const isConfirmingApply = confirmingApplyId === review.id

	return (
		<div className={styles.card} style={{ background: isOpen ? 'var(--card2)' : 'var(--card)' }}>
			<div className={styles.head}>
				<span className={`m ${styles.sevBadge}`} style={{ color: sevFg, background: sevBg }}>
					{sev}
				</span>
				<span className={styles.who}>{review.who}</span>
				{review.file && <span className={`m ${styles.file}`}>{review.file}</span>}
				<span className={styles.at}>{review.at ? new Date(review.at).toLocaleString(localeFor(lang)) : ''}</span>
				<span className={styles.stateLabel} style={{ color: stFg }}>
					{t(stLabel)}
				</span>
			</div>
			<p className={styles.body}>{review.body}</p>
			{review.reply && (
				<div className={styles.replyBox}>
					<div className={styles.replyLabel}>{t('내 항의')}</div>
					<div className={styles.replyText}>{review.reply}</div>
				</div>
			)}
			{isOpen && (
				<>
					{isDisputing ? (
						<div className={styles.disputeArea}>
							<textarea className={styles.disputeTextarea} value={disputeText} onChange={(e) => setDisputeText(e.target.value)} placeholder={t('왜 이 리뷰가 맞지 않는지 설명… (리뷰어에게 전달)')} />
							<div className={styles.actions}>
								<button className={styles.sendBtn} disabled={reviewBusy} onClick={() => disputeReview(review.id)}>
									{t('항의 보내기')}
								</button>
								<button className={styles.disputeBtn} onClick={cancelDispute}>
									{t('취소')}
								</button>
							</div>
						</div>
					) : isConfirmingApply ? (
						<div className={styles.disputeArea}>
							<p style={{ fontSize: 12, color: 'var(--t2)' }}>{t('이 리뷰를 세션에 보내 코드에 반영시킬까요? 실제로 커밋·푸시까지 진행됩니다.')}</p>
							<div className={styles.actions}>
								<button className={styles.applyBtn} disabled={reviewBusy} onClick={() => applyReview(review.id)}>
									{reviewBusy ? t('적용 중…') : t('적용')}
								</button>
								<button className={styles.disputeBtn} onClick={cancelApply}>
									{t('취소')}
								</button>
							</div>
						</div>
					) : (
						<div className={styles.actions}>
							<button className={styles.applyBtn} disabled={reviewBusy} onClick={() => startApply(review.id)}>
								{t('리뷰 적용')}
							</button>
							<button className={styles.disputeBtn} onClick={() => startDispute(review.id)}>
								{t('리뷰 항의')}
							</button>
						</div>
					)}
				</>
			)}
		</div>
	)
}
