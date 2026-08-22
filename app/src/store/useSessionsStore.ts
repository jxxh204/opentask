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
	rootPath: string | null // 단일 레포 모드의 루트 경로 — 오케스트레이터/지휘자가 아직 없어도 클로드 세션을 띄울 기본 cwd

	draft: string
	draftBusy: boolean // "일감으로 추가" 클릭 → 실제로 목록에 뜨기까지의 공백 — 그동안 아무 표시가 없어 뭘 하는지 몰랐던 지점
	classifying: Record<string, boolean> // taskId → repoClassify.cjs 자동배정이 아직 진행 중인지(멀티레포일 때만)
	openFolders: Record<string, boolean>
	openTasks: Record<string, boolean>
	dragTaskId: string | null
	overFolderId: string | null // 'inbox' | folder id | null
	orchestration: Record<string, OrchestrationState>
	orchBusy: Record<string, boolean>

	reviewTaskId: string | null
	disputingReviewId: string | null
	disputeText: string
	confirmingApplyId: string | null
	reviewBusy: boolean

	loadBoard(): Promise<void>
	setDraft(v: string): void
	addTaskFromDraft(): Promise<void>
	createFolder(name: string): Promise<void>
	/** cmdk "새 워크트리" — 지금 보고 있는 태스크와 같은 폴더(없으면 미분류)에 새 태스크를 만들고 연다 */
	createTaskInFolder(folderId: string | null, name: string): Promise<string | null>
	renameFolder(id: string, name: string): Promise<void>
	setFolderAutoMerge(id: string, on: boolean): Promise<void>
	renameTask(id: string, name: string): Promise<void>
	toggleFolder(id: string): void
	toggleTask(id: string): void
	setDragTask(id: string | null): void
	setOverFolder(id: string | null): void
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
	updateRepo(id: string, patch: Partial<{ name: string; path: string; base: string; description: string }>): Promise<void>
	removeRepo(id: string): Promise<void>
	setTaskRepo(taskId: string, repoId: string | null): Promise<void>
	/** 새 태스크 생성 직후, 백엔드가 백그라운드로 돌리는 자동배정(repo_id)이 끝날 때까지 잠깐 폴링 */
	pollTaskRepoClassification(taskId: string): void
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

	draft: '',
	draftBusy: false,
	classifying: {},
	openFolders: {},
	openTasks: {},
	dragTaskId: null,
	overFolderId: null,
	quickStartBusy: null,
	orchestration: {},
	orchBusy: {},

	reviewTaskId: null,
	disputingReviewId: null,
	disputeText: '',
	confirmingApplyId: null,
	reviewBusy: false,

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

	setDraft: (v) => set({ draft: v }),

	addTaskFromDraft: async () => {
		const v = get().draft.trim()
		if (!v) return
		const kind = detectLink(v)
		const name = kind ? `${LINK_LABEL[kind]} 링크 태스크` : v
		const desc = kind ? `붙여넣은 링크: ${v}` : ''
		// draft는 제출 직후 바로 비웠었다 — 그래서 버튼을 눌러도 아무 반응이 없어 보였다(요청이 실제로
		// 끝날 때까지 1~2초는 걸리는데 그동안 화면에 아무 신호가 없었음). draftBusy로 그 공백을 채운다.
		set({ draft: '', draftBusy: true })
		try {
			const task = await SessionsApi.createTask({ folderId: null, name, desc })
			if (kind) {
				const branch = await SessionsApi.createBranch({ taskId: task.id, name: '브랜치 미지정' })
				await SessionsApi.addBranchLink(branch.id, kind, v)
			}
			await get().loadBoard()
			if (!task.repo_id) get().pollTaskRepoClassification(task.id)
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		} finally {
			set({ draftBusy: false })
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

	// 사람이 직접 레포를 고르면(드롭다운) AI 자동배정 표시는 서버 쪽에서 해제됨(store/tasks.cjs update()).
	setTaskRepo: async (taskId, repoId) => {
		const patch = { repo_id: repoId, repo_auto: 0 as const }
		set((s) => ({
			inbox: s.inbox.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
			folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })),
		}))
		try {
			await SessionsApi.updateTask(taskId, { repoId })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
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
		set((s) => ({ folders: s.folders.map((f) => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, name } : t)) })) }))
		try {
			await SessionsApi.updateTask(id, { name })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
			await get().loadBoard()
		}
	},

	toggleFolder: (id) => set((s) => ({ openFolders: { ...s.openFolders, [id]: !(s.openFolders[id] !== false) } })),
	toggleTask: (id) => set((s) => ({ openTasks: { ...s.openTasks, [id]: !s.openTasks[id] } })),
	setDragTask: (id) => set({ dragTaskId: id }),
	setOverFolder: (id) => set({ overFolderId: id }),

	moveTask: async (taskId, toFolderId, beforeTaskId) => {
		set({ dragTaskId: null, overFolderId: null })
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
				const folder = await SessionsApi.createFolder({ name: task.name, base: opts?.base, autoMerge: opts?.autoMerge, retryLimit: opts?.retryLimit })
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
