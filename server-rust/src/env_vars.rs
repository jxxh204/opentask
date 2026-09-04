// env_vars.rs — app/server/store/envVars.cjs 이식 (Setup 페이지 "/api/setup/env").
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"key": row.get::<_, String>(1)?,
		"value": row.get::<_, String>(2)?,
		"secret": row.get::<_, i64>(3)?,
		"order_idx": row.get::<_, i64>(4)?,
		"created_at": row.get::<_, i64>(5)?,
	}))
}

const SELECT_COLS: &str = "id, key, value, secret, order_idx, created_at";

pub fn list(pool: &Pool) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM env_vars ORDER BY order_idx ASC, created_at ASC"))?;
	let rows: Vec<Value> = stmt.query_map([], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM env_vars WHERE id = ?1"), params![id], row_to_json).optional()?)
}

pub fn create(pool: &Pool, input: &Value) -> anyhow::Result<Value> {
	let key = input.get("key").and_then(Value::as_str).unwrap_or_default().to_string();
	let value = input.get("value").and_then(Value::as_str).unwrap_or_default().to_string();
	let secret = input.get("secret").and_then(Value::as_bool).unwrap_or(false) as i64;
	let id = Uuid::new_v4().to_string();
	let conn = pool.get()?;
	let max_order: i64 = conn.query_row("SELECT COALESCE(MAX(order_idx), -1) FROM env_vars", [], |r| r.get(0))?;
	conn.execute(
		"INSERT INTO env_vars (id, key, value, secret, order_idx, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
		params![id, key, value, secret, max_order + 1, chrono::Utc::now().timestamp_millis()],
	)?;
	drop(conn);
	Ok(get(pool, &id)?.unwrap_or(Value::Null))
}

pub fn update(pool: &Pool, id: &str, patch: &Value) -> anyhow::Result<Option<Value>> {
	let cur = match get(pool, id)? {
		Some(v) => v,
		None => return Ok(None),
	};
	let key = patch.get("key").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cur["key"].as_str().unwrap_or_default().to_string());
	let value = patch.get("value").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cur["value"].as_str().unwrap_or_default().to_string());
	let secret = if patch.get("secret").is_some() { patch["secret"].as_bool().unwrap_or(false) as i64 } else { cur["secret"].as_i64().unwrap_or(0) };
	let order_idx = patch.get("order").and_then(Value::as_i64).unwrap_or_else(|| cur["order_idx"].as_i64().unwrap_or(0));

	let conn = pool.get()?;
	conn.execute("UPDATE env_vars SET key=?1, value=?2, secret=?3, order_idx=?4 WHERE id=?5", params![key, value, secret, order_idx, id])?;
	drop(conn);
	get(pool, id)
}

pub fn remove(pool: &Pool, id: &str) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM env_vars WHERE id = ?1", params![id])?;
	Ok(json!({"ok": true}))
}
