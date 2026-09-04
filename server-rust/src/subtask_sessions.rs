// subtask_sessions.rs — app/server/store/subtaskSessions.cjs 이식. 서브태스크 단위 워크트리+세션
// 이력(SQLite 영구 저장 — orchestrator.cjs의 폴더/지휘자 세션과 달리 서버 재시작에도 안 사라짐).
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

const SELECT_COLS: &str = "id, subtask_id, task_id, tmux_session, worktree_path, branch, model, model_label, started_at, ended_at, report_html";

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"subtask_id": row.get::<_, String>(1)?,
		"task_id": row.get::<_, String>(2)?,
		"tmux_session": row.get::<_, String>(3)?,
		"worktree_path": row.get::<_, String>(4)?,
		"branch": row.get::<_, Option<String>>(5)?,
		"model": row.get::<_, Option<String>>(6)?,
		"model_label": row.get::<_, Option<String>>(7)?,
		"started_at": row.get::<_, i64>(8)?,
		"ended_at": row.get::<_, Option<i64>>(9)?,
		"report_html": row.get::<_, Option<String>>(10)?,
	}))
}

pub fn list_by_subtask(pool: &Pool, subtask_id: &str) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM subtask_sessions WHERE subtask_id = ?1 ORDER BY started_at ASC"))?;
	let rows: Vec<Value> = stmt.query_map(params![subtask_id], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

#[allow(dead_code)]
pub fn list_by_task(pool: &Pool, task_id: &str) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM subtask_sessions WHERE task_id = ?1 ORDER BY started_at ASC"))?;
	let rows: Vec<Value> = stmt.query_map(params![task_id], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

#[allow(dead_code)]
pub fn latest_for_subtask(pool: &Pool, subtask_id: &str) -> anyhow::Result<Option<Value>> {
	Ok(list_by_subtask(pool, subtask_id)?.into_iter().last())
}

/// "활성"은 항상 가장 최근 시도 하나만 기준으로 판정 — 그보다 오래된 고아 행(ended_at 못 찍힘)이
/// 있어도 최신 시도가 끝났으면 비활성으로 본다(§원본 주석, checkStalledSubtasks 오탐 방지).
pub fn get_active_for_subtask(pool: &Pool, subtask_id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	let row = conn
		.query_row(&format!("SELECT {SELECT_COLS} FROM subtask_sessions WHERE subtask_id = ?1 ORDER BY started_at DESC LIMIT 1"), params![subtask_id], row_to_json)
		.optional()?;
	Ok(row.filter(|r| r["ended_at"].is_null()))
}

pub struct CreateInput {
	pub subtask_id: String,
	pub task_id: String,
	pub tmux_session: String,
	pub worktree_path: String,
	pub branch: Option<String>,
	pub model: Option<String>,
	pub model_label: Option<String>,
}

pub fn create(pool: &Pool, input: CreateInput) -> anyhow::Result<Value> {
	let id = Uuid::new_v4().to_string();
	let conn = pool.get()?;
	conn.execute(
		"INSERT INTO subtask_sessions (id, subtask_id, task_id, tmux_session, worktree_path, branch, model, model_label, started_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
		params![id, input.subtask_id, input.task_id, input.tmux_session, input.worktree_path, input.branch, input.model, input.model_label, chrono::Utc::now().timestamp_millis()],
	)?;
	drop(conn);
	Ok(get_by_id(pool, &id)?.unwrap_or(Value::Null))
}

pub fn mark_ended(pool: &Pool, id: &str, report_html: Option<&str>) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("UPDATE subtask_sessions SET ended_at = ?1, report_html = COALESCE(?2, report_html) WHERE id = ?3", params![chrono::Utc::now().timestamp_millis(), report_html, id])?;
	Ok(json!({"ok": true}))
}

pub fn get_by_id(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM subtask_sessions WHERE id = ?1"), params![id], row_to_json).optional()?)
}
