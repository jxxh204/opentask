import { useEffect, useRef, useState } from 'react'
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
	// "일감 생성 버튼과 모달이 불편해" — Linear/Things 3의 퀵캡처 참고: 추가해도 닫지 않고 그 자리에서
	// 바로 다음 항목을 이어 입력할 수 있게(같은 부모/날짜를 여러 번 재선택할 필요 없음). justAdded는
	// 방금 추가됐다는 짧은 인라인 피드백용 — 토스트 대신 힌트 자리에 잠깐 표시하고 사라진다.
	const [justAdded, setJustAdded] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	// 열릴 때마다 이전 입력을 지우고 그 시점의 기본 날짜로 리셋 — 닫았다 다른 칸에서 다시 열면 새 날짜여야 한다.
	// defaultDueDate가 없으면(사이드바 경로) 오늘 — 캘린더 경로는 항상 명시적 날짜를 넘기므로 안 건드림.
	useEffect(() => {
		if (open) {
			setText('')
			setDueDate(defaultDueDate ?? Date.now())
			setError(null)
			setMode('main')
			setSubParentId(null)
			setJustAdded(false)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, defaultDueDate])

	// Modal.tsx는 backdrop 클릭만 닫아준다(Escape는 각 모달이 직접) — 연속 입력 중에도 빠져나갈 방법이
	// 분명해야 하니 여기서 챙긴다(§ TaskDetailContent.tsx와 같은 패턴).
	useEffect(() => {
		if (!open) return
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [open, onClose])

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
		} else {
			const r = await createTaskFromDraft(text, dueDate)
			if (!r.ok) {
				setBusy(false)
				setError(t(r.error || '추가 실패'))
				setJustAdded(false)
				return
			}
		}
		setBusy(false)
		// "닫지 말고 계속 이어서 입력" — 부모/날짜/모드는 그대로 두고 제목만 비워 바로 다음 항목을 받는다.
		setText('')
		setJustAdded(true)
		textareaRef.current?.focus()
		setTimeout(() => setJustAdded(false), 1400)
	}

	const mainTaskCandidates = folders.flatMap((f) => f.tasks).map((t) => ({ id: t.id, name: t.name }))
	const subParentName = mainTaskCandidates.find((c) => c.id === subParentId)?.name ?? null

	return (
		<Modal open={open} onClose={onClose} width={420}>
			<div className={styles.pad}>
				<div className={styles.title}>{t('일감 생성')}</div>
				{/* "일감 생성 버튼과 모달이 불편해" — 타이핑부터 시작(Linear 참고): 모드·부모·날짜 선택은
				    전부 이 아래로 내려서 보조 취급하고, 열자마자 바로 받아쓸 수 있는 입력창을 맨 먼저 둔다. */}
				<textarea
					ref={textareaRef}
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
				<div className={styles.metaRow}>
					<div className={styles.modeRow}>
						<button type="button" className={`${styles.modeTab} ${mode === 'main' ? styles.modeTabActive : ''}`} onClick={() => setMode('main')}>
							{t('메인 태스크')}
						</button>
						<button type="button" className={`${styles.modeTab} ${mode === 'sub' ? styles.modeTabActive : ''}`} onClick={() => setMode('sub')}>
							{t('서브태스크')}
						</button>
					</div>
					<div className={styles.dateRow}>
						<input
							type="date"
							className="fin m"
							style={{ width: 132, height: 30 }}
							value={dueDate ? msToDateInputValue(dueDate) : ''}
							onChange={(e) => setDueDate(e.target.value ? dateInputValueToMs(e.target.value) : null)}
						/>
						{dueDate !== null && (
							<button type="button" className={styles.dateClear} onClick={() => setDueDate(null)}>
								{t('지우기')}
							</button>
						)}
					</div>
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
				{error && <div className={styles.error}>{error}</div>}
				<button className={styles.submit} disabled={busy || !text.trim()} onClick={submit}>
					{busy ? <span className={styles.spinner} /> : null}
					{busy ? t('추가 중…') : mode === 'sub' ? t('서브태스크로 추가') : t('일감으로 추가')}
				</button>
				{/* "닫지 말고 계속 이어서 입력" — 추가 직후엔 힌트 자리에 짧게 확인만 보여주고(토스트 없음),
				    1.4초 뒤 원래 안내 문구로 돌아온다. 모달은 Escape나 배경 클릭으로만 닫힌다. */}
				<div className={styles.hint}>
					{justAdded ? t('✓ 추가됨 — 계속 입력하세요') : mode === 'sub' ? t('고른 메인 태스크 밑에 서브태스크로 바로 들어갑니다.') : t('새 일감은 미분류에 담깁니다 — 필요할 때 태스크로 드래그해 옮기세요.')}
				</div>
			</div>
		</Modal>
	)
}
