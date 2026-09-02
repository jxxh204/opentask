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

// AI 일감 검토(§ server/durationEstimate.cjs)의 최종 판단 — startDurationEstimate/getDurationEstimateStatus
// 폴링 중일 때와 board가 실어주는 영구 저장분(TaskReview.result) 둘 다 이 shape를 공유한다.
// "실제로 클로드로 개발들어간다면... 개발기한과 테스트 기한을 나눠야" — devDays(Claude 구현)와
// testDays(개발자 검증) 각각 따로 온다. days는 서버가 계산한 둘의 합(캘린더 스케줄링용 하위호환 필드).
export interface DurationEstimateItem {
	item: string
	devDays: number
	testDays: number
	days: number
	note: string
}
// "개발이라는 추상적인 단어보다 설계서의 업무를 순차적으로 서브태스크로 만들면 좋겠어" — 오케스트
// 레이터가 이 순서대로 서브태스크를 자동 생성해 하나씩 워크트리 체이닝으로 진행한다(§ orchestrator.cjs).
export interface DurationEstimateWorkUnit {
	name: string
	summary: string
}
export type DurationEstimateResult =
	| { ok: true; days: number; devDays: number; testDays: number; breakdown: DurationEstimateItem[]; detail: string; whyLong: string; plan: string[]; workUnits: DurationEstimateWorkUnit[]; betterDesc: string }
	| { ok: false; error: string; tooVague?: boolean }

// "검토한 일감은... 사라지면안돼. 항상 불러와야해" — 완료된 검토는 agent_jobs에 영구 저장되고
// composeTask가 board 응답에 실어준다. result가 null이면 잡은 있었지만 실패로 끝난 것(레거시 데이터
// 등 극히 드문 경우) — done만 알고 싶으면 doneAt 존재 여부로 충분하다.
export interface TaskReview {
	jobId: string
	result: DurationEstimateResult | null
	doneAt: number
}

// "일정 막기 기능이 필요해. QA기간같은게 있어서 다른걸 못할 수 있거든" — 태스크가 아니라 캘린더
// 자체의 제약. start_date/end_date는 로컬 자정 epoch ms(양 끝 포함).
export interface BlockedPeriod {
	id: string
	name: string
	start_date: number
	end_date: number
	created_at: number
}

// "태스크 하나에 개발, 개발자테스트, QA, 배포 이런식으로 나뉠 수 있거든" — 태스크 설명과 별개의
// 자기 설명 + 독립적인 예정일/기간(캘린더에서 태스크처럼 자유롭게 옮길 수 있음). 색은 없다 —
// 캘린더가 부모 태스크의 color로 통일해서 그린다(§ CalendarPane).
export interface Subtask {
	id: string
	// "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — null이면 어느 태스크에도
	// 속하지 않은 독립 서브태스크(메모). SessionsBoard.notes로 실린다(§ tasks.cjs board).
	task_id: string | null
	name: string
	desc: string
	due_date: number | null
	duration_days: number | null
	// "서브태스크도 레포를 별도로 줄 수 있어야하지만. 기본적으로는 메인태스크와 동일하게" — null이면
	// 폴더/태스크 레포를 그대로 물려받는다(launchSubtask 참고).
	repo_id: string | null
	order_idx: number
	// "서브태스크 완료 버튼 필요" — Task.completed_at과 같은 패턴. null이면 미완료, 값이 있으면 완료
	// 처리한 시각. 사이드바 트리에서는 걸러내 안 보이게 하지만 캘린더는 계속 보여준다.
	completed_at: number | null
	created_at: number
	updated_at: number
}

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
	due_date: number | null
	duration_days: number | null
	completed_at: number | null
	// "레포의 색상은... 다른걸로 표시해야할것같아" — 배경은 이 커스텀 색이 쓰고 레포색은 다른 채널
	// (텍스트 등)로 옮긴다. null이면 레포색/기본 배경 그대로(§ CalendarPane.renderChip).
	color: string | null
	created_at: number
	updated_at: number
	branches: Branch[]
	reviews: Review[]
	review: TaskReview | null
	subtasks: Subtask[]
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
	ownerAvatarUrl?: string | null
	color: string | null
	// "팀 규칙" — 브랜치 네이밍·사전 문서 요구사항처럼 팀마다 다른 개발 관행을 자연어로 적어두는 4칸
	// (§ db.cjs v22). OpenTask 코드는 파싱하지 않고 그대로 에이전트 지시문에 얹는다.
	rule_general: string | null
	rule_task_writing: string | null
	rule_branch: string | null
	rule_predev: string | null
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
	// "태스크 숨기기" — 완료/보관과 무관하게 사이드바 트리에서 안 보이게(§ db.cjs v27), 캘린더에서도
	// 안 보이게(§ CalendarPane.tsx allTasks — "눈모양으로 안보이게 표시하면 캘린더에서도 안보이게해줘").
	hidden: 0 | 1
	hidden_at: number | null
	// merge 게이트(§12) — 기본 꺼짐(Merge-ready: 자동 approve만, merge는 사람). 켜면 클린 판정 시 실제 merge까지 자동.
	auto_merge: 0 | 1
	// 레포는 폴더 단위로 하나만 — 서브태스크(Task.repo_id)는 폴더 생성 시 이 값을 물려받고 이후로도
	// 이 값이 정답(orchestrator.cjs가 워크트리를 만들 때 이 값을 쓴다).
	repo_id: string | null
	// "이건 태스크의 유니크한 규칙이야" — 팀 규칙(repos.rule_*)과 별개로 이 메인 태스크 하나만의
	// 예외 규칙(§ db.cjs v23).
	rule_task: string | null
	tasks: Task[]
}

export interface SessionsBoard {
	folders: Folder[]
	inbox: Task[]
	// 메인 태스크 없는 독립 서브태스크(메모) — inbox와 같은 층위, task.subtasks에는 안 실린다.
	notes: Subtask[]
}
