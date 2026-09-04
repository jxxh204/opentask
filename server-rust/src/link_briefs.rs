// link_briefs.rs — app/server/store/linkBriefs.cjs 이식. 태스크/서브태스크 설명에 박힌 노션·피그마
// 링크마다 헤드리스 claude+MCP로 뽑아낸 핵심 요약을 owner_type+owner_id+url로 캐싱(§ link_brief.rs가 실제 생성).
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	let data_json: Option<String> = row.get(6)?;
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"owner_type": row.get::<_, String>(1)?,
		"owner_id": row.get::<_, String>(2)?,
		"url": row.get::<_, String>(3)?,
		"kind": row.get::<_, String>(4)?,
		"status": row.get::<_, String>(5)?,
		"data": data_json.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
		"error": row.get::<_, Option<String>>(7)?,
		"job_id": row.get::<_, Option<String>>(8)?,
		"generated_at": row.get::<_, Option<i64>>(9)?,
		"updated_at": row.get::<_, i64>(10)?,
	}))
}
const SELECT_COLS: &str = "id, owner_type, owner_id, url, kind, status, data_json, error, job_id, generated_at, updated_at";

pub fn get(pool: &Pool, owner_type: &str, owner_id: &str, url: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn
		.query_row(&format!("SELECT {SELECT_COLS} FROM link_briefs WHERE owner_type = ?1 AND owner_id = ?2 AND url = ?3"), params![owner_type, owner_id, url], row_to_json)
		.optional()?)
}

pub fn list_by_owner(pool: &Pool, owner_type: &str, owner_id: &str) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM link_briefs WHERE owner_type = ?1 AND owner_id = ?2"))?;
	let rows: Vec<Value> = stmt.query_map(params![owner_type, owner_id], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

pub fn upsert_pending(pool: &Pool, owner_type: &str, owner_id: &str, url: &str, kind: &str, job_id: &str) -> anyhow::Result<Option<Value>> {
	let existing = get(pool, owner_type, owner_id, url)?;
	let now = chrono::Utc::now().timestamp_millis();
	let conn = pool.get()?;
	if let Some(existing) = &existing {
		let id = existing["id"].as_str().unwrap_or_default();
		conn.execute("UPDATE link_briefs SET status = 'pending', kind = ?1, job_id = ?2, error = NULL, updated_at = ?3 WHERE id = ?4", params![kind, job_id, now, id])?;
	} else {
		conn.execute(
			"INSERT INTO link_briefs (id, owner_type, owner_id, url, kind, status, job_id, updated_at) VALUES (?1,?2,?3,?4,?5,'pending',?6,?7)",
			params![Uuid::new_v4().to_string(), owner_type, owner_id, url, kind, job_id, now],
		)?;
	}
	drop(conn);
	get(pool, owner_type, owner_id, url)
}

pub fn mark_ok(pool: &Pool, owner_type: &str, owner_id: &str, url: &str, data: &Value) -> anyhow::Result<()> {
	let now = chrono::Utc::now().timestamp_millis();
	let conn = pool.get()?;
	conn.execute(
		"UPDATE link_briefs SET status = 'ok', data_json = ?1, error = NULL, generated_at = ?2, updated_at = ?3 WHERE owner_type = ?4 AND owner_id = ?5 AND url = ?6",
		params![data.to_string(), now, now, owner_type, owner_id, url],
	)?;
	Ok(())
}

pub fn mark_error(pool: &Pool, owner_type: &str, owner_id: &str, url: &str, error: &str) -> anyhow::Result<()> {
	let now = chrono::Utc::now().timestamp_millis();
	let truncated: String = error.chars().take(300).collect();
	let conn = pool.get()?;
	conn.execute("UPDATE link_briefs SET status = 'error', error = ?1, updated_at = ?2 WHERE owner_type = ?3 AND owner_id = ?4 AND url = ?5", params![truncated, now, owner_type, owner_id, url])?;
	Ok(())
}
