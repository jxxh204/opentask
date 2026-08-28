import { useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import type { Subtask } from '../../store/types'
import taskRowStyles from './TaskRow.module.css'
import styles from './SessionShell.module.css'

const PLUS_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 8v8M8 12h8" />
	</svg>
)

// "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — task_id 없는 독립
// 서브태스크(§ db.cjs v20)를 inbox 태스크와 같은 높이의 사이드바 섹션으로 보여준다. 행 자체는
// TaskRow의 subChain* 드래그 로직·클래스를 그대로 재사용하되(rail/dot 없이 칩만) taskId 자리에
// null을 넘겨 "메모 목록끼리만" 재정렬되게 한다(§ useSessionsStore.reorderSubtasks).
export default function NotesSection({ notes }: { notes: Subtask[] }) {
	const createNote = useSessionsStore((s) => s.createNote)
	const openNoteDetail = useSessionsStore((s) => s.openNoteDetail)
	const dragSubtaskId = useSessionsStore((s) => s.dragSubtaskId)
	const dragSubtaskTaskId = useSessionsStore((s) => s.dragSubtaskTaskId)
	const overSubtaskId = useSessionsStore((s) => s.overSubtaskId)
	const setDragSubtask = useSessionsStore((s) => s.setDragSubtask)
	const setOverSubtask = useSessionsStore((s) => s.setOverSubtask)
	const reorderSubtasks = useSessionsStore((s) => s.reorderSubtasks)

	const [adding, setAdding] = useState(false)
	const [draft, setDraft] = useState('')

	function commitAdd() {
		const name = draft.trim()
		setAdding(false)
		setDraft('')
		if (name) createNote({ name })
	}

	return (
		<div className={styles.notesSection}>
			<div className={styles.notesHeader}>
				<span>메모</span>
				{notes.length > 0 && <span className={styles.notesCount}>{notes.length}</span>}
				<button
					type="button"
					className={`${styles.headIconBtn} ${styles.notesAddBtn}`}
					onClick={(e) => {
						e.stopPropagation()
						setAdding(true)
					}}
					title="메모 추가"
				>
					{PLUS_ICON}
				</button>
			</div>
			{adding && (
				<input
					autoFocus
					className={styles.notesAddInput}
					value={draft}
					placeholder="메모 제목"
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commitAdd}
					onKeyDown={(e) => {
						if (e.key === 'Enter') commitAdd()
						if (e.key === 'Escape') {
							setAdding(false)
							setDraft('')
						}
					}}
				/>
			)}
			{notes.length > 0 && (
				<div
					className={styles.notesList}
					onDragOver={(e) => {
						if (dragSubtaskTaskId !== null) return
						e.preventDefault()
					}}
					onDrop={(e) => {
						if (dragSubtaskTaskId !== null || !dragSubtaskId) return
						e.preventDefault()
						reorderSubtasks(null, dragSubtaskId, null)
					}}
				>
					{notes.map((n) => (
						<div
							key={n.id}
							draggable
							style={{ opacity: dragSubtaskId === n.id ? 0.4 : 1 }}
							onDragStart={(e) => {
								e.dataTransfer.effectAllowed = 'move'
								e.dataTransfer.setData('text/plain', n.id)
								setDragSubtask(n.id, null)
							}}
							onDragEnd={() => {
								setDragSubtask(null, null)
								setOverSubtask(null)
							}}
						>
							<div
								className={`${taskRowStyles.subChainCard} ${overSubtaskId === n.id && dragSubtaskId !== n.id ? taskRowStyles.subChainCardDropTarget : ''}`}
								onClick={() => openNoteDetail(n.id)}
								onDragOver={(e) => {
									if (dragSubtaskTaskId !== null || dragSubtaskId === n.id) return
									e.preventDefault()
									if (overSubtaskId !== n.id) setOverSubtask(n.id)
								}}
								onDragLeave={() => {
									if (overSubtaskId === n.id) setOverSubtask(null)
								}}
								onDrop={(e) => {
									if (dragSubtaskTaskId !== null || !dragSubtaskId) return
									e.preventDefault()
									e.stopPropagation()
									reorderSubtasks(null, dragSubtaskId, n.id)
								}}
							>
								<span className={taskRowStyles.subChainName}>{n.name}</span>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
