import { useEffect, useRef, useState } from 'react'
import type { Folder, Task } from '../../store/types'
import { useSessionsStore, getOrchestration } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { LINK_LABEL } from '../../utils/linkDetect'
import type { LinkKind } from '../../utils/linkDetect'
import TaskRow from './TaskRow'
import styles from './FolderCard.module.css'

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
// 닫고 +로 얼마든지 새 탭을 더할 수 있음 — TabWorkspace 참고). 헤더를 누르면 펼치기/접기와 동시에
// 이 태스크를 활성 노드로 선택해 그 기본 탭을 연다. 사이드바엔 서브태스크(작업)들만 한 단계로
// 나열한다. "시작" 버튼은 없다 — 서브태스크가 생기는 순간 자동으로 통제가 시작된다
// (useSessionsStore.createTaskInFolder/moveTask/quickStartTask에서 트리거).
//
// 이름 변경은 클릭하면 바로 편집되는 인풋이 아니라 우클릭 메뉴로 — 실수로 트리거 안 되게(탭 이름
// 변경과 동일 패턴, TabWorkspace 참고).
// 우선순위(§12/§10): 완료가 아닌 것 중 확인이 급한 순서 — 인증필요 > 질문대기 > 진행중 > 대기 > 완료.
// 접힌 카드는 이 순서대로 상위 몇 개만 보여주고 나머지는 "+N"으로 접어, 확인이 급한 서브태스크가 안 잘리게 한다.
function taskUrgency(
	t: Task,
	sessions: { taskId: string; tmuxSession: string }[],
	gitStatus: Record<string, { pr?: { state: string } | null }>,
	termStatus: Record<string, { waiting?: boolean; needsAuth?: boolean } | undefined>,
) {
	const primaryBranch = t.branches[0]
	const git = primaryBranch ? gitStatus[primaryBranch.name] : undefined
	const isDone = git?.pr?.state === 'merged'
	const session = sessions.find((s) => s.taskId === t.id) ?? null
	const ts = session ? termStatus[session.tmuxSession] : undefined
	const needsAuth = !isDone && !!ts?.needsAuth
	const needsInput = !isDone && !needsAuth && !!ts?.waiting
	const isRunning = !isDone && !needsAuth && !needsInput && !!session
	if (needsAuth) return { rank: 0, kind: 'needsAuth' as const }
	if (needsInput) return { rank: 1, kind: 'needsInput' as const }
	if (isRunning) return { rank: 2, kind: 'running' as const }
	if (isDone) return { rank: 4, kind: 'done' as const }
	return { rank: 3, kind: 'waiting' as const }
}
const PREVIEW_ICON: Record<string, string> = { needsAuth: '🔒', needsInput: '?', running: '', done: '✓', waiting: '' }
const PREVIEW_MAX = 3

export default function FolderCard({ folder }: { folder: Folder }) {
	const open = useSessionsStore((s) => s.openFolders[folder.id] !== false)
	const toggleFolder = useSessionsStore((s) => s.toggleFolder)
	const renameFolder = useSessionsStore((s) => s.renameFolder)
	const setFolderAutoMerge = useSessionsStore((s) => s.setFolderAutoMerge)
	const overFolderId = useSessionsStore((s) => s.overFolderId)
	const setOverFolder = useSessionsStore((s) => s.setOverFolder)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const moveTask = useSessionsStore((s) => s.moveTask)
	const orch = useSessionsStore((s) => getOrchestration(s, folder.id))
	const gitStatus = useSessionsStore((s) => s.gitStatus)
	const termStatus = useSessionsStore((s) => s.termStatus)
	const archiveFolder = useSessionsStore((s) => s.archiveFolder)
	const archiveBusy = useSessionsStore((s) => s.archiveBusy === folder.id)
	const activeNodeId = useTabsStore((s) => s.activeNodeId)
	const [confirmArchive, setConfirmArchive] = useState(false)
	const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	const [menuOpen, setMenuOpen] = useState(false)
	const [renaming, setRenaming] = useState(false)
	const [nameDraft, setNameDraft] = useState(folder.name)
	const renameInputRef = useRef<HTMLInputElement>(null)
	const [linkPanelOpen, setLinkPanelOpen] = useState(false)

	const isOver = overFolderId === folder.id
	const selected = activeNodeId === folder.id
	// quickStartTask는 인박스 태스크를 그 텍스트 그대로 폴더명으로 승격하고, 그 태스크 자신을 첫
	// 서브태스크로 옮긴다 — 서브태스크가 딱 하나고 이름이 폴더와 같으면(가장 흔한 "태스크 하나만"
	// 케이스) 펼쳐도 똑같은 이름이 한 번 더 나올 뿐이라 펼치기 자체를 없애고 한 줄로 보여준다.
	const isSimple = folder.tasks.length === 1 && folder.tasks[0].name === folder.name

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
		if (!menuOpen) return
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

	function toggle() {
		if (!isSimple) toggleFolder(folder.id)
		useTabsStore.getState().setActiveNode(folder.id, 'orchestrator')
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
				onClick={toggle}
				onContextMenu={(e) => {
					e.preventDefault()
					e.stopPropagation()
					setMenuOpen(true)
				}}
			>
				{isSimple ? (
					<span className={styles.chevron} style={{ width: 9, height: 9 }} />
				) : (
					<svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
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
					<span className={styles.nameText}>{folder.name}</span>
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
					</div>
				)}
			</div>
			{open && !isSimple && (
				<div className={styles.taskBody}>
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
				</div>
			)}
			{!open && !isSimple && folder.tasks.length > 0 && (
				<div className={styles.previewChips}>
					{folder.tasks
						.map((t) => ({ t, u: taskUrgency(t, orch.sessions, gitStatus, termStatus) }))
						.sort((a, b) => a.u.rank - b.u.rank)
						.slice(0, PREVIEW_MAX)
						.map(({ t, u }) => (
							<span key={t.id} className={`${styles.previewChip} ${styles[u.kind]}`} title={t.name}>
								{u.kind === 'running' ? <span className={styles.spinner} /> : PREVIEW_ICON[u.kind]}
								{t.name}
							</span>
						))}
					{folder.tasks.length > PREVIEW_MAX && <span className={styles.previewOverflow}>+{folder.tasks.length - PREVIEW_MAX}</span>}
				</div>
			)}
		</div>
	)
}
