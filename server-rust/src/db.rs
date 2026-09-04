// db.rs — app/server/db.cjs(better-sqlite3, v1~v28 마이그레이션)의 최종 스키마를 그대로 재현.
// 새 DB를 여는 것이므로 마이그레이션을 단계별로 재생하지 않고 최종 형태를 한 번에 만든다(§CREATE TABLE
// IF NOT EXISTS — 여러 번 불러도 안전). Node가 만든 기존 .openrm/openrm.db(실사용자 데이터)를 절대
// 직접 열지 않는다 — 이 서버는 항상 별도 OPENRM_DATA_DIR을 쓴다(§ main.rs).
use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;

pub type Pool = r2d2::Pool<SqliteConnectionManager>;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS folders (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	base TEXT,
	order_idx INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	archived INTEGER NOT NULL DEFAULT 0,
	archived_at INTEGER,
	auto_merge INTEGER NOT NULL DEFAULT 0,
	retry_limit INTEGER NOT NULL DEFAULT 3,
	repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
	rule_task TEXT,
	conductor_session TEXT,
	hidden INTEGER NOT NULL DEFAULT 0,
	hidden_at INTEGER
);

CREATE TABLE IF NOT EXISTS repos (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	path TEXT NOT NULL,
	base TEXT,
	description TEXT NOT NULL DEFAULT '',
	order_idx INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	color TEXT,
	rule_general TEXT,
	rule_task_writing TEXT,
	rule_branch TEXT,
	rule_predev TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
	id TEXT PRIMARY KEY,
	folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
	order_idx INTEGER NOT NULL DEFAULT 0,
	name TEXT NOT NULL,
	desc TEXT NOT NULL DEFAULT '',
	kind TEXT NOT NULL DEFAULT 'single' CHECK (kind IN ('chain', 'parallel', 'single')),
	ticket TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	start_prompt TEXT,
	repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
	repo_auto INTEGER NOT NULL DEFAULT 0,
	due_date INTEGER,
	duration_days INTEGER,
	completed_at INTEGER,
	color TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_folder ON tasks(folder_id);

CREATE TABLE IF NOT EXISTS subtasks (
	id TEXT PRIMARY KEY,
	task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	desc TEXT NOT NULL DEFAULT '',
	due_date INTEGER,
	duration_days INTEGER,
	order_idx INTEGER NOT NULL DEFAULT 0,
	repo_id TEXT REFERENCES repos(id),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

CREATE TABLE IF NOT EXISTS branches (
	id TEXT PRIMARY KEY,
	task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
	order_idx INTEGER NOT NULL DEFAULT 0,
	name TEXT NOT NULL,
	repo TEXT,
	forked INTEGER NOT NULL DEFAULT 0,
	subtask_id TEXT REFERENCES subtasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_branches_task ON branches(task_id);

CREATE TABLE IF NOT EXISTS branch_links (
	id TEXT PRIMARY KEY,
	branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('figma', 'thread', 'doc', 'pr')),
	url TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branch_links_branch ON branch_links(branch_id);

CREATE TABLE IF NOT EXISTS reviews (
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
	applied_job_id TEXT,
	attempts INTEGER NOT NULL DEFAULT 0,
	source TEXT NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'ai'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_branch ON reviews(branch_id);

CREATE TABLE IF NOT EXISTS agent_jobs (
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
	done_at INTEGER,
	meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_ref ON agent_jobs(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_findings (
	key TEXT PRIMARY KEY,
	data_json TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'open',
	last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deploys (
	branch TEXT PRIMARY KEY,
	notion_url TEXT,
	base TEXT,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS architecture_cache (
	layer TEXT PRIMARY KEY,
	data_json TEXT NOT NULL,
	scanned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS env_vars (
	id TEXT PRIMARY KEY,
	key TEXT NOT NULL,
	value TEXT NOT NULL DEFAULT '',
	secret INTEGER NOT NULL DEFAULT 0,
	order_idx INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
	id TEXT PRIMARY KEY,
	folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
	task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('repo_assign', 'repo_verify_hold', 'kind_judge', 'review_verdict')),
	reason TEXT NOT NULL DEFAULT '',
	meta_json TEXT,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_folder ON decisions(folder_id);
CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(task_id);

CREATE TABLE IF NOT EXISTS cron_jobs (
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
CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS blocked_periods (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	start_date INTEGER NOT NULL,
	end_date INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subtask_sessions (
	id TEXT PRIMARY KEY,
	subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
	task_id TEXT NOT NULL,
	tmux_session TEXT NOT NULL,
	worktree_path TEXT NOT NULL,
	branch TEXT,
	model TEXT,
	model_label TEXT,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	report_html TEXT
);
CREATE INDEX IF NOT EXISTS idx_subtask_sessions_subtask ON subtask_sessions(subtask_id);
CREATE INDEX IF NOT EXISTS idx_subtask_sessions_task ON subtask_sessions(task_id);

CREATE TABLE IF NOT EXISTS link_briefs (
	id TEXT PRIMARY KEY,
	owner_type TEXT NOT NULL CHECK (owner_type IN ('task', 'subtask')),
	owner_id TEXT NOT NULL,
	url TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('figma', 'doc')),
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
	data_json TEXT,
	error TEXT,
	job_id TEXT,
	generated_at INTEGER,
	updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_link_briefs_owner_url ON link_briefs(owner_type, owner_id, url);

CREATE TABLE IF NOT EXISTS code_briefs (
	id TEXT PRIMARY KEY,
	subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
	stage TEXT NOT NULL CHECK (stage IN ('pre', 'post')),
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
	data_json TEXT,
	error TEXT,
	job_id TEXT,
	generated_at INTEGER,
	updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_code_briefs_subtask_stage ON code_briefs(subtask_id, stage);
"#;

pub fn open(data_dir: &Path) -> anyhow::Result<Pool> {
	std::fs::create_dir_all(data_dir)?;
	let db_path = data_dir.join("openrm.db");
	// busy_timeout 없이 풀에서 여러 커넥션을 동시에 열면(특히 부팅 직후 WAL 전환 순간) "database is
	// locked"이 즉시 에러로 튄다 — SQLite는 락이 걸려도 짧게 재시도하면 대개 풀리므로, 즉시 실패 대신
	// 5초까지 재시도하게 한다(실측: 이 설정 없이 기동할 때마다 100% 재현됨).
	let manager = SqliteConnectionManager::file(&db_path).with_init(|conn| {
		conn.busy_timeout(std::time::Duration::from_secs(5))?;
		conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
		Ok(())
	});
	// min_idle(0) — 기본값은 풀 생성 시 여러 커넥션을 동시에 미리 열어두는데, 갓 만들어진 파일이
	// WAL로 전환되는 그 순간에 여러 커넥션이 동시에 파일을 건드리면 위 busy_timeout이 아직 적용되기
	// 전에 "database is locked"가 난다(실측). 커넥션을 필요할 때 하나씩 열게 하면 이 경합 자체가 없다.
	let pool = r2d2::Pool::builder().min_idle(Some(0)).build(manager)?;
	{
		let conn = pool.get()?;
		conn.execute_batch(SCHEMA_SQL)?;
		conn.pragma_update(None, "user_version", 28)?;
	}
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		if let Ok(meta) = std::fs::metadata(&db_path) {
			let mut perms = meta.permissions();
			perms.set_mode(0o600);
			let _ = std::fs::set_permissions(&db_path, perms);
		}
	}
	Ok(pool)
}
