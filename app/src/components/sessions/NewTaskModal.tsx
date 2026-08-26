import { useEffect, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import Modal from '../common/Modal'
import styles from './NewTaskModal.module.css'

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

// "태스크 추가"(사이드바)와 "작업 추가"(캘린더 빈 칸)는 같은 행위였다 — 예전엔 사이드바가 앵커드
// 드롭다운 패널, 캘린더는 칸 안 인라인 입력으로 각자 구현돼 있던 걸 이 모달 하나로 합쳤다. 캘린더에서
// 열리면 defaultDueDate로 그 날짜가 미리 채워지고, 사이드바에서 열리면(명시적 defaultDueDate 없음)
// 오늘 날짜로 시작한다(둘 다 지우거나 바꿀 수 있음).
// defaultDueDate의 fallback을 Date.now()로 주지 않는다 — 함수 매개변수 기본값은 매 렌더마다 다시
// 평가돼 매번 새 타임스탬프가 되고, 그러면 아래 useEffect의 deps가 매 렌더 바뀐 걸로 오인해 모달이
// 열려있는 동안에도 계속 리셋된다. "오늘" 계산은 open이 바뀌는 순간(useEffect 안)에서만 한다.
export default function NewTaskModal({ open, onClose, defaultDueDate = null }: { open: boolean; onClose(): void; defaultDueDate?: number | null }) {
	const createTaskFromDraft = useSessionsStore((s) => s.createTaskFromDraft)
	const [text, setText] = useState('')
	const [dueDate, setDueDate] = useState<number | null>(defaultDueDate)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// 열릴 때마다 이전 입력을 지우고 그 시점의 기본 날짜로 리셋 — 닫았다 다른 칸에서 다시 열면 새 날짜여야 한다.
	// defaultDueDate가 없으면(사이드바 경로) 오늘 — 캘린더 경로는 항상 명시적 날짜를 넘기므로 안 건드림.
	useEffect(() => {
		if (open) {
			setText('')
			setDueDate(defaultDueDate ?? Date.now())
			setError(null)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, defaultDueDate])

	async function submit() {
		if (!text.trim() || busy) return
		setBusy(true)
		setError(null)
		const r = await createTaskFromDraft(text, dueDate)
		setBusy(false)
		if (r.ok) onClose()
		else setError(r.error || '추가 실패')
	}

	return (
		<Modal open={open} onClose={onClose} width={420}>
			<div className={styles.pad}>
				<div className={styles.title}>일감 생성</div>
				<textarea
					className={styles.input}
					autoFocus
					disabled={busy}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							submit()
						}
					}}
					placeholder="제목을 쓰거나 Figma·스레드·Notion·PR 링크를 붙여넣으세요"
				/>
				<div className={styles.dateRow}>
					<span className={styles.dateLabel}>예정일</span>
					<input
						type="date"
						className="fin m"
						style={{ width: 150, height: 32 }}
						value={dueDate ? msToDateInputValue(dueDate) : ''}
						onChange={(e) => setDueDate(e.target.value ? dateInputValueToMs(e.target.value) : null)}
					/>
					{dueDate !== null && (
						<button type="button" className={styles.dateClear} onClick={() => setDueDate(null)}>
							지우기
						</button>
					)}
				</div>
				{error && <div className={styles.error}>{error}</div>}
				<button className={styles.submit} disabled={busy || !text.trim()} onClick={submit}>
					{busy ? <span className={styles.spinner} /> : null}
					{busy ? '추가 중…' : '일감으로 추가'}
				</button>
				<div className={styles.hint}>새 일감은 미분류에 담깁니다 — 필요할 때 태스크로 드래그해 옮기세요.</div>
			</div>
		</Modal>
	)
}
