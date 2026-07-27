import { create } from 'zustand'
import type { Folder, Task } from './types'
import * as SessionsApi from '../api/sessions'
import type { OrchestrationState } from '../api/sessions'
import { detectLink, LINK_LABEL } from '../utils/linkDetect'

const EMPTY_ORCHESTRATION: OrchestrationState = { running: false, currentWaveIndex: 0, sessions: [], log: [] }

export interface SessionsState {
	folders: Folder[]
	inbox: Task[]
	loaded: boolean
	loading: boolean
	error: string | null

	draft: string
	openFolders: Record<string, boolean>
	openTasks: Record<string, boolean>
	dragTaskId: string | null
	overFolderId: string | null // 'inbox' | folder id | null
	orchestration: Record<string, OrchestrationState>

	reviewTaskId: string | null
	disputingReviewId: string | null
	disputeText: string
	reviewBusy: boolean

	loadBoard(): Promise<void>
	setDraft(v: string): void
	addTaskFromDraft(): Promise<void>
	createFolder(name: string): Promise<void>
	renameFolder(id: string, name: string): Promise<void>
	toggleFolder(id: string): void
	toggleTask(id: string): void
	setDragTask(id: string | null): void
	setOverFolder(id: string | null): void
	moveTask(taskId: string, toFolderId: string | null, beforeTaskId?: string | null): Promise<void>
	refreshOrchestration(folderId: string): Promise<void>
	startOrchestration(folderId: string): Promise<void>
	advanceOrchestration(folderId: string): Promise<void>
	stopOrchestration(folderId: string): Promise<void>

	openReview(taskId: string): void
	closeReview(): void
	setDisputeText(v: string): void
	startDispute(reviewId: string): void
	cancelDispute(): void
	syncReviews(branchId: string): Promise<void>
	applyReview(reviewId: string): Promise<void>
	disputeReview(reviewId: string): Promise<void>
}

export const useSessionsStore = create<SessionsState>()((set, get) => ({
	folders: [],
	inbox: [],
	loaded: false,
	loading: false,
	error: null,

	draft: '',
	openFolders: {},
	openTasks: {},
	dragTaskId: null,
	overFolderId: null,
	orchestration: {},

	reviewTaskId: null,
	disputingReviewId: null,
	disputeText: '',
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
		set({ draft: '' })
		try {
			const task = await SessionsApi.createTask({ folderId: null, name, desc })
			if (kind) {
				const branch = await SessionsApi.createBranch({ taskId: task.id, name: '브랜치 미지정' })
				await SessionsApi.addBranchLink(branch.id, kind, v)
			}
			await get().loadBoard()
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
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

	toggleFolder: (id) => set((s) => ({ openFolders: { ...s.openFolders, [id]: !(s.openFolders[id] !== false) } })),
	toggleTask: (id) => set((s) => ({ openTasks: { ...s.openTasks, [id]: !s.openTasks[id] } })),
	setDragTask: (id) => set({ dragTaskId: id }),
	setOverFolder: (id) => set({ overFolderId: id }),

	moveTask: async (taskId, toFolderId, beforeTaskId) => {
		set({ dragTaskId: null, overFolderId: null })
		try {
			await SessionsApi.moveTask(taskId, toFolderId, beforeTaskId ?? null)
			await get().loadBoard() // re-fetch for authoritative order rather than hand-rolling the splice
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
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
	startOrchestration: async (folderId) => {
		try {
			const state = await SessionsApi.startOrchestration(folderId)
			set((s) => ({ orchestration: { ...s.orchestration, [folderId]: state } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},
	advanceOrchestration: async (folderId) => {
		try {
			const state = await SessionsApi.advanceOrchestration(folderId)
			set((s) => ({ orchestration: { ...s.orchestration, [folderId]: state } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},
	stopOrchestration: async (folderId) => {
		try {
			const state = await SessionsApi.stopOrchestration(folderId)
			set((s) => ({ orchestration: { ...s.orchestration, [folderId]: state } }))
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) })
		}
	},

	openReview: (taskId) => set({ reviewTaskId: taskId, disputingReviewId: null, disputeText: '' }),
	closeReview: () => set({ reviewTaskId: null, disputingReviewId: null, disputeText: '' }),
	setDisputeText: (v) => set({ disputeText: v }),
	startDispute: (reviewId) => set({ disputingReviewId: reviewId, disputeText: '' }),
	cancelDispute: () => set({ disputingReviewId: null, disputeText: '' }),

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
	applyReview: async (reviewId) => {
		set({ reviewBusy: true })
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
