import { useEffect, useState } from 'react'
import { useSessionsStore, openTaskOrFolderDetail } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { getSubtaskWorkState, stopSubtaskSession } from '../../api/sessions'
import type { SubtaskWorkStatus } from '../../api/sessions'
import { addBusinessDays } from '../../utils/businessDays'
import styles from './TaskDetailModal.module.css'

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

// "서브태스크를 누르면 해당 서브태스크의 내용만 보이게" — 부모 태스크 전체를 담은 TaskDetailModal과
// 별개로, 서브태스크 하나만을 위한 드로어. 같은 슬라이드인 셰이프(TaskDetailModal.module.css 재사용)
// 를 쓰되 내용은 이 서브태스크 자신의 이름/설명/예정일/기간 + 지금 세션 상태로 좁힌다. 상단의
// "메인 태스크: X"를 누르면 이 패널을 닫고 그 태스크의 다이어그램 탭으로 넘어가 전체 체인을 보여준다.
export default function SubtaskDetailPanel({ subtaskId, parentTaskId, onClose }: { subtaskId: string | null; parentTaskId: string | null; onClose(): void }) {
	const open = !!subtaskId && !!parentTaskId
	const parentTask = useSessionsStore((s) => {
		if (!parentTaskId) return null
		return s.inbox.find((t) => t.id === parentTaskId) ?? s.folders.flatMap((f) => f.tasks).find((t) => t.id === parentTaskId) ?? null
	})
	const parentFolderId = useSessionsStore((s) => {
		if (!parentTaskId) return null
		const f = s.folders.find((f) => f.tasks.some((t) => t.id === parentTaskId))
		return f ? f.id : null
	})
	const updateSubtaskName = useSessionsStore((s) => s.updateSubtaskName)
	const updateSubtaskDesc = useSessionsStore((s) => s.updateSubtaskDesc)
	const updateSubtaskDueDate = useSessionsStore((s) => s.updateSubtaskDueDate)
	const updateSubtaskDuration = useSessionsStore((s) => s.updateSubtaskDuration)
	const setSubtaskDone = useSessionsStore((s) => s.setSubtaskDone)
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)

	const subtask = parentTask?.subtasks.find((st) => st.id === subtaskId) ?? null

	const [work, setWork] = useState<SubtaskWorkStatus | null>(null)
	const [busy, setBusy] = useState(false)
	useEffect(() => {
		if (!open || !parentTaskId || !subtaskId) return
		let cancelled = false
		async function poll() {
			const r = await getSubtaskWorkState(parentTaskId!)
			if (!cancelled && r.ok) setWork(r.subtasks.find((x) => x.id === subtaskId) ?? null)
		}
		poll()
		const id = window.setInterval(poll, 5000)
		return () => {
			cancelled = true
			window.clearInterval(id)
		}
	}, [open, parentTaskId, subtaskId])

	function goToMainTask() {
		if (!parentFolderId) return
		onClose()
		useTabsStore.getState().setActiveNode(parentFolderId, 'orchestrator')
		useTabsStore.getState().openOrFocusTab(parentFolderId, 'detail')
	}

	// "메인태스크가 없는건 승격 기능을 넣고... 승격되면 상세 UI도 메인태스크 UI로 변경되어야하고" —
	// 이 서브태스크의 부모가 아직 일감함에 머물러(폴더로 승격 전) 다이어그램이 없을 때 그 자리에서
	// 바로 승격시키고("시작" 버튼과 같은 quickStartTask), 성공하면 이 서브태스크 패널은 닫고 "메인
	// 태스크는 이제 사이드바에서 상세페이지를 띄우지말고 탭으로" — 이제 진짜 메인 태스크가 된 그
	// 태스크의 탭(태스크 매니저/다이어그램)으로 이동한다(TaskDetailModal 드로어 아님).
	const [promoting, setPromoting] = useState(false)
	async function promoteMainTask() {
		if (!parentTaskId) return
		setPromoting(true)
		try {
			await quickStartTask(parentTaskId)
			onClose()
			openTaskOrFolderDetail(parentTaskId)
		} finally {
			setPromoting(false)
		}
	}

	async function stopSession() {
		if (!subtaskId) return
		setBusy(true)
		try {
			await stopSubtaskSession(subtaskId)
			const r = await getSubtaskWorkState(parentTaskId!)
			if (r.ok) setWork(r.subtasks.find((x) => x.id === subtaskId) ?? null)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className={styles.overlay} style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} onClick={onClose}>
			<div className={styles.drawer} style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }} onClick={(e) => e.stopPropagation()}>
				{subtask && parentTask && (
					<>
						<div className={styles.head}>
							<input
								className={styles.nameInput}
								style={subtask.completed_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
								value={subtask.name}
								onChange={(e) => updateSubtaskName(subtask.id, e.target.value)}
								onBlur={(e) => updateSubtaskName(subtask.id, e.target.value.trim() || subtask.name)}
							/>
							{/* "서브태스크 완료 버튼 필요" — TaskDetailContent.doneToggle과 같은 패턴. 완료해도
							    레코드는 지우지 않고 completed_at만 찍혀 사이드바 subChain 목록에서 사라진다
							    (캘린더엔 그대로 남음, § CalendarPane). */}
							<button
								type="button"
								className={`${styles.doneToggle} ${subtask.completed_at ? styles.doneToggleActive : ''}`}
								onClick={() => setSubtaskDone(subtask.id, !subtask.completed_at)}
								title="완료 처리 — 사이드바 목록에서는 사라지고 캘린더에는 남습니다"
							>
								<span className={styles.doneCheck} />
								완료
							</button>
							<button type="button" className={styles.closeBtn} onClick={onClose} title="닫기">
								×
							</button>
						</div>
						<div className={styles.body}>
							{parentFolderId ? (
								<button type="button" className={mainTaskLinkClass()} onClick={goToMainTask} title="메인 태스크 다이어그램으로 이동">
									↰ 메인 태스크: {parentTask.name}
								</button>
							) : (
								<div className={mainTaskLinkClass()} style={{ justifyContent: 'space-between', cursor: 'default' }}>
									<span>↰ 메인 태스크: {parentTask.name}</span>
									<button type="button" className={styles.metaClear} disabled={promoting} onClick={promoteMainTask} title="이 메인 태스크를 승격해 오케스트레이션(워크트리·다이어그램)을 시작합니다">
										{promoting ? '승격 중…' : '승격'}
									</button>
								</div>
							)}

							<div className={styles.metaRow}>
								<span className={styles.metaLabel}>예정일</span>
								<input
									type="date"
									className="fin m"
									style={{ width: 150, height: 30 }}
									value={subtask.due_date ? msToDateInputValue(subtask.due_date) : ''}
									onChange={(e) => updateSubtaskDueDate(subtask.id, e.target.value ? dateInputValueToMs(e.target.value) : null)}
								/>
								{subtask.due_date !== null && (
									<button type="button" className={styles.metaClear} onClick={() => updateSubtaskDueDate(subtask.id, null)}>
										지우기
									</button>
								)}
							</div>
							{subtask.due_date !== null && (
								<div className={styles.metaRow}>
									<span className={styles.metaLabel}>기간</span>
									<input
										type="number"
										min={1}
										className="fin m"
										style={{ width: 56, height: 30 }}
										placeholder="1"
										value={subtask.duration_days ?? ''}
										onChange={(e) => updateSubtaskDuration(subtask.id, e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null)}
									/>
									<span className={styles.metaHint}>영업일</span>
									{subtask.duration_days !== null && subtask.duration_days > 1 && (
										<span className={styles.metaHint}>
											~ {new Date(addBusinessDays(subtask.due_date, subtask.duration_days)).getMonth() + 1}월 {new Date(addBusinessDays(subtask.due_date, subtask.duration_days)).getDate()}일 종료
										</span>
									)}
								</div>
							)}

							<div className={styles.metaRow} style={{ alignItems: 'center' }}>
								<span className={styles.metaLabel}>세션</span>
								{work?.alive ? (
									<>
										<span className={sessionBadgeClass('alive')}>진행 중</span>
										<button type="button" className={styles.metaClear} disabled={busy} onClick={stopSession}>
											{busy ? '종료 중…' : '세션 종료'}
										</button>
									</>
								) : work?.started ? (
									<span className={sessionBadgeClass('done')}>세션 종료됨</span>
								) : (
									<span className={sessionBadgeClass('idle')}>대기</span>
								)}
							</div>
							{work?.worktreePath && <div className={styles.metaHint}>worktree: {work.worktreePath}</div>}
							{work?.branch && <div className={styles.metaHint}>⎇ {work.branch}</div>}

							<div className={styles.descLabel} style={{ marginTop: 16 }}>
								설명
							</div>
							<textarea className={styles.descInput} value={subtask.desc} onChange={(e) => updateSubtaskDesc(subtask.id, e.target.value)} placeholder="이 서브태스크에 대해 설명해 주세요" />
						</div>
					</>
				)}
			</div>
		</div>
	)
}

function mainTaskLinkClass() {
	return styles.mainTaskLink
}
function sessionBadgeClass(kind: 'alive' | 'done' | 'idle') {
	return `${styles.sessionBadge} ${kind === 'alive' ? styles.sessionBadgeAlive : kind === 'done' ? styles.sessionBadgeDone : styles.sessionBadgeIdle}`
}
