// Shared domain types — shape mirrors exactly what server/store/tasks.cjs's
// board()/composeTask() return (snake_case, straight from SQLite rows) rather
// than introducing a camelCase mapping layer that could drift out of sync.
import type { LinkKind } from '../utils/linkDetect'

export interface BranchLink {
	id: string
	branch_id: string
	kind: LinkKind
	url: string
}

export interface Branch {
	id: string
	task_id: string
	order_idx: number
	name: string
	repo: string | null
	forked: 0 | 1
	links: BranchLink[]
}

export type ReviewSeverity = 'P1' | 'P2' | 'P3'
export type ReviewState = 'open' | 'applied' | 'disputed'

export interface Review {
	id: string
	branch_id: string
	external_id: string | null
	who: string | null
	at: number | null
	sev: ReviewSeverity | null
	file: string | null
	body: string | null
	state: ReviewState
	reply: string | null
	applied_job_id: string | null
}

export type TaskKind = 'chain' | 'parallel' | 'single'

export interface Task {
	id: string
	folder_id: string | null
	order_idx: number
	name: string
	desc: string
	kind: TaskKind
	ticket: string | null
	start_prompt: string | null
	repo_id: string | null
	repo_auto: 0 | 1
	created_at: number
	updated_at: number
	branches: Branch[]
	reviews: Review[]
}

// 멀티레포 프로젝트용 "연결된 레포" — 0~1개면 오케스트레이션은 지금처럼 단일 rootPath를 그대로 쓴다.
export interface Repo {
	id: string
	name: string
	path: string
	base: string | null
	description: string
	order_idx: number
	created_at: number
}

export interface Folder {
	id: string
	name: string
	base: string | null
	order_idx: number
	created_at: number
	updated_at: number
	archived: 0 | 1
	archived_at: number | null
	// merge 게이트(§12) — 기본 꺼짐(Merge-ready: 자동 approve만, merge는 사람). 켜면 클린 판정 시 실제 merge까지 자동.
	auto_merge: 0 | 1
	tasks: Task[]
}

export interface SessionsBoard {
	folders: Folder[]
	inbox: Task[]
}
