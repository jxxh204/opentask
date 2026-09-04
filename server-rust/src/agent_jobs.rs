// agent_jobs.rs — app/server/store/agentJobs.cjs 이식. tasks::compose_task(latestReview)가 쓰는
// 읽기 전용 조회에 더해, link_brief.rs(헤드리스 claude 작업 실행기) 같은 쓰기 경로도 이제 포팅됨.
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	let input_json: Option<String> = row.get(6)?;
	let result_json: Option<String> = row.get(10)?;
	let meta_json: Option<String> = row.get(13)?;
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"kind": row.get::<_, String>(1)?,
		"cwd": row.get::<_, Option<String>>(2)?,
		"claude_session_id": row.get::<_, Option<String>>(3)?,
		"ref_type": row.get::<_, Option<String>>(4)?,
		"ref_id": row.get::<_, Option<String>>(5)?,
		"input": input_json.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
		"percent": row.get::<_, i64>(7)?,
		"label": row.get::<_, Option<String>>(8)?,
		"done": row.get::<_, i64>(9)? != 0,
		"result": result_json.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
		"started_at": row.get::<_, i64>(11)?,
		"done_at": row.get::<_, Option<i64>>(12)?,
		"meta": meta_json.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
	}))
}
const SELECT_COLS: &str = "id, kind, cwd, claude_session_id, ref_type, ref_id, input_json, percent, label, done, result_json, started_at, done_at, meta_json";

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM agent_jobs WHERE id = ?1"), params![id], row_to_json).optional()?)
}

pub struct CreateInput<'a> {
	pub kind: &'a str,
	pub ref_type: Option<&'a str>,
	pub ref_id: Option<&'a str>,
	pub input: Option<&'a Value>,
	pub label: Option<&'a str>,
}

pub fn create(pool: &Pool, input: CreateInput) -> anyhow::Result<Value> {
	let id = Uuid::new_v4().to_string();
	let conn = pool.get()?;
	conn.execute(
		"INSERT INTO agent_jobs (id, kind, ref_type, ref_id, input_json, percent, label, done, started_at) VALUES (?1,?2,?3,?4,?5,0,?6,0,?7)",
		params![id, input.kind, input.ref_type, input.ref_id, input.input.map(|v| v.to_string()), input.label, chrono::Utc::now().timestamp_millis()],
	)?;
	drop(conn);
	Ok(get(pool, &id)?.unwrap_or(Value::Null))
}

pub fn mark_done(pool: &Pool, id: &str, result: &Value) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("UPDATE agent_jobs SET done = 1, done_at = ?1, percent = 100, result_json = ?2 WHERE id = ?3", params![chrono::Utc::now().timestamp_millis(), result.to_string(), id])?;
	drop(conn);
	Ok(get(pool, id)?.unwrap_or(Value::Null))
}

pub fn latest_done(pool: &Pool, kind: &str, ref_type: &str, ref_id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	let row = conn
		.query_row(
			"SELECT id, result_json, done_at FROM agent_jobs WHERE kind = ?1 AND ref_type = ?2 AND ref_id = ?3 AND done = 1 ORDER BY done_at DESC LIMIT 1",
			params![kind, ref_type, ref_id],
			|r| {
				let id: String = r.get(0)?;
				let result_json: Option<String> = r.get(1)?;
				let done_at: Option<i64> = r.get(2)?;
				Ok((id, result_json, done_at))
			},
		)
		.optional()?;
	Ok(row.map(|(id, result_json, done_at)| {
		let result: Value = result_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
		json!({"id": id, "result": result, "done_at": done_at})
	}))
}
