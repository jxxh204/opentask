import { api } from './client'
import type { SessionsBoard, Folder, Task, Branch, BranchLink, Review, Repo, DurationEstimateResult, BlockedPeriod, Subtask } from '../store/types'

export function getBoard() {
	return api.get<SessionsBoard>('/api/sessions/board')
}

export function createFolder(input: { name: string; base?: string | null; autoMerge?: boolean; retryLimit?: number; repoId?: string | null }) {
	return api.post<Folder>('/api/folders', input)
}
export function updateFolder(id: string, patch: Partial<{ name: string; base: string | null; order: number; autoMerge: boolean; repoId: string | null; ruleTask: string | null; hidden: boolean }>) {
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
	patch: Partial<{
		name: string
		desc: string
		kind: Task['kind']
		startPrompt: string | null
		repoId: string | null
		dueDate: number | null
		durationDays: number | null
		completedAt: number | null
		color: string | null
	}>,
) {
	return api.patch<Task>(`/api/tasks/${id}`, patch)
}
export function removeTask(id: string) {
	return api.delete<{ ok: boolean }>(`/api/tasks/${id}`)
}

// 서브태스크("태스크 하나에 개발, 개발자테스트, QA, 배포 이런식으로 나뉠 수 있거든") — board가 이미
// task.subtasks로 실어주므로 별도 목록 조회 함수는 없다.
export function createSubtask(taskId: string, input: { name: string; desc?: string; dueDate?: number | null; durationDays?: number | null }) {
	return api.post<Subtask>(`/api/tasks/${taskId}/subtasks`, input)
}
export function updateSubtask(id: string, patch: Partial<{ name: string; desc: string; dueDate: number | null; durationDays: number | null; repoId: string | null; completedAt: number | null }>) {
	return api.patch<Subtask>(`/api/subtasks/${id}`, patch)
}
export function removeSubtask(id: string) {
	return api.delete<{ ok: boolean }>(`/api/subtasks/${id}`)
}
// "순서 변경도 내가 할 수 있게 해줘" — 사이드바 드래그로 다시 정렬한 순서를 그대로 넘긴다.
export function reorderSubtasks(taskId: string, ids: string[]) {
	return api.post<{ ok: true; subtasks: Subtask[] }>(`/api/tasks/${taskId}/subtasks/reorder`, { ids })
}
// "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — task_id 없이 만드는
// 독립 서브태스크(메모). 수정/삭제는 위 updateSubtask/removeSubtask를 그대로 재사용(id 기반이라 무관).
export function createNote(input: { name: string; desc?: string; dueDate?: number | null; durationDays?: number | null }) {
	return api.post<Subtask>('/api/subtasks', input)
}
export function reorderNotes(ids: string[]) {
	return api.post<{ ok: true; subtasks: Subtask[] }>('/api/subtasks/reorder', { ids })
}

// "코드작업은 무조건 서브태스크를 만들고 그 서브태스크에 워크트리를 만들어서... 순차로... pr도
// 체이닝으로" — 태스크의 서브태스크(개발 단위)를 하나씩 워크트리+클로드 세션으로 체이닝 진행.
export interface SubtaskWorkStatus {
	id: string
	name: string
	started: boolean
	alive: boolean
	// "서브태스크가 완료되면 초록색 동그라미에 체크표시로" — 세션이 그냥 죽은 것(alive:false, done:false)과
	// 실제로 다음 단계로 넘어간 것(done:true)을 구분하는 신호(§ orchestrator.cjs getSubtaskWorkState).
	done: boolean
	// "업무가 멈추든... 서로가 답장을 주는거야" — 서브태스크가 report-blocked curl로 스스로 보고한
	// "도움 필요" 상태. needsAuth/needsInput과 같은 "확정된 사람 개입 필요" 카테고리(§ orchestrator.cjs
	// reportSubtaskBlocked).
	blocked: boolean
	blockedReason: string | null
	// "업무가 어떻든간에" — 명시적 보고 없이 조용해진 걸 서버가 추정한 신호(§ checkStalledSubtasks).
	// blocked(확정)와 구분해서 다른 색(amber)으로 보여준다 — 섞으면 확정 신호의 긴급도가 희석된다.
	stalled: boolean
	tmuxSession: string | null
	worktreePath: string | null
	branch: string | null
	// "서브 태스크가 끝나면... 어떻게 끝났고 어떤것들을 했는지 정리해서 보여줬으면해" — 완료 시
	// 서브태스크 세션 자신이 작성해 저장된 HTML 리포트가 있으면 그 서빙 경로, 없으면 null
	// (§ orchestrator.cjs getSubtaskWorkState).
	reportUrl: string | null
}
export function startSubtaskWork(taskId: string) {
	return api.post<{ ok: true; already?: boolean; subtaskId: string; subtaskName: string; tmuxSession: string } | { ok: false; error: string }>(`/api/tasks/${taskId}/subtask-work/start`)
}
export function advanceSubtaskWork(taskId: string) {
	return api.post<{ ok: true; done?: boolean; subtaskId?: string; subtaskName?: string; tmuxSession?: string } | { ok: false; error: string }>(`/api/tasks/${taskId}/subtask-work/advance`)
}
export function getSubtaskWorkState(taskId: string) {
	return api.get<{ ok: true; subtasks: SubtaskWorkStatus[] } | { ok: false; error: string }>(`/api/tasks/${taskId}/subtask-work/state`)
}

// "현황판... 각 메인태스크의 현재 진행중인 서브태스크와 그것을 확인할 수 있는 html파일이나 url화면"
// — 주캘린더 상단 현황판(§ CalendarPane.tsx StatusBoard)의 데이터 소스(§ server/orchestrator.cjs
// getBoardStatus). /api/sessions/board(DB 스냅샷)와 달리 세션 생존·검증 자료 같은 라이브 상태를 준다.
// "현황판에는 pr, 브랜치, 접속해서 확인가능한 링크" — pr/branch는 그 서브태스크 워크트리의 실제 git
// 상태(§ server/cockpit.cjs byPath — TaskRow의 GitStatusEntry.pr와 같은 소스, 재사용). PR이 없으면
// null(아직 안 만들었거나 매칭 레포 밖).
// "이 툴은 웹프론트개발자를 위한 툴이 아니라는점이 중요해 그래서 '검증을 위한 자료'라고 추상화하는거야"
// — verifyItems는 에이전트가 직접 보고한 것(§ reportSubtaskVerify)이 최우선이고, 그게 하나도 없을
// 때만 자동 감지 폴백(devUrl, § getBoardStatus 주석) 하나가 대신 채워진다(auto:true로 표시).
// "확인하기 한가지 말고 여러가지로 보여줘야할듯해" — 한 작업 안에도 확인할 방법이 여러 개일 수 있어
// 배열로 온다(최신이 배열 앞쪽).
export interface BoardStatusPr {
	number: number
	url: string
	state: string
	draft: boolean
	ci: string | null
}
export interface VerifyItem {
	text: string | null
	url: string | null
	at: number | null
	auto?: boolean
}
export interface BoardStatusItem {
	folderId: string
	folderName: string
	taskId: string
	taskName: string
	active: {
		subtaskId: string
		subtaskName: string
		tmuxSession: string
		verifyItems: VerifyItem[]
		devUrl: string | null
		branch: string | null
		pr: BoardStatusPr | null
	} | null
	lastDone: { subtaskId: string; subtaskName: string; endedAt: number; reportUrl: string; branch: string | null; pr: BoardStatusPr | null } | null
	// "여기 들어가는 정보들이 여러 단계에서 적용되어야할것같은데 서브태스크, 메인태스크, 하이브마인드가
	// 만들어갈 수 있도록" — active/lastDone은 서브태스크 관점(§ 위 주석)이고, notes는 특정 서브태스크에
	// 안 묶인 태스크 전체 관점(§ server/orchestrator.cjs reportTaskVerify) — 여러 서브태스크를 종합한
	// 지휘자(conductor)나, 사람과 직접 대화하며 확인한 하이브마인드가 보고한 것들. source로 어느 쪽인지
	// 항목마다 구분해서 보여준다(둘을 섞으면 "누가 보고했는지"가 사라진다).
	notes: { text: string; url: string | null; at: number; source: 'conductor' | 'hivemind' }[]
}
export function getBoardStatus() {
	return api.get<{ ok: true; items: BoardStatusItem[] } | { ok: false; error: string }>('/api/board-status')
}
// "서브태스크 클로드 세션은 어떻게 킬지 고민이야" — 다음으로 안 넘기고 지금 세션만 끝낸다.
export function stopSubtaskSession(subtaskId: string) {
	return api.post<{ ok: true } | { ok: false; error: string }>(`/api/subtasks/${subtaskId}/session/stop`)
}
// "메인 태스크를 고르는 기능도 필요해 — 서브태스크로 사용하려고 고른것일 수 있자나?" — 독립 태스크를
// 다른 태스크의 서브태스크로 편입한다.
export function attachTaskAsSubtask(taskId: string, mainTaskId: string) {
	return api.post<{ ok: true; subtask: Subtask } | { ok: false; error: string }>(`/api/tasks/${taskId}/attach-as-subtask`, { mainTaskId })
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
	result: DurationEstimateResult | null
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

// "태스크 상세에 너무 정보가 없어... 개발할 때 이것만 보면 개발할 수 있다 정도 요약정보" — 태스크/
// 서브태스크 설명 속 노션·피그마 링크마다 핵심 정책 요약(§ db.cjs v28 link_briefs, linkBrief.cjs).
// 자동 생성이라 프론트는 감지된 링크마다 ensure를 부르고 결과가 올 때까지 짧게 폴링만 하면 된다.
export interface LinkBriefData {
	summary: string
	policies: string[]
	imageUrl: string | null
}
export interface LinkBrief {
	owner_type: 'task' | 'subtask'
	owner_id: string
	url: string
	kind: 'figma' | 'doc'
	status: 'pending' | 'ok' | 'error'
	data: LinkBriefData | null
	error: string | null
}
export function listLinkBriefs(ownerType: 'task' | 'subtask', ownerId: string) {
	return api.get<{ ok: boolean; briefs: LinkBrief[] }>(`/api/link-briefs?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`)
}
export function ensureLinkBrief(ownerType: 'task' | 'subtask', ownerId: string, url: string) {
	return api.post<{ ok: boolean; status?: string; error?: string }>('/api/link-briefs/ensure', { ownerType, ownerId, url })
}

// "API의 경우 변경된 API 엔드포인트... 실제 판별 코드를 이런 조건에 보여지고 API에서는 이렇게
// 내려온다 식으로" — 서브태스크 착수 전(pre, 관련 기존 코드 참고) / 완료 후(post, 실제 diff 기준
// 변경점) 코드 근거 브리핑(§ db.cjs v28 code_briefs, codeBrief.cjs). "Storybook에서 어디로 들어가야
// 하는지 알려주지 않는다" — storybook 필드가 정확한 딥링크(서버가 파일을 직접 읽어 결정론적으로 생성).
export interface CodeBriefReference {
	path: string
	lines: string
	condition: string
	explanation: string
	editorLink: string | null
	exists: boolean
}
export interface CodeBriefEndpoint {
	method: string
	path: string
	note: string
}
export interface CodeBriefStorybook {
	path: string
	story: string | null
	storyId: string | null
	label: string
	url: string | null
}
export interface CodeBriefData {
	summary: string
	endpoints: CodeBriefEndpoint[]
	references: CodeBriefReference[]
	storybook: CodeBriefStorybook | null
}
export interface CodeBrief {
	subtask_id: string
	stage: 'pre' | 'post'
	status: 'pending' | 'ok' | 'error'
	data: CodeBriefData | null
	error: string | null
}
export function getCodeBriefs(subtaskId: string) {
	return api.get<{ ok: boolean; pre: CodeBrief | null; post: CodeBrief | null }>(`/api/code-briefs/${encodeURIComponent(subtaskId)}`)
}
export function generateCodeBrief(subtaskId: string, stage: 'pre' | 'post') {
	return api.post<{ ok: boolean; status?: string; error?: string }>(`/api/code-briefs/${encodeURIComponent(subtaskId)}/generate`, { stage })
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
export function updateRepo(
	id: string,
	patch: Partial<{ name: string; path: string; base: string; description: string; color: string | null; ruleGeneral: string | null; ruleTaskWriting: string | null; ruleBranch: string | null; rulePredev: string | null }>,
) {
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

// "일정 막기 기능이 필요해. QA기간같은게 있어서" — 캘린더 전용 차단 기간 CRUD.
export function listBlockedPeriods() {
	return api.get<BlockedPeriod[]>('/api/blocked-periods')
}
export function createBlockedPeriod(input: { name: string; startDate: number; endDate: number }) {
	return api.post<BlockedPeriod | { ok: false; error: string }>('/api/blocked-periods', input)
}
export function removeBlockedPeriod(id: string) {
	return api.delete<{ ok: boolean }>(`/api/blocked-periods/${id}`)
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
// "업무가 멈추든... 서로가 답장을 주는거야" — notifyConductor가 report/blocked/stalled 세 상태 전부
// 이 kind로 피드에 남긴다(§ server/orchestrator.cjs notifyConductor).
export type FeedKind = 'msg' | 'plan' | 'dispatch' | 'result' | 'error' | 'blocked' | 'stalled' | 'progress'
export interface FeedEntry {
	ts: number
	from: string
	to: string
	text: string
	kind: FeedKind
	// 완료(result) 보고에 실제 HTML 리포트가 있으면 서빙 URL — 있으면 대화 로그에서 바로 열 수 있다.
	reportUrl?: string | null
}
export interface OrchestrationState {
	running: boolean
	currentWaveIndex: number
	sessions: OrchestrationSession[]
	log: OrchestrationLogEntry[]
	conductor: Conductor | null
	conductorStalled: boolean
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
	// byPath 엔트리에만 실려온다 — "PR뱃지도 자동으로 안잡혀" 참고. 워크트리 안에서 에이전트가 직접
	// git checkout -b로 브랜치를 바꾸면 DB에 기록된 브랜치명이 즉시 낡아버린다(§ StoreBranches는
	// 워크트리 생성 시점 스냅샷). 실제로 지금 그 워크트리가 체크아웃돼 있는 브랜치를 그대로 실어준다.
	branch?: string | null
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
// "가장 하단에 켜져있는 로컬서버 바로 클릭 가능한 버튼이 있으면 좋겠어" — 서버는 이미 계산해서
// 돌려주고 있었는데(devServers) 프론트가 summary.devCount만 쓰고 개별 목록은 안 쓰고 있었다.
export interface DevServerEntry {
	port: number
	pid: number
	cwd: string
	kind: string
	ticket: string | null
}
export function getCockpit() {
	return api.get<{ ok: boolean; byBranch: Record<string, GitStatusEntry>; byPath: Record<string, GitStatusEntry>; summary: CockpitSummary; devServers: DevServerEntry[] }>('/api/cockpit')
}

export function getHealth() {
	return api.get<{ ok: boolean; repo: string; host: string; port: number }>('/api/health')
}
// "모바일 테스트할 때 로컬 서버를 모바일앱에서 접속할 때 사용해야해" — 127.0.0.1은 다른 기기에서
// 못 쓰니(루프백 전용), 같은 Wi-Fi의 실기기가 실제로 쓸 수 있는 이 맥의 LAN IP를 대신 보여준다
// (§ SessionShell.tsx apiAddress — 기존에 안 쓰이던 /api/localip를 여기서 처음 소비).
export function getLocalIp() {
	return api.get<{ ok: boolean; ip: string | null; ssid: string | null; ssidRedacted: boolean }>('/api/localip')
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
