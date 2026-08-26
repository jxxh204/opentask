import { api } from './client'
import type { SessionsBoard, Folder, Task, Branch, BranchLink, Review, Repo } from '../store/types'

export function getBoard() {
	return api.get<SessionsBoard>('/api/sessions/board')
}

export function createFolder(input: { name: string; base?: string | null; autoMerge?: boolean; retryLimit?: number; repoId?: string | null }) {
	return api.post<Folder>('/api/folders', input)
}
export function updateFolder(id: string, patch: Partial<{ name: string; base: string | null; order: number; autoMerge: boolean; repoId: string | null }>) {
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

export function createTask(input: { folderId: string | null; name: string; desc?: string; kind?: Task['kind']; repoId?: string | null; dueDate?: number | null }) {
	return api.post<Task>('/api/tasks', input)
}
export function moveTask(id: string, folderId: string | null, beforeTaskId?: string | null) {
	return api.patch<Task>(`/api/tasks/${id}`, { folderId, beforeTaskId })
}
export function updateTask(
	id: string,
	patch: Partial<{ name: string; desc: string; kind: Task['kind']; startPrompt: string | null; repoId: string | null; dueDate: number | null; durationDays: number | null; completedAt: number | null }>,
) {
	return api.patch<Task>(`/api/tasks/${id}`, patch)
}
export function removeTask(id: string) {
	return api.delete<{ ok: boolean }>(`/api/tasks/${id}`)
}
export interface DurationEstimateItem {
	item: string
	days: number
	note: string
}
export interface DurationEstimateTokens {
	input: number
	output: number
	cacheRead: number
	cacheCreation: number
}
export interface DurationEstimateStatus {
	ok: true
	percent: number
	label: string
	done: boolean
	tokens: DurationEstimateTokens
	costUsd: number | null
	elapsedMs: number
	// tooVague: 설명+조사 결과만으로는 무엇을 만드는 태스크인지 특정할 수 없을 때 — 억지 숫자 대신
	// "설명을 채워달라"는 경고로 취급한다("설명이 불확실하면 취소하고 채워달라는 경고를 띄워줘").
	// plan/changes: "조사 결과로 개발 계획까지" — plan은 "계획 적용" 버튼으로 task.start_prompt에 반영
	// 가능한 순서 있는 문장 배열. changes(AS-IS/TO-BE 코드 스케치)는 좁은 드로어에선 안 쓰고 HTML
	// 리포트에서만 렌더링하므로 여기 타입엔 넣지 않는다(드로어 쪽 화면에서 참조하지 않음).
	// betterDesc: "일감 내용 자체를 변경해버리면" — "설명 적용"으로 desc 필드를 통째로 교체 가능.
	result: ({ ok: true; days: number; breakdown: DurationEstimateItem[]; detail: string; plan: string[]; betterDesc: string } | { ok: false; error: string; tooVague?: boolean }) | null
}
// 태스크 상세 "AI 추정" 버튼 — 설명+실제 코드 기반 항목별(화면/로직/설계/영향범위) 예상 소요 영업일.
// 코드 탐색 때문에 30초~수 분 걸릴 수 있어("토큰/프로그레스바를 보여줘야" 피드백) 잡 방식으로 바뀜 —
// start로 jobId만 받고 status를 폴링. 응답은 제안일 뿐 저장되지 않는다 — 사용자가 받아들이면 별도로
// updateTask(id, {durationDays})를 호출해야 실제로 반영된다. days는 서버가 breakdown 합으로 계산.
export function startDurationEstimate(id: string) {
	return api.post<{ ok: true; jobId: string } | { ok: false; error: string }>(`/api/tasks/${id}/estimate-duration/start`)
}
export function getDurationEstimateStatus(id: string, jobId: string) {
	return api.get<DurationEstimateStatus | { ok: false; notFound: true; error: string }>(`/api/tasks/${id}/estimate-duration/status?jobId=${encodeURIComponent(jobId)}`)
}
// "결과를 html로 뽑아주고 링크로 제공" — fetch가 아니라 <a href target="_blank">로 직접 열림
// (Electron의 setWindowOpenHandler가 시스템 기본 브라우저로 넘겨준다, electron/main.cjs 참고).
export function durationEstimateReportUrl(id: string, jobId: string) {
	return `/api/tasks/${id}/estimate-duration/report?jobId=${encodeURIComponent(jobId)}`
}
// 스레드/노션/피그마 링크로 만든 일감의 "○○ 링크 태스크" placeholder 제목을, 링크 내용을 실제로
// 읽어(claude -p + MCP) 얻은 제목·요약으로 교체 — 몇 초~170초 걸릴 수 있어 호출부는 await하지 않고
// 백그라운드로 던진다.
export function enrichTaskTitle(id: string, url: string) {
	return api.post<{ ok: true; task: Task } | { ok: false; error: string }>(`/api/tasks/${id}/enrich-title`, { url })
}

// 멀티레포 프로젝트 — 연결된 레포 레지스트리 (0~1개면 단일 rootPath로 동작, 기존과 동일)
export function listRepos() {
	return api.get<Repo[]>('/api/repos')
}
export function createRepo(input: { name: string; path: string; base?: string; description?: string }) {
	return api.post<Repo>('/api/repos', input)
}
export function updateRepo(id: string, patch: Partial<{ name: string; path: string; base: string; description: string; color: string | null }>) {
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
