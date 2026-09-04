// blocked_periods.rs — app/server/store/blockedPeriods.cjs 이식. 응답 JSON은 DB 컬럼 그대로
// snake_case로 나간다(프론트 CalendarPane.tsx가 p.start_date/p.end_date로 직접 읽음 — Node와 동일
// 계약, 요청 바디만 camelCase startDate/endDate를 받는다).
use crate::db::Pool;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

const DAY_MS: i64 = 86_400_000;

fn is_weekend(ms: i64) -> bool {
	// epoch ms → 요일. chrono로 UTC 기준 계산(Node의 new Date(ms).getDay()는 로컬 타임존 기준이지만,
	// 이 값 자체가 "그 날짜"를 가리키는 로컬 자정 ms라 이미 타임존 보정이 끝난 값 — UTC로 다시 해석해도
	// 같은 날짜가 나온다. §db.cjs v10 주석 참고).
	use chrono::{Datelike, TimeZone, Utc, Weekday};
	let dt = Utc.timestamp_millis_opt(ms).single().unwrap_or_else(|| Utc.timestamp_millis_opt(0).unwrap());
	matches!(dt.weekday(), Weekday::Sat | Weekday::Sun)
}

fn add_business_days_ms(start_ms: i64, duration_days: Option<i64>) -> i64 {
	let duration_days = match duration_days {
		Some(d) if d > 1 => d,
		_ => return start_ms,
	};
	let mut ms = start_ms;
	let mut remaining = duration_days - 1;
	while remaining > 0 {
		ms += DAY_MS;
		if !is_weekend(ms) {
			remaining -= 1;
		}
	}
	ms
}

fn push_overlapping_tasks(pool: &Pool, start_date: i64, end_date: i64) -> anyhow::Result<()> {
	let block_span_days = (end_date - start_date) / DAY_MS + 1;
	let shift_ms = block_span_days * DAY_MS;
	let conn = pool.get()?;
	let mut stmt = conn.prepare("SELECT id, due_date, duration_days FROM tasks WHERE due_date IS NOT NULL AND completed_at IS NULL")?;
	let rows: Vec<(String, i64, Option<i64>)> = stmt
		.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
		.filter_map(Result::ok)
		.collect();
	for (id, due_date, duration_days) in rows {
		let occupied_end = add_business_days_ms(due_date, duration_days);
		let overlaps = due_date <= end_date && occupied_end >= start_date;
		if overlaps {
			conn.execute("UPDATE tasks SET due_date = ?1, updated_at = ?2 WHERE id = ?3", params![due_date + shift_ms, chrono::Utc::now().timestamp_millis(), id])?;
		}
	}
	Ok(())
}

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"name": row.get::<_, String>(1)?,
		"start_date": row.get::<_, i64>(2)?,
		"end_date": row.get::<_, i64>(3)?,
		"created_at": row.get::<_, i64>(4)?,
	}))
}

pub fn list(pool: &Pool) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare("SELECT id, name, start_date, end_date, created_at FROM blocked_periods ORDER BY start_date ASC")?;
	let rows = stmt.query_map([], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

#[derive(Deserialize)]
pub struct CreateInput {
	pub name: Option<String>,
	#[serde(rename = "startDate")]
	pub start_date: Option<i64>,
	#[serde(rename = "endDate")]
	pub end_date: Option<i64>,
}

pub fn create(pool: &Pool, input: CreateInput) -> anyhow::Result<Value> {
	let trimmed = input.name.unwrap_or_default().trim().to_string();
	if trimmed.is_empty() {
		return Ok(json!({"ok": false, "error": "이유는 필수입니다."}));
	}
	let (start_date, end_date) = match (input.start_date, input.end_date) {
		(Some(s), Some(e)) => (s, e),
		_ => return Ok(json!({"ok": false, "error": "기간은 필수입니다."})),
	};
	if end_date < start_date {
		return Ok(json!({"ok": false, "error": "종료일이 시작일보다 빠릅니다."}));
	}
	let id = Uuid::new_v4().to_string();
	let created_at = chrono::Utc::now().timestamp_millis();
	{
		let conn = pool.get()?;
		conn.execute(
			"INSERT INTO blocked_periods (id, name, start_date, end_date, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
			params![id, trimmed, start_date, end_date, created_at],
		)?;
	}
	push_overlapping_tasks(pool, start_date, end_date)?;
	let conn = pool.get()?;
	let row = conn.query_row("SELECT id, name, start_date, end_date, created_at FROM blocked_periods WHERE id = ?1", params![id], row_to_json)?;
	Ok(row)
}

pub fn remove(pool: &Pool, id: &str) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM blocked_periods WHERE id = ?1", params![id])?;
	Ok(json!({"ok": true}))
}
