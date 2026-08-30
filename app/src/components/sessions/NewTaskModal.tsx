import { useEffect, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import { createTask as apiCreateTask } from '../../api/sessions'
import { useT, useTp } from '../../utils/i18n'
import Modal from '../common/Modal'
import MainTaskPicker from './MainTaskPicker'
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
	const t = useT()
	const tp = useTp()
	const createTaskFromDraft = useSessionsStore((s) => s.createTaskFromDraft)
	const createSubtask = useSessionsStore((s) => s.createSubtask)
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)
	const folders = useSessionsStore((s) => s.folders)
	const [text, setText] = useState('')
	const [dueDate, setDueDate] = useState<number | null>(defaultDueDate)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	// "여기서 메인 서브 선택 기능있으면 좋을듯" — 만들 때부터 이 일감이 메인 태스크인지, 이미 있는
	// 메인 태스크의 서브태스크인지 바로 정할 수 있게.
	const [mode, setMode] = useState<'main' | 'sub'>('main')
	const [subParentId, setSubParentId] = useState<string | null>(null)

	// 열릴 때마다 이전 입력을 지우고 그 시점의 기본 날짜로 리셋 — 닫았다 다른 칸에서 다시 열면 새 날짜여야 한다.
	// defaultDueDate가 없으면(사이드바 경로) 오늘 — 캘린더 경로는 항상 명시적 날짜를 넘기므로 안 건드림.
	useEffect(() => {
		if (open) {
			setText('')
			setDueDate(defaultDueDate ?? Date.now())
			setError(null)
			setMode('main')
			setSubParentId(null)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, defaultDueDate])

	async function submit() {
		if (!text.trim() || busy) return
		if (mode === 'sub' && !subParentId) {
			setError(t('메인 태스크를 먼저 골라주세요.'))
			return
		}
		setBusy(true)
		setError(null)
		if (mode === 'sub' && subParentId) {
			await createSubtask(subParentId, { name: text.trim(), dueDate })
			setBusy(false)
			onClose()
			return
		}
		const r = await createTaskFromDraft(text, dueDate)
		setBusy(false)
		if (r.ok) onClose()
		else setError(t(r.error || '추가 실패'))
	}

	const mainTaskCandidates = folders.flatMap((f) => f.tasks).map((t) => ({ id: t.id, name: t.name }))
	const subParentName = mainTaskCandidates.find((c) => c.id === subParentId)?.name ?? null

	return (
		<Modal open={open} onClose={onClose} width={420}>
			<div className={styles.pad}>
				<div className={styles.title}>{t('일감 생성')}</div>
				<div className={styles.modeRow}>
					<button type="button" className={`${styles.modeTab} ${mode === 'main' ? styles.modeTabActive : ''}`} onClick={() => setMode('main')}>
						{t('메인 태스크')}
					</button>
					<button type="button" className={`${styles.modeTab} ${mode === 'sub' ? styles.modeTabActive : ''}`} onClick={() => setMode('sub')}>
						{t('서브태스크')}
					</button>
				</div>
				{mode === 'sub' && (
					<div className={styles.subParentRow}>
						<MainTaskPicker
							label={subParentName ? tp('메인 태스크: {name}', { name: subParentName }) : t('메인 태스크 고르기…')}
							candidates={mainTaskCandidates}
							onPick={setSubParentId}
							onCreateNew={async (name) => {
								const task = await apiCreateTask({ folderId: null, name })
								// quickStartTask는 스토어 로컬 상태에서 이 태스크를 찾아야 승격이 진행된다 — 방금
								// API로 직접 만들어서 아직 로컬 상태엔 없으니 먼저 새로고침한다.
								await useSessionsStore.getState().loadBoard()
								await quickStartTask(task.id)
								return task.id
							}}
						/>
					</div>
				)}
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
					placeholder={mode === 'sub' ? t('서브태스크 이름') : t('제목을 쓰거나 Figma·스레드·Notion·PR 링크를 붙여넣으세요')}
				/>
				<div className={styles.dateRow}>
					<span className={styles.dateLabel}>{t('예정일')}</span>
					<input
						type="date"
						className="fin m"
						style={{ width: 150, height: 32 }}
						value={dueDate ? msToDateInputValue(dueDate) : ''}
						onChange={(e) => setDueDate(e.target.value ? dateInputValueToMs(e.target.value) : null)}
					/>
					{dueDate !== null && (
						<button type="button" className={styles.dateClear} onClick={() => setDueDate(null)}>
							{t('지우기')}
						</button>
					)}
				</div>
				{error && <div className={styles.error}>{error}</div>}
				<button className={styles.submit} disabled={busy || !text.trim()} onClick={submit}>
					{busy ? <span className={styles.spinner} /> : null}
					{busy ? t('추가 중…') : mode === 'sub' ? t('서브태스크로 추가') : t('일감으로 추가')}
				</button>
				<div className={styles.hint}>{mode === 'sub' ? t('고른 메인 태스크 밑에 서브태스크로 바로 들어갑니다.') : t('새 일감은 미분류에 담깁니다 — 필요할 때 태스크로 드래그해 옮기세요.')}</div>
			</div>
		</Modal>
	)
}
