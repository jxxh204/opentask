import { create } from 'zustand'
import type { Folder, Task, Repo } from './types'
import * as SessionsApi from '../api/sessions'
import type { OrchestrationState, GitStatusEntry, CockpitSummary } from '../api/sessions'
import { detectLink, LINK_LABEL } from '../utils/linkDetect'
import { listTerm } from '../api/term'
import type { TermStatus } from '../api/term'

const EMPTY_ORCHESTRATION: OrchestrationState = { running: false, currentWaveIndex: 0, sessions: [], log: [], conductor: null, feed: [] }

export interface SessionsState {
	folders: Folder[]
	inbox: Task[]
	loaded: boolean
	loading: boolean
	error: string | null
	repos: Repo[]
	reposLoaded: boolean
	archive: Folder[]
	archiveLoaded: boolean
	archiveBusy: string | null
	gitStatus: Record<string, GitStatusEntry> // 브랜치명 → PR/ahead-behind (server/cockpit.cjs 실데이터)
	termStatus: Record<string, TermStatus> // tmux 세션명 → 질문대기/인증필요(term.cjs status() 실데이터, 저장값 아님)
	cockpitSummary: CockpitSummary | null // 사이드바 하단 상태바 요약 (dev/스트림/dirty/PR 총계, 메인 브랜치)
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
	orchestration: Record<string, OrchestrationState>
	orchBusy: Record<string, boolean>

	reviewTaskId: string | null
	disputingReviewId: string | null
	disputeText: string
	confirmingApplyId: string | null
	reviewBusy: boolean

	// TaskDetailModal의 열림 상태 — 캘린더 칩 클릭뿐 아니라 사이드바의 "AI 검토" 진행 목록에서도
	// 같은 드로어를 열어야 해서(§ "사이드바에서 진행상황을 보여주고 클릭하면 상세로") CalendarPane
	// 로컬 state였던 걸 여기로 끌어올렸다 — SessionShell 최상위에서 한 번만 렌더.
	detailTaskId: string | null

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
	renameTask(id: string, name: string): Promise<void>
	updateTaskDesc(id: string, desc: string): Promise<void>
	updateTaskRepo(id: string, repoId: string | null): Promise<void>
	setFolderRepo(id: string, repoId: string | null): Promise<void>
	updateTaskDueDate(id: string, dueDate: number | null): Promise<void>
	updateTaskDuration(id: string, durationDays: number | null): Promise<void>
	setTaskDone(id: string, done: boolean): Promise<void>
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
	createRepo(input: { name: string; path: string; base?: string; description?: string }): Promise<void>
	cloneRepo(input: { url: string; parentPath: string; name?: string }): Promise<{ ok: boolean; error?: string }>
	initRepo(input: { parentPath: string; name: string }): Promise<{ ok: boolean; error?: string }>
	updateRepo(id: string, patch: Partial<{ name: string; path: string; base: string; description: string; color: string | null }>): Promise<void>
	removeRepo(id: string): Promise<void>
	/** 새 태스크 생성 직후, 백엔드가 백그라운드로 돌리는 자동배정(repo_id)이 끝날 때까지 잠깐 폴링 */
	pollTaskRepoClassification(taskId: string): void
	enrichTaskTitleInBackground(taskId: string, url: string): void
	refreshOrchestration(folderId: string): Promise<void>
	refreshAllOrchestrations(): Promise<void>
	startOrchestration(folderId: string): Promise<void>
	advanceOrchestration(folderId: string): Promise<void>
	stopOrchestration(folderId: string): Promise<void>
	startConductor(folderId: string): Promise<void>
	stopConductor(folderId: string): Promise<void>
	tellConductor(folderId: string, text: string): Promise<void>

	// 보관함 — 완료된 폴더를 지우지 않고 archived로만 표시, 날짜별로 보존
	loadArchive(): Promise<void>
	loadGitStatus(): Promise<void>
	loadTermStatus(): Promise<void>
	loadHealth(): Promise<void>
	archiveFolder(id: string): Promise<void>
	restoreFolder(id: string): Promise<void>

	openReview(taskId: string): void
	closeReview(): void
	openTaskDetail(taskId: string): void
	closeTaskDetail(): void
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
	loaded: false,
	loading: false,
	error: null,
	repos: [],
	reposLoaded: false,
	archive: [],
	archiveLoaded: false,
	archiveBusy: null,
	gitStatus: {},
	termStatus: {},
	cockpitSummary: null,
	apiAddress: null,
	rootPath: null,

	classifying: {},
	enrichingTitle: {},
	openFolders: {},
	openTasks: {},
	dragTaskId: null,
	overFolderId: null,
	overTaskId: null,
	quickStartBusy: null,
	orchestration: {},
	orchBusy: {},

	reviewTaskId: null,
	disputingReviewId: null,
	disputeText: '',
	confirmingApplyId: null,
	reviewBusy: false,
	detailTaskId: null,

	loadBoard: async () => {
		set({ loading: true, error: null })
		try {
			const board = await SessionsApi.getBoard()
			set((s) => ({
				folders: board.folders,
				inbox: board.inbox,
				loaded: true,
				loading: false,
				// default folders to open on first load only — preserve user's manual collapses across refetches
				openFolders: s.loaded ? s.openFolders : Object.fromEntries(board.folders.map((f) => [f.id, true])),
			}))
		} catch (e) {
			set({ loading: false, error: e instanceof Error ? e.message : String(e) })
		}
	},

	// 사이드바 "태스크 추가"와 캘린더 빈 칸 추가가 공유하는 단일 생성 경로(NewTaskModal) — 예전엔
	// 사이드바 드롭다운 패널(draft/draftBusy 전역 상태)과 캘린더 인라인 입력이 각자 따로 구현돼 있었다.
	// 폼 자체의 진행 중 상태는 모달 로컬 state로 관리하므로 여기선 순수 함수형으로 결과만 돌려준다.
	createTaskFromDraft: async (text, dueDate) => {
		const v = text.trim()
		if (!v) return { ok: false, error: '내용을 입력하세요.' }
		const kind = detectLink(v)
		const name = kind ? `${LINK_LABEL[kind]} 링크 태스크` : v
		// 링크는 addBranchLink로 따로 저장돼 BranchChain/FolderCard에 LINK_LABEL 칩으로 이미 표시된다 —
		// desc에 "붙여넣은 링크: <url>"을 원문 그대로 또 넣으면 같은 정보가 중복 노출된다.
		try {
			const task = await SessionsApi.createTask({ folderId: null, name, desc: '', dueDate: dueDate ?? null })
			if (kind) {
				const branch = await SessionsApi.createBranch({ taskId: task.id, name: '브랜치 미지정' })
				await SessionsApi.addBranchLink(branch.id, kind, v)
				// "○○ 링크 태스크" placeholder를 실제 링크 내용 기반 제목으로 — await 안 함(몇 초~170초
				// 걸릴 수 있어 일감 추가 자체를 막으면 안 됨), enrichingTitle로 사이드바에 진행 상태만 표시.
				get().enrichTaskTitleInBackground(task.id, v)
			}
			await get().loadBoard()
			if (!task.repo_id) get().pollTaskRepoClassification(task.id)
			// 내용이 있냐(=링크) 없냐(=순수 텍스트)로 자동 시작 여부를 가른다 — 링크는 그 자체로 실제
			// 내용(피그마 화면·노션 문서·슬랙 스레드·PR)을 담고 있어 곧장 승격+오케스트레이션 시작까지
			// 이어가도 안전하지만, 순수 텍스트는 제목 한 줄뿐이라 레포·base·kind 등을 사람이 확인해야
			// 한다("AI 제안 + 사람이 자유롭게 덮어쓰기", §12) — 미분류에 담아두고 InboxPreview의
			// "태스크로 등록"을 거치게 둔다. 예전엔 링크·텍스트 구분 없이 항상 곧장 시작했었다.
			if (kind) await get().quickStartTask(task.id)
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
		set((s) => ({ repos: s.repos.map((r) => (r.id === id ? { ...r, ...patch } : r)) })) // optimistic
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
			const folder = await SessionsApi.createFolder({ name: name || '새 폴더' })
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
			if (!r.ok) throw new Error(r.error || '지휘자 시작 실패')
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
			if (!r.ok) throw new Error(r.error || '전송 실패')
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

	// /api/cockpit는 stale-while-revalidate 캐시(15초 fresh)라 자주 불러도 서버에 부담 없음 — 실패해도
	// 조용히 무시(PR 배지·상태바 요약은 있으면 좋은 부가 정보지, 실패했다고 보드 전체를 에러로 만들
	// 정도는 아님).
	loadGitStatus: async () => {
		try {
			const { byBranch, summary } = await SessionsApi.getCockpit()
			set({ gitStatus: byBranch || {}, cockpitSummary: summary || null })
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
			set({ apiAddress: `${h.host}:${h.port}`, rootPath: h.repo || null })
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

	openReview: (taskId) => set({ reviewTaskId: taskId, disputingReviewId: null, disputeText: '', confirmingApplyId: null }),
	closeReview: () => set({ reviewTaskId: null, disputingReviewId: null, disputeText: '', confirmingApplyId: null }),
	openTaskDetail: (taskId) => set({ detailTaskId: taskId }),
	closeTaskDetail: () => set({ detailTaskId: null }),
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
			if (!r.ok) throw new Error(r.error || 'AI 리뷰 실패')
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

export function getOrchestration(state: SessionsState, folderId: string): OrchestrationState {
	return state.orchestration[folderId] ?? EMPTY_ORCHESTRATION
}
