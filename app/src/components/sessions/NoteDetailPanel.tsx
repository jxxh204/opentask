import { useSessionsStore } from '../../store/useSessionsStore'
import styles from './TaskDetailModal.module.css'

// "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — SubtaskDetailPanel과
// 같은 드로어 셰이프(TaskDetailModal.module.css)를 재사용하되, 부모 태스크가 없는 메모 전용이라
// "메인 태스크로 이동"/세션 상태 같은 그쪽 UI는 없다. 이름/설명 편집 + 삭제만.
export default function NoteDetailPanel({ noteId, onClose }: { noteId: string | null; onClose(): void }) {
	const open = !!noteId
	const note = useSessionsStore((s) => s.notes.find((n) => n.id === noteId) ?? null)
	const updateSubtaskName = useSessionsStore((s) => s.updateSubtaskName)
	const updateSubtaskDesc = useSessionsStore((s) => s.updateSubtaskDesc)
	const removeSubtask = useSessionsStore((s) => s.removeSubtask)

	function remove() {
		if (!note) return
		onClose()
		removeSubtask(note.id)
	}

	return (
		<div className={styles.overlay} style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} onClick={onClose}>
			<div className={styles.drawer} style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }} onClick={(e) => e.stopPropagation()}>
				{note && (
					<>
						<div className={styles.head}>
							<input
								className={styles.nameInput}
								value={note.name}
								onChange={(e) => updateSubtaskName(note.id, e.target.value)}
								onBlur={(e) => updateSubtaskName(note.id, e.target.value.trim() || note.name)}
							/>
							<button type="button" className={styles.closeBtn} onClick={onClose} title="닫기">
								×
							</button>
						</div>
						<div className={styles.body}>
							<div className={styles.descLabel}>설명</div>
							<textarea className={styles.descInput} value={note.desc} onChange={(e) => updateSubtaskDesc(note.id, e.target.value)} placeholder="메모 내용을 적어주세요" />
							<button type="button" className={styles.metaClear} style={{ marginTop: 16 }} onClick={remove}>
								메모 삭제
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	)
}
