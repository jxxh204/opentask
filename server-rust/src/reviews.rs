// reviews.rs — app/server/store/reviews.cjs 이식.
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

const SELECT_COLS: &str = "id, branch_id, external_id, who, at, sev, file, body, state, reply, applied_job_id, attempts, source";

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"branch_id": row.get::<_, String>(1)?,
		"external_id": row.get::<_, Option<String>>(2)?,
		"who": row.get::<_, Option<String>>(3)?,
		"at": row.get::<_, Option<i64>>(4)?,
		"sev": row.get::<_, Option<String>>(5)?,
		"file": row.get::<_, Option<String>>(6)?,
		"body": row.get::<_, Option<String>>(7)?,
		"state": row.get::<_, String>(8)?,
		"reply": row.get::<_, Option<String>>(9)?,
		"applied_job_id": row.get::<_, Option<String>>(10)?,
		"attempts": row.get::<_, i64>(11)?,
		"source": row.get::<_, String>(12)?,
	}))
}

pub fn list_by_branch(pool: &Pool, branch_id: &str) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM reviews WHERE branch_id = ?1 ORDER BY at DESC"))?;
	let rows: Vec<Value> = stmt.query_map(params![branch_id], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM reviews WHERE id = ?1"), params![id], row_to_json).optional()?)
}

#[allow(dead_code)]
pub fn upsert_from_external(pool: &Pool, branch_id: &str, external_id: &str, who: Option<&str>, at: Option<i64>, sev: Option<&str>, file: Option<&str>, body: Option<&str>) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	let existing = conn
		.query_row(&format!("SELECT {SELECT_COLS} FROM reviews WHERE branch_id = ?1 AND external_id = ?2"), params![branch_id, external_id], row_to_json)
		.optional()?;
	if let Some(v) = existing {
		return Ok(v);
	}
	let id = Uuid::new_v4().to_string();
	conn.execute(
		"INSERT INTO reviews (id, branch_id, external_id, who, at, sev, file, body, state) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'open')",
		params![id, branch_id, external_id, who, at, sev, file, body],
	)?;
	drop(conn);
	Ok(get(pool, &id)?.unwrap_or(Value::Null))
}

#[allow(dead_code)]
pub fn apply(pool: &Pool, id: &str, job_id: Option<&str>) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	conn.execute("UPDATE reviews SET state = 'applied', applied_job_id = ?1 WHERE id = ?2", params![job_id, id])?;
	drop(conn);
	get(pool, id)
}

#[allow(dead_code)]
pub fn set_source(pool: &Pool, id: &str, source: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	conn.execute("UPDATE reviews SET source = ?1 WHERE id = ?2", params![source, id])?;
	drop(conn);
	get(pool, id)
}

#[allow(dead_code)]
pub fn bump_attempts(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	conn.execute("UPDATE reviews SET attempts = attempts + 1, state = 'open' WHERE id = ?1", params![id])?;
	drop(conn);
	get(pool, id)
}

#[allow(dead_code)]
pub fn dispute(pool: &Pool, id: &str, reply_text: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	conn.execute("UPDATE reviews SET state = 'disputed', reply = ?1 WHERE id = ?2", params![reply_text, id])?;
	drop(conn);
	get(pool, id)
}
