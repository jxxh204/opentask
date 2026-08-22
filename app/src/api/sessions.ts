import { api } from './client'
import type { SessionsBoard, Folder, Task, Branch, BranchLink, Review, Repo } from '../store/types'

export function getBoard() {
	return api.get<SessionsBoard>('/api/sessions/board')
}

export function createFolder(input: { name: string; base?: string | null; autoMerge?: boolean; retryLimit?: number }) {
	return api.post<Folder>('/api/folders', input)
}
export function updateFolder(id: string, patch: Partial<{ name: string; base: string | null; order: number; autoMerge: boolean }>) {
	return api.patch<Folder>(`/api/folders/${id}`, patch)
}
export function removeFolder(id: string) {
	return api.delete<{ ok: boolean }>(`/api/folders/${id}`)
}
export function archiveFolder(id: string) {
	return api.post<Folder>(`/api/folders/${id}/archive`)
}
export function restoreFolder(id: string) {
	return api.post<Folder>(`/api/folders/${id}/restore`)
}
export function listArchivedFolders() {
	return api.get<{ folders: Folder[] }>('/api/folders/archived')
}

export function createTask(input: { folderId: string | null; name: string; desc?: string; kind?: Task['kind']; repoId?: string | null }) {
	return api.post<Task>('/api/tasks', input)
}
export function moveTask(id: string, folderId: string | null, beforeTaskId?: string | null) {
	return api.patch<Task>(`/api/tasks/${id}`, { folderId, beforeTaskId })
}
export function updateTask(id: string, patch: Partial<{ name: string; desc: string; kind: Task['kind']; startPrompt: string | null; repoId: string | null }>) {
	return api.patch<Task>(`/api/tasks/${id}`, patch)
}
export function removeTask(id: string) {
	return api.delete<{ ok: boolean }>(`/api/tasks/${id}`)
}

// 멀티레포 프로젝트 — 연결된 레포 레지스트리 (0~1개면 단일 rootPath로 동작, 기존과 동일)
export function listRepos() {
	return api.get<Repo[]>('/api/repos')
}
export function createRepo(input: { name: string; path: string; base?: string; description?: string }) {
	return api.post<Repo>('/api/repos', input)
}
export function updateRepo(id: string, patch: Partial<{ name: string; path: string; base: string; description: string }>) {
	return api.patch<Repo>(`/api/repos/${id}`, patch)
}
export function removeRepo(id: string) {
	return api.delete<{ ok: boolean }>(`/api/repos/${id}`)
}
export function cloneRepo(input: { url: string; parentPath: string; name?: string }) {
	return api.post<{ ok: boolean; repo?: Repo; error?: string }>('/api/repos/clone', input)
}
export function initRepo(input: { parentPath: string; name: string }) {
	return api.post<{ ok: boolean; repo?: Repo; error?: string }>('/api/repos/init', input)
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
	model: string | null
	modelLabel: string | null
}
export interface Conductor {
	session: string
	model: string
	modelLabel: string | null
	startedAt: number
	cwd: string
}
export type FeedKind = 'msg' | 'plan' | 'dispatch' | 'result' | 'error'
export interface FeedEntry {
	ts: number
	from: string
	to: string
	text: string
	kind: FeedKind
}
export interface OrchestrationState {
	running: boolean
	currentWaveIndex: number
	sessions: OrchestrationSession[]
	log: OrchestrationLogEntry[]
	conductor: Conductor | null
	feed: FeedEntry[]
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

// AI 판정 감사 로그(§12) — conductor.feed(인메모리, 재시작시 소실)와 달리 SQLite에 영속.
export type DecisionKind = 'repo_assign' | 'repo_verify_hold' | 'kind_judge' | 'review_verdict'
export interface Decision {
	id: string
	folder_id: string | null
	task_id: string | null
	kind: DecisionKind
	reason: string
	meta: Record<string, unknown> | null
	created_at: number
}
export function getDecisions(folderId: string) {
	return api.get<{ ok: boolean; decisions: Decision[] }>(`/api/folders/${folderId}/decisions`)
}

// 지휘자(오케스트레이터 자체의 클로드 세션) — say/event는 지휘자 세션 자신이 curl로 호출하므로
// 프론트는 start/stop/tell(사람→지휘자 발화)만 쓴다.
export function startConductor(folderId: string) {
	return api.post<{ ok: boolean; session?: string; error?: string }>(`/api/folders/${folderId}/conductor/start`)
}
export function stopConductor(folderId: string) {
	return api.post<{ ok: boolean }>(`/api/folders/${folderId}/conductor/stop`)
}
export function tellConductor(folderId: string, text: string) {
	return api.post<{ ok: boolean; error?: string }>(`/api/folders/${folderId}/conductor/tell`, { text })
}

// /api/cockpit(server/cockpit.cjs)이 이미 워크트리마다 git ahead/behind·dirty·PR(gh 조회)를 계산해
// 캐시해둔다(15초 fresh, stale-while-revalidate) — TaskRow가 브랜치명으로 조회해 PR 배지·
// ahead/behind를, 사이드바 하단 상태바가 요약(dev/스트림/dirty/PR 총계)을 실데이터로 붙이는 용도.
export interface GitStatusEntry {
	dirty: number
	ahead: number
	behind: number
	pr: { number: number; state: 'open' | 'merged' | 'closed'; draft: boolean; ci: string | null; url: string } | null
}
export interface CockpitSummary {
	devCount: number
	streamsTotal: number
	streamsActive: number
	dirty: number
	prOpen: number
	prDraft: number
	ciFail: number
	mainBranch: string | null
}
export function getCockpit() {
	return api.get<{ ok: boolean; byBranch: Record<string, GitStatusEntry>; summary: CockpitSummary }>('/api/cockpit')
}

export function getHealth() {
	return api.get<{ ok: boolean; repo: string; host: string; port: number }>('/api/health')
}

export function syncReviews(branchId: string) {
	return api.post<Review[]>(`/api/branches/${branchId}/reviews/sync`)
}
// ⑧ AI 자동 리뷰 — diff를 스스로 읽고 이슈를 낸다(prReview.cjs startAiReview, §12). 사람이 눌러야
// 도는 수동 트리거 — 백그라운드에서 자동으로 도는 루프는 아직 없음.
export function startAiReview(branchId: string) {
	return api.post<{ ok: boolean; verdict?: string; summary?: string; error?: string }>(`/api/branches/${branchId}/reviews/ai-review`)
}
export function applyReview(id: string) {
	return api.post<Review>(`/api/reviews/${id}/apply`)
}
export function disputeReview(id: string, text: string) {
	return api.post<Review>(`/api/reviews/${id}/dispute`, { text })
}
