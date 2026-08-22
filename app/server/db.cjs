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
