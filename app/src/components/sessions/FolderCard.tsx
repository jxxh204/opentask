import { useEffect, useRef, useState } from 'react'
import type { Folder } from '../../store/types'
import { useSessionsStore, getOrchestration } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { LINK_LABEL } from '../../utils/linkDetect'
import type { LinkKind } from '../../utils/linkDetect'
import TaskRow from './TaskRow'
import TaskColorDot from './TaskColorDot'
import styles from './FolderCard.module.css'
import taskRowStyles from './TaskRow.module.css'

const CLOCK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3.5 2" />
	</svg>
)
const ARCHIVE_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<rect x="3" y="4" width="18" height="5" rx="1.2" />
		<path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
	</svg>
)
const LINK_ICON: Record<LinkKind, React.ReactNode> = {
	figma: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<path d="M9 3h4a3 3 0 0 1 0 6H9zM9 9h4a3 3 0 0 1 0 6H9zM9 15h3a3 3 0 1 1-3 3z" />
		</svg>
	),
	doc: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
			<path d="M14 3v4h4M9 13h6M9 16h6" />
		</svg>
	),
	thread: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L4 20l1-4.7A8.5 8.5 0 1 1 21 11.5z" />
		</svg>
	),
	pr: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<circle cx="6" cy="6" r="2.1" />
			<circle cx="6" cy="18" r="2.1" />
			<circle cx="18" cy="8" r="2.1" />
			<path d="M6 8.1v7.8M18 10.1c0 3-3 4-6 4.5" />
		</svg>
	),
}

function timeAgo(ts: number) {
	const min = Math.floor((Date.now() - ts) / 60000)
	if (min < 1) return '방금'
	if (min < 60) return `${min}m`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}h`
	return `${Math.floor(hr / 24)}d`
}

// 실제 백엔드의 Folder = "태스크"(오케스트레이션 단위, 최상위) — 별도의 "폴더" 개념은 UI에 없다.
// 오케스트레이터는 사이드바 노드가 아니라 VSCode 탭처럼 워크스페이스에 기본 장착되는 탭이다(X로
// 닫고 +로 얼마든지 새 탭을 더할 수 있음 — TabWorkspace 참고). 이름(등 헤더 나머지 영역)을 누르면 이
// 태스크를 활성 노드로 선택해 그 기본 탭을 열고, 화살표를 누르면 펼치기/접기만 한다(§ "화살표를
// 누르면 화살표 역할만" — 이전엔 헤더 전체가 한 번에 둘 다 해서 혼동됐다). 사이드바엔 서브태스크
// (작업)들만 한 단계로 나열한다. "시작" 버튼은 없다 — 서브태스크가 생기는 순간 자동으로 통제가
// 시작된다(useSessionsStore.createTaskInFolder/moveTask/quickStartTask에서 트리거).
//
// 이름 변경은 클릭하면 바로 편집되는 인풋이 아니라 우클릭 메뉴로 — 실수로 트리거 안 되게(탭 이름
// 변경과 동일 패턴, TabWorkspace 참고).

export default function FolderCard({ folder }: { folder: Folder }) {
	const open = useSessionsStore((s) => s.openFolders[folder.id] !== false)
	const toggleFolder = useSessionsStore((s) => s.toggleFolder)
	const renameFolder = useSessionsStore((s) => s.renameFolder)
	const updateTaskColor = useSessionsStore((s) => s.updateTaskColor)
	const openSubtaskDetail = useSessionsStore((s) => s.openSubtaskDetail)
	const createSubtask = useSessionsStore((s) => s.createSubtask)
	const setFolderAutoMerge = useSessionsStore((s) => s.setFolderAutoMerge)
	const overFolderId = useSessionsStore((s) => s.overFolderId)
	const setOverFolder = useSessionsStore((s) => s.setOverFolder)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const moveTask = useSessionsStore((s) => s.moveTask)
	const dragSubtaskId = useSessionsStore((s) => s.dragSubtaskId)
	const dragSubtaskTaskId = useSessionsStore((s) => s.dragSubtaskTaskId)
	const overSubtaskId = useSessionsStore((s) => s.overSubtaskId)
	const setDragSubtask = useSessionsStore((s) => s.setDragSubtask)
	const setOverSubtask = useSessionsStore((s) => s.setOverSubtask)
	const reorderSubtasks = useSessionsStore((s) => s.reorderSubtasks)
	const orch = useSessionsStore((s) => getOrchestration(s, folder.id))
	const archiveFolder = useSessionsStore((s) => s.archiveFolder)
	const archiveBusy = useSessionsStore((s) => s.archiveBusy === folder.id)
	const deleteFolder = useSessionsStore((s) => s.deleteFolder)
	const deleteBusy = useSessionsStore((s) => s.deleteBusy === folder.id)
	const activeNodeId = useTabsStore((s) => s.activeNodeId)
	const [confirmArchive, setConfirmArchive] = useState(false)
	const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	// "메인 태스크 오른쪽 마우스 클릭하면 삭제 UI" — 되돌릴 수 없는 동작이라 archiveFolder와 같은
	// "두 번 눌러야 확정" 패턴(§ onArchiveClick)을 그대로 따른다 — 별도 모달 없이 메뉴 안에서 바로.
	const [confirmDelete, setConfirmDelete] = useState(false)
	const deleteConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	const [menuOpen, setMenuOpen] = useState(false)
	const [renaming, setRenaming] = useState(false)
	const [nameDraft, setNameDraft] = useState(folder.name)
	const renameInputRef = useRef<HTMLInputElement>(null)
	const [linkPanelOpen, setLinkPanelOpen] = useState(false)

	const isOver = overFolderId === folder.id
	const selected = activeNodeId === folder.id
	// quickStartTask는 인박스 태스크를 폴더로 승격하고, 그 태스크 자신을 첫 서브태스크로 옮긴다 —
	// 폴더 산하 태스크가 딱 하나면(가장 흔한 "태스크 하나만" 케이스) 폴더=그 태스크 1:1이라, 펼쳐서
	// TaskRow를 또 그리면 "신규 고객 뱃지 on/off" 밑에 "신규 고객 뱃지 on/off 개발 및 QA"처럼 이름이
	// (완전히 같지 않아도) 사실상 겹쳐 보인다("이건 왜 뎁스가 하나 더있대" 신고) — 이름이 정확히
	// 같은지와 무관하게 태스크가 하나뿐이면 항상 한 단계로 접는다. 서브태스크(Subtask)가 생기면
	// TaskRow를 또 그리는 대신 그 목록만 폴더 헤더 바로 아래에 곧바로 보여준다.
	const onlyTask = folder.tasks.length === 1 ? folder.tasks[0] : null
	// "진행중 표기도 안돼" — subChain 점의 진행 중/세션 종료 색은 여기서 읽는다(§ useSessionsStore.subtaskWork,
	// SessionShell이 15초마다 전체 갱신).
	const subtaskWork = useSessionsStore((s) => (onlyTask ? s.subtaskWork[onlyTask.id] : undefined))
	// "서브태스크 완료 버튼 필요" — 완료 처리한(completed_at) 서브태스크는 이 목록에서 걸러낸다(§ TaskRow
	// visibleSubtasks와 동일 원칙). 전부 완료되면 서브태스크가 없던 것처럼 isSimple로 접힌다.
	const visibleOnlyTaskSubtasks = onlyTask ? onlyTask.subtasks.filter((st) => !st.completed_at) : []
	const simpleWithSubtasks = !!onlyTask && visibleOnlyTaskSubtasks.length > 0
	const isSimple = !!onlyTask && !simpleWithSubtasks

	// 이 태스크 산하 모든 서브태스크·브랜치의 링크를 종류별로 모은다 — Figma/Notion/Slack/PR 실데이터.
	const linksByKind = new Map<LinkKind, string[]>()
	for (const t of folder.tasks) {
		for (const b of t.branches) {
			for (const lk of b.links) {
				const arr = linksByKind.get(lk.kind) ?? []
				arr.push(lk.url)
				linksByKind.set(lk.kind, arr)
			}
		}
	}
	const linkKinds = Array.from(linksByKind.keys())

	useEffect(() => {
		if (!menuOpen) {
			// 메뉴가 닫히면 "확인" 무장 상태도 같이 풀어둔다 — 안 그러면 다음에 메뉴를 다시 열었을 때
			// 실수로 한 번만 눌러도 바로 삭제되는 함정이 생긴다.
			setConfirmDelete(false)
			if (deleteConfirmTimer.current) clearTimeout(deleteConfirmTimer.current)
			return
		}
		const onDocClick = () => setMenuOpen(false)
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	}, [menuOpen])

	useEffect(() => {
		if (!linkPanelOpen) return
		const onDocClick = () => setLinkPanelOpen(false)
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	}, [linkPanelOpen])

	useEffect(() => {
		if (renaming) {
			setNameDraft(folder.name)
			renameInputRef.current?.focus()
			renameInputRef.current?.select()
		}
	}, [renaming, folder.name])

	function commitRename() {
		if (nameDraft.trim() && nameDraft !== folder.name) renameFolder(folder.id, nameDraft.trim())
		setRenaming(false)
	}

	function onArchiveClick(e: React.MouseEvent) {
		e.stopPropagation()
		if (archiveBusy) return
		if (!confirmArchive) {
			setConfirmArchive(true)
			confirmTimer.current = setTimeout(() => setConfirmArchive(false), 2500)
			return
		}
		if (confirmTimer.current) clearTimeout(confirmTimer.current)
		setConfirmArchive(false)
		archiveFolder(folder.id)
	}

	// "삭제 UI 넣고 기능까지" — 되돌릴 수 없어 메뉴 안에서 한 번 더 누르게 한다(위 onArchiveClick과
	// 같은 패턴). 폴더만 지워지고 산하 태스크는 일감함으로 돌아간다(§ deleteFolder 주석).
	function onDeleteClick(e: React.MouseEvent) {
		e.stopPropagation()
		if (deleteBusy) return
		if (!confirmDelete) {
			setConfirmDelete(true)
			deleteConfirmTimer.current = setTimeout(() => setConfirmDelete(false), 2500)
			return
		}
		if (deleteConfirmTimer.current) clearTimeout(deleteConfirmTimer.current)
		setConfirmDelete(false)
		setMenuOpen(false)
		deleteFolder(folder.id)
	}

	// "화살표를 누르면 화살표 역할만 하고 이름을 눌러야 태스크 접속해줘" — 펼치기/접기(화살표 전용)와
	// 태스크 진입(이름 등 나머지 영역)을 분리한다. 이전엔 헤더 전체가 한 번에 둘 다 했다.
	// "메인 태스크 누르면 이제 메인태스크의 상세페이지가 탭으로 나와야한다고 했었어" — setActiveNode만
	// 하면 예전에 마지막으로 보던 탭(대개 태스크 매니저 터미널)이 그대로 다시 뜬다. 다른 진입점
	// (openTaskOrFolderDetail, SubtaskDetailPanel의 "메인 태스크로 이동")과 똑같이 다이어그램(=이
	// 태스크의 실제 상세 뷰)을 항상 같이 포커스한다.
	function enter() {
		useTabsStore.getState().setActiveNode(folder.id, 'orchestrator')
		useTabsStore.getState().openOrFocusTab(folder.id, 'detail')
	}
	function toggleChevron(e: React.MouseEvent) {
		e.stopPropagation()
		if (!isSimple) toggleFolder(folder.id)
	}

	return (
		<div
			className={styles.node}
			style={isOver ? { background: 'var(--vtint)', borderRadius: 8 } : undefined}
			onDragOver={(e) => {
				e.preventDefault()
				if (overFolderId !== folder.id) setOverFolder(folder.id)
			}}
			onDrop={(e) => {
				e.preventDefault()
				if (dragTaskId) moveTask(dragTaskId, folder.id)
			}}
		>
			<div
				className={`${styles.head} ${selected ? styles.headSelected : ''}`}
				onClick={enter}
				onContextMenu={(e) => {
					e.preventDefault()
					e.stopPropagation()
					setMenuOpen(true)
				}}
			>
				{isSimple ? (
					<span className={styles.chevron} style={{ width: 9, height: 9 }} />
				) : (
					<svg
						className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
						width="9"
						height="9"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2.4}
						strokeLinecap="round"
						strokeLinejoin="round"
						onClick={toggleChevron}
					>
						<path d="M9 6l6 6-6 6" />
					</svg>
				)}
				<span className={`${styles.statusIcon} ${orch.running ? styles.running : styles.waiting}`}>
					{orch.running ? <span className={styles.spinner} /> : CLOCK}
				</span>
				{renaming ? (
					<input
						ref={renameInputRef}
						className={styles.nameInput}
						value={nameDraft}
						onClick={(e) => e.stopPropagation()}
						onChange={(e) => setNameDraft(e.target.value)}
						onBlur={commitRename}
						onKeyDown={(e) => {
							if (e.key === 'Enter') commitRename()
							if (e.key === 'Escape') setRenaming(false)
						}}
					/>
				) : (
					<>
						{onlyTask && <TaskColorDot color={onlyTask.color} onPick={(color) => updateTaskColor(onlyTask.id, color)} />}
						<span className={styles.nameText}>{folder.name}</span>
					</>
				)}
				{!!folder.auto_merge && (
					<span className={`m ${styles.autoMergeBadge}`} title="클린 판정이면 사람 확인 없이 자동으로 merge됩니다(우클릭으로 끌 수 있음)">
						auto-merge
					</span>
				)}
				{linkKinds.length > 0 && (
					<span className={styles.linkAnchor}>
						<span
							className={styles.linkCluster}
							onClick={(e) => {
								e.stopPropagation()
								setLinkPanelOpen((o) => !o)
							}}
						>
							{linkKinds.map((k) => (
								<span key={k} className={styles.linkIcon}>
									{LINK_ICON[k]}
								</span>
							))}
						</span>
						{linkPanelOpen && (
							<div className={styles.linkPanel} onClick={(e) => e.stopPropagation()}>
								{linkKinds.map((k) => (
									<div key={k} className={styles.linkPanelGroup}>
										<div className={styles.linkPanelSrc}>
											{LINK_ICON[k]}
											<span>{LINK_LABEL[k]}</span>
										</div>
										{linksByKind.get(k)!.map((url) => (
											<a key={url} href={url} target="_blank" rel="noreferrer" className={styles.linkPanelItem} onClick={(e) => e.stopPropagation()}>
												{url}
											</a>
										))}
									</div>
								))}
							</div>
						)}
					</span>
				)}
				<span className={`m ${styles.time}`}>{timeAgo(folder.updated_at)}</span>
				<span
					className={`${styles.archiveBtn} ${confirmArchive ? styles.archiveConfirm : ''}`}
					title={confirmArchive ? '다시 누르면 보관함으로 이동합니다' : '완료된 태스크를 보관함으로 이동'}
					onClick={onArchiveClick}
					style={{ opacity: archiveBusy ? 0.5 : undefined, visibility: confirmArchive ? 'visible' : undefined }}
				>
					{confirmArchive ? '확인' : ARCHIVE_ICON}
				</span>
				{menuOpen && (
					<div className={styles.ctxMenu} onClick={(e) => e.stopPropagation()}>
						<div
							className={styles.ctxMenuItem}
							onClick={() => {
								setMenuOpen(false)
								setRenaming(true)
							}}
						>
							이름 변경
						</div>
						{/* "메인 태스크 오른쪽 버튼 누르면 나오는 메뉴에 서브 태스크 추가도" — 상세 모달을 열지
						    않아도 사이드바에서 바로 하나 추가. onlyTask가 이 폴더가 실제로 감싸는 그 태스크. */}
						{onlyTask && (
							<div
								className={styles.ctxMenuItem}
								onClick={() => {
									setMenuOpen(false)
									createSubtask(onlyTask.id, { name: '서브태스크' })
								}}
							>
								+ 서브태스크 추가
							</div>
						)}
						<div
							className={styles.ctxMenuItem}
							title="꺼짐(기본): AI 리뷰가 클린이어도 사람이 직접 merge를 눌러야 함. 켜짐: 클린 판정 시 실제 merge까지 자동(§12)."
							onClick={() => {
								setMenuOpen(false)
								setFolderAutoMerge(folder.id, !folder.auto_merge)
							}}
						>
							Auto-merge {folder.auto_merge ? '끄기' : '켜기'}
						</div>
						<div className={styles.ctxMenuSep} />
						<div
							className={`${styles.ctxMenuItem} ${styles.ctxMenuItemDanger}`}
							title={confirmDelete ? '다시 누르면 되돌릴 수 없이 삭제됩니다(산하 태스크는 일감함으로 돌아감)' : '이 메인 태스크를 삭제합니다'}
							style={{ opacity: deleteBusy ? 0.5 : undefined }}
							onClick={onDeleteClick}
						>
							{confirmDelete ? '정말 삭제할까요? (다시 클릭)' : '삭제'}
						</div>
					</div>
				)}
			</div>
			{open && !isSimple && (
				<div className={styles.taskBody}>
					{simpleWithSubtasks ? (
						<div
							className={taskRowStyles.subChainWrap}
							onDragOver={(e) => {
								if (dragSubtaskTaskId !== onlyTask!.id) return
								e.preventDefault()
								e.stopPropagation()
							}}
							onDrop={(e) => {
								if (dragSubtaskTaskId !== onlyTask!.id || !dragSubtaskId) return
								e.preventDefault()
								e.stopPropagation()
								reorderSubtasks(onlyTask!.id, dragSubtaskId, null)
							}}
						>
							<div className={taskRowStyles.subChainRail} />
							{visibleOnlyTaskSubtasks.map((st) => (
								<div
									key={st.id}
									className={taskRowStyles.subChainNode}
									draggable
									style={{ opacity: dragSubtaskId === st.id ? 0.4 : 1 }}
									onDragStart={(e) => {
										e.stopPropagation()
										e.dataTransfer.effectAllowed = 'move'
										e.dataTransfer.setData('text/plain', st.id)
										setDragSubtask(st.id, onlyTask!.id)
									}}
									onDragEnd={(e) => {
										e.stopPropagation()
										setDragSubtask(null, null)
										setOverSubtask(null)
									}}
								>
									<span
										className={`${taskRowStyles.subChainDot} ${
											subtaskWork?.find((w) => w.id === st.id)?.alive
												? taskRowStyles.subChainDotAlive
												: subtaskWork?.find((w) => w.id === st.id)?.started
													? taskRowStyles.subChainDotDone
													: ''
										}`}
									/>
									<div
										className={`${taskRowStyles.subChainCard} ${overSubtaskId === st.id && dragSubtaskId !== st.id ? taskRowStyles.subChainCardDropTarget : ''}`}
										onClick={(e) => { e.stopPropagation(); openSubtaskDetail(st.id, onlyTask!.id) }}
										onDragOver={(e) => {
											if (dragSubtaskTaskId !== onlyTask!.id || dragSubtaskId === st.id) return
											e.preventDefault()
											e.stopPropagation()
											if (overSubtaskId !== st.id) setOverSubtask(st.id)
										}}
										onDragLeave={(e) => {
											e.stopPropagation()
											if (overSubtaskId === st.id) setOverSubtask(null)
										}}
										onDrop={(e) => {
											if (dragSubtaskTaskId !== onlyTask!.id || !dragSubtaskId) return
											e.preventDefault()
											e.stopPropagation()
											reorderSubtasks(onlyTask!.id, dragSubtaskId, st.id)
										}}
									>
										<span className={taskRowStyles.subChainName}>{st.name}</span>
									</div>
								</div>
							))}
						</div>
					) : (
						<>
							{folder.tasks.length > 0 && (
								<div className={styles.subtaskList}>
									{folder.tasks.map((t) => (
										<TaskRow
											key={t.id}
											task={t}
											folderBase={folder.base}
											session={orch.sessions.find((s) => s.taskId === t.id) ?? null}
											// 지휘자↔서브태스크가 실제로 주고받은 대화(§10 "사이드바가 살아있게") — task.updated_at은
											// DB 메타데이터라 대화가 오가도 안 바뀌는데, feed는 실제 타임스탬프가 있다.
											lastActivityAt={orch.feed.filter((f) => f.from === t.id || f.to === t.id).reduce((max, f) => Math.max(max, f.ts), 0) || null}
											dragBeforeTaskId={(e) => {
												e.preventDefault()
												e.stopPropagation()
												if (dragTaskId) moveTask(dragTaskId, folder.id, t.id)
											}}
										/>
									))}
								</div>
							)}
							{folder.tasks.length === 0 && <div className={styles.emptyDrop}>여기로 서브태스크를 드래그</div>}
						</>
					)}
				</div>
			)}
		</div>
	)
}
