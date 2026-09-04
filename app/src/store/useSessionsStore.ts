import { create } from 'zustand'
import type { Folder, Task, Repo, BlockedPeriod, Subtask, UiBlock } from './types'
import * as SessionsApi from '../api/sessions'
import type { OrchestrationState, GitStatusEntry, CockpitSummary, SubtaskWorkStatus, DevServerEntry } from '../api/sessions'
import { detectLink, LINK_LABEL } from '../utils/linkDetect'
import { translate, translateP } from '../utils/i18n'
import { listTerm } from '../api/term'
import type { TermStatus } from '../api/term'
import { getSetupStatus } from '../api/setup'
import { useReviewStore } from './useReviewStore'
import { useTabsStore } from './useTabsStore'

const EMPTY_ORCHESTRATION: OrchestrationState = { running: false, currentWaveIndex: 0, sessions: [], log: [], conductor: null, conductorStalled: false, feed: [] }

// "체크한 거 유지되게 해줘 계속 초기화되는데" — repoFilters가 순수 인메모리 상태라 창을 새로고침·재시작할
// 때마다 null(전체 선택)로 돌아갔다. null은 "필터 없음"을 뜻하는 유효 상태라 빈 배열과 구분해서 저장한다.
const REPO_FILTERS_KEY = 'openrm.repoFilters'

function loadRepoFilters(): Set<string> | null {
	try {
		const raw = localStorage.getItem(REPO_FILTERS_KEY)
		if (!raw) return null
		const arr = JSON.parse(raw)
		return Array.isArray(arr) ? new Set(arr) : null
	} catch {
		return null
	}
}

function saveRepoFilters(filters: Set<string> | null) {
	try {
		if (!filters) localStorage.removeItem(REPO_FILTERS_KEY)
		else localStorage.setItem(REPO_FILTERS_KEY, JSON.stringify(Array.from(filters)))
	} catch {
		/* private mode / no storage — fine, just won't persist */
	}
}

// 서브태스크는 각 Task 안에 중첩된 배열이라, inbox/folders 양쪽 트리를 순회하며 그 안의 서브태스크
// 하나만 갱신하는 걸 여러 액션(이름/설명/예정일/기간)이 공유한다.
function mapSubtaskInTasks(tasks: Task[], subtaskId: string, updater: (st: Subtask) => Subtask): Task[] {
	return tasks.map((t) => (t.subtasks.some((st) => st.id === subtaskId) ? { ...t, subtasks: t.subtasks.map((st) => (st.id === subtaskId ? updater(st) : st)) } : t))
}

// 메인 태스크 없는 서브태스크(메모, § db.cjs v20)는 어느 Task의 subtasks 배열에도 없이 notes에
// flat하게 있어 위 mapSubtaskInTasks와 별개로 갱신한다.
function mapSubtaskInNotes(notes: Subtask[], subtaskId: string, updater: (st: Subtask) => Subtask): Subtask[] {
	return notes.map((n) => (n.id === subtaskId ? updater(n) : n))
}

// reorderSubtasks의 낙관적 갱신 — taskId가 일치하는 태스크 하나만 subtasks 배열을 새 id 순서로 재배치한다.
function reorderTaskSubtasks(tasks: Task[], taskId: string, orderedIds: string[]): Task[] {
	return tasks.map((t) => {
		if (t.id !== taskId) return t
		const byId = new Map(t.subtasks.map((st) => [st.id, st]))
		return { ...t, subtasks: orderedIds.map((id) => byId.get(id)).filter((st): st is Subtask => !!st) }
	})
}

export interface SessionsState {
	folders: Folder[]
	inbox: Task[]
	// "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — task_id 없는 독립
	// 서브태스크. inbox처럼 어느 Task에도 속하지 않은 것들만 flat하게 담긴다.
	notes: Subtask[]
	loaded: boolean
	loading: boolean
	error: string | null
	repos: Repo[]
	reposLoaded: boolean
	// "일정 막기 기능이 필요해. QA기간같은게 있어서 다른걸 못할 수 있거든" — 캘린더 전용 차단 기간.
	blockedPeriods: BlockedPeriod[]
	blockedPeriodsLoaded: boolean
	archive: Folder[]
	archiveLoaded: boolean
	archiveBusy: string | null
	// "고스티도 tmux도 설정 토글로 제공해야해" — XTerm.tsx의 "고스티에서 열기" 버튼을 보여줄지 결정하는
	// 전역 설정값. 여러 터미널 탭이 동시에 떠도 한 번만 불러오면 되므로 SessionShell에서 loadArchive와
	// 같은 패턴으로 한 번만 로드한다(§ loadTerminalGhostty).
	terminalGhostty: boolean
	// "메인 태스크 오른쪽 마우스 클릭하면 삭제" — archiveBusy와 같은 패턴, 별도 필드(동시에 두 동작이
	// 겹칠 일은 없지만 의미를 분리해두는 게 나음).
	deleteBusy: string | null
	gitStatus: Record<string, GitStatusEntry> // 브랜치명 → PR/ahead-behind (server/cockpit.cjs 실데이터)
	// "PR뱃지도 자동으로 안잡혀" — 서브태스크가 자기 워크트리 안에서 브랜치를 바꾸면 위 gitStatus(브랜치명
	// 키)는 그 순간 낡는다. 워크트리 경로는 안 바뀌므로 경로 키로도 같은 데이터를 들고 있는다.
	gitStatusByPath: Record<string, GitStatusEntry>
	termStatus: Record<string, TermStatus> // tmux 세션명 → 질문대기/인증필요(term.cjs status() 실데이터, 저장값 아님)
	cockpitSummary: CockpitSummary | null // 사이드바 하단 상태바 요약 (dev/스트림/dirty/PR 총계, 메인 브랜치)
	// "가장 하단에 켜져있는 로컬서버 바로 클릭 가능한 버튼" — cockpitSummary.devCount는 개수뿐이라
	// 실제로 열 URL(port)이 없었다. 같은 /api/cockpit 응답의 devServers를 그대로 노출.
	devServers: DevServerEntry[]
	apiAddress: string | null // "host:port" — 상태바 우측의 실제 백엔드 주소
	rootPath: string | null // 프로젝트 루트 경로 — 오케스트레이터/지휘자가 아직 없어도 클로드 세션을 띄울 기본 cwd

	classifying: Record<string, boolean> // taskId → repoClassify.cjs 자동배정이 아직 진행 중인지(멀티레포일 때만)
	enrichingTitle: Record<string, boolean> // taskId → 링크 내용을 읽어 "○○ 링크 태스크" placeholder를 실제 제목으로 바꾸는 중인지
	openFolders: Record<string, boolean>
	openTasks: Record<string, boolean>
	dragTaskId: string | null
	overFolderId: string | null // 'inbox' | folder id | null
	// 태스크를 다른 태스크 위로 드래그하면 그 태스크의 폴더로 합류(chain 순서로 그 앞에 삽입) —
	// "하위 태스크" 가벼운 버전(§ 사용자 확인: 새 스키마 없이 기존 폴더 오케스트레이션 재사용).
	// 드롭 대상에 시각 피드백을 주기 위한 hover 태스크 id.
	overTaskId: string | null
	// "사이드바 서브태스크들은 드래그앤 드롭으로 위치를 자유자재로 조정" — 위 dragTaskId/overTaskId와
	// 같은 구조지만 서브태스크는 부모 태스크 안에서만 재배치되므로 어느 태스크 소속인지도 같이 든다.
	dragSubtaskId: string | null
	dragSubtaskTaskId: string | null
	overSubtaskId: string | null
	orchestration: Record<string, OrchestrationState>
	orchBusy: Record<string, boolean>
	// taskId → 그 태스크 서브태스크들의 살아있음 상태(§ FolderCard/TaskRow의 subChain 진행 중 배지).
	subtaskWork: Record<string, SubtaskWorkStatus[]>

	reviewTaskId: string | null
	disputingReviewId: string | null
	disputeText: string
	confirmingApplyId: string | null
	reviewBusy: boolean

	// TaskDetailModal의 열림 상태 — 캘린더 칩 클릭뿐 아니라 사이드바의 "AI 검토" 진행 목록에서도
	// 같은 드로어를 열어야 해서(§ "사이드바에서 진행상황을 보여주고 클릭하면 상세로") CalendarPane
	// 로컬 state였던 걸 여기로 끌어올렸다 — SessionShell 최상위에서 한 번만 렌더.
	detailTaskId: string | null

	// "서브태스크를 누르면 해당 서브태스크의 내용만 보이게" — 부모 태스크의 전체 모달과 별개로,
	// 서브태스크 하나만을 위한 드로어(SubtaskDetailPanel). parentTaskId가 있어야 그 서브태스크를
	// task.subtasks에서 찾고, "메인 태스크로 이동" 버튼도 그 부모를 연다.
	detailSubtaskId: string | null
	detailSubtaskParentId: string | null

	// "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — 메모(notes) 전용
	// 드로어(NoteDetailPanel)를 위한 열림 상태. SubtaskDetailPanel과 별개다 — 메모는 부모 태스크가
	// 없어 "메인 태스크로 이동"/세션 상태 같은 그쪽 UI가 성립하지 않는다.
	detailNoteId: string | null

	// "좋아. 이것 그대로 두고 이게 캘린더에도 적용되게 해줘" — 사이드바 레포 체크박스 필터를 캘린더도
	// 같이 봐야 해서 SessionShell 로컬 state였던 걸 여기로 끌어올렸다(위 detailTaskId와 같은 이유).
	// null=전체(필터 없음), Set이면 그 안에 있는 레포만.
	repoFilters: Set<string> | null

	loadBoard(): Promise<void>
	// 사이드바 "태스크 추가"와 캘린더 빈 칸 추가가 공유하는 단일 생성 경로(NewTaskModal) — 제목을 쓰거나
	// Figma·스레드·Notion·PR 링크를 붙여넣으면 자동감지해 링크가 붙은 일감을 만든다. dueDate는 캘린더에서
	// 열렸을 때만 채워짐.
	createTaskFromDraft(text: string, dueDate?: number | null): Promise<{ ok: boolean; error?: string }>
	createFolder(name: string): Promise<void>
	/** cmdk "새 워크트리" — 지금 보고 있는 태스크와 같은 폴더(없으면 미분류)에 새 태스크를 만들고 연다 */
	createTaskInFolder(folderId: string | null, name: string): Promise<string | null>
	renameFolder(id: string, name: string): Promise<void>
	setFolderAutoMerge(id: string, on: boolean): Promise<void>
	setFolderHidden(id: string, hidden: boolean): Promise<void>
	renameTask(id: string, name: string): Promise<void>
	updateTaskDesc(id: string, desc: string): Promise<void>
	updateTaskRepo(id: string, repoId: string | null): Promise<void>
	setFolderRepo(id: string, repoId: string | null): Promise<void>
	setFolderTaskRule(id: string, ruleTask: string | null): Promise<void>
	updateTaskDueDate(id: string, dueDate: number | null): Promise<void>
	updateTaskDuration(id: string, durationDays: number | null): Promise<void>
	setTaskDone(id: string, done: boolean): Promise<void>
	// "레포의 색상은... 다른걸로 표시해야할것같아" — 태스크 커스텀 색(캘린더 배경용). null이면 레포색/기본.
	updateTaskColor(id: string, color: string | null): Promise<void>
	// "태스크 하나에 개발, 개발자테스트, QA, 배포 이런식으로 나뉠 수 있거든" — 서브태스크 CRUD.
	createSubtask(taskId: string, input: { name: string; desc?: string; dueDate?: number | null; durationDays?: number | null }): Promise<void>
	// "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — task_id 없이 만드는
	// 독립 서브태스크(메모). 이름/설명/예정일/기간 수정과 삭제는 위 updateSubtask*/removeSubtask를
	// 그대로 재사용한다(id 기반이라 메모/서브태스크 구분 없이 동작).
	createNote(input: { name: string; desc?: string; dueDate?: number | null; durationDays?: number | null }): Promise<void>
	updateSubtaskName(id: string, name: string): Promise<void>
	updateSubtaskDesc(id: string, desc: string): Promise<void>
	updateSubtaskDueDate(id: string, dueDate: number | null): Promise<void>
	updateSubtaskDuration(id: string, durationDays: number | null): Promise<void>
	updateSubtaskRepo(id: string, repoId: string | null): Promise<void>
	// "하이브마인드가 서브태스크에 원한다면 ui를 추가" — 배열 전체를 통째로 덮어쓴다(§ SubtaskUiBlocks.tsx).
	updateSubtaskUiBlocks(id: string, uiBlocks: UiBlock[]): Promise<void>
	// "서브태스크 완료 버튼 필요" — Task.setTaskDone과 같은 패턴(레코드는 안 지우고 completed_at만).
	setSubtaskDone(id: string, done: boolean): Promise<void>
	removeSubtask(id: string): Promise<void>
	setDragSubtask(id: string | null, taskId: string | null): void
	setOverSubtask(id: string | null): void
	/** taskId가 null이면 메모(notes) 목록에서 재정렬. beforeSubtaskId가 null이면 그 목록 맨 끝으로 이동 */
	reorderSubtasks(taskId: string | null, subtaskId: string, beforeSubtaskId: string | null): Promise<void>
	toggleFolder(id: string): void
	toggleTask(id: string): void
	setDragTask(id: string | null): void
	setOverFolder(id: string | null): void
	setOverTask(id: string | null): void
	moveTask(taskId: string, toFolderId: string | null, beforeTaskId?: string | null): Promise<void>
	updateTaskPrompt(taskId: string, startPrompt: string): Promise<void>
	quickStartTask(
		taskId: string,
		opts?: { base?: string | null; autoMerge?: boolean; retryLimit?: number; kind?: Task['kind']; repoId?: string | null; startPrompt?: string | null },
	): Promise<void>
	quickStartBusy: string | null

	// 멀티레포 프로젝트 — 연결된 레포 레지스트리 (0~1개면 오케스트레이션은 단일 rootPath로 동작, 기존과 동일)
	loadRepos(): Promise<void>
	loadBlockedPeriods(): Promise<void>
	createBlockedPeriod(input: { name: string; startDate: number; endDate: number }): Promise<{ ok: boolean; error?: string }>
	removeBlockedPeriod(id: string): Promise<void>
	createRepo(input: { name: string; path: string; base?: string; description?: string }): Promise<void>
	cloneRepo(input: { url: string; parentPath: string; name?: string }): Promise<{ ok: boolean; error?: string }>
	initRepo(input: { parentPath: string; name: string }): Promise<{ ok: boolean; error?: string }>
	updateRepo(
		id: string,
		patch: Partial<{ name: string; path: string; base: string; description: string; color: string | null; ruleGeneral: string | null; ruleTaskWriting: string | null; ruleBranch: string | null; rulePredev: string | null }>,
	): Promise<void>
	removeRepo(id: string): Promise<void>
	/** 새 태스크 생성 직후, 백엔드가 백그라운드로 돌리는 자동배정(repo_id)이 끝날 때까지 잠깐 폴링 */
	pollTaskRepoClassification(taskId: string): void
	enrichTaskTitleInBackground(taskId: string, url: string): void
	refreshOrchestration(folderId: string): Promise<void>
	refreshAllOrchestrations(): Promise<void>
	refreshSubtaskWork(taskId: string): Promise<void>
	refreshAllSubtaskWork(): Promise<void>
	startOrchestration(folderId: string): Promise<void>
	advanceOrchestration(folderId: string): Promise<void>
	stopOrchestration(folderId: string): Promise<void>
	startConductor(folderId: string): Promise<void>
	stopConductor(folderId: string): Promise<void>
	tellConductor(folderId: string, text: string): Promise<void>

	// 보관함 — 완료된 폴더를 지우지 않고 archived로만 표시, 날짜별로 보존
	loadArchive(): Promise<void>
	loadTerminalGhostty(): Promise<void>
	loadGitStatus(): Promise<void>
	loadTermStatus(): Promise<void>
	loadHealth(): Promise<void>
	archiveFolder(id: string): Promise<void>
	restoreFolder(id: string): Promise<void>
	deleteFolder(id: string): Promise<void>

	openReview(taskId: string): void
	closeReview(): void
	openTaskDetail(taskId: string): void
	closeTaskDetail(): void
	openSubtaskDetail(subtaskId: string, parentTaskId: string): void
	closeSubtaskDetail(): void
	openNoteDetail(noteId: string): void
	closeNoteDetail(): void
	setRepoFilters(filters: Set<string> | null): void
	/** "전체" 상태에서 하나만 끄면 나머지 전부가 켜진 Set으로 시작해 "이 레포만 빼고 다 보기"가 된다. */
	toggleRepoFilter(repoId: string): void
	setDisputeText(v: string): void
	startDispute(reviewId: string): void
	cancelDispute(): void
	startApply(reviewId: string): void
	cancelApply(): void
	syncReviews(branchId: string): Promise<void>
	startAiReview(branchId: string): Promise<void>
	applyReview(reviewId: string): Promise<void>
	disputeReview(reviewId: string): Promise<void>
}

export const useSessionsStore = create<SessionsState>()((set, get) => ({
	folders: [],
	inbox: [],
	notes: [],
	loaded: false,
	loading: false,
	error: null,
	repos: [],
	reposLoaded: false,
	blockedPeriods: [],
	blockedPeriodsLoaded: false,
	archive: [],
	terminalGhostty: false,
	archiveLoaded: false,
	archiveBusy: null,
	deleteBusy: null,
	gitStatus: {},
	gitStatusByPath: {},
	termStatus: {},
	cockpitSummary: null,
	devServers: [],
	apiAddress: null,
	rootPath: null,

	classifying: {},
	enrichingTitle: {},
	openFolders: {},
	openTasks: {},
	dragTaskId: null,
	overFolderId: null,
	overTaskId: null,
	dragSubtaskId: null,
	dragSubtaskTaskId: null,
	overSubtaskId: null,
	quickStartBusy: null,
	orchestration: {},
	orchBusy: {},
	subtaskWork: {},

	reviewTaskId: null,
	disputingReviewId: null,
	disputeText: '',
	confirmingApplyId: null,
	reviewBusy: false,
	detailTaskId: null,
	detailSubtaskId: null,
	detailSubtaskParentId: null,
	detailNoteId: null,
	repoFilters: loadRepoFilters(),

	loadBoard: async () => {
		set({ loading: true, error: null })
		try {
			const board = await SessionsApi.getBoard()
			set((s) => ({
				folders: board.folders,
				inbox: board.inbox,
				notes: board.notes,
				loaded: true,
				loading: false,
				// default folders to open on first load only — preserve user's manual collapses across refetches
				openFolders: s.loaded ? s.openFolders : Object.fromEntries(board.folders.map((f) => [f.id, true])),
			}))
			// "검토한 일감은... 사라지면안돼. 항상 불러와야해" — board가 실어준 task.review(영구 저장된
			// 완료 검토)로 useReviewStore를 채운다. 새로고침 직후 첫 loadBoard든, 다른 조작 뒤의 재조회든
			// hydrateFromTask 자체가 "이미 항목이 있으면 무시"라 안전하게 매번 불러도 된다.
			const hydrateFromTask = useReviewStore.getState().hydrateFromTask
			for (const t of board.inbox) hydrateFromTask(t)
			for (const f of board.folders) for (const t of f.tasks) hydrateFromTask(t)
		} catch (e) {
			set({ loading: false, error: e instanceof Error ? e.message : String(e) })
		}
	},

	// 사이드바 "태스크 추가"와 캘린더 빈 칸 추가가 공유하는 단일 생성 경로(NewTaskModal) — 예전엔
	// 사이드바 드롭다운 패널(draft/draftBusy 전역 상태)과 캘린더 인라인 입력이 각자 따로 구현돼 있었다.
	// 폼 자체의 진행 중 상태는 모달 로컬 state로 관리하므로 여기선 순수 함수형으로 결과만 돌려준다.
	createTaskFromDraft: async (text, dueDate) => {
		const v = text.trim()
		if (!v) return { ok: false, error: translate('내용을 입력하세요.') }
		const kind = detectLink(v)
		const name = kind ? translateP('{label} 링크 태스크', { label: translate(LINK_LABEL[kind]) }) : v
		// 링크는 addBranchLink로 따로 저장돼 BranchChain/FolderCard에 LINK_LABEL 칩으로 이미 표시된다 —
		// desc에 "붙여넣은 링크: <url>"을 원문 그대로 또 넣으면 같은 정보가 중복 노출된다.
		try {
			const task = await SessionsApi.createTask({ folderId: null, name, desc: '', dueDate: dueDate ?? null })
			if (kind) {
				const branch = await SessionsApi.createBranch({ taskId: task.id, name: translate('브랜치 미지정') })
				await SessionsApi.addBranchLink(branch.id, kind, v)
				// "○○ 링크 태스크" placeholder를 실제 링크 내용 기반 제목으로 — await 안 함(몇 초~170초
				// 걸릴 수 있어 일감 추가 자체를 막으면 안 됨), enrichingTitle로 사이드바에 진행 상태만 표시.
				get().enrichTaskTitleInBackground(task.id, v)
			}
			await get().loadBoard()
			// 레포 자동배정 비활성화로 서버가 더는 repo_id를 채워주지 않으므로 분류 폴링도 트리거하지 않음.
			// "메인태스크를 만들었으면 바로 메인태스크 칸으로 가야해" — NewTaskModal에 메인/서브
			// 모드가 생긴 뒤로 이 함수는 오직 "메인 태스크" 모드 제출만 거친다(서브태스크는
			// createSubtask로 별도 경로). 사람이 이미 "메인 태스크"를 명시적으로 골랐으므로 순수
			// 텍스트든 링크든 미분류에 남기지 않고 곧장 승격+오케스트레이션까지 시작한다.
			await get().quickStartTask(task.id)
			return { ok: true }
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e)
			set({ error })
			return { ok: false, error }
		}
	},

	loadRepos: async () => {
		try {
			const repos = await SessionsApi.listRepos()
			set({ repos, reposLoaded: true })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e), reposLoaded: true })
		}
	},
	loadBlockedPeriods: async () => {
		try {
			const blockedPeriods = await SessionsApi.listBlockedPeriods()
			set({ blockedPeriods, blockedPeriodsLoaded: true })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e), blockedPeriodsLoaded: true })
		}
	},
	createBlockedPeriod: async (input) => {
		const r = await SessionsApi.createBlockedPeriod(input)
		if ('ok' in r && r.ok === false) return { ok: false, error: r.error }
		await get().loadBlockedPeriods()
		// "다른 일정은 막은 만큼 밀려야해" — 서버가 겹치는 태스크들의 due_date를 같이 밀어두므로,
		// board도 다시 불러와야 캘린더에서 밀린 날짜가 바로 보인다.
		await get().loadBoard()
		return { ok: true }
	},
	removeBlockedPeriod: async (id) => {
		await SessionsApi.removeBlockedPeriod(id)
		set((s) => ({ blockedPeriods: s.blockedPeriods.filter((p) => p.id !== id) }))
	},
	createRepo: async (input) => {
		try {
			await SessionsApi.createRepo(input)
			await get().loadRepos()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},
	cloneRepo: async (input) => {
		try {
			const r = await SessionsApi.cloneRepo(input)
			if (r.ok) await get().loadRepos()
			return r
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e)
			set({ error })
			return { ok: false, error }
		}
	},
	initRepo: async (input) => {
		try {
			const r = await SessionsApi.initRepo(input)
			if (r.ok) await get().loadRepos()
			return r
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e)
			set({ error })
			return { ok: false, error }
		}
	},
	updateRepo: async (id, patch) => {
		// "팀 규칙" 4칸은 API/백엔드 컬럼명이 스네이크케이스(rule_general 등)라 patch의 카멜케이스
		// 키를 그대로 스프레드하면 Repo 표시 필드를 안 덮어쓰고 엉뚱한 키만 추가된다 — 명시적으로 옮긴다.
		const { ruleGeneral, ruleTaskWriting, ruleBranch, rulePredev, ...rest } = patch
		set((s) => ({
			repos: s.repos.map((r) =>
				r.id === id
					? {
							...r,
							...rest,
							...('ruleGeneral' in patch ? { rule_general: ruleGeneral ?? null } : {}),
							...('ruleTaskWriting' in patch ? { rule_task_writing: ruleTaskWriting ?? null } : {}),
							...('ruleBranch' in patch ? { rule_branch: ruleBranch ?? null } : {}),
							...('rulePredev' in patch ? { rule_predev: rulePredev ?? null } : {}),
						}
					: r,
			),
		})) // optimistic
		try {
			await SessionsApi.updateRepo(id, patch)
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadRepos() // revert to server truth on failure
		}
	},
	removeRepo: async (id) => {
		set((s) => ({ repos: s.repos.filter((r) => r.id !== id) })) // optimistic
		try {
			await SessionsApi.removeRepo(id)
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadRepos()
		}
	},

	pollTaskRepoClassification: (taskId) => {
		if (get().repos.length < 2) return // 레포 1개 이하면 자동배정 자체가 안 뜸(서버도 스킵)
		// 이전엔 폴링이 조용히 백그라운드에서만 돌아서, 일감함에 새로 뜬 항목이 "그냥 저러고 있는 건지
		// 멈춘 건지" 알 방법이 없었다 — classifying 플래그로 사이드바에 "분류 중" 표시를 낸다.
		set((s) => ({ classifying: { ...s.classifying, [taskId]: true } }))
		let tries = 0
		const stop = () => set((s) => ({ classifying: { ...s.classifying, [taskId]: false } }))
		const tick = async () => {
			tries += 1
			await get().loadBoard()
			const s = get()
			const task = s.inbox.find((t) => t.id === taskId) ?? s.folders.flatMap((f) => f.tasks).find((t) => t.id === taskId)
			if (!task || task.repo_id || tries >= 8) return stop() // 찾았거나, 배정됐거나, 최대 8회(약 16초)면 중단
			setTimeout(tick, 2000)
		}
		setTimeout(tick, 2000)
	},

	enrichTaskTitleInBackground: async (taskId, url) => {
		set((s) => ({ enrichingTitle: { ...s.enrichingTitle, [taskId]: true } }))
		try {
			const r = await SessionsApi.enrichTaskTitle(taskId, url)
			if ('ok' in r && r.ok) await get().loadBoard()
			// 실패해도 조용히 무시 — placeholder 제목("○○ 링크 태스크")이 그대로 남을 뿐, 치명적이지 않다.
		} catch (_) {
			/* ignore */
		} finally {
			set((s) => ({ enrichingTitle: { ...s.enrichingTitle, [taskId]: false } }))
		}
	},

	createFolder: async (name) => {
		try {
			const folder = await SessionsApi.createFolder({ name: name || translate('새 폴더') })
			set((s) => ({ openFolders: { ...s.openFolders, [folder.id]: true } }))
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},

	createTaskInFolder: async (folderId, name) => {
		try {
			const task = await SessionsApi.createTask({ folderId, name })
			set((s) => (folderId ? { openFolders: { ...s.openFolders, [folderId]: true } } : s))
			await get().loadBoard()
			// 오케스트레이터는 수동 "시작" 없이, 태스크에 서브태스크가 처음 생기는 순간 자동으로 통제를
			// 시작한다 — 이미 조율 중이면 startOrchestration이 알아서 no-op(already 처리)이라 안전.
			if (folderId) get().startOrchestration(folderId)
			return task.id
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			return null
		}
	},

	renameFolder: async (id, name) => {
		// optimistic — rename is low-risk to reflect instantly without a round-trip
		set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) }))
		try {
			await SessionsApi.updateFolder(id, { name })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard() // revert to server truth on failure
		}
	},
	// merge 게이트(§12) — 기본 Merge-ready(사람이 merge), 켜면 클린 판정 시 실제 merge까지 자동(opt-in).
	setFolderAutoMerge: async (id, on) => {
		set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, auto_merge: on ? 1 : 0 } : f)) }))
		try {
			await SessionsApi.updateFolder(id, { autoMerge: on })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// "태스크 숨기기 기능있으면 좋겠다. 다 보여서 힘들어" — archiveFolder(완료 전용, 복원 확인 절차)와
	// 달리 언제든 가볍게 켜고 끌 수 있어야 해서 확인 절차 없이 바로 토글.
	setFolderHidden: async (id, hidden) => {
		set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, hidden: hidden ? 1 : 0, hidden_at: hidden ? Date.now() : null } : f)) }))
		try {
			await SessionsApi.updateFolder(id, { hidden })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	renameTask: async (id, name) => {
		// inbox 태스크는 안 바뀌던 버그 — folders 쪽만 patch해서 미분류에서 이름 바꾸면 다음
		// loadBoard 전까지 화면에 반영이 안 됐다(TaskDetailModal에서 처음 발견).
		set((s) => ({
			inbox: s.inbox.map((t) => (t.id === id ? { ...t, name } : t)),
			folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, name } : t)) })),
		}))
		try {
			await SessionsApi.updateTask(id, { name })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	updateTaskDesc: async (id, desc) => {
		set((s) => ({
			inbox: s.inbox.map((t) => (t.id === id ? { ...t, desc } : t)),
			folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, desc } : t)) })),
		}))
		try {
			await SessionsApi.updateTask(id, { desc })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// 미분류(inbox) 태스크 전용 — 폴더로 승격된 태스크는 레포가 폴더 단위(folder.repo_id)라 이걸 쓰지
	// 않고 setFolderRepo를 쓴다(TaskDetailModal이 folder 유무로 갈라 호출).
	updateTaskRepo: async (id, repoId) => {
		set((s) => ({ inbox: s.inbox.map((t) => (t.id === id ? { ...t, repo_id: repoId, repo_auto: 0 } : t)) }))
		try {
			await SessionsApi.updateTask(id, { repoId })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// 레포는 폴더 단위로 하나만 — 사람이 태스크 상세에서 직접 바꾸면(예: AI 배정이 틀렸을 때) 이후
	// 그 폴더의 모든 서브태스크가 이 값을 기준으로 워크트리를 만든다(orchestrator.cjs).
	setFolderRepo: async (id, repoId) => {
		set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, repo_id: repoId } : f)) }))
		try {
			await SessionsApi.updateFolder(id, { repoId })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// "팀규칙에 현재 태스크 규칙도 추가해줬으면 좋겠어. 이건 태스크의 유니크한 규칙이야" — repos.rule_*
	// (레포 전체 공통)와 별개로 이 메인 태스크(폴더) 하나만의 예외 규칙.
	setFolderTaskRule: async (id, ruleTask) => {
		set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, rule_task: ruleTask } : f)) }))
		try {
			await SessionsApi.updateFolder(id, { ruleTask })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// 캘린더 칸 드래그로 예정일 재배치 — inbox 항목도 포함해야 하므로 renameTask와 달리 inbox도 함께 patch.
	updateTaskDueDate: async (id, dueDate) => {
		set((s) => ({
			inbox: s.inbox.map((t) => (t.id === id ? { ...t, due_date: dueDate } : t)),
			folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, due_date: dueDate } : t)) })),
		}))
		try {
			await SessionsApi.updateTask(id, { dueDate })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// 소요 기간(영업일) — due_date로부터 종료일을 계산하는 데 쓴다(utils/businessDays.ts). AI 추정은
	// 별도 API(estimateTaskDuration)로 제안만 받고, 사용자가 받아들일 때 이 액션으로 실제 저장한다.
	updateTaskDuration: async (id, durationDays) => {
		set((s) => ({
			inbox: s.inbox.map((t) => (t.id === id ? { ...t, duration_days: durationDays } : t)),
			folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, duration_days: durationDays } : t)) })),
		}))
		try {
			await SessionsApi.updateTask(id, { durationDays })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// "일감 완료 체크... 그걸하면 그냥 완료로 보이는거야" — 레코드는 지우지 않는다. 사이드바 태스크
	// 트리는 completed_at이 있으면 걸러내 안 보이게 하지만(SessionShell.tsx visibleInbox/visibleFolders),
	// 캘린더는 이 필드를 무시하고 그대로 계속 보여준다.
	setTaskDone: async (id, done) => {
		const completedAt = done ? Date.now() : null
		set((s) => ({
			inbox: s.inbox.map((t) => (t.id === id ? { ...t, completed_at: completedAt } : t)),
			folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, completed_at: completedAt } : t)) })),
		}))
		try {
			await SessionsApi.updateTask(id, { completedAt })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	updateTaskColor: async (id, color) => {
		set((s) => ({
			inbox: s.inbox.map((t) => (t.id === id ? { ...t, color } : t)),
			folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, color } : t)) })),
		}))
		try {
			await SessionsApi.updateTask(id, { color })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// 서브태스크 생성/삭제는 부모 태스크의 subtasks 배열 길이가 바뀌어(id 새로 필요) 낙관적 갱신이
	// 번거로운 데다 자주 일어나는 조작도 아니라, 서버 응답 뒤 board를 다시 불러오는 쪽이 더 단순하다.
	createSubtask: async (taskId, input) => {
		try {
			await SessionsApi.createSubtask(taskId, input)
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},
	createNote: async (input) => {
		try {
			await SessionsApi.createNote(input)
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},
	removeSubtask: async (id) => {
		try {
			await SessionsApi.removeSubtask(id)
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},
	// 이름/설명/예정일/기간은 캘린더 드래그(예정일)처럼 반응이 즉각적이어야 하는 조작이라 낙관적으로
	// 갱신한다 — mapSubtaskInTasks가 inbox/folders 양쪽에서 그 서브태스크 하나만 찾아 바꾼다.
	updateSubtaskName: async (id, name) => {
		set((s) => ({
			inbox: mapSubtaskInTasks(s.inbox, id, (st) => ({ ...st, name })),
			folders: s.folders.map((f) => ({ ...f, tasks: mapSubtaskInTasks(f.tasks, id, (st) => ({ ...st, name })) })),
			notes: mapSubtaskInNotes(s.notes, id, (st) => ({ ...st, name })),
		}))
		try {
			await SessionsApi.updateSubtask(id, { name })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	updateSubtaskDesc: async (id, desc) => {
		set((s) => ({
			inbox: mapSubtaskInTasks(s.inbox, id, (st) => ({ ...st, desc })),
			folders: s.folders.map((f) => ({ ...f, tasks: mapSubtaskInTasks(f.tasks, id, (st) => ({ ...st, desc })) })),
			notes: mapSubtaskInNotes(s.notes, id, (st) => ({ ...st, desc })),
		}))
		try {
			await SessionsApi.updateSubtask(id, { desc })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	updateSubtaskDueDate: async (id, dueDate) => {
		set((s) => ({
			inbox: mapSubtaskInTasks(s.inbox, id, (st) => ({ ...st, due_date: dueDate })),
			folders: s.folders.map((f) => ({ ...f, tasks: mapSubtaskInTasks(f.tasks, id, (st) => ({ ...st, due_date: dueDate })) })),
			notes: mapSubtaskInNotes(s.notes, id, (st) => ({ ...st, due_date: dueDate })),
		}))
		try {
			await SessionsApi.updateSubtask(id, { dueDate })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	updateSubtaskDuration: async (id, durationDays) => {
		set((s) => ({
			inbox: mapSubtaskInTasks(s.inbox, id, (st) => ({ ...st, duration_days: durationDays })),
			folders: s.folders.map((f) => ({ ...f, tasks: mapSubtaskInTasks(f.tasks, id, (st) => ({ ...st, duration_days: durationDays })) })),
			notes: mapSubtaskInNotes(s.notes, id, (st) => ({ ...st, duration_days: durationDays })),
		}))
		try {
			await SessionsApi.updateSubtask(id, { durationDays })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// "서브태스크도 레포를 별도로 줄 수 있어야하지만. 기본적으로는 메인태스크와 동일하게" — null은
	// "메인 태스크와 동일"(상속)을 뜻한다.
	updateSubtaskRepo: async (id, repoId) => {
		set((s) => ({
			inbox: mapSubtaskInTasks(s.inbox, id, (st) => ({ ...st, repo_id: repoId })),
			folders: s.folders.map((f) => ({ ...f, tasks: mapSubtaskInTasks(f.tasks, id, (st) => ({ ...st, repo_id: repoId })) })),
			notes: mapSubtaskInNotes(s.notes, id, (st) => ({ ...st, repo_id: repoId })),
		}))
		try {
			await SessionsApi.updateSubtask(id, { repoId })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// "하이브마인드가 서브태스크에 원한다면 ui를 추가할 수 있으면 좋겠어" — 하이브마인드(update_subtask MCP
	// 툴)와 사람(SubtaskUiBlocks.tsx 체크박스)이 같은 액션·같은 엔드포인트를 쓴다. 배열 전체를 통째로
	// 덮어쓰므로 호출부가 항상 "다음 전체 상태"를 만들어 넘긴다.
	updateSubtaskUiBlocks: async (id, uiBlocks) => {
		set((s) => ({
			inbox: mapSubtaskInTasks(s.inbox, id, (st) => ({ ...st, ui_blocks: uiBlocks })),
			folders: s.folders.map((f) => ({ ...f, tasks: mapSubtaskInTasks(f.tasks, id, (st) => ({ ...st, ui_blocks: uiBlocks })) })),
			notes: mapSubtaskInNotes(s.notes, id, (st) => ({ ...st, ui_blocks: uiBlocks })),
		}))
		try {
			await SessionsApi.updateSubtask(id, { uiBlocks })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},
	// "서브태스크 완료 버튼 필요" — completed_at만 찍고 레코드는 지우지 않는다(§ setTaskDone과 동일 패턴).
	// TaskRow/FolderCard의 subChain 목록에서는 걸러내 안 보이지만 캘린더는 계속 보여준다.
	setSubtaskDone: async (id, done) => {
		const completedAt = done ? Date.now() : null
		set((s) => ({
			inbox: mapSubtaskInTasks(s.inbox, id, (st) => ({ ...st, completed_at: completedAt })),
			folders: s.folders.map((f) => ({ ...f, tasks: mapSubtaskInTasks(f.tasks, id, (st) => ({ ...st, completed_at: completedAt })) })),
			notes: mapSubtaskInNotes(s.notes, id, (st) => ({ ...st, completed_at: completedAt })),
		}))
		try {
			await SessionsApi.updateSubtask(id, { completedAt })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},

	setDragSubtask: (id, taskId) => set({ dragSubtaskId: id, dragSubtaskTaskId: taskId }),
	setOverSubtask: (id) => set({ overSubtaskId: id }),

	// 캘린더 드래그처럼 즉각 반응해야 해서(§ updateSubtaskName 주석 참고) 낙관적으로 순서를 바꾸고,
	// 실패하면 board를 다시 불러와 서버 진실로 되돌린다. beforeSubtaskId가 없으면 목록 맨 끝으로 이동.
	// taskId가 null이면 메인 태스크 없는 서브태스크(메모, notes 배열) 재정렬.
	reorderSubtasks: async (taskId, subtaskId, beforeSubtaskId) => {
		set({ dragSubtaskId: null, dragSubtaskTaskId: null, overSubtaskId: null })
		if (subtaskId === beforeSubtaskId) return
		const s = get()
		if (taskId === null) {
			const dragged = s.notes.find((n) => n.id === subtaskId)
			if (!dragged) return
			const rest = s.notes.filter((n) => n.id !== subtaskId)
			const insertAt = beforeSubtaskId ? rest.findIndex((n) => n.id === beforeSubtaskId) : -1
			const at = insertAt < 0 ? rest.length : insertAt
			const ordered = [...rest.slice(0, at), dragged, ...rest.slice(at)]
			set({ notes: ordered })
			try {
				await SessionsApi.reorderNotes(ordered.map((n) => n.id))
			} catch (e) {
				set({ error: e instanceof Error ? e.message : String(e) })
				await get().loadBoard()
			}
			return
		}
		const task = s.inbox.find((t) => t.id === taskId) ?? s.folders.flatMap((f) => f.tasks).find((t) => t.id === taskId)
		const dragged = task?.subtasks.find((st) => st.id === subtaskId)
		if (!task || !dragged) return
		const rest = task.subtasks.filter((st) => st.id !== subtaskId)
		const insertAt = beforeSubtaskId ? rest.findIndex((st) => st.id === beforeSubtaskId) : -1
		const at = insertAt < 0 ? rest.length : insertAt
		const ids = [...rest.slice(0, at), dragged, ...rest.slice(at)].map((st) => st.id)
		set({
			inbox: reorderTaskSubtasks(s.inbox, taskId, ids),
			folders: s.folders.map((f) => ({ ...f, tasks: reorderTaskSubtasks(f.tasks, taskId, ids) })),
		})
		try {
			await SessionsApi.reorderSubtasks(taskId, ids)
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},

	toggleFolder: (id) => set((s) => ({ openFolders: { ...s.openFolders, [id]: !(s.openFolders[id] !== false) } })),
	toggleTask: (id) => set((s) => ({ openTasks: { ...s.openTasks, [id]: !s.openTasks[id] } })),
	setDragTask: (id) => set({ dragTaskId: id }),
	setOverFolder: (id) => set({ overFolderId: id }),
	setOverTask: (id) => set({ overTaskId: id }),

	moveTask: async (taskId, toFolderId, beforeTaskId) => {
		set({ dragTaskId: null, overFolderId: null, overTaskId: null })
		try {
			await SessionsApi.moveTask(taskId, toFolderId, beforeTaskId ?? null)
			await get().loadBoard() // re-fetch for authoritative order rather than hand-rolling the splice
			// 드래그로 태스크에 서브태스크가 들어온 것도 "생겼다"는 순간 — 자동으로 통제 시작(idempotent).
			if (toFolderId) get().startOrchestration(toFolderId)
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},

	// 태스크별 오케스트레이션 시작 프롬프트 직접 편집 — 비워두면 orchestrator.cjs의 자동 생성 문구로 폴백.
	updateTaskPrompt: async (taskId, startPrompt) => {
		const patch = { start_prompt: startPrompt.trim() || null }
		set((s) => ({
			inbox: s.inbox.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
			folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })),
		}))
		try {
			await SessionsApi.updateTask(taskId, { startPrompt: patch.start_prompt })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard() // revert to server truth on failure
		}
	},

	// 태스크를 만들고 나면 미분류에만 담겨 다음 액션이 없다는 피드백 — mrm처럼 태스크 하나만으로도
	// 바로 워크트리+세션을 띄울 수 있게, 필요하면 태스크 이름으로 폴더를 즉석 생성해 오케스트레이션까지 이어준다.
	// opts는 mainTask 생성 확인 단계(§12 "AI 제안 + 사람이 자유롭게 덮어쓰기")에서 사람이 확인/수정한 값 —
	// 안 넘기면 전부 AI/제품 기본값 그대로 진행(빠르게 쓰고 싶은 사람은 한 번도 안 펼치지 않아도 됨).
	quickStartTask: async (taskId, opts) => {
		const s = get()
		const task = s.inbox.find((t) => t.id === taskId) ?? s.folders.flatMap((f) => f.tasks).find((t) => t.id === taskId)
		if (!task) return
		set({ quickStartBusy: taskId })
		try {
			let folderId = task.folder_id
			if (!folderId) {
				// 레포는 폴더 단위로 한 번만 — 사람이 확인 화면에서 고른 값(opts.repoId) 우선, 안 골랐으면
				// inbox 단계에서 이미 AI가 배정해둔 task.repo_id를 그대로 폴더로 승격.
				const folder = await SessionsApi.createFolder({
					name: task.name,
					base: opts?.base,
					autoMerge: opts?.autoMerge,
					retryLimit: opts?.retryLimit,
					repoId: opts?.repoId !== undefined ? opts.repoId : task.repo_id,
				})
				folderId = folder.id
				await SessionsApi.moveTask(taskId, folderId, null)
			}
			if (opts && (opts.kind || opts.repoId !== undefined || opts.startPrompt !== undefined)) {
				await SessionsApi.updateTask(taskId, { kind: opts.kind, repoId: opts.repoId, startPrompt: opts.startPrompt })
			}
			await get().loadBoard()
			await get().startOrchestration(folderId)
			set((st) => ({ openFolders: { ...st.openFolders, [folderId!]: true } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ quickStartBusy: null })
		}
	},

	refreshOrchestration: async (folderId) => {
		try {
			const state = await SessionsApi.getOrchestrationState(folderId)
			set((s) => ({ orchestration: { ...s.orchestration, [folderId]: state } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},
	// 이전엔 오케스트레이터 탭을 실제로 열어야만(그 탭의 4초 폴링) 그 태스크의 상태가 갱신됐다 —
	// 지금 안 보고 있는 태스크는 세션이 활발히 돌고 있어도 사이드바에 오래된 상태로 멈춰 보이는 원인.
	// loadGitStatus와 같은 자리에서 같은 주기로 모든 태스크를 함께 갱신해 사이드바 전체를 최신으로 유지한다.
	refreshAllOrchestrations: async () => {
		const ids = get().folders.map((f) => f.id)
		await Promise.all(ids.map((id) => get().refreshOrchestration(id)))
	},

	// "진행중 표기도 안돼" — 서브태스크의 "진행 중"/"세션 종료" 배지는 예전엔 TaskDetailContent가
	// 열려있을 때만(§ 그 컴포넌트 자체 폴링) 채워졌다. 사이드바(FolderCard/TaskRow)의 subChain 목록은
	// 이 데이터를 아예 구독하지 않아 뭘 눌러도 항상 회색 점이었다 — refreshAllOrchestrations와 같은
	// 패턴으로 전역에 끌어올려 사이드바도 같은 값을 읽게 한다.
	refreshSubtaskWork: async (taskId) => {
		try {
			const r = await SessionsApi.getSubtaskWorkState(taskId)
			if (r.ok) set((s) => ({ subtaskWork: { ...s.subtaskWork, [taskId]: r.subtasks } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},
	refreshAllSubtaskWork: async () => {
		const ids = get()
			.folders.flatMap((f) => f.tasks)
			.filter((t) => t.subtasks.length > 0)
			.map((t) => t.id)
		await Promise.all(ids.map((id) => get().refreshSubtaskWork(id)))
	},
	startOrchestration: async (folderId) => {
		if (get().orchBusy[folderId]) return // 더블클릭 등 재진입 방지 — 서버도 동일 가드 있음(방어 중복)
		set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: true } }))
		try {
			const state = await SessionsApi.startOrchestration(folderId)
			set((s) => ({ orchestration: { ...s.orchestration, [folderId]: state } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: false } }))
		}
	},
	advanceOrchestration: async (folderId) => {
		if (get().orchBusy[folderId]) return
		set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: true } }))
		try {
			const state = await SessionsApi.advanceOrchestration(folderId)
			set((s) => ({ orchestration: { ...s.orchestration, [folderId]: state } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: false } }))
		}
	},
	stopOrchestration: async (folderId) => {
		if (get().orchBusy[folderId]) return
		set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: true } }))
		try {
			const state = await SessionsApi.stopOrchestration(folderId)
			set((s) => ({ orchestration: { ...s.orchestration, [folderId]: state } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: false } }))
		}
	},

	// 지휘자 start/stop/tell은 부분 응답만 오므로(전체 OrchestrationState 아님) 호출 후 refreshOrchestration으로
	// conductor/feed를 포함한 전체 상태를 다시 받아온다.
	startConductor: async (folderId) => {
		if (get().orchBusy[folderId]) return
		set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: true } }))
		try {
			const r = await SessionsApi.startConductor(folderId)
			if (!r.ok) throw new Error(translate(r.error || '태스크 매니저 시작 실패'))
			await get().refreshOrchestration(folderId)
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: false } }))
		}
	},
	stopConductor: async (folderId) => {
		if (get().orchBusy[folderId]) return
		set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: true } }))
		try {
			await SessionsApi.stopConductor(folderId)
			await get().refreshOrchestration(folderId)
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set((s) => ({ orchBusy: { ...s.orchBusy, [folderId]: false } }))
		}
	},
	tellConductor: async (folderId, text) => {
		try {
			const r = await SessionsApi.tellConductor(folderId, text)
			if (!r.ok) throw new Error(translate(r.error || '전송 실패'))
			await get().refreshOrchestration(folderId)
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},

	loadArchive: async () => {
		try {
			const { folders } = await SessionsApi.listArchivedFolders()
			set({ archive: folders, archiveLoaded: true })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e), archiveLoaded: true })
		}
	},

	// "고스티도 tmux도 설정 토글로 제공해야해" — SettingsModal이 값을 바꾸는 동안 이 store는 낡은 값을
	// 들고 있을 수 있지만(설정 모달을 닫을 때까지), 다음 세션 생성부터만 영향을 주는 값이라 실시간
	// 동기화가 아쉽지 않다 — 앱 시작 시 한 번만 불러온다(§ SessionShell 초기 useEffect).
	loadTerminalGhostty: async () => {
		try {
			const { appConfig } = await getSetupStatus()
			set({ terminalGhostty: !!appConfig.terminalGhostty })
		} catch (_) {
			/* 조용히 무시 — 버튼을 안 보여주는 쪽으로 안전하게 폴백 */
		}
	},

	// /api/cockpit는 stale-while-revalidate 캐시(15초 fresh)라 자주 불러도 서버에 부담 없음 — 실패해도
	// 조용히 무시(PR 배지·상태바 요약은 있으면 좋은 부가 정보지, 실패했다고 보드 전체를 에러로 만들
	// 정도는 아님).
	loadGitStatus: async () => {
		try {
			const { byBranch, byPath, summary, devServers } = await SessionsApi.getCockpit()
			set({ gitStatus: byBranch || {}, gitStatusByPath: byPath || {}, cockpitSummary: summary || null, devServers: devServers || [] })
		} catch {
			// no-op
		}
	},
	// TaskRow의 상태 dot이 질문대기/인증필요를 반영하려면(§12) session.status를 세션명으로 조인해야
	// 한다 — /api/term은 이미 이 값을 실어서 주는데 지금까지 어느 프론트 코드도 안 썼다.
	loadTermStatus: async () => {
		try {
			const { sessions } = await listTerm()
			const map: Record<string, TermStatus> = {}
			for (const s of sessions || []) if (s.status) map[s.name] = s.status
			set({ termStatus: map })
		} catch {
			// no-op
		}
	},
	loadHealth: async () => {
		try {
			const h = await SessionsApi.getHealth()
			// "모바일 테스트할 때... 접속할 때 사용해야해" — 127.0.0.1은 이 맥 자신 말고는 아무도 못
			// 쓰니, 같은 Wi-Fi의 실기기가 실제로 쓸 LAN IP를 대신 보여준다. 못 찾으면(네트워크 없음 등)
			// 기존 host로 조용히 폴백.
			const ip = await SessionsApi.getLocalIp().catch(() => null)
			const host = (ip?.ok && ip.ip) || h.host
			set({ apiAddress: `${host}:${h.port}`, rootPath: h.repo || null })
		} catch {
			// no-op
		}
	},
	archiveFolder: async (id) => {
		set({ archiveBusy: id })
		try {
			await SessionsApi.archiveFolder(id)
			await Promise.all([get().loadBoard(), get().loadArchive()])
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ archiveBusy: null })
		}
	},
	restoreFolder: async (id) => {
		set({ archiveBusy: id })
		try {
			await SessionsApi.restoreFolder(id)
			await Promise.all([get().loadBoard(), get().loadArchive()])
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ archiveBusy: null })
		}
	},
	// "메인 태스크 오른쪽 마우스 클릭하면 삭제 UI 넣고 기능까지" — 폴더(=메인 태스크) 자체만 지운다.
	// 산하 태스크/서브태스크는 DB의 ON DELETE SET NULL로 일감함에 그대로 남는다(§ server/store/folders.cjs
	// remove — 데이터 손실 없음). 살아있는 지휘자 세션은 서버가 먼저 정리한다(§ index.cjs DELETE 라우트).
	deleteFolder: async (id) => {
		set({ deleteBusy: id })
		try {
			await SessionsApi.removeFolder(id)
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ deleteBusy: null })
		}
	},

	openReview: (taskId) => set({ reviewTaskId: taskId, disputingReviewId: null, disputeText: '', confirmingApplyId: null }),
	closeReview: () => set({ reviewTaskId: null, disputingReviewId: null, disputeText: '', confirmingApplyId: null }),
	openTaskDetail: (taskId) => set({ detailTaskId: taskId }),
	closeTaskDetail: () => set({ detailTaskId: null }),
	openSubtaskDetail: (subtaskId, parentTaskId) => set({ detailSubtaskId: subtaskId, detailSubtaskParentId: parentTaskId }),
	closeSubtaskDetail: () => set({ detailSubtaskId: null, detailSubtaskParentId: null }),
	openNoteDetail: (noteId) => set({ detailNoteId: noteId }),
	closeNoteDetail: () => set({ detailNoteId: null }),
	setRepoFilters: (filters) => {
		saveRepoFilters(filters)
		set({ repoFilters: filters })
	},
	toggleRepoFilter: (repoId) =>
		set((s) => {
			const base = s.repoFilters ?? new Set(s.repos.map((r) => r.id))
			const next = new Set(base)
			if (next.has(repoId)) next.delete(repoId)
			else next.add(repoId)
			const repoFilters = next.size === s.repos.length ? null : next
			saveRepoFilters(repoFilters)
			return { repoFilters }
		}),
	setDisputeText: (v) => set({ disputeText: v }),
	startDispute: (reviewId) => set({ disputingReviewId: reviewId, disputeText: '' }),
	cancelDispute: () => set({ disputingReviewId: null, disputeText: '' }),
	startApply: (reviewId) => set({ confirmingApplyId: reviewId }),
	cancelApply: () => set({ confirmingApplyId: null }),

	syncReviews: async (branchId) => {
		set({ reviewBusy: true })
		try {
			await SessionsApi.syncReviews(branchId)
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ reviewBusy: false })
		}
	},
	startAiReview: async (branchId) => {
		set({ reviewBusy: true })
		try {
			const r = await SessionsApi.startAiReview(branchId)
			if (!r.ok) throw new Error(translate(r.error || 'AI 리뷰 실패'))
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ reviewBusy: false })
		}
	},
	applyReview: async (reviewId) => {
		set({ reviewBusy: true, confirmingApplyId: null })
		try {
			await SessionsApi.applyReview(reviewId)
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ reviewBusy: false })
		}
	},
	disputeReview: async (reviewId) => {
		const text = get().disputeText.trim()
		if (!text) return
		set({ reviewBusy: true })
		try {
			await SessionsApi.disputeReview(reviewId, text)
			set({ disputingReviewId: null, disputeText: '' })
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ reviewBusy: false })
		}
	},
}))

// "메인 태스크는 이제 사이드바에서 상세페이지를 띄우지말고 탭으로 띄워줘" — 폴더로 승격된(=folder_id가
// 있는) 태스크는 더 이상 TaskDetailModal 드로어를 열지 않고, 그 폴더의 탭(태스크 매니저/다이어그램)으로
// 바로 이동한다. 아직 일감함에 있는(승격 전) 태스크는 그대로 상세 드로어를 연다.
export function openTaskOrFolderDetail(taskId: string) {
	const s = useSessionsStore.getState()
	const task = s.inbox.find((t) => t.id === taskId) ?? s.folders.flatMap((f) => f.tasks).find((t) => t.id === taskId)
	if (task?.folder_id) {
		useTabsStore.getState().setActiveNode(task.folder_id, 'orchestrator')
		useTabsStore.getState().openOrFocusTab(task.folder_id, 'detail')
	} else {
		s.openTaskDetail(taskId)
	}
}

// 하이브마인드 컨텍스트 캔버스(§ ControlPane.tsx CanvasCard) 클릭용 — 서브태스크 id 하나만 갖고 있고
// 어느 폴더/태스크 소속인지는 모르는 상황(비서의 tool_use 응답엔 subtask id만 들어있다)에서, 전체
// folders 트리를 훑어 openSubtaskTab에 필요한 folderId·parentTaskId를 역으로 찾아낸다. 못 찾으면(그
// 사이 삭제됐거나 아직 폴더 목록이 안 실렸으면) 조용히 아무 일도 안 한다 — 클릭 한 번의 결과로 에러를
// 띄울 만큼 중요한 실패가 아니다.
// 이름을 openSubtaskDetail로 지었다가 스토어의 기존 액션(§ 위 openSubtaskDetail: (subtaskId,
// parentTaskId) => set(...) — 상세 드로어를 여는 전혀 다른 함수)과 이름이 겹쳐서 focusSubtaskTab으로
// 바꿨다. 같은 모듈이라 문법 충돌은 없었지만 import 시 어느 쪽인지 헷갈릴 뻔했다.
export function focusSubtaskTab(subtaskId: string) {
	const s = useSessionsStore.getState()
	for (const f of s.folders) {
		for (const t of f.tasks) {
			const st = t.subtasks.find((x) => x.id === subtaskId)
			if (st) {
				useTabsStore.getState().openSubtaskTab(f.id, st.id, t.id, st.name)
				return
			}
		}
	}
}

export function getOrchestration(state: SessionsState, folderId: string): OrchestrationState {
	return state.orchestration[folderId] ?? EMPTY_ORCHESTRATION
}
