// subtasks.rs — app/server/store/subtasks.cjs 이식.
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

const SELECT_COLS: &str = "id, task_id, name, desc, due_date, duration_days, order_idx, repo_id, created_at, updated_at, completed_at";

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"task_id": row.get::<_, Option<String>>(1)?,
		"name": row.get::<_, String>(2)?,
		"desc": row.get::<_, String>(3)?,
		"due_date": row.get::<_, Option<i64>>(4)?,
		"duration_days": row.get::<_, Option<i64>>(5)?,
		"order_idx": row.get::<_, i64>(6)?,
		"repo_id": row.get::<_, Option<String>>(7)?,
		"created_at": row.get::<_, i64>(8)?,
		"updated_at": row.get::<_, i64>(9)?,
		"completed_at": row.get::<_, Option<i64>>(10)?,
	}))
}

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM subtasks WHERE id = ?1"), params![id], row_to_json).optional()?)
}

pub fn list_by_task(pool: &Pool, task_id: &str) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM subtasks WHERE task_id = ?1 ORDER BY order_idx ASC, created_at ASC"))?;
	let rows: Vec<Value> = stmt.query_map(params![task_id], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

pub fn list_orphans(pool: &Pool) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM subtasks WHERE task_id IS NULL ORDER BY order_idx ASC, created_at ASC"))?;
	let rows: Vec<Value> = stmt.query_map([], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

fn opt_str(v: &Value, key: &str) -> Option<String> {
	v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

pub fn create(pool: &Pool, input: &Value) -> anyhow::Result<Value> {
	let task_id = opt_str(input, "taskId");
	let name = opt_str(input, "name").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| if task_id.is_some() { "서브태스크".to_string() } else { "메모".to_string() });
	let desc = opt_str(input, "desc").unwrap_or_default();
	let due_date = input.get("dueDate").and_then(Value::as_i64);
	let duration_days = input.get("durationDays").and_then(Value::as_i64);

	let id = Uuid::new_v4().to_string();
	let now = chrono::Utc::now().timestamp_millis();
	let conn = pool.get()?;
	let max_order: i64 = match &task_id {
		Some(tid) => conn.query_row("SELECT COALESCE(MAX(order_idx), -1) FROM subtasks WHERE task_id = ?1", params![tid], |r| r.get(0))?,
		None => conn.query_row("SELECT COALESCE(MAX(order_idx), -1) FROM subtasks WHERE task_id IS NULL", [], |r| r.get(0))?,
	};
	conn.execute(
		"INSERT INTO subtasks (id, task_id, name, desc, due_date, duration_days, order_idx, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
		params![id, task_id, name, desc, due_date, duration_days, max_order + 1, now, now],
	)?;
	drop(conn);
	Ok(get(pool, &id)?.unwrap_or(Value::Null))
}

pub fn update(pool: &Pool, id: &str, patch: &Value) -> anyhow::Result<Option<Value>> {
	let cur = match get(pool, id)? {
		Some(v) => v,
		None => return Ok(None),
	};
	let name = patch.get("name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cur["name"].as_str().unwrap_or_default().to_string());
	let desc = patch.get("desc").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cur["desc"].as_str().unwrap_or_default().to_string());
	let due_date = if patch.get("dueDate").is_some() { patch["dueDate"].as_i64() } else { cur["due_date"].as_i64() };
	let duration_days = if patch.get("durationDays").is_some() { patch["durationDays"].as_i64() } else { cur["duration_days"].as_i64() };
	let repo_id = if patch.get("repoId").is_some() { opt_str(patch, "repoId") } else { cur["repo_id"].as_str().map(str::to_string) };
	let completed_at = if patch.get("completedAt").is_some() { patch["completedAt"].as_i64() } else { cur["completed_at"].as_i64() };

	let conn = pool.get()?;
	conn.execute(
		"UPDATE subtasks SET name=?1, desc=?2, due_date=?3, duration_days=?4, repo_id=?5, completed_at=?6, updated_at=?7 WHERE id=?8",
		params![name, desc, due_date, duration_days, repo_id, completed_at, chrono::Utc::now().timestamp_millis(), id],
	)?;
	drop(conn);
	get(pool, id)
}

pub fn remove(pool: &Pool, id: &str) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM subtasks WHERE id = ?1", params![id])?;
	Ok(json!({"ok": true}))
}

pub fn reorder(pool: &Pool, task_id: Option<&str>, ids: &[String]) -> anyhow::Result<Vec<Value>> {
	let now = chrono::Utc::now().timestamp_millis();
	let mut conn = pool.get()?;
	let tx = conn.transaction()?;
	for (i, id) in ids.iter().enumerate() {
		match task_id {
			Some(tid) => tx.execute("UPDATE subtasks SET order_idx=?1, updated_at=?2 WHERE id=?3 AND task_id=?4", params![i as i64, now, id, tid])?,
			None => tx.execute("UPDATE subtasks SET order_idx=?1, updated_at=?2 WHERE id=?3 AND task_id IS NULL", params![i as i64, now, id])?,
		};
	}
	tx.commit()?;
	drop(conn);
	match task_id {
		Some(tid) => list_by_task(pool, tid),
		None => list_orphans(pool),
	}
}
