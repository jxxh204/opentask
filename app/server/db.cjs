// db.cjs — openRM's own SQLite store. Single source of truth per local instance
// (each user who runs their own copy of this open-source app owns their own
// .openrm/openrm.db — this is NOT a shared/centralized data store).
// Replaces collector.cjs's external read-only state.json model.
'use strict'
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

const DATA_DIR = process.env.OPENRM_DATA_DIR || path.join(__dirname, '..', '.openrm')
const DB_PATH = path.join(DATA_DIR, 'openrm.db')

fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// holds secrets (GitHub token, DB conn string, Sentry token) — file permissions
// are the whole protection story here, matching this app's existing local-only
// threat model (anyone with filesystem access already has everything).
try {
	fs.chmodSync(DB_PATH, 0o600)
} catch (_) {}

// Migrations are numbered and gated by PRAGMA user_version — append new entries,
// never edit an already-shipped one.
const MIGRATIONS = [
	// v1 — core schema
	(db) => {
		db.exec(`
			CREATE TABLE folders (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				base TEXT,
				order_idx INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);

			CREATE TABLE tasks (
				id TEXT PRIMARY KEY,
				folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
				order_idx INTEGER NOT NULL DEFAULT 0,
				name TEXT NOT NULL,
				desc TEXT NOT NULL DEFAULT '',
				kind TEXT NOT NULL DEFAULT 'single' CHECK (kind IN ('chain', 'parallel', 'single')),
				ticket TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX idx_tasks_folder ON tasks(folder_id);

			CREATE TABLE branches (
				id TEXT PRIMARY KEY,
				task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
				order_idx INTEGER NOT NULL DEFAULT 0,
				name TEXT NOT NULL,
				repo TEXT,
				forked INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX idx_branches_task ON branches(task_id);

			CREATE TABLE branch_links (
				id TEXT PRIMARY KEY,
				branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
				kind TEXT NOT NULL CHECK (kind IN ('figma', 'thread', 'doc', 'pr')),
				url TEXT NOT NULL
			);
			CREATE INDEX idx_branch_links_branch ON branch_links(branch_id);

			CREATE TABLE reviews (
				id TEXT PRIMARY KEY,
				branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
				external_id TEXT,
				who TEXT,
				at INTEGER,
				sev TEXT CHECK (sev IN ('P1', 'P2', 'P3')),
				file TEXT,
				body TEXT,
				state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'applied', 'disputed')),
				reply TEXT,
				applied_job_id TEXT
			);
			CREATE INDEX idx_reviews_branch ON reviews(branch_id);

			CREATE TABLE agent_jobs (
				id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				cwd TEXT,
				claude_session_id TEXT,
				ref_type TEXT,
				ref_id TEXT,
				input_json TEXT,
				percent INTEGER NOT NULL DEFAULT 0,
				label TEXT,
				done INTEGER NOT NULL DEFAULT 0,
				result_json TEXT,
				started_at INTEGER NOT NULL,
				done_at INTEGER
			);
			CREATE INDEX idx_agent_jobs_ref ON agent_jobs(ref_type, ref_id);

			CREATE TABLE settings (
				key TEXT PRIMARY KEY,
				value_json TEXT NOT NULL
			);

			CREATE TABLE secrets (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);

			CREATE TABLE monitor_findings (
				key TEXT PRIMARY KEY,
				data_json TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'open',
				last_seen INTEGER NOT NULL
			);

			CREATE TABLE deploys (
				branch TEXT PRIMARY KEY,
				notion_url TEXT,
				base TEXT,
				created_at INTEGER NOT NULL
			);

			CREATE TABLE architecture_cache (
				layer TEXT PRIMARY KEY,
				data_json TEXT NOT NULL,
				scanned_at INTEGER NOT NULL
			);
		`)
	},
	// v2 — Setup 페이지의 자유 형식 ".env 테이블" (사용자가 추가하는 임의 KEY=VALUE 행;
	// store/secrets.cjs의 named secret과는 별개 개념 — 앱이 런타임에 주입하는 환경변수들).
	(db) => {
		db.exec(`
			CREATE TABLE env_vars (
				id TEXT PRIMARY KEY,
				key TEXT NOT NULL,
				value TEXT NOT NULL DEFAULT '',
				secret INTEGER NOT NULL DEFAULT 0,
				order_idx INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL
			);
		`)
	},
	// v3 — 태스크별 오케스트레이션 시작 프롬프트. 비어있으면 orchestrator.cjs의 자동 생성 문구로 폴백.
	(db) => {
		db.exec(`ALTER TABLE tasks ADD COLUMN start_prompt TEXT;`)
	},
	// v4 — 멀티레포 지원. 레포 레지스트리(이름/경로/기본 브랜치/설명) + 태스크별 대상 레포.
	// repo_id가 비어있으면(레지스트리에 0~1개만 등록된 기존/단일-레포 세팅) 지금처럼 AppConfig.rootPath로 폴백.
	(db) => {
		db.exec(`
			CREATE TABLE repos (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				path TEXT NOT NULL,
				base TEXT,
				description TEXT NOT NULL DEFAULT '',
				order_idx INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL
			);
			ALTER TABLE tasks ADD COLUMN repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL;
			ALTER TABLE tasks ADD COLUMN repo_auto INTEGER NOT NULL DEFAULT 0;
		`)
	},
	// v5 — 폴더(= 사이드바 트리의 최상위 오케스트레이션 단위) 보관함. 완료된 폴더를 지우지 않고
	// 날짜별로 보존만 하는 프로토타입의 "보관함" 기능 — board()는 archived=0만 보여준다.
	(db) => {
		db.exec(`
			ALTER TABLE folders ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
			ALTER TABLE folders ADD COLUMN archived_at INTEGER;
		`)
	},
	// v6 — AI 판단 감사 로그 + 재요청 카운터 + merge 게이트. 전부 "기획: 이상적 워크플로우" 문서의
	// ②⑤⑧ 안전장치를 실제 데이터로 옮긴 것 — orchestrator.cjs의 conductor.feed는 인메모리라 서버
	// 재시작 시 소실되는데(§07), 판정 근거만큼은 재시작과 무관하게 남아야 나중에 감사가 가능하다.
	(db) => {
		db.exec(`
			CREATE TABLE decisions (
				id TEXT PRIMARY KEY,
				folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
				task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
				kind TEXT NOT NULL CHECK (kind IN ('repo_assign', 'repo_verify_hold', 'kind_judge', 'review_verdict')),
				reason TEXT NOT NULL DEFAULT '',
				meta_json TEXT,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX idx_decisions_folder ON decisions(folder_id);
			CREATE INDEX idx_decisions_task ON decisions(task_id);

			ALTER TABLE reviews ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
			ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'ai'));

			ALTER TABLE folders ADD COLUMN auto_merge INTEGER NOT NULL DEFAULT 0;
		`)
	},
	// v7 — mainTask 생성 확인 단계(§12 "AI 제안 + 사람이 자유롭게 덮어쓰기")의 "재시도 횟수(N)" 필드.
	// 재요청 에스컬레이션 사다리(prReview.cjs applyReview)가 이전엔 1/2/3회차를 하드코딩했는데,
	// 이제 이 폴더의 실제 N을 기준으로 "새 세션+모델 상향" 시점을 정한다.
	(db) => {
		db.exec(`ALTER TABLE folders ADD COLUMN retry_limit INTEGER NOT NULL DEFAULT 3;`)
	},
	// v8 — Automations(§07 열린 항목 "크론잡 생성"). 스케줄러는 OpenRM 서버 프로세스가 켜져 있는 동안만
	// 동작한다(orchestrator.cjs의 in-memory 상태·monitor.cjs의 setInterval 폴링과 같은 원칙 — 이 앱은
	// 로컬에서만 쓰는 도구라 OS 레벨 cron/launchd 연동은 하지 않음, 과한 인프라).
	(db) => {
		db.exec(`
			CREATE TABLE cron_jobs (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				schedule_type TEXT NOT NULL CHECK (schedule_type IN ('interval', 'daily', 'weekly')),
				schedule_json TEXT NOT NULL,
				action_type TEXT NOT NULL DEFAULT 'create_task' CHECK (action_type IN ('create_task')),
				action_json TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				last_run_at INTEGER,
				next_run_at INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX idx_cron_jobs_next_run ON cron_jobs(enabled, next_run_at);
		`)
	},
	// v9 — 레포는 서브태스크(tasks)가 아니라 폴더(전체 태스크) 단위로 하나만 정한다. 이전엔 서브태스크
	// 마다 독립적으로 레포를 골라서, 같은 폴더 안에서 서로 다른 레포가 섞여도 아무 표시가 없었다.
	// tasks.repo_id/repo_auto는 그대로 둔다 — inbox 단계(아직 폴더 없음)의 repoClassify.cjs 자동배정은
	// 여전히 태스크 단위로 동작해야 하므로. 폴더로 승격되는 순간 그 값을 folders.repo_id로 복사해
	// "이후로는 폴더가 정답"으로 넘긴다.
	(db) => {
		db.exec(`ALTER TABLE folders ADD COLUMN repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL;`)
	},
	// v10 — 주/월 캘린더(§ "캘린더에 일감이 관리되어야해"). 태스크에 예정일 하나를 붙여 그 날짜 칸에
	// 표시·드래그 재배치한다. 날짜만 의미가 있어(시:분 없음) 로컬 자정 epoch ms로 저장 — created_at처럼
	// 정밀 타임스탬프가 아니라 "그 날"을 가리키는 값이라 UTC 자정이 아니라 클라이언트가 계산한 로컬
	// 자정을 그대로 저장한다(서버는 그냥 통과시키는 값이라 타임존 변환을 하지 않음).
	(db) => {
		db.exec(`ALTER TABLE tasks ADD COLUMN due_date INTEGER;`)
	},
	// v11 — 레포 식별 컬러(레포 피커 드롭다운의 색 점). null이면 프론트가 repo.id를 해시해 고정
	// 팔레트에서 자동 배정하고(store/repos.cjs와 무관 — 서버는 명시적으로 고른 값만 저장), 사용자가
	// 점을 눌러 팔레트에서 고르면 그 값이 이 컬럼에 저장돼 자동 배정을 덮어쓴다.
	(db) => {
		db.exec(`ALTER TABLE repos ADD COLUMN color TEXT;`)
	},
	// v12 — 태스크 소요 기간(영업일). due_date(시작일)로부터 며칠짜리 일감인지 — 캘린더에 종료일을
	// 계산해 보여주는 데 쓴다("각 태스크는 몇일이 걸릴지... 영업일 기준"). 1이면 당일 완료(=기본과 동일),
	// null이면 기간 미지정. 종료일 자체는 저장하지 않고 프론트(utils/businessDays.ts)가 매번 계산 —
	// due_date가 나중에 바뀌어도 별도 재계산 로직 없이 항상 정합.
	(db) => {
		db.exec(`ALTER TABLE tasks ADD COLUMN duration_days INTEGER;`)
	},
	// v13 — 태스크 완료 체크("일감 완료 체크가 있으면 좋겠어. 그걸하면 그냥 완료로 보이는거야"). 완료해도
	// 레코드는 삭제하지 않는다 — 사이드바 태스크 트리에서는 걸러내 안 보이게 하지만("태스크에서는
	// 없어져도 되나"), 캘린더는 지난 일정의 기록이라 완료 여부와 무관하게 계속 보여야 한다("캘린더에는
	// 남아있어야함"). null이면 미완료, 값이 있으면 완료 처리한 시각.
	(db) => {
		db.exec(`ALTER TABLE tasks ADD COLUMN completed_at INTEGER;`)
	},
	// v14 — "검토한 일감은... 사라지면안돼. 항상 불러와야해". AI 일감 검토(durationEstimate.cjs)는
	// 예전엔 서버 메모리(jobs 맵)에만 진행률·결과를 들고 있어서, 새로고침이나 서버 재시작 한 번이면
	// 완료된 검토 결과까지 통째로 날아갔다. agent_jobs(이미 monitor.cjs가 같은 용도로 씀)에 태워
	// SQLite에 영구 저장하고, ref_type='task'/ref_id=taskId로 나중에 다시 찾는다. meta_json은 percent/
	// label처럼 done 전에도 실시간으로 갱신되는 부가 상태(토큰·비용 누적치) — result_json과 별개로 둔
	// 이유는 done=0인 동안엔 result_json이 아직 없어서다.
	(db) => {
		db.exec(`ALTER TABLE agent_jobs ADD COLUMN meta_json TEXT;`)
	},
	// v15 — 일정 막기("일정 막기 기능이 필요해. 중간에 QA기간같은게 있어서 다른걸 못할 수 있거든").
	// 태스크가 아니라 캘린더 자체의 제약(그 기간엔 새 일을 넣기 어렵다)이라 tasks 테이블과 분리한
	// 별도 테이블 — 시작~종료일(둘 다 로컬 자정 epoch ms, inclusive) 안의 모든 날짜 칸을 캘린더가
	// 줄무늬로 표시한다.
	(db) => {
		db.exec(`
			CREATE TABLE blocked_periods (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				start_date INTEGER NOT NULL,
				end_date INTEGER NOT NULL,
				created_at INTEGER NOT NULL
			);
		`)
	},
	// v16 — 태스크 커스텀 색상("레포 색상은... 뭔가 다른걸로 표시해야할것같아" — 배경은 이 색이 쓰고,
	// 레포 색은 텍스트색 등 다른 채널로 옮긴다). null이면 레포색/기본 배경 그대로.
	(db) => {
		db.exec(`ALTER TABLE tasks ADD COLUMN color TEXT;`)
	},
	// v17 — 서브태스크("태스크 하나에 개발, 개발자테스트, QA, 배포 이런식으로 나뉠 수 있거든"). 태스크
	// 설명과 별개로 서브태스크마다 자기 설명·예정일·기간을 독립적으로 가지고 캘린더에서 태스크처럼
	// 자유롭게 옮길 수 있다("서브태스크 일정은... 각각 일정이 별도"). 색은 없다 — 캘린더에서 전부 부모
	// 태스크 색 하나로 통일해서 보여주므로(§ CalendarPane) 서브태스크 자체엔 색 컬럼이 필요 없다.
	(db) => {
		db.exec(`
			CREATE TABLE subtasks (
				id TEXT PRIMARY KEY,
				task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				desc TEXT NOT NULL DEFAULT '',
				due_date INTEGER,
				duration_days INTEGER,
				order_idx INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX idx_subtasks_task ON subtasks(task_id);
		`)
	},
	// v18 — "코드작업은 무조건 서브태스크를 만들고 그 서브태스크에 워크트리를 만들어서 개발을
	// 들어가야해... 순차로... pr도 체이닝으로". 서브태스크 단위 워크트리+클로드 세션 이력을 SQLite에
	// 영구 저장한다 — "클로드 세션이나 태스크나 켜놓은 창은 컴퓨터가 꺼져도 지워지면안돼" 요청대로,
	// 실제 tmux 세션은 컴퓨터가 꺼지면 같이 죽어도 "어느 서브태스크가 어느 워크트리/브랜치까지 진행됐는지"
	// 기록은 남아 다시 이어갈 수 있다(기존 orchestrator.cjs의 폴더/지휘자 세션은 여전히 인메모리 — 이번
	// 범위 밖, 별도 후속 작업). branches.subtask_id로 브랜치도 태스크가 아니라 서브태스크에 붙을 수 있게 한다.
	(db) => {
		db.exec(`
			ALTER TABLE branches ADD COLUMN subtask_id TEXT REFERENCES subtasks(id) ON DELETE CASCADE;
			CREATE TABLE subtask_sessions (
				id TEXT PRIMARY KEY,
				subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
				task_id TEXT NOT NULL,
				tmux_session TEXT NOT NULL,
				worktree_path TEXT NOT NULL,
				branch TEXT,
				model TEXT,
				model_label TEXT,
				started_at INTEGER NOT NULL,
				ended_at INTEGER
			);
			CREATE INDEX idx_subtask_sessions_subtask ON subtask_sessions(subtask_id);
			CREATE INDEX idx_subtask_sessions_task ON subtask_sessions(task_id);
		`)
	},
	// v19 — "서브태스크도 레포를 별도로 줄 수 있어야하지만. 기본적으로는 메인태스크와 동일하게 해야해."
	// null(기본값)이면 launchSubtask가 폴더/태스크의 레포를 그대로 물려받고, 값이 있으면 그 서브태스크만
	// 다른 레포에 워크트리를 만든다.
	(db) => {
		db.exec(`ALTER TABLE subtasks ADD COLUMN repo_id TEXT REFERENCES repos(id);`)
	},
	// v20 — "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — tasks.folder_id가
	// nullable이라 폴더 없이도 "미분류" 태스크가 존재하듯, subtasks.task_id도 nullable로 풀어 메인
	// 태스크 없는 독립 서브태스크(=메모, § store/subtasks.cjs listOrphans)를 허용한다. SQLite는
	// 컬럼 제약(NOT NULL) 변경을 지원하지 않아 표준 12단계 절차대로 테이블을 다시 만든다.
	(db) => {
		db.exec(`
			CREATE TABLE subtasks_new (
				id TEXT PRIMARY KEY,
				task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				desc TEXT NOT NULL DEFAULT '',
				due_date INTEGER,
				duration_days INTEGER,
				order_idx INTEGER NOT NULL DEFAULT 0,
				repo_id TEXT REFERENCES repos(id),
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			INSERT INTO subtasks_new (id, task_id, name, desc, due_date, duration_days, order_idx, repo_id, created_at, updated_at)
				SELECT id, task_id, name, desc, due_date, duration_days, order_idx, repo_id, created_at, updated_at FROM subtasks;
			DROP TABLE subtasks;
			ALTER TABLE subtasks_new RENAME TO subtasks;
			CREATE INDEX idx_subtasks_task ON subtasks(task_id);
		`)
	},
	// v21 — "서브태스크 완료 버튼 필요". tasks.completed_at(§ v13)과 같은 패턴 — 레코드는 지우지 않고
	// completed_at만 찍는다. null이면 미완료, 값이 있으면 완료 처리한 시각. 사이드바 트리(TaskRow/
	// FolderCard의 subChain 목록)에서는 걸러내 안 보이게 하지만, 캘린더는 계속 보여준다(§ CalendarPane).
	(db) => {
		db.exec(`ALTER TABLE subtasks ADD COLUMN completed_at INTEGER;`)
	},
	// v22 — "팀 규칙"("브랜치 이름은 영문에 프리픽스가 있고, 브랜치를 만들기 전에 노션 문서를 써야
	// 해... 이건 오픈소스로 풀 앱이라 외부에서 이런 설정을 할 수 있어야해"). 브랜치 네이밍이나 사전
	// 문서 요구사항처럼 팀마다 다른 개발 관행을, 구조화된 필드가 아니라 레포당 자유 텍스트 4칸으로
	// 저장한다 — 그 텍스트가 그대로 conductorSeed/launchSubtask의 에이전트 지시문에 얹힌다(OpenTask
	// 코드는 내용을 파싱하지 않는다). 전부 비어있으면(기본값) 지금과 완전히 동일하게 동작.
	(db) => {
		db.exec(`
			ALTER TABLE repos ADD COLUMN rule_general TEXT;
			ALTER TABLE repos ADD COLUMN rule_task_writing TEXT;
			ALTER TABLE repos ADD COLUMN rule_branch TEXT;
			ALTER TABLE repos ADD COLUMN rule_predev TEXT;
		`)
	},
	// v23 — "팀규칙에 현재 태스크 규칙도 추가해줬으면 좋겠어. 이건 태스크의 유니크한 규칙이야." 위
	// 4칸(§v22)은 레포 전체에 적용되는 팀 공통 규칙이고, 이건 그중 딱 이 메인 태스크(폴더)에만 해당하는
	// 예외/특이사항 — 그래서 repos가 아니라 folders에 붙인다.
	(db) => {
		db.exec(`ALTER TABLE folders ADD COLUMN rule_task TEXT;`)
	},
	// v24 — "세션이 바뀌면 안 돼 — 강제로 꺼져도 그렇고" — 지휘자 세션 복원(§orchestrator.cjs
	// restoreConductorSession)이 folder.name으로 다시 지어낸 라벨("conductor-${folder.name}")로
	// 스냅샷을 찾았는데, 폴더 이름을 나중에 바꾸면 그 라벨이 안 맞아 복원이 조용히 실패하고 매번 새
	// 세션이 떴다(서브태스크 쪽의 같은 버그를 고치며 발견 — restoreByName으로 통일). 진짜 세션 이름을
	// 폴더에 직접 저장해두면 이름이 뭘로 바뀌든 상관없이 정확히 그 세션을 다시 찾는다.
	(db) => {
		db.exec(`ALTER TABLE folders ADD COLUMN conductor_session TEXT;`)
	},
	// v25 — "서브 태스크가 끝나면... 어떻게 끝났고 어떤것들을 했는지 정리해서 보여줬으면해. 지금은
	// 끝나도 뭐가 완료되었는지 확인하지 못해." 완료를 스스로 보고하는 서브태스크 세션 자신이 작성한
	// 완성된 HTML 리포트(다이어그램 포함 가능)를 그대로 저장 — 서버는 렌더링 없이 그대로 서빙만
	// 한다(§ orchestrator.cjs advanceSubtaskWork, server/index.cjs /api/subtask-sessions/:id/report).
	(db) => {
		db.exec(`ALTER TABLE subtask_sessions ADD COLUMN report_html TEXT;`)
	},
	// v26 — "크론잡이 너무 정형화되어있어. 어떤 크론잡이든 만들 수 있는 자유도를 주고싶어." 지금까진
	// action_type이 create_task 하나뿐이라(§v8 CHECK 제약) 크론잡이 "정해진 시각에 태스크 하나 생성"만
	// 할 수 있었다. run_instruction을 추가해 사람이 미리 써둔 자연어 지시(예: "이번 주 완료 안 된
	// 서브태스크를 다음 주로 재스케줄해줘")를 그 시각에 opentask-control MCP 툴로 그대로 실행하게
	// 한다 — "AI는 범위를 스스로 만들지 않는다"(§scheduler.cjs) 원칙은 그대로 유지: 무엇을 할지는
	// 사람이 미리 문장으로 다 정해두고, 트리거 시점의 AI는 그 문장을 실행하는 손일 뿐이다(사람이 그
	// 순간 비서에게 직접 타이핑하는 것과 동등 — 즉흥적 판단이 아니라 이미 정해진 지시의 지연 실행).
	// SQLite는 CHECK 제약을 ALTER로 못 고쳐서(§v8) 테이블을 다시 만든다. last_result는 run_instruction
	// 결과를 사람이 나중에 훑어볼 수 있게(§v25 report_html과 같은 이유 — "뭐가 됐는지 확인 못 함").
	(db) => {
		db.exec(`
			CREATE TABLE cron_jobs_new (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				schedule_type TEXT NOT NULL CHECK (schedule_type IN ('interval', 'daily', 'weekly')),
				schedule_json TEXT NOT NULL,
				action_type TEXT NOT NULL DEFAULT 'create_task' CHECK (action_type IN ('create_task', 'run_instruction')),
				action_json TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				last_run_at INTEGER,
				last_result TEXT,
				next_run_at INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			INSERT INTO cron_jobs_new (id, name, schedule_type, schedule_json, action_type, action_json, enabled, last_run_at, next_run_at, created_at, updated_at)
				SELECT id, name, schedule_type, schedule_json, action_type, action_json, enabled, last_run_at, next_run_at, created_at, updated_at FROM cron_jobs;
			DROP TABLE cron_jobs;
			ALTER TABLE cron_jobs_new RENAME TO cron_jobs;
			CREATE INDEX idx_cron_jobs_next_run ON cron_jobs(enabled, next_run_at);
		`)
	},
]

function migrate() {
	const current = db.pragma('user_version', { simple: true })
	for (let v = current; v < MIGRATIONS.length; v++) {
		const run = db.transaction(() => {
			MIGRATIONS[v](db)
			db.pragma(`user_version = ${v + 1}`)
		})
		run()
	}
}
migrate()

// Setup 페이지의 "환경변수" 테이블(env_vars, 자유 형식 KEY=VALUE)을 실제 process.env로 주입.
// db.cjs는 index.cjs의 require 체인에서 가장 먼저 로드되므로(collector.cjs→store/settings.cjs→
// 여기), ticket.cjs/worktrees.cjs 등 다른 모듈이 모듈 로드 시점에 읽는 process.env.OPENRM_* 값이
// 실제로 반영된다. 이미 쉘에서 설정된 키는 덮어쓰지 않음(쉘 설정이 항상 우선).
try {
	for (const row of db.prepare('SELECT key, value FROM env_vars').all()) {
		if (row.key && !(row.key in process.env)) process.env[row.key] = row.value
	}
} catch (_) {}

function tx(fn) {
	return db.transaction(fn)
}

module.exports = { db, tx, DB_PATH }
