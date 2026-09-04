// branches.rs — app/server/store/branches.cjs 이식.
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

const SELECT_COLS: &str = "id, task_id, order_idx, name, repo, forked, subtask_id";

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"task_id": row.get::<_, String>(1)?,
		"order_idx": row.get::<_, i64>(2)?,
		"name": row.get::<_, String>(3)?,
		"repo": row.get::<_, Option<String>>(4)?,
		"forked": row.get::<_, i64>(5)?,
		"subtask_id": row.get::<_, Option<String>>(6)?,
	}))
}

pub fn list_by_task(pool: &Pool, task_id: &str) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM branches WHERE task_id = ?1 ORDER BY order_idx ASC"))?;
	let rows: Vec<Value> = stmt.query_map(params![task_id], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

#[allow(dead_code)]
pub fn list_by_subtask(pool: &Pool, subtask_id: &str) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM branches WHERE subtask_id = ?1 ORDER BY order_idx ASC"))?;
	let rows: Vec<Value> = stmt.query_map(params![subtask_id], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM branches WHERE id = ?1"), params![id], row_to_json).optional()?)
}

#[allow(dead_code)]
pub fn create(pool: &Pool, input: &Value) -> anyhow::Result<Value> {
	let task_id = input.get("taskId").and_then(Value::as_str).unwrap_or_default().to_string();
	let subtask_id = input.get("subtaskId").and_then(Value::as_str).map(str::to_string);
	let name = input.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
	let repo = input.get("repo").and_then(Value::as_str).map(str::to_string);
	let forked = input.get("forked").and_then(Value::as_bool).unwrap_or(false) as i64;

	let id = Uuid::new_v4().to_string();
	let conn = pool.get()?;
	let max_order: i64 = conn.query_row("SELECT COALESCE(MAX(order_idx), -1) FROM branches WHERE task_id = ?1", params![task_id], |r| r.get(0))?;
	conn.execute(
		"INSERT INTO branches (id, task_id, subtask_id, order_idx, name, repo, forked) VALUES (?1,?2,?3,?4,?5,?6,?7)",
		params![id, task_id, subtask_id, max_order + 1, name, repo, forked],
	)?;
	drop(conn);
	Ok(get(pool, &id)?.unwrap_or(Value::Null))
}

#[allow(dead_code)]
pub fn update(pool: &Pool, id: &str, patch: &Value) -> anyhow::Result<Option<Value>> {
	let cur = match get(pool, id)? {
		Some(v) => v,
		None => return Ok(None),
	};
	let name = patch.get("name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cur["name"].as_str().unwrap_or_default().to_string());
	let repo = if patch.get("repo").is_some() { patch["repo"].as_str().map(str::to_string) } else { cur["repo"].as_str().map(str::to_string) };
	let order_idx = patch.get("order").and_then(Value::as_i64).unwrap_or_else(|| cur["order_idx"].as_i64().unwrap_or(0));
	let forked = if patch.get("forked").is_some() { patch["forked"].as_bool().unwrap_or(false) as i64 } else { cur["forked"].as_i64().unwrap_or(0) };

	let conn = pool.get()?;
	conn.execute("UPDATE branches SET name=?1, repo=?2, order_idx=?3, forked=?4 WHERE id=?5", params![name, repo, order_idx, forked, id])?;
	drop(conn);
	get(pool, id)
}

#[allow(dead_code)]
pub fn remove(pool: &Pool, id: &str) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM branches WHERE id = ?1", params![id])?;
	Ok(json!({"ok": true}))
}

#[allow(dead_code)]
pub fn link_to_subtask(pool: &Pool, id: &str, subtask_id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	conn.execute("UPDATE branches SET subtask_id = ?1 WHERE id = ?2", params![subtask_id, id])?;
	drop(conn);
	get(pool, id)
}

pub fn links(pool: &Pool, branch_id: &str) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare("SELECT id, branch_id, kind, url FROM branch_links WHERE branch_id = ?1")?;
	let rows: Vec<Value> = stmt
		.query_map(params![branch_id], |row| {
			Ok(json!({
				"id": row.get::<_, String>(0)?,
				"branch_id": row.get::<_, String>(1)?,
				"kind": row.get::<_, String>(2)?,
				"url": row.get::<_, String>(3)?,
			}))
		})?
		.filter_map(Result::ok)
		.collect();
	Ok(rows)
}

#[allow(dead_code)]
pub fn add_link(pool: &Pool, branch_id: &str, kind: &str, url: &str) -> anyhow::Result<Value> {
	let id = Uuid::new_v4().to_string();
	let conn = pool.get()?;
	conn.execute("INSERT INTO branch_links (id, branch_id, kind, url) VALUES (?1,?2,?3,?4)", params![id, branch_id, kind, url])?;
	Ok(json!({"id": id, "branch_id": branch_id, "kind": kind, "url": url}))
}

#[allow(dead_code)]
pub fn remove_link(pool: &Pool, link_id: &str) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM branch_links WHERE id = ?1", params![link_id])?;
	Ok(json!({"ok": true}))
}
