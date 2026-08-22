import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
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
	const [treeCollapsed, setTreeCollapsed] = useState(false)
	const [archiveView, setArchiveView] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [reposModalOpen, setReposModalOpen] = useState(false)
	const [addRepoOpen, setAddRepoOpen] = useState(false)
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

	return (
		<div className={styles.appRoot}>
		<div className={styles.root} ref={rootRef}>
			<aside className={styles.sidebar}>
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
								<div className={styles.repoSelectDivider} />
								<div
									className={`${styles.repoSelectOpt} ${styles.repoSelectAdd}`}
									onClick={() => {
										setRepoPickerOpen(false)
										setAddRepoOpen(true)
									}}
								>
									+ 새 레포 추가
								</div>
							</div>
						)}
					</span>
					<span className={styles.inboxAnchor}>
						<button className={styles.inboxTrigger} type="button" onClick={(e) => { e.stopPropagation(); setTicketOpen((o) => !o) }} title="일감 생성">
							{PLUS_ICON}
							<span>일감</span>
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

				{!archiveView && visibleInbox.length > 0 && (
					<div className={`scroll-y ${styles.inboxList}`}>
						{visibleInbox.map((t) => (
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
										{classifying[t.id] ? (
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
						{visibleFolders.map((f) => (
							<FolderCard key={f.id} folder={f} />
						))}
						{visibleFolders.length === 0 && <div className={styles.treeEmpty}>진행 중인 작업 없음</div>}
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
