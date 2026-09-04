// decisions.rs — app/server/store/decisions.cjs 이식. record()는 아직 그걸 부를 오케스트레이터가
// 없어 라우트 미연결(§ 코드 존재, 사용처는 나중).
use crate::db::Pool;
use rusqlite::params;
use serde_json::{json, Value};
#[allow(unused_imports)]
use uuid::Uuid;

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	let meta_json: Option<String> = row.get(5)?;
	let meta: Value = meta_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"folder_id": row.get::<_, Option<String>>(1)?,
		"task_id": row.get::<_, Option<String>>(2)?,
		"kind": row.get::<_, String>(3)?,
		"reason": row.get::<_, String>(4)?,
		"meta_json": row.get::<_, Option<String>>(5)?,
		"meta": meta,
		"created_at": row.get::<_, i64>(6)?,
	}))
}

const SELECT_COLS: &str = "id, folder_id, task_id, kind, reason, meta_json, created_at";

#[allow(dead_code)]
pub fn record(pool: &Pool, folder_id: Option<&str>, task_id: Option<&str>, kind: &str, reason: &str, meta: Option<&Value>) -> anyhow::Result<Value> {
	let id = Uuid::new_v4().to_string();
	let conn = pool.get()?;
	conn.execute(
		"INSERT INTO decisions (id, folder_id, task_id, kind, reason, meta_json, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
		params![id, folder_id, task_id, kind, reason, meta.map(|m| m.to_string()), chrono::Utc::now().timestamp_millis()],
	)?;
	drop(conn);
	Ok(conn_get(pool, &id)?.unwrap_or(Value::Null))
}

fn conn_get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	use rusqlite::OptionalExtension;
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM decisions WHERE id = ?1"), params![id], row_to_json).optional()?)
}

pub fn list_by_folder(pool: &Pool, folder_id: &str, limit: i64) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM decisions WHERE folder_id = ?1 ORDER BY created_at DESC LIMIT ?2"))?;
	let rows: Vec<Value> = stmt.query_map(params![folder_id, limit], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

#[allow(dead_code)]
pub fn list_by_task(pool: &Pool, task_id: &str, limit: i64) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM decisions WHERE task_id = ?1 ORDER BY created_at DESC LIMIT ?2"))?;
	let rows: Vec<Value> = stmt.query_map(params![task_id, limit], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}
