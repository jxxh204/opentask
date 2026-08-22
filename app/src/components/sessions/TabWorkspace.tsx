import { useEffect, useRef, useState } from 'react'
import { useSessionsStore, getOrchestration } from '../../store/useSessionsStore'
import { useTabsStore, TAB_LABEL, CRONJOBS_NODE_ID, MODEL_POLICY_NODE_ID, wtPathFromNodeId } from '../../store/useTabsStore'
import type { TabKind } from '../../store/useTabsStore'
import type { Task } from '../../store/types'
import { createTerm } from '../../api/term'
import XTerm from '../terminal/XTerm'
import ServerPane from './ServerPane'
import BrowserPane from './BrowserPane'
import SubagentStrip from './SubagentStrip'
import OrchestratorPane from './OrchestratorPane'
import CronJobsPane from './CronJobsPane'
import ModelPolicyPane from './ModelPolicyPane'
import styles from './TabWorkspace.module.css'

// 오케스트레이터·태스크(서브태스크) 노드 둘 다 같은 탭 개념을 쓴다 — "+"로 열 수 있는 종류는 노드
// 종류에 따라서만 달라진다(폴더엔 "오케스트레이터"가 하나 더 있음, 그 자리에 "새 워크트리"는 없음).
// 터미널/로컬 서버/브라우저/클로드 세션의 백엔드는 노드에 따라 다른 세션을 가리킨다 — 태스크 노드는
// 그 서브태스크의 오케스트레이션 세션, 폴더 노드는 그 폴더의 지휘자(conductor) 세션.
const ADDABLE_TASK_TABS: TabKind[] = ['terminal', 'server', 'browser', 'claude']
const ADDABLE_FOLDER_TABS: TabKind[] = ['orchestrator', 'terminal', 'server', 'browser', 'claude']

// VSCode의 "새 터미널"처럼 탭을 열면 버튼 없이 곧바로 세션이 뜬다 — 탭 인스턴스당 한 번만
// 시작하도록 startedRef로 막는다(StrictMode 이중 마운트·재렌더 대비).
function ClaudeSessionPane({ tabId, cwd }: { tabId: string; cwd: string }) {
	const sessionName = useTabsStore((s) => s.claudeSessionByTab[tabId])
	const modelLabel = useTabsStore((s) => s.claudeModelByTab[tabId])
	const setClaudeSession = useTabsStore((s) => s.setClaudeSession)
	const [error, setError] = useState<string | null>(null)
	const startedRef = useRef(false)

	useEffect(() => {
		if (sessionName || startedRef.current) return
		startedRef.current = true
		createTerm({ cwd, command: 'claude', label: `${tabId.slice(0, 8)}-claude` })
			.then((r) => {
				if (r.ok) setClaudeSession(tabId, r.name, r.modelLabel)
				else setError(r.error || '세션 생성 실패')
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
	}, [tabId, cwd, sessionName, setClaudeSession])

	if (sessionName) return <XTerm session={sessionName} cwd={cwd} modelLabel={modelLabel} />
	if (error)
		return (
			<div className={styles.stub}>
				<div className={styles.stubTitle}>세션을 시작하지 못했습니다</div>
				<div className={styles.stubError}>{error}</div>
			</div>
		)
	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>클로드 세션 시작 중…</div>
		</div>
	)
}

// 워크트리 목록에서 "미추적" 워크트리를 클릭했을 때 여는 즉석 셸(claude 명령 없이 plain tmux 세션).
// OpenTask 태스크가 아니라 claudeSessionByTab/claudeModelByTab 저장소를 그대로 재사용 — 이름은
// "클로드"지만 실제로는 tabId → tmux 세션명 매핑일 뿐이라 일반 터미널에도 그대로 쓸 수 있다.
function AdHocTerminalPane({ tabId, cwd }: { tabId: string; cwd: string }) {
	const sessionName = useTabsStore((s) => s.claudeSessionByTab[tabId])
	const setClaudeSession = useTabsStore((s) => s.setClaudeSession)
	const [error, setError] = useState<string | null>(null)
	const startedRef = useRef(false)

	useEffect(() => {
		if (sessionName || startedRef.current) return
		startedRef.current = true
		createTerm({ cwd, label: cwd.split('/').pop() })
			.then((r) => {
				if (r.ok) setClaudeSession(tabId, r.name, null)
				else setError(r.error || '세션 생성 실패')
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
	}, [tabId, cwd, sessionName, setClaudeSession])

	if (sessionName) return <XTerm session={sessionName} cwd={cwd} modelLabel={null} />
	if (error)
		return (
			<div className={styles.stub}>
				<div className={styles.stubTitle}>세션을 시작하지 못했습니다</div>
				<div className={styles.stubError}>{error}</div>
			</div>
		)
	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>터미널 시작 중…</div>
		</div>
	)
}

const KIND_OPT: { id: Task['kind']; label: string }[] = [
	{ id: 'single', label: 'single' },
	{ id: 'chain', label: 'chain(이어서)' },
	{ id: 'parallel', label: 'parallel(동시에)' },
]

// 일감함(inbox)의 일감은 누른다고 바로 등록되지 않는다 — 먼저 내용을 훑어보고, 여기서 명시적으로
// "태스크로 등록"해야 실제 태스크가 되어 트리로 내려가고(quickStartTask) 워크트리·세션이 자동으로 뜬다.
//
// mainTask 생성 확인 단계(§12) — "AI 제안 + 사람이 자유롭게 덮어쓰기". 처음 만드는 사람에게 전부
// 보여주고 직접 결정하게 하되, 매번 처음부터 다 채우면 번거로우니 AI/제품 기본값을 미리 채워두고
// "기본 접힘 고급 설정" 패턴으로 감싼다 — 평소엔 한 줄 요약만 보고 바로 등록, 세밀하게 통제하고 싶으면 펼침.
function InboxPreview({ task }: { task: Task }) {
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)
	const quickStartBusy = useSessionsStore((s) => s.quickStartBusy === task.id)
	const repos = useSessionsStore((s) => s.repos)
	const rootPath = useSessionsStore((s) => s.rootPath)
	const multiRepo = repos.length > 1

	const [open, setOpen] = useState(false)
	// 'main'으로 미리 채워두면 안 건드려도 그대로 전송돼 백엔드(worktrees.cjs)의 base 자동감지(레포
	// 설정 → 현재 체크아웃 브랜치 → 최후수단 'main')를 항상 덮어써버렸다 — 손대지 않으면 빈 값을 보내
	// 백엔드가 그 레포에 맞는 base를 스스로 찾게 둔다.
	const [base, setBase] = useState('')
	const [autoMerge, setAutoMerge] = useState(false)
	const [retryLimit, setRetryLimit] = useState(3)
	const [kind, setKind] = useState<Task['kind']>(task.kind || 'single')
	const [repoId, setRepoId] = useState<string | null>(task.repo_id ?? (repos[0]?.id ?? null))
	const [startPrompt, setStartPrompt] = useState(task.start_prompt || task.name)

	const repoName = multiRepo ? repos.find((r) => r.id === repoId)?.name || '(선택 안 함)' : repos[0]?.name || rootPath?.split('/').pop() || '단일 레포'

	function commit() {
		quickStartTask(task.id, { base, autoMerge, retryLimit, kind, repoId: multiRepo ? repoId : undefined, startPrompt })
	}

	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>{task.name}</div>
			<div className={styles.stubSub}>{task.desc || '설명 없음'}</div>
			<div className={styles.confirmSummary} onClick={() => setOpen((o) => !o)}>
				{repoName} · {base || '자동감지'} · 자동머지 {autoMerge ? 'on' : 'off'} · N={retryLimit} {open ? '▾' : '▸ 자세히'}
			</div>
			{open && (
				<div className={styles.confirmForm} onClick={(e) => e.stopPropagation()}>
					{multiRepo && (
						<div className={styles.confirmRow}>
							<span className={styles.confirmLabel}>레포</span>
							<select className="fin m" style={{ width: 160, height: 26, fontSize: 10.5 }} value={repoId ?? ''} onChange={(e) => setRepoId(e.target.value || null)}>
								<option value="">(선택 안 함)</option>
								{repos.map((r) => (
									<option key={r.id} value={r.id}>
										{r.name}
									</option>
								))}
							</select>
						</div>
					)}
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>base 브랜치</span>
						<input
							className="fin m"
							style={{ width: 160, height: 26, fontSize: 10.5 }}
							value={base}
							onChange={(e) => setBase(e.target.value)}
							placeholder="자동감지"
						/>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>자동 머지 정책</span>
						<label className="m" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5 }}>
							<input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} />
							Auto-merge
						</label>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>첫 subTask kind</span>
						<select className="fin m" style={{ width: 160, height: 26, fontSize: 10.5 }} value={kind} onChange={(e) => setKind(e.target.value as Task['kind'])}>
							{KIND_OPT.map((k) => (
								<option key={k.id} value={k.id}>
									{k.label}
								</option>
							))}
						</select>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>재시도 횟수(N)</span>
						<input
							className="fin m"
							type="number"
							min={1}
							style={{ width: 160, height: 26, fontSize: 10.5 }}
							value={retryLimit}
							onChange={(e) => setRetryLimit(Math.max(1, Number(e.target.value) || 1))}
						/>
					</div>
					<div>
						<div className={styles.confirmLabel} style={{ marginBottom: 4 }}>
							start_prompt
						</div>
						<textarea className={`fin m ${styles.confirmPrompt}`} value={startPrompt} onChange={(e) => setStartPrompt(e.target.value)} />
					</div>
				</div>
			)}
			<button className={styles.stubBtn} disabled={quickStartBusy} onClick={commit}>
				{quickStartBusy ? '등록 중…' : '태스크로 등록'}
			</button>
		</div>
	)
}

function NoSessionStub({ folderKind }: { folderKind: boolean }) {
	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>{folderKind ? '아직 지휘자 세션이 없습니다' : '아직 워크트리가 없습니다'}</div>
			<div className={styles.stubSub}>
				{folderKind ? '오케스트레이터 탭에서 "대화 시작"을 눌러 지휘자 세션을 먼저 띄우세요.' : '서브태스크가 이 태스크에 들어가는 순간 오케스트레이터가 자동으로 워크트리·세션을 만듭니다.'}
			</div>
		</div>
	)
}

// 트리 노드는 두 종류다 — 태스크(=실제 Folder, 클릭하면 기본 "오케스트레이터" 탭) / 서브태스크
// (=실제 Task, 클릭하면 기본 "터미널" 탭). activeNodeId 하나로 다루되, 어느 쪽인지에 따라 탭 구성과
// 콘텐츠가 달라진다.
export default function TabWorkspace() {
	const activeNodeId = useTabsStore((s) => s.activeNodeId)
	const tabsByNode = useTabsStore((s) => s.tabsByNode)
	const activeTabByNode = useTabsStore((s) => s.activeTabByNode)
	const openTab = useTabsStore((s) => s.openTab)
	const closeTab = useTabsStore((s) => s.closeTab)
	const reopenLastClosed = useTabsStore((s) => s.reopenLastClosed)
	const cycleTab = useTabsStore((s) => s.cycleTab)
	const setActiveTab = useTabsStore((s) => s.setActiveTab)
	const renameTab = useTabsStore((s) => s.renameTab)
	const [cmdkOpen, setCmdkOpen] = useState(false)
	const [menuForTab, setMenuForTab] = useState<string | null>(null)
	const [renamingTab, setRenamingTab] = useState<string | null>(null)
	const [renameDraft, setRenameDraft] = useState('')
	const renameInputRef = useRef<HTMLInputElement>(null)
	// "새 워크트리"는 예전엔 이름을 고정 문자열('새 워크트리 작업')로 박아 만들고 실제로 뭘 시킬지는
	// 나중에 따로 채워야 했다 — 여기서 자유 텍스트를 받아 그대로 이름 + start_prompt로 같이 심는다.
	const [newWtOpen, setNewWtOpen] = useState(false)
	const [newWtDraft, setNewWtDraft] = useState('')
	const newWtInputRef = useRef<HTMLInputElement>(null)

	const found = useSessionsStore((s) => {
		if (!activeNodeId) return null
		const folderHit = s.folders.find((f) => f.id === activeNodeId)
		if (folderHit) return { kind: 'folder' as const, folderId: folderHit.id, task: null }
		const inboxHit = s.inbox.find((t) => t.id === activeNodeId)
		if (inboxHit) return { kind: 'task' as const, folderId: null as string | null, task: inboxHit }
		for (const f of s.folders) {
			const hit = f.tasks.find((t) => t.id === activeNodeId)
			if (hit) return { kind: 'task' as const, folderId: f.id, task: hit }
		}
		return null
	})
	const orch = useSessionsStore((s) => (found?.folderId ? getOrchestration(s, found.folderId) : null))
	const repos = useSessionsStore((s) => s.repos)
	const rootPath = useSessionsStore((s) => s.rootPath)

	const tabs = activeNodeId
		? (tabsByNode[activeNodeId] ?? (found?.kind === 'folder' ? [{ id: activeNodeId, kind: 'orchestrator' as TabKind }] : [{ id: activeNodeId, kind: 'terminal' as TabKind }]))
		: []
	const activeTabId = activeNodeId ? (activeTabByNode[activeNodeId] ?? tabs[0]?.id) : undefined

	// 탭 단축키 — Orca/VSCode 기본값을 따른다: Cmd/Ctrl+W 닫기, Cmd/Ctrl+Shift+T 마지막으로 닫은 탭
	// 되살리기, Ctrl+Tab(+Shift로 역방향) 탭 순환. Electron 쪽은 기본 메뉴의 Cmd+W(창 닫기) accelerator를
	// 없애서(electron/main.cjs) 여기서 preventDefault한 게 실제로 먹히게 해뒀다.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (!activeNodeId) return
			const mod = e.metaKey || e.ctrlKey
			if (mod && !e.shiftKey && e.key.toLowerCase() === 'w') {
				if (!activeTabId) return
				e.preventDefault()
				closeTab(activeNodeId, activeTabId)
			} else if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
				e.preventDefault()
				reopenLastClosed(activeNodeId)
			} else if (e.ctrlKey && e.key === 'Tab') {
				e.preventDefault()
				cycleTab(activeNodeId, e.shiftKey ? -1 : 1)
			} else if (e.metaKey && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
				e.preventDefault()
				cycleTab(activeNodeId, e.key === 'ArrowRight' ? 1 : -1)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [activeNodeId, activeTabId, closeTab, reopenLastClosed, cycleTab])

	useEffect(() => {
		if (!menuForTab) return
		const onDocClick = () => setMenuForTab(null)
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	}, [menuForTab])

	useEffect(() => {
		if (renamingTab) renameInputRef.current?.focus()
	}, [renamingTab])

	useEffect(() => {
		if (newWtOpen) newWtInputRef.current?.focus()
	}, [newWtOpen])

	function startRename(tabId: string, current: string) {
		setMenuForTab(null)
		setRenamingTab(tabId)
		setRenameDraft(current)
	}
	function commitRename() {
		if (activeNodeId && renamingTab) renameTab(activeNodeId, renamingTab, renameDraft)
		setRenamingTab(null)
	}

	async function commitNewWorktree(folderId: string | null) {
		const text = newWtDraft.trim()
		setNewWtOpen(false)
		setNewWtDraft('')
		setCmdkOpen(false)
		if (!text) return
		const newId = await useSessionsStore.getState().createTaskInFolder(folderId, text)
		if (!newId) return
		await useSessionsStore.getState().updateTaskPrompt(newId, text)
		useSessionsStore.getState().toggleTask(newId)
	}

	if (!activeNodeId) {
		return (
			<div className={styles.empty}>
				<div className={styles.emptyIcon}>⌘</div>
				<div className={styles.emptyTitle}>왼쪽에서 태스크를 펼쳐보세요</div>
				<div className={styles.emptySub}>태스크를 열면 여기에 오케스트레이터 · 터미널 · 로컬 서버 · 브라우저 탭이 뜹니다</div>
			</div>
		)
	}
	// 크론잡/모델배정/미추적 워크트리 즉석 터미널은 태스크 트리에 속하지 않는 전역 가짜 노드라 found가
	// 항상 null이다 — 아래 found 기반 렌더링(오케스트레이터/터미널/서버/브라우저 등)과는 무관하게 먼저 갈라낸다.
	const wtPath = wtPathFromNodeId(activeNodeId)
	if (activeNodeId === CRONJOBS_NODE_ID || activeNodeId === MODEL_POLICY_NODE_ID || wtPath) {
		const activeTabInstance = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
		return (
			<div className={styles.wrap}>
				<div className={styles.tabbar}>
					{tabs.map((t) => (
						<div key={t.id} className={`${styles.tab} ${t.id === activeTabId ? styles.tabActive : ''}`} onClick={() => setActiveTab(activeNodeId, t.id)}>
							<span>{t.label || TAB_LABEL[t.kind]}</span>
							<span
								className={styles.tabClose}
								onClick={(e) => {
									e.stopPropagation()
									closeTab(activeNodeId, t.id)
								}}
							>
								×
							</span>
						</div>
					))}
				</div>
				<div className={styles.body}>
					{activeTabInstance?.kind === 'cronjobs' && <CronJobsPane />}
					{activeTabInstance?.kind === 'modelPolicy' && <ModelPolicyPane />}
					{wtPath && activeTabInstance?.kind === 'terminal' && <AdHocTerminalPane tabId={activeTabInstance.id} cwd={wtPath} />}
				</div>
			</div>
		)
	}

	if (!found) return null
	const isInboxItem = found.kind === 'task' && !found.task?.folder_id
	const activeTabInstance = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
	// 태스크(서브태스크) 노드는 자신의 오케스트레이션 세션을, 폴더(태스크) 노드는 지휘자 세션을 그
	// 자리의 "메인 세션"으로 쓴다 — 터미널/로컬 서버/브라우저/클로드 세션 탭이 공통으로 이걸 가리킨다.
	const taskSession = found.task ? (orch?.sessions.find((s) => s.taskId === found.task!.id) ?? null) : null
	const mainSession =
		found.kind === 'folder'
			? orch?.conductor
				? { tmuxSession: orch.conductor.session, worktreePath: orch.conductor.cwd, modelLabel: orch.conductor.modelLabel }
				: null
			: taskSession
	const addableTabs = found.kind === 'folder' ? ADDABLE_FOLDER_TABS : ADDABLE_TASK_TABS
	// "메인 세션과 별개의 클로드 세션"은 원래도 그 이름대로 오케스트레이터/지휘자와 무관하게 즉석에서
	// 띄우는 게 목적이라, 아직 지휘자를 시작 안 했거나(폴더) 워크트리가 없어도(서브태스크) cwd만
	// 있으면 세션을 만들 수 있어야 한다 — 멀티레포면 그 레포 경로, 아니면 단일 레포 루트로 대체.
	const fallbackRepoPath = (found.kind === 'task' && found.task?.repo_id ? repos.find((r) => r.id === found.task!.repo_id)?.path : null) ?? rootPath
	const claudeCwd = mainSession?.worktreePath ?? fallbackRepoPath ?? null

	return (
		<div className={styles.wrap}>
			<div className={styles.tabbar}>
				{tabs.map((t) => (
					<div
						key={t.id}
						className={`${styles.tab} ${t.id === activeTabId ? styles.tabActive : ''}`}
						onClick={() => setActiveTab(activeNodeId, t.id)}
						onContextMenu={(e) => {
							e.preventDefault()
							setMenuForTab(t.id)
						}}
					>
						{renamingTab === t.id ? (
							<input
								ref={renameInputRef}
								className={styles.tabRenameInput}
								value={renameDraft}
								onClick={(e) => e.stopPropagation()}
								onChange={(e) => setRenameDraft(e.target.value)}
								onBlur={commitRename}
								onKeyDown={(e) => {
									if (e.key === 'Enter') commitRename()
									if (e.key === 'Escape') setRenamingTab(null)
								}}
							/>
						) : (
							<span>{t.label || TAB_LABEL[t.kind]}</span>
						)}
						<span
							className={styles.tabClose}
							onClick={(e) => {
								e.stopPropagation()
								closeTab(activeNodeId, t.id)
							}}
						>
							×
						</span>
						{menuForTab === t.id && (
							<div className={styles.tabMenu} onClick={(e) => e.stopPropagation()}>
								<div className={styles.tabMenuItem} onClick={() => startRename(t.id, t.label || TAB_LABEL[t.kind])}>
									이름 변경
								</div>
							</div>
						)}
					</div>
				))}
				<div className={styles.cmdkAnchor}>
					<button className={styles.cmdkBtn} onClick={() => setCmdkOpen((o) => !o)} title="탭 추가">
						+
					</button>
					{cmdkOpen && (
						<div className={styles.cmdkPanel} onMouseLeave={() => !newWtOpen && setCmdkOpen(false)}>
							{addableTabs.map((t) => (
								<div
									key={t}
									className={styles.cmdkItem}
									onClick={() => {
										openTab(activeNodeId, t)
										setCmdkOpen(false)
									}}
								>
									<span>{TAB_LABEL[t]}</span>
								</div>
							))}
							{found.kind === 'task' && (
								<>
									<div className={styles.cmdkDivider} />
									{newWtOpen ? (
										<input
											ref={newWtInputRef}
											className={styles.tabRenameInput}
											value={newWtDraft}
											placeholder="이 워크트리에서 뭘 시킬지"
											onClick={(e) => e.stopPropagation()}
											onChange={(e) => setNewWtDraft(e.target.value)}
											onBlur={() => commitNewWorktree(found.folderId)}
											onKeyDown={(e) => {
												if (e.key === 'Enter') commitNewWorktree(found.folderId)
												if (e.key === 'Escape') {
													setNewWtOpen(false)
													setNewWtDraft('')
												}
											}}
										/>
									) : (
										<div
											className={styles.cmdkItem}
											onClick={(e) => {
												e.stopPropagation()
												setNewWtOpen(true)
											}}
										>
											<span>새 워크트리</span>
										</div>
									)}
								</>
							)}
						</div>
					)}
				</div>
			</div>
			{tabs.length === 0 && (
				<div className={styles.empty}>
					<div className={styles.emptyIcon}>⌘</div>
					<div className={styles.emptyTitle}>열린 탭이 없습니다</div>
					<div className={styles.emptySub}>+ 를 눌러 탭을 추가하세요</div>
				</div>
			)}
			{tabs.length > 0 && (
				<div className={styles.body}>
					{isInboxItem ? (
						<InboxPreview task={found.task!} />
					) : (
						<>
							{activeTabInstance?.kind === 'orchestrator' && found.kind === 'folder' && <OrchestratorPane folderId={found.folderId!} />}
							{activeTabInstance?.kind === 'terminal' &&
								(mainSession ? (
									<div className={styles.termWrap}>
										{found.kind === 'task' && <SubagentStrip cwd={mainSession.worktreePath} />}
										<div className={styles.termHost}>
											<XTerm session={mainSession.tmuxSession} cwd={mainSession.worktreePath} modelLabel={mainSession.modelLabel} />
										</div>
									</div>
								) : (
									<NoSessionStub folderKind={found.kind === 'folder'} />
								))}
							{activeTabInstance?.kind === 'claude' &&
								(claudeCwd ? <ClaudeSessionPane tabId={activeTabInstance.id} cwd={claudeCwd} /> : <NoSessionStub folderKind={found.kind === 'folder'} />)}
							{activeTabInstance?.kind === 'server' && (mainSession ? <ServerPane cwd={mainSession.worktreePath} /> : <NoSessionStub folderKind={found.kind === 'folder'} />)}
							{activeTabInstance?.kind === 'browser' && <BrowserPane taskId={activeNodeId} cwd={mainSession?.worktreePath ?? null} />}
						</>
					)}
				</div>
			)}
		</div>
	)
}
