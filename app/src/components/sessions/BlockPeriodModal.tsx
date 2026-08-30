import { useEffect, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useT } from '../../utils/i18n'
import Modal from '../common/Modal'
import styles from './BlockPeriodModal.module.css'

function pad(n: number) {
	return String(n).padStart(2, '0')
}
function msToDateInputValue(ms: number) {
	const d = new Date(ms)
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function dateInputValueToMs(v: string) {
	const [y, m, d] = v.split('-').map(Number)
	return new Date(y, m - 1, d).getTime()
}

// "일정 막기 기능이 필요해. 중간에 QA기간같은게 있어서 다른걸 못할 수 있거든" — 캘린더 툴바의
// "+ 일정 막기"로 열린다. NewTaskModal과 같은 구조(제목/기간 입력 + 제출)지만 태스크가 아니라
// 캘린더 자체의 차단 기간을 만든다(§ server/store/blockedPeriods.cjs).
export default function BlockPeriodModal({ open, onClose, defaultStartDate = null }: { open: boolean; onClose(): void; defaultStartDate?: number | null }) {
	const t = useT()
	const createBlockedPeriod = useSessionsStore((s) => s.createBlockedPeriod)
	const [name, setName] = useState('')
	const [startDate, setStartDate] = useState<number>(Date.now())
	const [endDate, setEndDate] = useState<number>(Date.now())
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (open) {
			setName('')
			const start = defaultStartDate ?? Date.now()
			setStartDate(start)
			setEndDate(start)
			setError(null)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, defaultStartDate])

	async function submit() {
		if (!name.trim() || busy) return
		setBusy(true)
		setError(null)
		const r = await createBlockedPeriod({ name: name.trim(), startDate, endDate })
		setBusy(false)
		if (r.ok) onClose()
		else setError(t(r.error || '추가 실패'))
	}

	return (
		<Modal open={open} onClose={onClose} width={380}>
			<div className={styles.pad}>
				<div className={styles.title}>{t('일정 막기')}</div>
				{/* "일정막기의 이유를 타이틀로 하고" — 이름이 아니라 "왜 막는지"를 받는다는 걸 라벨로 명시. */}
				<div className={styles.nameRow}>
					<span className={styles.dateLabel}>{t('이유')}</span>
					<input
						className={styles.input}
						autoFocus
						disabled={busy}
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault()
								submit()
							}
						}}
						placeholder={t('예: QA 기간')}
					/>
				</div>
				<div className={styles.dateRow}>
					<span className={styles.dateLabel}>{t('시작')}</span>
					<input
						type="date"
						className="fin m"
						style={{ width: 140, height: 32 }}
						value={msToDateInputValue(startDate)}
						onChange={(e) => {
							const v = dateInputValueToMs(e.target.value)
							setStartDate(v)
							if (v > endDate) setEndDate(v)
						}}
					/>
				</div>
				<div className={styles.dateRow}>
					<span className={styles.dateLabel}>{t('종료')}</span>
					<input
						type="date"
						className="fin m"
						style={{ width: 140, height: 32 }}
						min={msToDateInputValue(startDate)}
						value={msToDateInputValue(endDate)}
						onChange={(e) => setEndDate(dateInputValueToMs(e.target.value))}
					/>
				</div>
				{error && <div className={styles.error}>{error}</div>}
				<button className={styles.submit} disabled={busy || !name.trim()} onClick={submit}>
					{busy ? <span className={styles.spinner} /> : null}
					{busy ? t('추가 중…') : t('막기')}
				</button>
				<div className={styles.hint}>{t('이 기간의 모든 날짜가 캘린더에 줄무늬로 표시됩니다 — 실제로 일정 등록을 막지는 않아요.')}</div>
			</div>
		</Modal>
	)
}
