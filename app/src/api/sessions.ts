import { api } from './client'
import type { SessionsBoard, Folder, Task, Branch, BranchLink, Review } from '../store/types'

export function getBoard() {
	return api.get<SessionsBoard>('/api/sessions/board')
}

export function createFolder(input: { name: string; base?: string | null }) {
	return api.post<Folder>('/api/folders', input)
}
export function updateFolder(id: string, patch: Partial<{ name: string; base: string | null; order: number }>) {
	return api.patch<Folder>(`/api/folders/${id}`, patch)
}
export function removeFolder(id: string) {
	return api.delete<{ ok: boolean }>(`/api/folders/${id}`)
}

export function createTask(input: { folderId: string | null; name: string; desc?: string; kind?: Task['kind'] }) {
	return api.post<Task>('/api/tasks', input)
}
export function moveTask(id: string, folderId: string | null, beforeTaskId?: string | null) {
	return api.patch<Task>(`/api/tasks/${id}`, { folderId, beforeTaskId })
}
export function updateTask(id: string, patch: Partial<{ name: string; desc: string; kind: Task['kind'] }>) {
	return api.patch<Task>(`/api/tasks/${id}`, patch)
}
export function removeTask(id: string) {
	return api.delete<{ ok: boolean }>(`/api/tasks/${id}`)
}

export function createBranch(input: { taskId: string; name: string; repo?: string }) {
	return api.post<Branch>('/api/branches', input)
}
export function removeBranch(id: string) {
	return api.delete<{ ok: boolean }>(`/api/branches/${id}`)
}
export function addBranchLink(branchId: string, kind: BranchLink['kind'], url: string) {
	return api.post<BranchLink>(`/api/branches/${branchId}/links`, { kind, url })
}
export function removeBranchLink(linkId: string) {
	return api.delete<{ ok: boolean }>(`/api/branch-links/${linkId}`)
}

export interface OrchestrationLogEntry {
	t: string
	dot: 'violet' | 'green' | 'blue' | 'amber'
	at: number
}
export interface OrchestrationSession {
	taskId: string
	tmuxSession: string
	worktreePath: string
}
export interface OrchestrationState {
	running: boolean
	currentWaveIndex: number
	sessions: OrchestrationSession[]
	log: OrchestrationLogEntry[]
}

export function startOrchestration(folderId: string) {
	return api.post<OrchestrationState>(`/api/folders/${folderId}/orchestrate/start`)
}
export function advanceOrchestration(folderId: string) {
	return api.post<OrchestrationState>(`/api/folders/${folderId}/orchestrate/advance`)
}
export function stopOrchestration(folderId: string) {
	return api.post<OrchestrationState>(`/api/folders/${folderId}/orchestrate/stop`)
}
export function getOrchestrationState(folderId: string) {
	return api.get<OrchestrationState>(`/api/folders/${folderId}/orchestrate/state`)
}

export function syncReviews(branchId: string) {
	return api.post<Review[]>(`/api/branches/${branchId}/reviews/sync`)
}
export function applyReview(id: string) {
	return api.post<Review>(`/api/reviews/${id}/apply`)
}
export function disputeReview(id: string, text: string) {
	return api.post<Review>(`/api/reviews/${id}/dispute`, { text })
}
