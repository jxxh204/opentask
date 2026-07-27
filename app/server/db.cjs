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

function tx(fn) {
	return db.transaction(fn)
}

module.exports = { db, tx, DB_PATH }
