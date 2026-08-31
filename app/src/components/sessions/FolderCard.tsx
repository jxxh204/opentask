import { useEffect, useRef, useState } from 'react'
import type { Folder } from '../../store/types'
import { useSessionsStore, getOrchestration } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { LINK_LABEL } from '../../utils/linkDetect'
import type { LinkKind } from '../../utils/linkDetect'
import { useT, useTp, translate } from '../../utils/i18n'
import TaskRow, { PR_LABEL, CHECK, HELP } from './TaskRow'
import TaskColorDot from './TaskColorDot'
import styles from './FolderCard.module.css'
import taskRowStyles from './TaskRow.module.css'

const CLOCK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3.5 2" />
	</svg>
)
// "클로드세션 동작 여부에 따라서... 여러 상태가 보여야해" — TaskRow의 statusDot과 같은 아이콘(LOCK/QUESTION).
const LOCK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		<rect x="5" y="11" width="14" height="9" rx="2" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	</svg>
)
const QUESTION = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 9a3 3 0 1 1 4 2.8c-.9.4-1.5 1.1-1.5 2.2" />
		<path d="M12 17h.01" />
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
	if (min < 1) return translate('방금')
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
	const t = useT()
	const tp = useTp()
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
	// "태스크 매니저가 명령했으면 움직이는 모션이 있어야하는데... 너무 정적이야" — 단일 태스크+서브태스크
	// 체인 폴더(simpleWithSubtasks)는 TaskRow를 아예 안 그려서(§ 아래 taskBody 분기) TaskRow.tsx의 flash가
	// 이 폴더엔 한 번도 안 붙어 있었다. 지휘자(=태스크 매니저) feed에 새 이벤트가 들어온 순간 폴더 헤더
	// 자체를 반짝여 "명령이 오갔다"는 걸 보여준다 — TaskRow의 flash와 같은 원칙(§10), 대상만 폴더 헤더.
	const lastFeedTs = orch.feed.reduce((max, f) => Math.max(max, f.ts), 0) || null
	const [flash, setFlash] = useState(false)
	const lastSeenFeedRef = useRef<number | null>(null)
	useEffect(() => {
		if (!lastFeedTs) return
		if (lastSeenFeedRef.current !== null && lastFeedTs > lastSeenFeedRef.current) {
			setFlash(true)
			const id = setTimeout(() => setFlash(false), 500)
			lastSeenFeedRef.current = lastFeedTs
			return () => clearTimeout(id)
		}
		lastSeenFeedRef.current = lastFeedTs
	}, [lastFeedTs])
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
	// "PR 상황이 보이지 않고 있어. 워크트리 이름도" — TaskRow의 subChainCard와 같은 gitStatus[branch] 조인.
	const gitStatus = useSessionsStore((s) => s.gitStatus)
	const gitStatusByPath = useSessionsStore((s) => s.gitStatusByPath)
	// "클로드세션 동작 여부에 따라서... 여러 상태가 보여야해. 지금은 아무것도 표현되어있지 않아" — 헤더
	// 원이 running/waiting 둘뿐이라 지휘자(태스크 매니저)가 인증·질문 대기 중이어도 티가 안 났다.
	// TaskRow의 statusDot과 같은 소스(termStatus, § term.cjs가 계산)를 지휘자 세션명으로 조인한다.
	const conductorTermStatus = useSessionsStore((s) => (orch.conductor ? s.termStatus[orch.conductor.session] : undefined))
	const needsAuth = !!conductorTermStatus?.needsAuth
	const needsResume = !needsAuth && !!conductorTermStatus?.needsResume
	const needsInput = !needsAuth && !needsResume && !!conductorTermStatus?.waiting
	// "멈춘상황을 어떻게 인지할 수 있을까? 지금은 인지가 어려워" — 지휘자가 명시적 대기(needsInput류)
	// 없이 그냥 조용해진 경우(§ orchestrator.cjs checkStalledSubtasks의 conductorStalled). 백엔드가
	// 확정 판단하지만, 폴링 주기(60초) 지연 없이 곧바로 반영되도록 프론트도 같은 조건을 한 번 더 본다.
	const conductorStalled = !needsAuth && !needsResume && !needsInput && !!orch.conductorStalled
	// "서브태스크가 돌아도 메인태스크 스피너가 도는것같기도하고" — orch.running은 웨이브 오케스트레이션이
	// 한 번이라도 시작됐는지만 볼 뿐(start()에서 세션이 하나라도 있으면 켜지고, stop() 전까진 절대 안
	// 꺼짐) 지금 실제로 뭔가 돌고 있는지와 무관했다. subChainDot과 같은 실데이터(subtaskWork[].alive)를
	// 이 폴더의 모든 태스크에 걸쳐 조인해, 실제 서브태스크가 살아있을 때만 스피너가 돈다.
	const subtaskWorkMap = useSessionsStore((s) => s.subtaskWork)
	const anySubtaskAlive = folder.tasks.some((t) => subtaskWorkMap[t.id]?.some((w) => w.alive))
	const isRunning = !needsAuth && !needsInput && anySubtaskAlive
	// 서브태스크별 세션명으로 다시 조인(§ TaskRow의 subChainDot과 동일 패턴).
	const termStatusMap = useSessionsStore((s) => s.termStatus)
	// "서브태스크 완료 버튼 필요" — 완료 처리한(completed_at) 서브태스크는 이 목록에서 걸러낸다(§ TaskRow
	// visibleSubtasks와 동일 원칙 — 세션이 아직 살아있으면 예외). 전부 완료되면 서브태스크가 없던 것처럼 isSimple로 접힌다.
	const visibleOnlyTaskSubtasks = onlyTask ? onlyTask.subtasks.filter((st) => !st.completed_at || subtaskWork?.find((w) => w.id === st.id)?.alive) : []
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
				className={`${styles.head} ${selected ? styles.headSelected : ''} ${flash ? taskRowStyles.flash : ''}`}
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
				<span
					className={`${styles.statusIcon} ${
						needsAuth
							? styles.needsAuth
							: needsResume || needsInput
								? styles.needsInput
								: conductorStalled
									? styles.stalled
									: isRunning
										? styles.running
										: styles.waiting
					}`}
					title={
						needsAuth
							? t('태스크 매니저에 인증이 필요합니다')
							: needsResume
								? t('세션 재개 확인이 필요합니다 (요약으로 재개할지 메뉴에서 멈춤)')
								: needsInput
									? t('태스크 매니저가 입력을 기다리고 있습니다')
									: conductorStalled
										? t('지휘자가 한동안 응답이 없습니다 — 확인해보세요')
										: undefined
					}
				>
					{needsAuth ? LOCK : needsResume || needsInput ? QUESTION : conductorStalled ? HELP : isRunning ? <span className={styles.spinner} /> : CLOCK}
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
					<span className={`m ${styles.autoMergeBadge}`} title={t('클린 판정이면 사람 확인 없이 자동으로 merge됩니다(우클릭으로 끌 수 있음)')}>
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
											<span>{t(LINK_LABEL[k])}</span>
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
					title={confirmArchive ? t('다시 누르면 보관함으로 이동합니다') : t('완료된 태스크를 보관함으로 이동')}
					onClick={onArchiveClick}
					style={{ opacity: archiveBusy ? 0.5 : undefined, visibility: confirmArchive ? 'visible' : undefined }}
				>
					{confirmArchive ? t('확인') : ARCHIVE_ICON}
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
							{t('이름 변경')}
						</div>
						{/* "메인 태스크 오른쪽 버튼 누르면 나오는 메뉴에 서브 태스크 추가도" — 상세 모달을 열지
						    않아도 사이드바에서 바로 하나 추가. onlyTask가 이 폴더가 실제로 감싸는 그 태스크. */}
						{onlyTask && (
							<div
								className={styles.ctxMenuItem}
								onClick={() => {
									setMenuOpen(false)
									createSubtask(onlyTask.id, { name: t('서브태스크') })
								}}
							>
								+ {t('서브태스크 추가')}
							</div>
						)}
						<div
							className={styles.ctxMenuItem}
							title={t('꺼짐(기본): AI 리뷰가 클린이어도 사람이 직접 merge를 눌러야 함. 켜짐: 클린 판정 시 실제 merge까지 자동(§12).')}
							onClick={() => {
								setMenuOpen(false)
								setFolderAutoMerge(folder.id, !folder.auto_merge)
							}}
						>
							Auto-merge {folder.auto_merge ? t('끄기') : t('켜기')}
						</div>
						<div className={styles.ctxMenuSep} />
						<div
							className={`${styles.ctxMenuItem} ${styles.ctxMenuItemDanger}`}
							title={confirmDelete ? t('다시 누르면 되돌릴 수 없이 삭제됩니다(산하 태스크는 일감함으로 돌아감)') : t('이 메인 태스크를 삭제합니다')}
							style={{ opacity: deleteBusy ? 0.5 : undefined }}
							onClick={onDeleteClick}
						>
							{confirmDelete ? t('정말 삭제할까요? (다시 클릭)') : t('삭제')}
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
							{visibleOnlyTaskSubtasks.map((st) => {
								const work = subtaskWork?.find((w) => w.id === st.id)
								// "PR뱃지도 자동으로 안잡혀" — § TaskRow와 동일 원인·수정(gitStatusByPath 우선, 표시
								// 브랜치명도 실제 지금 값 우선).
								const subGit = work?.worktreePath ? gitStatusByPath[work.worktreePath] : work?.branch ? gitStatus[work.branch] : undefined
								const subBranch = subGit?.branch ?? work?.branch
								const subTermStatus = work?.tmuxSession ? termStatusMap[work.tmuxSession] : undefined
								const subNeedsAuth = !!subTermStatus?.needsAuth
								const subNeedsInput = !subNeedsAuth && !!subTermStatus?.waiting
								return (
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
												work?.blocked || subNeedsAuth || subNeedsInput
													? taskRowStyles.subChainDotAlert
													: work?.stalled
														? taskRowStyles.subChainDotStalled
														: work?.alive
															? taskRowStyles.subChainDotAlive
															: work?.done
																? taskRowStyles.subChainDotComplete
																: work?.started
																	? taskRowStyles.subChainDotDone
																	: ''
											}`}
											title={
												work?.blocked
													? tp('도움 요청: {reason}', { reason: work.blockedReason ?? '' })
													: subNeedsAuth
														? t('인증이 필요합니다')
														: subNeedsInput
															? t('입력이 필요합니다')
															: work?.stalled
																? t('한동안 응답이 없습니다 — 확인해보세요')
																: work?.done
																	? t('완료')
																	: undefined
											}
										>
											{work?.blocked ? HELP : work?.done && !subNeedsAuth && !subNeedsInput && !work?.alive ? CHECK : null}
										</span>
										<div
											className={`${taskRowStyles.subChainCard} ${overSubtaskId === st.id && dragSubtaskId !== st.id ? taskRowStyles.subChainCardDropTarget : ''}`}
											onClick={(e) => {
											e.stopPropagation()
											// "스피너가 있는 태스크는 클릭 시 클로드세션탭이 열렸으면해" — § TaskRow와 동일.
											if (work?.alive) {
												useTabsStore.getState().openSubtaskTab(folder.id, st.id, onlyTask!.id, st.name)
												useTabsStore.getState().setActiveNode(folder.id, 'orchestrator')
											} else {
												openSubtaskDetail(st.id, onlyTask!.id)
											}
										}}
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
											<div className={taskRowStyles.subChainTop}>
												<span className={taskRowStyles.subChainName}>{st.name}</span>
												{subGit?.pr && (
													<a
														href={subGit.pr.url}
														target="_blank"
														rel="noreferrer"
														className={`m ${taskRowStyles.subChainPill} ${subGit.pr.draft ? taskRowStyles.pillPrDraft : taskRowStyles.pillPr}`}
														onClick={(e) => e.stopPropagation()}
													>
														{subGit.pr.draft ? 'PR draft' : PR_LABEL[subGit.pr.state]}
													</a>
												)}
											</div>
											{subBranch && (
												<div className={`m ${taskRowStyles.subChainWt}`}>
													<span className={taskRowStyles.wtIcon}>⎇</span>
													{subBranch}
													{!!subGit?.ahead && <span className={taskRowStyles.deltaAhead}> ↑{subGit.ahead}</span>}
													{!!subGit?.behind && <span className={taskRowStyles.deltaBehind}> ↓{subGit.behind}</span>}
												</div>
											)}
										</div>
									</div>
								)
							})}
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
							{folder.tasks.length === 0 && <div className={styles.emptyDrop}>{t('여기로 서브태스크를 드래그')}</div>}
						</>
					)}
				</div>
			)}
		</div>
	)
}
