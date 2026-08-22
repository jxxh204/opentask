import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore, CRONJOBS_NODE_ID, wtNodeId } from '../../store/useTabsStore'
import { listRepoWorktrees, adoptWorktree } from '../../api/worktrees'
import type { RealWorktree } from '../../api/worktrees'
import FolderCard from './FolderCard'
import TabWorkspace from './TabWorkspace'
import PrReviewModal from './PrReviewModal'
import SettingsModal from './SettingsModal'
import Modal from '../common/Modal'
import RepoTable from './RepoTable'
import AddRepoModal from './AddRepoModal'
import styles from './SessionShell.module.css'

const ARCHIVE_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<rect x="3" y="4" width="18" height="5" rx="1.2" />
		<path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
	</svg>
)
const PLUS_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 8v8M8 12h8" />
	</svg>
)
const GEAR_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
	</svg>
)
// navRegistry.ts의 automations 아이콘과 동일 — 달력(스케줄) + 시계(예약 실행)로 "정해진 시각에 자동
// 실행"을 한 아이콘에 담는다(Orca 사이드바 참고, §07 "Automations 페이지").
const AUTOMATIONS_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<rect x="3" y="5" width="18" height="16" rx="2.5" />
		<path d="M3 10h18M8 3v4M16 3v4" />
		<circle cx="15.5" cy="15.5" r="3.2" />
		<path d="M15.5 14v1.6l1.1.9" />
	</svg>
)
// "+ 새 레포 추가"가 텍스트 "+"만 있어서 뭘 하는 액션인지 한눈에 안 들어왔다 — 폴더+플러스 아이콘으로
// (Orca 사이드바의 "새 프로젝트" 아이콘 참고).
const FOLDER_ADD_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
		<path d="M12 12v5M9.5 14.5h5" />
	</svg>
)
const SEARCH_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="11" cy="11" r="7" />
		<path d="M21 21l-4.3-4.3" />
	</svg>
)
// 워크트리 목록의 연결/연결 해제 토글 하나에 같이 쓴다 — 추적됨(바이올렛)/미추적(회색) 색으로만
// 상태를 구분하고 아이콘 모양은 하나로 통일(간결함 우선).
const PLUG_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 3v5M15 3v5" />
		<path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0V8z" />
		<path d="M12 17v3.5" />
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

// 프로토타입의 "사이드바 작업 트리 + 탭 워크스페이스" IA를 실제 데이터로 구현한 최상위 레이아웃.
// FolderCard/TaskRow는 프로토타입의 압축 트리 노드 스타일로 다시 그렸고, ReviewItemCard/
// PrReviewModal/RepoTable은 store에서 id로 조회하는 좁은 props라 그대로 재사용했다.
export default function SessionShell() {
	const activeNodeId = useTabsStore((s) => s.activeNodeId)
	const folders = useSessionsStore((s) => s.folders)
	const inbox = useSessionsStore((s) => s.inbox)
	const repos = useSessionsStore((s) => s.repos)
	const openTasks = useSessionsStore((s) => s.openTasks)
	const openFolders = useSessionsStore((s) => s.openFolders)
	const toggleFolder = useSessionsStore((s) => s.toggleFolder)
	const draft = useSessionsStore((s) => s.draft)
	const draftBusy = useSessionsStore((s) => s.draftBusy)
	const classifying = useSessionsStore((s) => s.classifying)
	const enrichingTitle = useSessionsStore((s) => s.enrichingTitle)
	const setDraft = useSessionsStore((s) => s.setDraft)
	const addTaskFromDraft = useSessionsStore((s) => s.addTaskFromDraft)
	const archive = useSessionsStore((s) => s.archive)
	const archiveBusy = useSessionsStore((s) => s.archiveBusy)
	const loadArchive = useSessionsStore((s) => s.loadArchive)
	const restoreFolder = useSessionsStore((s) => s.restoreFolder)
	const loadGitStatus = useSessionsStore((s) => s.loadGitStatus)
	const loadTermStatus = useSessionsStore((s) => s.loadTermStatus)
	const loadHealth = useSessionsStore((s) => s.loadHealth)
	const refreshAllOrchestrations = useSessionsStore((s) => s.refreshAllOrchestrations)
	const cockpitSummary = useSessionsStore((s) => s.cockpitSummary)
	const apiAddress = useSessionsStore((s) => s.apiAddress)

	const [repoFilter, setRepoFilter] = useState<string | null>(null)
	const [repoPickerOpen, setRepoPickerOpen] = useState(false)
	const [ticketOpen, setTicketOpen] = useState(false)
	const [sidebarQuery, setSidebarQuery] = useState('')
	const [treeCollapsed, setTreeCollapsed] = useState(false)
	const [archiveView, setArchiveView] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [reposModalOpen, setReposModalOpen] = useState(false)
	const [addRepoOpen, setAddRepoOpen] = useState(false)
	const [worktrees, setWorktrees] = useState<RealWorktree[] | null>(null)
	const [worktreesError, setWorktreesError] = useState<string | null>(null)
	const [worktreeBusy, setWorktreeBusy] = useState<string | null>(null)
	const multiRepo = repos.length > 1
	const rootRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		loadArchive()
		loadHealth()
	}, [loadArchive, loadHealth])

	// /api/cockpit는 서버에서 15초 fresh 캐시(stale-while-revalidate)라 이 정도 폴링은 부담 없음.
	useEffect(() => {
		loadGitStatus()
		const id = setInterval(loadGitStatus, 15000)
		return () => clearInterval(id)
	}, [loadGitStatus])

	// 이전엔 지금 열려있는 오케스트레이터 탭의 태스크만 상태가 갱신되고, 안 보고 있는 다른 태스크는
	// 사이드바에서 오래된 상태로 멈춰 보였다(§10/§07 "사이드바 오케스트레이션 상태가 실시간이 아님").
	// gitStatus와 같은 주기로 사이드바 전체를 최신으로 유지한다.
	useEffect(() => {
		refreshAllOrchestrations()
		const id = setInterval(refreshAllOrchestrations, 15000)
		return () => clearInterval(id)
	}, [refreshAllOrchestrations])

	// TaskRow가 질문대기/인증필요를 보여주려면(§12) term.cjs의 실시간 status가 필요 — 백엔드는 이미
	// /api/term으로 내려주고 있었는데 프론트 어디서도 안 쓰고 있었다.
	useEffect(() => {
		loadTermStatus()
		const id = setInterval(loadTermStatus, 15000)
		return () => clearInterval(id)
	}, [loadTermStatus])

	// 서브태스크를 펼치면(TaskRow의 기존 toggleTask) 그 서브태스크가 워크스페이스의 활성 노드가
	// 된다(기본 탭: 터미널). 태스크(폴더) 쪽 선택은 FolderCard의 헤더 클릭이 직접 처리한다.
	const prevOpenRef = useRef<Record<string, boolean>>({})
	useEffect(() => {
		const prev = prevOpenRef.current
		for (const id of Object.keys(openTasks)) {
			if (openTasks[id] && !prev[id]) {
				useTabsStore.getState().setActiveNode(id, 'terminal')
				break
			}
		}
		prevOpenRef.current = openTasks
	}, [openTasks])

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setRepoPickerOpen(false)
				setTicketOpen(false)
			}
		}
		document.addEventListener('click', onClick)
		return () => document.removeEventListener('click', onClick)
	}, [])

	const visibleInbox = repoFilter ? inbox.filter((t) => t.repo_id === repoFilter) : inbox
	const visibleFolders = repoFilter ? folders.map((f) => ({ ...f, tasks: f.tasks.filter((t) => t.repo_id === repoFilter) })).filter((f) => f.tasks.length > 0) : folders
	const totalTasks = visibleInbox.length + visibleFolders.reduce((n, f) => n + f.tasks.length, 0)
	const activeRepoLabel = repoFilter ? repos.find((r) => r.id === repoFilter)?.name ?? '전체 레포' : repos[0]?.name ?? '전체 레포'
	// "전체 레포"(멀티레포에서 repoFilter 미지정)일 땐 워크트리 목록이 어느 레포 것인지 모호해서
	// 첫 번째 레포로 대체 — 드롭다운에서 구체적인 레포를 고르면 바로 그 레포로 바뀐다.
	const activeRepoId = repoFilter || repos[0]?.id || null
	// 브랜치명 → 이미 추적 중인 태스크. inbox 태스크는 폴더가 없어 실제 워크트리가 없으므로 제외.
	const trackedByBranch = new Map<string, { taskId: string; taskName: string }>()
	for (const f of folders) for (const t of f.tasks) for (const b of t.branches) trackedByBranch.set(b.name, { taskId: t.id, taskName: t.name })
	// 사이드바 "워크트리" 섹션엔 아직 태스크로 안 들어온 것만 — 이미 태스크로 등록된 워크트리는
	// 태스크 트리 안에서만 보인다(중복 표시 방지).
	const untrackedWorktrees = (worktrees ?? []).filter((w) => !w.isMain && !trackedByBranch.has(w.branch))
	// worktrees===null인 동안이 곧 로딩 중 — list()가 워크트리마다 status/log/rev-list를 돌려서
	// (worktrees.cjs) 워크트리가 많은 레포는 눈에 띄게 느리다. 스켈레톤으로 그 시간을 표시.
	const wtLoading = !!activeRepoId && worktrees === null && !worktreesError

	// 레포를 바꾸면(activeRepoId 변경) 그 레포 것으로 다시 불러온다. 사이드바에 상시 노출되므로
	// 드롭다운 열림 여부와 무관하게 불러온다.
	// cancelled 가드 필수 — 레포를 빠르게 전환하면 이전 레포(워크트리 많아 느림)의 응답이 지금
	// 레포보다 늦게 도착해, 화면엔 새 레포가 떠 있는데 엉뚱한 레포의 워크트리 목록이 덮어씌워질 수
	// 있다("연결"을 누르면 지금 레포id + 다른 레포의 브랜치가 잘못 짝지어져 저장되는 사고로 실제 발생).
	useEffect(() => {
		if (!activeRepoId) return
		let cancelled = false
		setWorktrees(null)
		setWorktreesError(null)
		listRepoWorktrees(activeRepoId)
			.then((d) => { if (!cancelled) setWorktrees(d.worktrees) })
			.catch((e) => { if (!cancelled) setWorktreesError(e instanceof Error ? e.message : String(e)) })
		return () => {
			cancelled = true
		}
	}, [activeRepoId])

	const q = sidebarQuery.trim().toLowerCase()
	const displayInbox = q ? visibleInbox.filter((t) => t.name.toLowerCase().includes(q)) : visibleInbox
	const displayFolders = q
		? visibleFolders
				.map((f) => (f.name.toLowerCase().includes(q) ? f : { ...f, tasks: f.tasks.filter((t) => t.name.toLowerCase().includes(q)) }))
				.filter((f) => f.name.toLowerCase().includes(q) || f.tasks.length > 0)
		: visibleFolders

	// 보관함 — archived_at(ms) 기준 날짜별로 묶어서 최신 날짜가 위로 오게
	const archiveGroups: [string, typeof archive][] = []
	{
		const byDate = new Map<string, typeof archive>()
		for (const f of archive) {
			const label = f.archived_at ? new Date(f.archived_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '날짜 없음'
			if (!byDate.has(label)) byDate.set(label, [])
			byDate.get(label)!.push(f)
		}
		archiveGroups.push(...byDate.entries())
	}

	async function submitTicket() {
		if (!draft.trim()) return
		// 이전엔 클릭하자마자 패널부터 닫아버려서, 실제로 등록되는 중인지 실패했는지 알 방법이 없었다 —
		// 이제 요청이 실제로 끝난 뒤에만 패널을 닫는다(그동안은 버튼이 "추가 중…"으로 바뀜).
		await addTaskFromDraft()
		setTicketOpen(false)
	}

	function collapseAll() {
		setTreeCollapsed((c) => !c)
		visibleFolders.forEach((f) => {
			const isOpen = openFolders[f.id] !== false
			if (treeCollapsed ? !isOpen : isOpen) toggleFolder(f.id)
		})
	}

	function openTrackedTask(taskId: string) {
		useTabsStore.getState().setActiveNode(taskId, 'terminal')
		setRepoPickerOpen(false)
	}

	function openAdHocTerminal(path: string) {
		const nodeId = wtNodeId(path)
		const s = useTabsStore.getState()
		if (!s.tabsByNode[nodeId]?.length) s.openTab(nodeId, 'terminal')
		s.setActiveNode(nodeId, 'terminal')
		setRepoPickerOpen(false)
	}

	// 새 워크트리를 만들지 않고(이미 있으니) 그 브랜치를 가리키는 Folder/Task/Branch 레코드만 생성.
	async function connectWorktree(branch: string) {
		if (!activeRepoId) return
		setWorktreeBusy(branch)
		try {
			const r = await adoptWorktree(activeRepoId, branch)
			if ('ok' in r && r.ok === false) throw new Error(r.error)
			await useSessionsStore.getState().loadBoard()
			if ('taskId' in r) openTrackedTask(r.taskId)
		} catch (e) {
			setWorktreesError(e instanceof Error ? e.message : String(e))
		} finally {
			setWorktreeBusy(null)
		}
	}

	return (
		<div className={styles.appRoot}>
		<div className={styles.root} ref={rootRef}>
			<aside className={styles.sidebar}>
				<div className={styles.navLinks}>
					<button
						className={styles.navLink}
						type="button"
						onClick={() => {
							const s = useTabsStore.getState()
							if (!s.tabsByNode[CRONJOBS_NODE_ID]?.length) s.openTab(CRONJOBS_NODE_ID, 'cronjobs')
							s.setActiveNode(CRONJOBS_NODE_ID, 'cronjobs')
						}}
					>
						<span className={styles.navLinkIcon}>{AUTOMATIONS_ICON}</span>
						크론잡
					</button>
				</div>
				<label className={styles.sidebarSearch}>
					<span className={styles.sidebarSearchIcon}>{SEARCH_ICON}</span>
					<input
						className={styles.sidebarSearchInput}
						type="text"
						value={sidebarQuery}
						onChange={(e) => setSidebarQuery(e.target.value)}
						placeholder="검색"
					/>
				</label>
				<div className={styles.head}>
					<span className={`${styles.repoPicker} ${repoPickerOpen ? styles.open : ''}`}>
						<button className={styles.repoSelect} type="button" onClick={(e) => { e.stopPropagation(); setRepoPickerOpen((o) => !o) }}>
							<span className={styles.repoSelectLabel}>{activeRepoLabel}</span>
							<span className={styles.repoSelectChev}>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
									<path d="M6 9l6 6 6-6" />
								</svg>
							</span>
						</button>
						{repoPickerOpen && (
							<div className={styles.repoSelectPanel}>
								{multiRepo && (
									<div className={`${styles.repoSelectOpt} ${!repoFilter ? styles.selected : ''}`} onClick={() => { setRepoFilter(null); setRepoPickerOpen(false) }}>
										전체 레포
									</div>
								)}
								{repos.map((r) => (
									<div key={r.id} className={`${styles.repoSelectOpt} ${repoFilter === r.id ? styles.selected : ''}`} onClick={() => { setRepoFilter(r.id); setRepoPickerOpen(false) }}>
										{r.name}
									</div>
								))}
								<div className={styles.wtDivider} />
								<div
									className={`${styles.repoSelectOpt} ${styles.repoSelectManage}`}
									onClick={() => {
										setRepoPickerOpen(false)
										setReposModalOpen(true)
									}}
								>
									레포 관리
								</div>
							</div>
						)}
					</span>
					<button className={styles.headIconBtn} type="button" onClick={(e) => { e.stopPropagation(); setRepoPickerOpen(false); setAddRepoOpen(true) }} title="새 레포 추가">
						{FOLDER_ADD_ICON}
					</button>
					<span className={styles.inboxAnchor}>
						<button className={styles.taskAddBtn} type="button" onClick={(e) => { e.stopPropagation(); setTicketOpen((o) => !o) }}>
							{PLUS_ICON}
							<span>태스크 추가</span>
						</button>
						{ticketOpen && (
							<div className={styles.inboxPanel}>
								<div className={styles.inboxPanelLabel}>일감 생성</div>
								<textarea
									className={styles.inboxInput}
									autoFocus
									disabled={draftBusy}
									value={draft}
									onChange={(e) => setDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' && !e.shiftKey) {
											e.preventDefault()
											submitTicket()
										}
									}}
									placeholder="제목을 쓰거나 Figma·스레드·Notion·PR 링크를 붙여넣으세요"
								/>
								<button className={styles.inboxSubmit} disabled={draftBusy} onClick={submitTicket}>
									{draftBusy ? <span className={styles.inboxSubmitSpinner} /> : null}
									{draftBusy ? '추가 중…' : '일감으로 추가'}
								</button>
								<div className={styles.inboxPanelHint}>새 일감은 미분류에 담깁니다 — 필요할 때 태스크로 드래그해 옮기세요.</div>
							</div>
						)}
					</span>
				</div>

				{!archiveView && (
					<div className={`${styles.taskCount} ${treeCollapsed ? styles.collapsed : ''}`} onClick={collapseAll}>
						<span className={styles.tcchev}>⌄</span>
						<span>{totalTasks} Task</span>
					</div>
				)}

				{!archiveView && displayInbox.length > 0 && (
					<div className={`scroll-y ${styles.inboxList}`}>
						{displayInbox.map((t) => (
							<div
								key={t.id}
								className={`${styles.inboxRow} ${activeNodeId === t.id ? styles.inboxRowSelected : ''}`}
								onClick={() => useTabsStore.getState().setActiveNode(t.id, 'terminal')}
							>
								<span className={styles.inboxIcon}>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
										<path d="M4 12h4l2 3h4l2-3h4" />
										<path d="M5.5 5h13L21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6L5.5 5z" />
									</svg>
								</span>
								<div className={styles.inboxBody}>
									<div className={styles.inboxTitle}>{t.name}</div>
									<div className={styles.inboxMeta}>
										{enrichingTitle[t.id] ? (
											// 링크로 만든 일감의 제목이 당분간 "○○ 링크 태스크" placeholder라 헷갈릴 수
											// 있다 — 링크 내용을 읽어 실제 제목으로 바꾸는 중임을 명시(최대 170초).
											<span className={styles.inboxClassifying}>
												<span className={styles.inboxSubmitSpinner} />
												제목 생성 중…
											</span>
										) : classifying[t.id] ? (
											// repoClassify.cjs가 백그라운드에서 도는 동안(멀티레포일 때만, 최대 ~16초) 조용히
											// 아무 표시가 없었다 — "레포 분류 중"이라고 명시해서 멈춘 것처럼 안 보이게 한다.
											<span className={styles.inboxClassifying}>
												<span className={styles.inboxSubmitSpinner} />
												레포 분류 중…
											</span>
										) : (
											<span className={`m ${styles.inboxTime}`}>{timeAgo(t.created_at)}</span>
										)}
										<span
											className={styles.inboxAction}
											onClick={(e) => {
												e.stopPropagation()
												useSessionsStore.getState().quickStartTask(t.id)
											}}
										>
											시작
										</span>
									</div>
								</div>
							</div>
						))}
					</div>
				)}

				{!archiveView && (
					<div className={`scroll-y ${styles.treeScroll}`}>
						{displayFolders.map((f) => (
							<FolderCard key={f.id} folder={f} />
						))}
						{displayFolders.length === 0 && <div className={styles.treeEmpty}>{q ? '검색 결과 없음' : '진행 중인 작업 없음'}</div>}
					</div>
				)}

				{archiveView && (
					<div className={`scroll-y ${styles.treeScroll}`}>
						{archive.length === 0 && <div className={styles.treeEmpty}>보관된 작업 없음</div>}
						{archiveGroups.map(([date, items]) => (
							<div key={date}>
								<div className={`m ${styles.archiveDateLabel}`}>{date}</div>
								{items.map((f) => (
									<div key={f.id} className={styles.archiveItemRow}>
										<div className={styles.archiveItemBody}>
											<div className={styles.archiveItemTitle}>{f.name}</div>
											{f.base && (
												<div className={`m ${styles.wtLineSmall}`}>
													⎇ {f.base}
												</div>
											)}
										</div>
										<span
											className={styles.archiveRestoreBtn}
											onClick={() => restoreFolder(f.id)}
											style={{ opacity: archiveBusy === f.id ? 0.5 : undefined }}
										>
											복원
										</span>
									</div>
								))}
							</div>
						))}
					</div>
				)}

				{!archiveView && (wtLoading || untrackedWorktrees.length > 0 || worktreesError) && (
					<div className={styles.sidebarWtSection}>
						<div className={styles.sidebarWtDivider} />
						<div className={styles.sidebarWtHeader}>
							<span>워크트리</span>
							{!wtLoading && <span className={styles.sidebarWtCount}>{untrackedWorktrees.length}</span>}
						</div>
						{worktreesError && <div className={styles.wtHint}>{worktreesError}</div>}
						<div className={`scroll-y ${styles.sidebarWtList}`}>
							{wtLoading &&
								[0, 1, 2].map((i) => (
									<div key={i} className={styles.wtSkeletonRow}>
										<span className={styles.wtSkeletonBar} style={{ width: `${64 - i * 10}%` }} />
									</div>
								))}
							{!wtLoading &&
								untrackedWorktrees.map((w) => {
									const busy = worktreeBusy === w.branch
									return (
										<div key={w.path} className={styles.wtRow}>
											<span className={styles.wtRowMain} onClick={() => openAdHocTerminal(w.path)}>
												<span className={styles.wtRowLabel}>{w.branch}</span>
											</span>
											<span
												className={styles.wtRowAction}
												onClick={(e) => {
													e.stopPropagation()
													if (!busy) connectWorktree(w.branch)
												}}
												title="연결"
											>
												{PLUG_ICON}
											</span>
										</div>
									)
								})}
						</div>
					</div>
				)}

				<div className={`m ${styles.foot}`}>
					<span className={styles.livedot} />
					<span>{cockpitSummary?.mainBranch ? `${cockpitSummary.mainBranch} · ` : ''}{totalTasks} 작업</span>
				</div>
				<div className={`${styles.archiveRow} ${archiveView ? styles.archiveRowActive : ''}`} onClick={() => setArchiveView((v) => !v)}>
					<span className={styles.archiveIcon}>{ARCHIVE_ICON}</span>
					<span style={{ flex: 1 }}>보관함</span>
					<span className={`m ${styles.archiveCount}`}>{archive.length}</span>
				</div>
				<div className={styles.archiveRow} onClick={() => setSettingsOpen(true)}>
					<span className={styles.archiveIcon}>{GEAR_ICON}</span>
					<span style={{ flex: 1 }}>설정</span>
				</div>
			</aside>

			<main className={styles.workspace}>
				<TabWorkspace />
			</main>
		</div>

			<div className={`m ${styles.statusbar}`}>
				<span className={styles.sbItem}>
					<span className={styles.sbDot} />
					<span>연결됨</span>
				</span>
				<span className={styles.sbSep} />
				<span className={styles.sbItem}>
					<b>{cockpitSummary?.devCount ?? 0}</b>&nbsp;dev
				</span>
				<span className={styles.sbItem}>
					<b>{cockpitSummary?.streamsActive ?? 0}</b>/{cockpitSummary?.streamsTotal ?? 0} 스트림
				</span>
				<span className={styles.sbItem}>
					✎ <b>{cockpitSummary?.dirty ?? 0}</b> dirty
				</span>
				<span className={styles.sbSep} />
				<span className={`${styles.sbPill}`}>
					PR {cockpitSummary?.prOpen ?? 0} open · {cockpitSummary?.prDraft ?? 0} draft
				</span>
				<span className={styles.sbSpacer} />
				{apiAddress && <span className={styles.sbItem}>{apiAddress}</span>}
			</div>

			<PrReviewModal />
			<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
			<Modal open={reposModalOpen} onClose={() => setReposModalOpen(false)}>
				<RepoTable />
			</Modal>
			<AddRepoModal open={addRepoOpen} onClose={() => setAddRepoOpen(false)} onManage={() => setReposModalOpen(true)} />
		</div>
	)
}
