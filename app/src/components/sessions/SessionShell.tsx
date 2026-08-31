import { useEffect, useRef, useState } from 'react'
import { useSessionsStore, openTaskOrFolderDetail } from '../../store/useSessionsStore'
import { useReviewStore } from '../../store/useReviewStore'
import { useTabsStore, CRONJOBS_NODE_ID, CALENDAR_NODE_ID, CONTROL_NODE_ID } from '../../store/useTabsStore'
import { useBrowserNavStore } from '../../store/useBrowserNavStore'
import { useUiStore } from '../../store/useUiStore'
import type { Repo } from '../../store/types'
import { getRepoColor, REPO_COLOR_PALETTE } from '../../utils/repoColor'
import { useUpdateCheck } from '../../utils/useUpdateCheck'
import { useT, useTp, translate, localeFor } from '../../utils/i18n'
import StatusDot from '../common/StatusDot'
import FolderCard from './FolderCard'
import TabWorkspace from './TabWorkspace'
import PrReviewModal from './PrReviewModal'
import TaskDetailModal from './TaskDetailModal'
import SubtaskDetailPanel from './SubtaskDetailPanel'
import NotesSection from './NotesSection'
import NoteDetailPanel from './NoteDetailPanel'
import SettingsModal from './SettingsModal'
import Modal from '../common/Modal'
import RepoTable from './RepoTable'
import AddRepoModal from './AddRepoModal'
import NewTaskModal from './NewTaskModal'
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
// AUTOMATIONS_ICON에서 시계(예약 실행)를 뺀 순수 달력 — "정해진 시각에 자동 실행"이 아니라
// "날짜별로 일감을 훑어보고 재배치"하는 캘린더라 시계 배지를 붙이면 크론잡과 혼동된다.
const CALENDAR_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<rect x="3" y="5" width="18" height="16" rx="2.5" />
		<path d="M3 10h18M8 3v4M16 3v4" />
		<path d="M7.5 14h1M11.5 14h1M15.5 14h1M7.5 17.5h1M11.5 17.5h1" />
	</svg>
)
// "+ 새 레포 추가"가 텍스트 "+"만 있어서 뭘 하는 액션인지 한눈에 안 들어왔다 — 폴더+플러스 아이콘으로
// (Orca 사이드바의 "새 프로젝트" 아이콘 참고).
// 오버마인드(§control.cjs, 구 "관제") — 안테나 기둥이던 옛 아이콘("관제탑" 컨셉)을 "모든 걸 조종하는
// 뇌" 컨셉에 맞춰 뇌 형상으로 교체(§ tabIcons.tsx control 아이콘과 동일 형상 — 사이드바·탭에서 같은
// 실루엣으로 보이게).
const CONTROL_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 3.2c-1.7 0-3 1.3-3 3v.3C7.3 6.9 6 8.3 6 10.1c0 .9.3 1.7.9 2.3-.6.6-.9 1.4-.9 2.3 0 1.5 1 2.8 2.4 3.2.2 1.6 1.6 2.9 3.3 2.9h.4" />
		<path d="M12 3.2c1.7 0 3 1.3 3 3v.3c1.7.3 3 1.7 3 3.5 0 .9-.3 1.7-.9 2.3.6.6.9 1.4.9 2.3 0 1.5-1 2.8-2.4 3.2-.2 1.6-1.6 2.9-3.3 2.9h-.4" />
		<path d="M12 3.2v17.6M9 9.6h.01M15 9.6h.01M9 14.4h.01M15 14.4h.01" />
	</svg>
)
const FOLDER_ADD_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
		<path d="M12 12v5M9.5 14.5h5" />
	</svg>
)
// origin 리모트가 없거나(GitHub가 아니거나) 아바타를 못 찾은 레포용 대체 아이콘 — FOLDER_ADD_ICON에서
// "+" 획만 뺀 순수 폴더 윤곽.
const REPO_FALLBACK_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
	</svg>
)
function RepoIcon({ repo }: { repo: Repo }) {
	const [failed, setFailed] = useState(false)
	if (!repo.ownerAvatarUrl || failed) return <span className={styles.repoIconFallback}>{REPO_FALLBACK_ICON}</span>
	return <img src={repo.ownerAvatarUrl} alt="" className={styles.repoIconImg} onError={() => setFailed(true)} />
}
// 레포 식별 컬러 점 — 기본은 repo.id 해시로 자동 배정(getRepoColor), 눌러서 팔레트 중 하나를 고르면
// repo.color로 저장돼 자동 배정을 덮어쓴다. 원래는 점 바로 아래 뜨는 인라인 팝오버였는데, 드롭다운
// 스크롤 컨테이너(.repoSelectPanel) 안에 중첩된 absolute 요소라 조상 어딘가의 overflow에 계속
// 잘려 보였다(overflow-x:visible을 줘도 재발 — 사용자가 스크린샷으로 두 번 신고). 조상 클리핑과
// 무관한 Modal(position:fixed 오버레이)로 바꿔 근본적으로 해결.
function RepoColorDot({ repo, open, onToggle, onClose }: { repo: Repo; open: boolean; onToggle(): void; onClose(): void }) {
	const t = useT()
	const tp = useTp()
	const current = getRepoColor(repo)
	return (
		<>
			<span
				className={styles.repoColorDot}
				style={{ background: current }}
				title={t('레포 색상')}
				onClick={(e) => {
					e.stopPropagation()
					onToggle()
				}}
			/>
			<Modal open={open} onClose={onClose} width={220}>
				<div className={styles.repoColorModalTitle}>{tp('{name} 색상', { name: repo.name })}</div>
				<div className={styles.repoColorGrid}>
					{REPO_COLOR_PALETTE.map((c) => (
						<span
							key={c}
							className={`${styles.repoColorSwatch} ${c === current ? styles.repoColorSwatchActive : ''}`}
							style={{ background: c }}
							onClick={() => {
								useSessionsStore.getState().updateRepo(repo.id, { color: c })
								onClose()
							}}
						/>
					))}
				</div>
			</Modal>
		</>
	)
}
const SEARCH_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="11" cy="11" r="7" />
		<path d="M21 21l-4.3-4.3" />
	</svg>
)
function timeAgo(ts: number) {
	const min = Math.floor((Date.now() - ts) / 60000)
	if (min < 1) return translate('방금')
	if (min < 60) return `${min}m`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}h`
	return `${Math.floor(hr / 24)}d`
}

// 프로토타입의 "사이드바 작업 트리 + 탭 워크스페이스" IA를 실제 데이터로 구현한 최상위 레이아웃.
// FolderCard/TaskRow는 프로토타입의 압축 트리 노드 스타일로 다시 그렸고, ReviewItemCard/
// PrReviewModal/RepoTable은 store에서 id로 조회하는 좁은 props라 그대로 재사용했다.
export default function SessionShell() {
	const t = useT()
	const tp = useTp()
	const lang = useUiStore((s) => s.lang)
	const activeNodeId = useTabsStore((s) => s.activeNodeId)
	const folders = useSessionsStore((s) => s.folders)
	const inbox = useSessionsStore((s) => s.inbox)
	const notes = useSessionsStore((s) => s.notes)
	const detailTaskId = useSessionsStore((s) => s.detailTaskId)
	const detailSubtaskId = useSessionsStore((s) => s.detailSubtaskId)
	const detailSubtaskParentId = useSessionsStore((s) => s.detailSubtaskParentId)
	const closeSubtaskDetail = useSessionsStore((s) => s.closeSubtaskDetail)
	const detailNoteId = useSessionsStore((s) => s.detailNoteId)
	const closeNoteDetail = useSessionsStore((s) => s.closeNoteDetail)
	const closeTaskDetail = useSessionsStore((s) => s.closeTaskDetail)
	const reviewJobs = useReviewStore((s) => s.jobs)
	const clearReview = useReviewStore((s) => s.clearReview)
	const repos = useSessionsStore((s) => s.repos)
	const openTasks = useSessionsStore((s) => s.openTasks)
	const openFolders = useSessionsStore((s) => s.openFolders)
	const toggleFolder = useSessionsStore((s) => s.toggleFolder)
	const classifying = useSessionsStore((s) => s.classifying)
	const enrichingTitle = useSessionsStore((s) => s.enrichingTitle)
	const archive = useSessionsStore((s) => s.archive)
	const archiveBusy = useSessionsStore((s) => s.archiveBusy)
	const loadArchive = useSessionsStore((s) => s.loadArchive)
	const restoreFolder = useSessionsStore((s) => s.restoreFolder)
	const loadGitStatus = useSessionsStore((s) => s.loadGitStatus)
	const loadTermStatus = useSessionsStore((s) => s.loadTermStatus)
	const loadBoard = useSessionsStore((s) => s.loadBoard)
	const loadRepos = useSessionsStore((s) => s.loadRepos)
	// "관제에게 물어보기 하면 관제가 움직이잖아. 관제에도 상태가 보일 필요가 있어" — term.cjs가 이미
	// 계산해주는 status(§ loadTermStatus, TaskRow가 쓰는 것과 같은 소스)를 관제 세션 이름(orm-control)
	// 그대로 조인한다.
	const controlTermStatus = useSessionsStore((s) => s.termStatus['orm-control'])
	// "멈춘상황을 어떻게 인지할 수 있을까? 지금은 인지가 어려워" — control.cjs checkStalled와 같은
	// 3분 임계값(값은 그쪽이 정본, 여긴 폴링 지연 없이 즉시 반영하려고 프론트에서도 계산).
	const CONTROL_STALLED_THRESHOLD_MS = 3 * 60 * 1000
	const controlStalled =
		!!controlTermStatus?.exists &&
		!controlTermStatus.working &&
		!controlTermStatus.waiting &&
		!controlTermStatus.needsAuth &&
		!controlTermStatus.needsResume &&
		!!controlTermStatus.lastWorkingAt &&
		Date.now() - controlTermStatus.lastWorkingAt >= CONTROL_STALLED_THRESHOLD_MS
	const loadHealth = useSessionsStore((s) => s.loadHealth)
	const refreshAllOrchestrations = useSessionsStore((s) => s.refreshAllOrchestrations)
	const refreshAllSubtaskWork = useSessionsStore((s) => s.refreshAllSubtaskWork)
	const cockpitSummary = useSessionsStore((s) => s.cockpitSummary)
	const devServers = useSessionsStore((s) => s.devServers)
	const apiAddress = useSessionsStore((s) => s.apiAddress)
	const updateInfo = useUpdateCheck()
	// "가장 하단에 켜져있는 로컬서버 바로 클릭 가능한 버튼이나 뭔가 있으면 좋겠어" — 에이전트가
	// 원격으로 브라우저 탭을 열어주는 경로는 없다(webview는 렌더러 안에만 존재 — §BrowserPane.tsx
	// 주석). 대신 지금 보고 있는 태스크의 "브라우저" 탭을 사람이 직접 그 dev 서버로 연다 — 터미널
	// 링크 클릭과 똑같은 useBrowserNavStore 경로(§XTerm.tsx)라 새 배관이 필요 없다.
	function openDevServer() {
		const nodeId = useTabsStore.getState().activeNodeId
		const dev = devServers[0]
		if (!nodeId || nodeId.startsWith('__') || !dev) return
		useTabsStore.getState().openOrFocusTab(nodeId, 'browser')
		useBrowserNavStore.getState().request(nodeId, `http://localhost:${dev.port}`)
	}

	// "각 레포별로 볼 수 있는 체크박스가 있으면 좋겠어. 예외처리를 한다던가" — 예전엔 라디오 방식(전체 or
	// 딱 하나)이었다. null=전체(필터 없음), Set이면 그 안에 있는 레포만. "전체" 상태에서 하나만 체크
	// 해제하면 나머지 전부를 체크한 Set으로 시작해 "이 레포만 빼고 다 보기"(예외처리)가 자연스럽게 된다.
	// "이게 캘린더에도 적용되게 해줘" — useSessionsStore로 끌어올려 CalendarPane도 같은 필터를 본다.
	const repoFilters = useSessionsStore((s) => s.repoFilters)
	const toggleRepoFilter = useSessionsStore((s) => s.toggleRepoFilter)
	const setRepoFilters = useSessionsStore((s) => s.setRepoFilters)
	const [repoPickerOpen, setRepoPickerOpen] = useState(false)
	const [newTaskModalOpen, setNewTaskModalOpen] = useState(false)
	const [sidebarQuery, setSidebarQuery] = useState('')
	const [treeCollapsed, setTreeCollapsed] = useState(false)
	const [archiveView, setArchiveView] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [reposModalOpen, setReposModalOpen] = useState(false)
	const [addRepoOpen, setAddRepoOpen] = useState(false)
	const [colorPickerFor, setColorPickerFor] = useState<string | null>(null)
	const multiRepo = repos.length > 1
	const rootRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		loadArchive()
	}, [loadArchive])

	// "ip address가 달라" — 예전엔 마운트 시 딱 한 번만 불러서, 앱을 켜둔 채 Wi-Fi가 바뀌거나(DHCP
	// 재임대 등) 잠깐 끊겼다 잡히면 상태바의 LAN IP가 영영 옛 값에 멈춰 있었다. gitStatus 등과 같은
	// 15초 주기로 다시 불러 실제 지금 IP를 따라가게 한다.
	useEffect(() => {
		loadHealth()
		const id = setInterval(loadHealth, 15000)
		return () => clearInterval(id)
	}, [loadHealth])

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

	// "진행중 표기도 안돼" — 서브태스크의 진행 중/세션 종료 배지도 같은 이유로 안 보였다: 이 데이터
	// 자체를 사이드바가 구독한 적이 없었다(TaskDetailContent가 열려있을 때만 자체 폴링). 같은 주기로
	// 전역 상태에 채워 FolderCard/TaskRow의 subChain 점이 실제 세션 생사를 반영하게 한다.
	useEffect(() => {
		refreshAllSubtaskWork()
		const id = setInterval(refreshAllSubtaskWork, 15000)
		return () => clearInterval(id)
	}, [refreshAllSubtaskWork])

	// "관제에게 물어보기"로 저장된 팀 규칙은 관제 세션이 curl로 서버에 직접 쓴 것이라(프론트의 자체
	// 액션을 안 거침) loadBoard와 같은 이유로 여기도 주기적으로 다시 안 불러오면 화면에 안 반영된다.
	useEffect(() => {
		const id = setInterval(loadRepos, 15000)
		return () => clearInterval(id)
	}, [loadRepos])

	// TaskRow가 질문대기/인증필요를 보여주려면(§12) term.cjs의 실시간 status가 필요 — 백엔드는 이미
	// /api/term으로 내려주고 있었는데 프론트 어디서도 안 쓰고 있었다.
	useEffect(() => {
		loadTermStatus()
		const id = setInterval(loadTermStatus, 15000)
		return () => clearInterval(id)
	}, [loadTermStatus])

	// "사이드바가 실시간 동기화되지 않고 있어" — 지휘자가 MCP/API로 서브태스크를 만들거나 이름을
	// 바꾸는 등, 프론트의 자체 액션을 거치지 않고 서버 데이터가 바뀌는 경우가 있다(오케스트레이터
	// 세션이 API를 직접 호출). 그런 변경은 화면이 다시 로드되기 전까진 반영될 계기가 없었다 —
	// gitStatus/오케스트레이션과 같은 주기로 보드 전체를 다시 불러와 사이드바 트리를 최신으로 유지.
	useEffect(() => {
		const id = setInterval(loadBoard, 15000)
		return () => clearInterval(id)
	}, [loadBoard])

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
				setColorPickerFor(null)
			}
		}
		document.addEventListener('click', onClick)
		return () => document.removeEventListener('click', onClick)
	}, [])

	// "일감 완료 체크... 태스크에서는 없어져도 되나 캘린더에는 남아있어야함" — 완료 처리한 태스크는
	// 이 사이드바 트리에서만 걸러낸다. 캘린더(CalendarPane)는 completed_at을 보지 않고 그대로 보여준다.
	const visibleInbox = (repoFilters ? inbox.filter((t) => !!t.repo_id && repoFilters.has(t.repo_id)) : inbox).filter((t) => !t.completed_at)
	const visibleFolders = (repoFilters ? folders.map((f) => ({ ...f, tasks: f.tasks.filter((t) => !!t.repo_id && repoFilters.has(t.repo_id)) })) : folders).map((f) => ({ ...f, tasks: f.tasks.filter((t) => !t.completed_at) })).filter((f) => !repoFilters || f.tasks.length > 0)
	const totalTasks = visibleInbox.length + visibleFolders.reduce((n, f) => n + f.tasks.length, 0)
	// 버튼 라벨은 실제 선택 상태를 정직하게 반영한다 — 체크된 레포가 몇 개냐에 따라 이름/개수/전체를 구분.
	const checkedRepos = repoFilters ? repos.filter((r) => repoFilters.has(r.id)) : repos
	const activeRepo = checkedRepos.length === 1 ? checkedRepos[0] : undefined
	const activeRepoLabel = !repoFilters ? t('전체 레포') : checkedRepos.length === 0 ? t('레포 없음') : checkedRepos.length === 1 ? checkedRepos[0].name : tp('{n}개 레포', { n: checkedRepos.length })

	const q = sidebarQuery.trim().toLowerCase()
	const displayInbox = q ? visibleInbox.filter((t) => t.name.toLowerCase().includes(q)) : visibleInbox
	const displayFolders = q ? visibleFolders.map((f) => (f.name.toLowerCase().includes(q) ? f : { ...f, tasks: f.tasks.filter((t) => t.name.toLowerCase().includes(q)) })).filter((f) => f.name.toLowerCase().includes(q) || f.tasks.length > 0) : visibleFolders
	const displayNotes = q ? notes.filter((n) => n.name.toLowerCase().includes(q)) : notes

	// 보관함 — archived_at(ms) 기준 날짜별로 묶어서 최신 날짜가 위로 오게
	const archiveGroups: [string, typeof archive][] = []
	{
		const byDate = new Map<string, typeof archive>()
		for (const f of archive) {
			const label = f.archived_at ? new Date(f.archived_at).toLocaleDateString(localeFor(lang), { year: 'numeric', month: 'long', day: 'numeric' }) : t('날짜 없음')
			if (!byDate.has(label)) byDate.set(label, [])
			byDate.get(label)!.push(f)
		}
		archiveGroups.push(...byDate.entries())
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
							{t('크론잡')}
						</button>
						<button
							className={styles.navLink}
							type="button"
							onClick={() => {
								const s = useTabsStore.getState()
								if (!s.tabsByNode[CALENDAR_NODE_ID]?.length) s.openTab(CALENDAR_NODE_ID, 'calendar')
								s.setActiveNode(CALENDAR_NODE_ID, 'calendar')
							}}
						>
							<span className={styles.navLinkIcon}>{CALENDAR_ICON}</span>
							{t('캘린더')}
						</button>
						<button
							className={styles.navLink}
							type="button"
							onClick={() => {
								const s = useTabsStore.getState()
								if (!s.tabsByNode[CONTROL_NODE_ID]?.length) s.openTab(CONTROL_NODE_ID, 'control')
								s.setActiveNode(CONTROL_NODE_ID, 'control')
							}}
						>
							<span className={styles.navLinkIcon}>{CONTROL_ICON}</span>
							<span style={{ flex: 1, textAlign: 'left' }}>{t('오버마인드')}</span>
							{controlTermStatus?.exists && (
								<StatusDot
									color={controlTermStatus.needsAuth ? 'red' : controlTermStatus.waiting || controlStalled ? 'amber' : 'green'}
									pulse={!!controlTermStatus.working || controlStalled}
									size={7}
									title={controlStalled ? t('오버마인드가 한동안 응답이 없습니다 — 확인해보세요') : undefined}
								/>
							)}
						</button>
					</div>
					<label className={styles.sidebarSearch}>
						<span className={styles.sidebarSearchIcon}>{SEARCH_ICON}</span>
						<input className={styles.sidebarSearchInput} type="text" value={sidebarQuery} onChange={(e) => setSidebarQuery(e.target.value)} placeholder={t('검색')} />
					</label>
					<div className={styles.head}>
						<span className={`${styles.repoPicker} ${repoPickerOpen ? styles.open : ''}`}>
							<button
								className={styles.repoSelect}
								type="button"
								onClick={(e) => {
									e.stopPropagation()
									setRepoPickerOpen((o) => !o)
									setColorPickerFor(null)
								}}
							>
								{activeRepo && <RepoIcon repo={activeRepo} />}
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
										<div
											className={`${styles.repoSelectOpt} ${!repoFilters ? styles.selected : ''}`}
											onClick={() => {
												setRepoFilters(null)
												setRepoPickerOpen(false)
											}}
										>
											<span className={styles.repoCheckbox} data-checked={!repoFilters} />
											{t('전체 레포')}
										</div>
									)}
									{repos.map((r) => {
										const checked = !repoFilters || repoFilters.has(r.id)
										return (
											<div
												key={r.id}
												className={`${styles.repoSelectOpt} ${checked && repoFilters ? styles.selected : ''}`}
												onClick={(e) => {
													e.stopPropagation()
													toggleRepoFilter(r.id)
												}}
											>
												<span className={styles.repoCheckbox} data-checked={checked} />
												<RepoIcon repo={r} />
												<span className={styles.repoSelectOptName}>{r.name}</span>
												<RepoColorDot repo={r} open={colorPickerFor === r.id} onToggle={() => setColorPickerFor((id) => (id === r.id ? null : r.id))} onClose={() => setColorPickerFor(null)} />
											</div>
										)
									})}
									<div className={styles.wtDivider} />
									<div
										className={`${styles.repoSelectOpt} ${styles.repoSelectManage}`}
										onClick={() => {
											setRepoPickerOpen(false)
											setReposModalOpen(true)
										}}
									>
										{t('레포 관리')}
									</div>
								</div>
							)}
						</span>
						<button
							className={styles.headIconBtn}
							type="button"
							onClick={(e) => {
								e.stopPropagation()
								setRepoPickerOpen(false)
								setAddRepoOpen(true)
							}}
							title={t('새 레포 추가')}
						>
							{FOLDER_ADD_ICON}
						</button>
						<button
							className={styles.taskAddBtn}
							type="button"
							onClick={(e) => {
								e.stopPropagation()
								setNewTaskModalOpen(true)
							}}
							title={t('메인 태스크 추가')}
						>
							{PLUS_ICON}
						</button>
					</div>

					{!archiveView && (
						<div className={`${styles.taskCount} ${treeCollapsed ? styles.collapsed : ''}`} onClick={collapseAll}>
							<span className={styles.tcchev}>⌄</span>
							<span>{totalTasks} Task</span>
						</div>
					)}

					{!archiveView && displayInbox.length > 0 && (
						<div className={`scroll-y ${styles.inboxList}`}>
							{displayInbox.map((task) => (
								<div key={task.id} className={`${styles.inboxRow} ${activeNodeId === task.id ? styles.inboxRowSelected : ''}`} onClick={() => useTabsStore.getState().setActiveNode(task.id, 'terminal')}>
									<span className={styles.inboxIcon}>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
											<path d="M4 12h4l2 3h4l2-3h4" />
											<path d="M5.5 5h13L21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6L5.5 5z" />
										</svg>
									</span>
									<div className={styles.inboxBody}>
										<div className={styles.inboxTitle}>{task.name}</div>
										<div className={styles.inboxMeta}>
											{enrichingTitle[task.id] ? (
												// 링크로 만든 일감의 제목이 당분간 "○○ 링크 태스크" placeholder라 헷갈릴 수
												// 있다 — 링크 내용을 읽어 실제 제목으로 바꾸는 중임을 명시(최대 170초).
												<span className={styles.inboxClassifying}>
													<span className={styles.inboxSubmitSpinner} />
													{t('제목 생성 중…')}
												</span>
											) : classifying[task.id] ? (
												// repoClassify.cjs가 백그라운드에서 도는 동안(멀티레포일 때만, 최대 ~16초) 조용히
												// 아무 표시가 없었다 — "레포 분류 중"이라고 명시해서 멈춘 것처럼 안 보이게 한다.
												<span className={styles.inboxClassifying}>
													<span className={styles.inboxSubmitSpinner} />
													{t('레포 분류 중…')}
												</span>
											) : (
												<span className={`m ${styles.inboxTime}`}>{timeAgo(task.created_at)}</span>
											)}
											<span
												className={styles.inboxAction}
												onClick={(e) => {
													e.stopPropagation()
													useSessionsStore.getState().quickStartTask(task.id)
												}}
											>
												{t('시작')}
											</span>
										</div>
									</div>
								</div>
							))}
						</div>
					)}

					{!archiveView && <NotesSection notes={displayNotes} />}

					{!archiveView && (
						<div className={`scroll-y ${styles.treeScroll}`}>
							{displayFolders.map((f) => (
								<FolderCard key={f.id} folder={f} />
							))}
							{displayFolders.length === 0 && <div className={styles.treeEmpty}>{q ? t('검색 결과 없음') : t('진행 중인 작업 없음')}</div>}
						</div>
					)}

					{archiveView && (
						<div className={`scroll-y ${styles.treeScroll}`}>
							{archive.length === 0 && <div className={styles.treeEmpty}>{t('보관된 작업 없음')}</div>}
							{archiveGroups.map(([date, items]) => (
								<div key={date}>
									<div className={`m ${styles.archiveDateLabel}`}>{date}</div>
									{items.map((f) => (
										<div key={f.id} className={styles.archiveItemRow}>
											<div className={styles.archiveItemBody}>
												<div className={styles.archiveItemTitle}>{f.name}</div>
												{f.base && <div className={`m ${styles.wtLineSmall}`}>⎇ {f.base}</div>}
											</div>
											<span className={styles.archiveRestoreBtn} onClick={() => restoreFolder(f.id)} style={{ opacity: archiveBusy === f.id ? 0.5 : undefined }}>
												{t('복원')}
											</span>
										</div>
									))}
								</div>
							))}
						</div>
					)}

					<div className={`m ${styles.foot}`}>
						<span className={styles.livedot} />
						<span>
							{cockpitSummary?.mainBranch ? `${cockpitSummary.mainBranch} · ` : ''}
							{tp('{n} 작업', { n: totalTasks })}
						</span>
					</div>
					{/* "다른 걸 하고 있어도 백그라운드에서 돌아서 다 되면 확인할 수 있게, 사이드바에서 진행상황을
				    보여주고 클릭하면 상세로" — useReviewStore는 드로어 마운트 여부와 무관하게 계속 폴링하므로
				    여기서도 같은 상태를 그대로 구독만 하면 된다. */}
					{/* "태스크 등록됐으면 여기서 빼줘" — quickStartTask가 폴더를 만들어 태스크를 그리로 옮기면
				    folder_id가 생긴다("등록됨"의 신호). folders[].tasks에 있다는 게 바로 그 뜻이라, 거기
				    속한 태스크는 이 검토 진행 목록에서 뺀다(더 이상 트리아지 대상이 아니라 실제 오케스트레이션
				    중인 태스크니까). 아직 inbox에 있는 것만 여기 남는다. */}
					{(() => {
						const registeredTaskIds = new Set(folders.flatMap((f) => f.tasks.map((t) => t.id)))
						const pendingReviewJobs = Object.values(reviewJobs).filter((j) => !registeredTaskIds.has(j.taskId))
						if (pendingReviewJobs.length === 0) return null
						return (
							<div className={styles.reviewSection}>
								<div className={styles.reviewSectionTitle}>{t('AI 검토')}</div>
								{pendingReviewJobs.map((j) => {
									const result = j.status?.result
									const done = !!j.status?.done
									const failed = !!j.error || (done && !!result && !result.ok && !result.tooVague)
									const vague = done && !!result && !result.ok && !!result.tooVague
									return (
										<div key={j.taskId} className={styles.reviewRow} onClick={() => openTaskOrFolderDetail(j.taskId)}>
											<span className={`${styles.reviewDot} ${!done ? styles.reviewDotBusy : failed ? styles.reviewDotFail : vague ? styles.reviewDotWarn : styles.reviewDotDone}`} />
											<span className={styles.reviewName}>{j.taskName}</span>
											<span className={styles.reviewStatus}>
												{/* "24퍼에서 안움직여" — j.error가 뜨면 done은 영영 true가 안 되니(폴링이 실패 직후 멈춤)
										    !done 분기가 먼저 걸려 마지막으로 받은 퍼센트에서 그대로 얼어붙어 보였다.
										    failed(=error 포함) 여부를 !done보다 먼저 확인해야 한다. */}
												{failed ? t('실패') : !done ? `${j.status?.percent ?? 5}%` : vague ? t('설명 필요') : result && result.ok ? tp('{days}일', { days: result.days }) : ''}
											</span>
											<span
												className={styles.reviewDismiss}
												onClick={(e) => {
													e.stopPropagation()
													clearReview(j.taskId)
												}}
												title={t('닫기')}
											>
												×
											</span>
										</div>
									)
								})}
							</div>
						)
					})()}
					<div className={`${styles.archiveRow} ${archiveView ? styles.archiveRowActive : ''}`} onClick={() => setArchiveView((v) => !v)}>
						<span className={styles.archiveIcon}>{ARCHIVE_ICON}</span>
						<span style={{ flex: 1 }}>{t('보관함')}</span>
						<span className={`m ${styles.archiveCount}`}>{archive.length}</span>
					</div>
					<div className={styles.archiveRow} onClick={() => setSettingsOpen(true)}>
						<span className={styles.archiveIcon}>{GEAR_ICON}</span>
						<span style={{ flex: 1 }}>{t('설정')}</span>
					</div>
				</aside>

				<main className={styles.workspace}>
					<TabWorkspace />
				</main>
			</div>

			<div className={`m ${styles.statusbar}`}>
				<span className={styles.sbItem}>
					<span className={styles.sbDot} />
					<span>{t('연결됨')}</span>
				</span>
				<span className={styles.sbSep} />
				{cockpitSummary === null ? (
					// 이번 세션에서 /api/cockpit이 아직 한 번도 안 왔다 — dev/스트림/dirty/PR을 전부 0으로
					// 보여주면 "이미 확인 끝났고 진짜 0개"처럼 보여 오독된다(§ "새로고침하고 화면 동기화되는데
					// 오래걸려" 리포트). 워크트리가 많을수록(§ cockpit.cjs streams()) 첫 응답이 늦을 수 있다.
					<span className={styles.sbItem} title={t('레포·워크트리 상태(PR·dirty 등)를 처음 불러오는 중입니다.')}>
						<span className={styles.sbSyncDot} />
						<span>{t('동기화 중…')}</span>
					</span>
				) : (
					<>
						<span
							className={`${styles.sbItem} ${devServers.length ? styles.sbItemLink : ''}`}
							onClick={devServers.length ? openDevServer : undefined}
							title={devServers.length ? tp('localhost:{port} — 지금 태스크의 "브라우저" 탭에서 엽니다', { port: devServers[0].port }) : undefined}
						>
							<b>{cockpitSummary?.devCount ?? 0}</b>&nbsp;dev
						</span>
						<span className={styles.sbItem}>
							<b>{cockpitSummary?.streamsActive ?? 0}</b>/{cockpitSummary?.streamsTotal ?? 0} {t('스트림')}
						</span>
						<span className={styles.sbItem}>
							✎ <b>{cockpitSummary?.dirty ?? 0}</b> dirty
						</span>
						<span className={styles.sbSep} />
						<span className={`${styles.sbPill}`}>
							PR {cockpitSummary?.prOpen ?? 0} open · {cockpitSummary?.prDraft ?? 0} draft
						</span>
					</>
				)}
				{updateInfo && (
					<a
						href={updateInfo.url}
						target="_blank"
						rel="noreferrer"
						className={`${styles.sbItem} ${styles.sbItemLink}`}
						title={tp('버전 {version} 릴리스 노트/다운로드 열기', { version: updateInfo.latestVersion })}
					>
						{tp('🔔 새 버전 v{version}', { version: updateInfo.latestVersion })}
					</a>
				)}
				<span className={styles.sbSpacer} />
				{apiAddress && (
					// "로컬서버 포트 열려있는거 버튼으로 만들어서 클릭하면 브라우저로 열리게" — target="_blank"는
					// electron/main.cjs의 setWindowOpenHandler가 가로채 shell.openExternal로 넘긴다(§ PR 링크와
					// 같은 경로) — 앱 안 webview가 아니라 실제 시스템 기본 브라우저가 뜬다.
					<a href={`http://${apiAddress}`} target="_blank" rel="noreferrer" className={styles.apiAddress} title={t('클릭하면 브라우저에서 엽니다')}>
						{apiAddress}
					</a>
				)}
			</div>

			<PrReviewModal />
			<TaskDetailModal taskId={detailTaskId} onClose={closeTaskDetail} />
			<SubtaskDetailPanel subtaskId={detailSubtaskId} parentTaskId={detailSubtaskParentId} onClose={closeSubtaskDetail} />
			<NoteDetailPanel noteId={detailNoteId} onClose={closeNoteDetail} />
			<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
			<Modal open={reposModalOpen} onClose={() => setReposModalOpen(false)}>
				<RepoTable onAddRepo={() => setAddRepoOpen(true)} />
			</Modal>
			<AddRepoModal open={addRepoOpen} onClose={() => setAddRepoOpen(false)} onManage={() => setReposModalOpen(true)} />
			<NewTaskModal open={newTaskModalOpen} onClose={() => setNewTaskModalOpen(false)} />
		</div>
	)
}
