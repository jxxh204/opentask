import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../store/types'
import type { OrchestrationSession } from '../../api/sessions'
import { removeTask } from '../../api/sessions'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { useGlobalTabsStore } from '../../store/useGlobalTabsStore'
import { useT, useTp } from '../../utils/i18n'
import { timeAgo } from '../../utils/timeAgo'
import { CLOCK, CHECK, LOCK, QUESTION, HELP } from '../common/StatusIcon'
import BranchChain from './BranchChain'
import SubagentStrip from './SubagentStrip'
import TaskColorDot from './TaskColorDot'
import styles from './TaskRow.module.css'

export { CHECK, HELP }

export const PR_LABEL = { open: 'PR open', merged: 'PR merged', closed: 'PR closed' } as const

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
	const t = useT()
	const tp = useTp()
	const open = useSessionsStore((s) => !!s.openTasks[task.id])
	const toggleTask = useSessionsStore((s) => s.toggleTask)
	const setDragTask = useSessionsStore((s) => s.setDragTask)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const overTaskId = useSessionsStore((s) => s.overTaskId)
	const setOverTask = useSessionsStore((s) => s.setOverTask)
	const dragSubtaskId = useSessionsStore((s) => s.dragSubtaskId)
	const dragSubtaskTaskId = useSessionsStore((s) => s.dragSubtaskTaskId)
	const overSubtaskId = useSessionsStore((s) => s.overSubtaskId)
	const setDragSubtask = useSessionsStore((s) => s.setDragSubtask)
	const setOverSubtask = useSessionsStore((s) => s.setOverSubtask)
	const reorderSubtasks = useSessionsStore((s) => s.reorderSubtasks)
	// "진행중 표기도 안돼" — subChain 점의 진행 중/세션 종료 색(§ FolderCard와 동일 패턴).
	const subtaskWork = useSessionsStore((s) => s.subtaskWork[task.id])
	const openReview = useSessionsStore((s) => s.openReview)
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)
	const quickStartBusy = useSessionsStore((s) => s.quickStartBusy === task.id)
	const gitStatus = useSessionsStore((s) => s.gitStatus)
	const gitStatusByPath = useSessionsStore((s) => s.gitStatusByPath)
	const renameTask = useSessionsStore((s) => s.renameTask)
	const updateTaskColor = useSessionsStore((s) => s.updateTaskColor)
	const setTaskDone = useSessionsStore((s) => s.setTaskDone)
	// term.cjs가 tmux 화면을 스크레이프해 매번 새로 계산하는 값(저장된 상태 아님) — 세션명으로 조인.
	const termStatus = useSessionsStore((s) => (session ? s.termStatus[session.tmuxSession] : undefined))
	// "클로드세션 동작 여부에 따라서... 서브태스크도" — subChainDot이 alive/done 2단계뿐이라 서브태스크
	// 세션이 인증·질문 대기 중이어도 안 보였다. 서브태스크별 세션명으로 같은 termStatus 맵을 다시 조인.
	const termStatusMap = useSessionsStore((s) => s.termStatus)

	const [menuOpen, setMenuOpen] = useState(false)
	const [renaming, setRenaming] = useState(false)
	const [nameDraft, setNameDraft] = useState(task.name)
	const renameInputRef = useRef<HTMLInputElement>(null)

	const openPrTab = (url: string, label: string) => {
		useGlobalTabsStore.getState().openBrowserTab(label, url, task.folder_id, task.name, task.color)
	}

	const nb = task.branches.length
	// "서브태스크 완료 버튼 필요" — 완료 처리한(completed_at) 서브태스크는 태스크 트리와 같은 원칙으로
	// 이 목록에서 걸러낸다(§ SessionShell.tsx visibleInbox/visibleFolders, 캘린더에는 그대로 남음).
	// "circle 조건을 살펴봐야겠어. 나와야할땐 안나오고" — 완료 처리됐어도 그 서브태스크의 세션이
	// 아직 살아있으면(사람이 먼저 완료를 누르고 에이전트는 계속 일하는 경우) 숨기지 않는다 — 안 그러면
	// 실제로 진행 중인 서브태스크가 체인에서 통째로 사라져 "진행중 표기가 안 보인다"로 보인다.
	const visibleSubtasks = task.subtasks.filter((st) => !st.completed_at || subtaskWork?.find((w) => w.id === st.id)?.alive)
	const primaryBranch = task.branches[0]
	const git = primaryBranch ? gitStatus[primaryBranch.name] : undefined
	const openReviewCount = task.reviews.filter((r) => r.state === 'open').length
	const hasReviews = task.reviews.length > 0

	const isDone = git?.pr?.state === 'merged'
	// 우선순위(§12): 완료 > 인증필요 > 질문대기 > 진행중 > 대기 — 완료가 아니면 그 다음 확인이 급한 것부터.
	const needsAuth = !isDone && !!termStatus?.needsAuth
	const needsResume = !isDone && !needsAuth && !!termStatus?.needsResume
	const needsInput = !isDone && !needsAuth && !needsResume && !!termStatus?.waiting
	const isRunning = !isDone && !needsAuth && !needsResume && !needsInput && !!session

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
			className={`${styles.row} ${overTaskId === task.id && dragTaskId !== task.id ? styles.rowDropTarget : ''}`}
			draggable
			style={{ opacity: dragTaskId === task.id ? 0.4 : 1 }}
			onDragStart={(e) => {
				e.dataTransfer.effectAllowed = 'move'
				e.dataTransfer.setData('text/plain', task.id)
				setDragTask(task.id)
			}}
			onDragEnd={() => {
				setDragTask(null)
				setOverTask(null)
			}}
			onDragOver={(e) => {
				e.preventDefault()
				if (dragTaskId && dragTaskId !== task.id && overTaskId !== task.id) setOverTask(task.id)
			}}
			onDragLeave={() => {
				if (overTaskId === task.id) setOverTask(null)
			}}
			onDrop={(e) => {
				setOverTask(null)
				dragBeforeTaskId(e)
			}}
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
						isDone ? styles.done : needsAuth ? styles.needsAuth : needsResume || needsInput ? styles.needsInput : isRunning ? styles.running : styles.waiting
					}`}
					title={needsAuth ? t('인증이 필요합니다') : needsResume ? t('세션 재개 확인이 필요합니다') : needsInput ? t('입력이 필요합니다') : undefined}
				>
					{isDone ? CHECK : needsAuth ? LOCK : needsResume || needsInput ? QUESTION : isRunning ? <span className={styles.spinner} /> : CLOCK}
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
							<>
								<TaskColorDot color={task.color} onPick={(color) => updateTaskColor(task.id, color)} />
								<span className={styles.title}>{task.name}</span>
							</>
						)}
						{git?.pr && (
							<a
								href={git.pr.url}
								target="_blank"
								rel="noreferrer"
								className={`m ${styles.pill} ${git.pr.draft ? styles.pillPrDraft : styles.pillPr}`}
								onClick={(e) => {
									e.preventDefault()
									e.stopPropagation()
									openPrTab(git.pr!.url, `${task.name} PR`)
								}}
							>
								{git.pr.draft ? 'PR draft' : PR_LABEL[git.pr.state]}
							</a>
						)}
						{hasReviews && (
							<span
								className={`m ${styles.pill} ${openReviewCount > 0 ? styles.pillIssues : styles.pillOk}`}
								onClick={(e) => {
									e.stopPropagation()
									openReview(task.id)
								}}
							>
								{openReviewCount > 0 ? tp('이슈 {n}', { n: openReviewCount }) : t('리뷰 완료')}
							</span>
						)}
						{nb === 0 && (
							<span
								className={styles.quickStart}
								title={task.folder_id ? t('이 서브태스크가 속한 태스크 전체를 오케스트레이션합니다') : t('태스크를 만들어 워크트리+세션을 바로 시작합니다')}
								onClick={(e) => {
									e.stopPropagation()
									if (!quickStartBusy) quickStartTask(task.id)
								}}
								style={{ opacity: quickStartBusy ? 0.5 : 1 }}
							>
								{quickStartBusy ? '…' : t('시작')}
							</span>
						)}
						<span className={`m ${styles.subTime}`} title={lastActivityAt ? t('태스크 매니저와 마지막으로 주고받은 대화 시각') : undefined}>
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
							<SubagentStrip cwd={session.worktreePath} sessionName={session.tmuxSession} compact />
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
							{t('이름 변경')}
						</div>
						{/* "일감 완료 체크가 있으면 좋겠어. 그걸하면 그냥 완료로 보이는거야" — 레코드는 안
						    지우고 completed_at만 찍는다. 이 트리에서는 사라지지만(SessionShell.tsx
						    visibleInbox/visibleFolders) 캘린더에는 그대로 남는다. */}
						<div
							className={styles.ctxMenuItem}
							onClick={() => {
								setMenuOpen(false)
								setTaskDone(task.id, true)
							}}
						>
							{t('완료 처리')}
						</div>
						{/* 워크트리 목록에서 "연결"한 태스크를 다시 풀어놓는 자리 — 태스크·브랜치 레코드만
						    지우고 실제 git worktree·브랜치는 그대로 둔다(server/store/tasks.cjs remove). */}
						<div
							className={styles.ctxMenuItem}
							onClick={() => {
								setMenuOpen(false)
								if (confirm(tp('"{name}" 연결을 해제할까요? 워크트리·브랜치는 그대로 남습니다.', { name: task.name }))) {
									removeTask(task.id).then(() => useSessionsStore.getState().loadBoard())
								}
							}}
						>
							{t('연결 해제 (워크트리 유지)')}
						</div>
					</div>
				)}
			</div>
			{open && (
				<div className={styles.detail}>
					{visibleSubtasks.length > 0 && (
						// "서브태스크 이전처럼 브랜치 이어지는 UI로" — BranchChain의 레일+노드 언어를 빌리되
						// "서브태스크가 메인태스크만큼 눈에 띄면 안 돼" 피드백으로 작고 옅은 전용 변형(subChain*)을
						// 쓴다(진짜 BranchChain 크기는 그대로 유지). 누르면 서브태스크 상세 패널이 열린다.
						<div
							className={styles.subChainWrap}
							onDragOver={(e) => {
								if (dragSubtaskTaskId !== task.id) return
								e.preventDefault()
								e.stopPropagation()
							}}
							onDrop={(e) => {
								if (dragSubtaskTaskId !== task.id || !dragSubtaskId) return
								e.preventDefault()
								e.stopPropagation()
								reorderSubtasks(task.id, dragSubtaskId, null)
							}}
						>
							<div className={styles.subChainRail} />
							{visibleSubtasks.map((st) => {
								const work = subtaskWork?.find((w) => w.id === st.id)
								// "PR뱃지도 자동으로 안잡혀" — subtaskWork.branch(DB 스냅샷)는 에이전트가 자기
								// 워크트리 안에서 git checkout -b로 브랜치를 바꾸는 순간 낡는다. 경로는 안 바뀌므로
								// gitStatusByPath로 먼저 조회하고, 표시할 브랜치명도 실제 지금 값(subGit.branch)을
								// 우선한다 — 없으면(경로 데이터가 아직 없을 때) DB 스냅샷으로 폴백.
								const subGit = work?.worktreePath ? gitStatusByPath[work.worktreePath] : work?.branch ? gitStatus[work.branch] : undefined
								const subBranch = subGit?.branch ?? work?.branch
								const subTermStatus = work?.tmuxSession ? termStatusMap[work.tmuxSession] : undefined
								const subNeedsAuth = !!subTermStatus?.needsAuth
								const subNeedsInput = !subNeedsAuth && !!subTermStatus?.waiting
								return (
									<div
										key={st.id}
										className={styles.subChainNode}
										draggable
										style={{ opacity: dragSubtaskId === st.id ? 0.4 : 1 }}
										onDragStart={(e) => {
											e.stopPropagation()
											e.dataTransfer.effectAllowed = 'move'
											e.dataTransfer.setData('text/plain', st.id)
											setDragSubtask(st.id, task.id)
										}}
										onDragEnd={(e) => {
											e.stopPropagation()
											setDragSubtask(null, null)
											setOverSubtask(null)
										}}
									>
										<span
											className={`${styles.subChainDot} ${
												work?.blocked || subNeedsAuth || subNeedsInput
													? styles.subChainDotAlert
													: work?.stalled
														? styles.subChainDotStalled
														: work?.alive
															? styles.subChainDotAlive
															: work?.done
																? styles.subChainDotComplete
																: work?.started
																	? styles.subChainDotDone
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
											className={`${styles.subChainCard} ${overSubtaskId === st.id && dragSubtaskId !== st.id ? styles.subChainCardDropTarget : ''}`}
											onClick={(e) => {
												e.stopPropagation()
												// "스피너가 있는 태스크는 클릭 시 클로드세션탭이 열렸으면해" — 진행 중(alive)인
												// 서브태스크는 상세 모달 대신 바로 그 세션 탭으로 들어간다. task.folder_id가
												// 없으면(아직 일감함) 승격 전이라 세션 자체가 없으니 기존 상세 모달로.
												if (work?.alive && task.folder_id) {
													useTabsStore.getState().openSubtaskTab(task.folder_id, st.id, task.id, st.name)
													useTabsStore.getState().setActiveNode(task.folder_id, 'orchestrator')
												} else {
													useSessionsStore.getState().openSubtaskDetail(st.id, task.id)
												}
											}}
											onDragOver={(e) => {
												if (dragSubtaskTaskId !== task.id || dragSubtaskId === st.id) return
												e.preventDefault()
												e.stopPropagation()
												if (overSubtaskId !== st.id) setOverSubtask(st.id)
											}}
											onDragLeave={(e) => {
												e.stopPropagation()
												if (overSubtaskId === st.id) setOverSubtask(null)
											}}
											onDrop={(e) => {
												if (dragSubtaskTaskId !== task.id || !dragSubtaskId) return
												e.preventDefault()
												e.stopPropagation()
												reorderSubtasks(task.id, dragSubtaskId, st.id)
											}}
										>
											<div className={styles.subChainTop}>
												<span className={styles.subChainName}>{st.name}</span>
												{subGit?.pr && (
													<a
														href={subGit.pr.url}
														target="_blank"
														rel="noreferrer"
														className={`m ${styles.subChainPill} ${subGit.pr.draft ? styles.pillPrDraft : styles.pillPr}`}
														onClick={(e) => {
															e.preventDefault()
															e.stopPropagation()
															openPrTab(subGit.pr!.url, `${st.name} PR`)
														}}
													>
														{subGit.pr.draft ? 'PR draft' : PR_LABEL[subGit.pr.state]}
													</a>
												)}
											</div>
											{subBranch && (
												<div className={`m ${styles.subChainWt}`}>
													<span className={styles.wtIcon}>⎇</span>
													{subBranch}
													{!!subGit?.ahead && <span className={styles.deltaAhead}> ↑{subGit.ahead}</span>}
													{!!subGit?.behind && <span className={styles.deltaBehind}> ↓{subGit.behind}</span>}
												</div>
											)}
										</div>
									</div>
								)
							})}
						</div>
					)}
					{nb > 0 && <BranchChain branches={task.branches} kind={task.kind} groupBase={folderBase} />}
				</div>
			)}
		</div>
	)
}
