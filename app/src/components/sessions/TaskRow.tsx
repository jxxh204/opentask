import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../store/types'
import type { OrchestrationSession } from '../../api/sessions'
import { removeTask } from '../../api/sessions'
import { useSessionsStore } from '../../store/useSessionsStore'
import BranchChain from './BranchChain'
import SubagentStrip from './SubagentStrip'
import styles from './TaskRow.module.css'

const CLOCK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3.5 2" />
	</svg>
)
const CHECK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
		<path d="M5 13l4 4L19 7" />
	</svg>
)
const LOCK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
		<rect x="5" y="11" width="14" height="9" rx="2" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	</svg>
)
const QUESTION = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 9a3 3 0 1 1 4 2.8c-.9.4-1.5 1.1-1.5 2.2" />
		<path d="M12 17h.01" />
	</svg>
)

function timeAgo(ts: number) {
	const min = Math.floor((Date.now() - ts) / 60000)
	if (min < 1) return '방금'
	if (min < 60) return `${min}m`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}h`
	return `${Math.floor(hr / 24)}d`
}

const PR_LABEL = { open: 'PR open', merged: 'PR merged', closed: 'PR closed' } as const

// 프로토타입의 subtask-row 그대로 — 상태 원(circle) + 제목 + 뱃지가 1행, 브랜치 줄(⎇)이 2행,
// 담당 에이전트(모델) 칩이 3행, 서브에이전트 토글이 그 아래. PR 상태/ahead-behind/서브에이전트는
// 전부 server(cockpit.cjs, worktree/subagents 라우트)의 실시간 조인 데이터 — 지어내지 않는다.
// 이름 변경은 클릭하면 바로 편집되는 인풋이 아니라 우클릭 메뉴로(FolderCard와 동일 패턴).
export default function TaskRow({
	task,
	folderBase,
	session,
	lastActivityAt,
	dragBeforeTaskId,
}: {
	task: Task
	folderBase: string | null
	session: OrchestrationSession | null
	lastActivityAt?: number | null
	dragBeforeTaskId: (e: React.DragEvent) => void
}) {
	const open = useSessionsStore((s) => !!s.openTasks[task.id])
	const toggleTask = useSessionsStore((s) => s.toggleTask)
	const setDragTask = useSessionsStore((s) => s.setDragTask)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const openReview = useSessionsStore((s) => s.openReview)
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)
	const quickStartBusy = useSessionsStore((s) => s.quickStartBusy === task.id)
	const gitStatus = useSessionsStore((s) => s.gitStatus)
	const renameTask = useSessionsStore((s) => s.renameTask)
	// term.cjs가 tmux 화면을 스크레이프해 매번 새로 계산하는 값(저장된 상태 아님) — 세션명으로 조인.
	const termStatus = useSessionsStore((s) => (session ? s.termStatus[session.tmuxSession] : undefined))

	const [menuOpen, setMenuOpen] = useState(false)
	const [renaming, setRenaming] = useState(false)
	const [nameDraft, setNameDraft] = useState(task.name)
	const renameInputRef = useRef<HTMLInputElement>(null)

	const nb = task.branches.length
	const primaryBranch = task.branches[0]
	const git = primaryBranch ? gitStatus[primaryBranch.name] : undefined
	const openReviewCount = task.reviews.filter((r) => r.state === 'open').length
	const hasReviews = task.reviews.length > 0

	const isDone = git?.pr?.state === 'merged'
	// 우선순위(§12): 완료 > 인증필요 > 질문대기 > 진행중 > 대기 — 완료가 아니면 그 다음 확인이 급한 것부터.
	const needsAuth = !isDone && !!termStatus?.needsAuth
	const needsInput = !isDone && !needsAuth && !!termStatus?.waiting
	const isRunning = !isDone && !needsAuth && !needsInput && !!session

	// 사이드바가 "지금 대화 중"이라는 걸 실제로 보여주는 자리(§10) — 장식 애니메이션이 아니라 feed에
	// 진짜 새 이벤트가 들어온 순간에만 0.5초 반짝인다. 이전엔 정적인 스피너뿐이라 대화가 오가도 티가 안 났다.
	const [flash, setFlash] = useState(false)
	const lastSeenActivityRef = useRef<number | null>(null)
	useEffect(() => {
		if (!lastActivityAt) return
		if (lastSeenActivityRef.current !== null && lastActivityAt > lastSeenActivityRef.current) {
			setFlash(true)
			const id = setTimeout(() => setFlash(false), 500)
			lastSeenActivityRef.current = lastActivityAt
			return () => clearTimeout(id)
		}
		lastSeenActivityRef.current = lastActivityAt
	}, [lastActivityAt])

	useEffect(() => {
		if (!menuOpen) return
		const onDocClick = () => setMenuOpen(false)
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	}, [menuOpen])

	useEffect(() => {
		if (renaming) {
			setNameDraft(task.name)
			renameInputRef.current?.focus()
			renameInputRef.current?.select()
		}
	}, [renaming, task.name])

	function commitRename() {
		if (nameDraft.trim() && nameDraft !== task.name) renameTask(task.id, nameDraft.trim())
		setRenaming(false)
	}

	return (
		<div
			className={styles.row}
			draggable
			style={{ opacity: dragTaskId === task.id ? 0.4 : 1 }}
			onDragStart={(e) => {
				e.dataTransfer.effectAllowed = 'move'
				e.dataTransfer.setData('text/plain', task.id)
				setDragTask(task.id)
			}}
			onDragEnd={() => setDragTask(null)}
			onDragOver={(e) => e.preventDefault()}
			onDrop={dragBeforeTaskId}
		>
			<div
				className={`${styles.head} ${open ? styles.headSelected : ''} ${flash ? styles.flash : ''}`}
				onClick={() => toggleTask(task.id)}
				onContextMenu={(e) => {
					e.preventDefault()
					e.stopPropagation()
					setMenuOpen(true)
				}}
			>
				<span
					className={`${styles.statusDot} ${
						isDone ? styles.done : needsAuth ? styles.needsAuth : needsInput ? styles.needsInput : isRunning ? styles.running : styles.waiting
					}`}
					title={needsAuth ? '인증이 필요합니다' : needsInput ? '입력이 필요합니다' : undefined}
				>
					{isDone ? CHECK : needsAuth ? LOCK : needsInput ? QUESTION : isRunning ? <span className={styles.spinner} /> : CLOCK}
				</span>
				<div className={styles.body}>
					<div className={styles.line1}>
						{renaming ? (
							<input
								ref={renameInputRef}
								className={styles.titleInput}
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
							<span className={styles.title}>{task.name}</span>
						)}
						{git?.pr && (
							<span className={`m ${styles.pill} ${git.pr.draft ? styles.pillPrDraft : styles.pillPr}`}>{git.pr.draft ? 'PR draft' : PR_LABEL[git.pr.state]}</span>
						)}
						{hasReviews && (
							<span
								className={`m ${styles.pill} ${openReviewCount > 0 ? styles.pillIssues : styles.pillOk}`}
								onClick={(e) => {
									e.stopPropagation()
									openReview(task.id)
								}}
							>
								{openReviewCount > 0 ? `이슈 ${openReviewCount}` : '리뷰 완료'}
							</span>
						)}
						{nb === 0 && (
							<span
								className={styles.quickStart}
								title={task.folder_id ? '이 서브태스크가 속한 태스크 전체를 오케스트레이션합니다' : '태스크를 만들어 워크트리+세션을 바로 시작합니다'}
								onClick={(e) => {
									e.stopPropagation()
									if (!quickStartBusy) quickStartTask(task.id)
								}}
								style={{ opacity: quickStartBusy ? 0.5 : 1 }}
							>
								{quickStartBusy ? '…' : '시작'}
							</span>
						)}
						<span className={`m ${styles.subTime}`} title={lastActivityAt ? '지휘자와 마지막으로 주고받은 대화 시각' : undefined}>
							{lastActivityAt && lastActivityAt > task.updated_at ? timeAgo(lastActivityAt) : timeAgo(task.updated_at)}
						</span>
					</div>
					{primaryBranch && (
						<div className={`m ${styles.wtLine}`}>
							<span className={styles.wtIcon}>⎇</span>
							{primaryBranch.name}
							{!!git?.ahead && <span className={styles.deltaAhead}> ↑{git.ahead}</span>}
							{!!git?.behind && <span className={styles.deltaBehind}> ↓{git.behind}</span>}
							{nb > 1 && <span className={styles.chainGlyph}>{task.kind === 'parallel' ? ` ⑂${nb}` : ' ●─●'}</span>}
						</div>
					)}
					{session?.modelLabel && (
						<div className={styles.modelChip}>
							<span className={styles.modelDot} />
							{session.modelLabel}
						</div>
					)}
					{session?.worktreePath && (
						<div onClick={(e) => e.stopPropagation()}>
							<SubagentStrip cwd={session.worktreePath} compact />
						</div>
					)}
				</div>
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
						{/* 워크트리 목록에서 "연결"한 태스크를 다시 풀어놓는 자리 — 태스크·브랜치 레코드만
						    지우고 실제 git worktree·브랜치는 그대로 둔다(server/store/tasks.cjs remove). */}
						<div
							className={styles.ctxMenuItem}
							onClick={() => {
								setMenuOpen(false)
								if (confirm(`"${task.name}" 연결을 해제할까요? 워크트리·브랜치는 그대로 남습니다.`)) {
									removeTask(task.id).then(() => useSessionsStore.getState().loadBoard())
								}
							}}
						>
							연결 해제 (워크트리 유지)
						</div>
					</div>
				)}
			</div>
			{open && (
				<div className={styles.detail}>
					<p className={styles.desc}>{task.desc || '설명 없음'}</p>
					{nb > 0 && <BranchChain branches={task.branches} kind={task.kind} groupBase={folderBase} />}
				</div>
			)}
		</div>
	)
}
