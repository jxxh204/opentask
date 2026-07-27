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
	created_at: number
	updated_at: number
	branches: Branch[]
	reviews: Review[]
}

export interface Folder {
	id: string
	name: string
	base: string | null
	order_idx: number
	created_at: number
	updated_at: number
	tasks: Task[]
}

export interface SessionsBoard {
	folders: Folder[]
	inbox: Task[]
}
