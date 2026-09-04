// cron_jobs.rs — app/server/store/cronJobs.cjs 이식 (스토어 CRUD만 — 실제 스케줄러 tick/실행은
// scheduler.cjs 쪽이라 아직 미포팅. computeNextRun은 그대로 옮겨서 create/update 시 다음 실행 시각을
// 정확히 계산한다).
use crate::db::Pool;
use chrono::{Datelike, Local, TimeZone};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	let schedule_json: String = row.get(3)?;
	let action_json: String = row.get(5)?;
	let schedule: Value = serde_json::from_str(&schedule_json).unwrap_or(Value::Null);
	let action: Value = serde_json::from_str(&action_json).unwrap_or(Value::Null);
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"name": row.get::<_, String>(1)?,
		"schedule_type": row.get::<_, String>(2)?,
		"schedule_json": schedule_json,
		"schedule": schedule,
		"action_type": row.get::<_, String>(4)?,
		"action_json": action_json,
		"action": action,
		"enabled": row.get::<_, i64>(6)?,
		"last_run_at": row.get::<_, Option<i64>>(7)?,
		"last_result": row.get::<_, Option<String>>(8)?,
		"next_run_at": row.get::<_, Option<i64>>(9)?,
		"created_at": row.get::<_, i64>(10)?,
		"updated_at": row.get::<_, i64>(11)?,
	}))
}

const SELECT_COLS: &str = "id, name, schedule_type, schedule_json, action_type, action_json, enabled, last_run_at, last_result, next_run_at, created_at, updated_at";

pub fn list(pool: &Pool) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM cron_jobs ORDER BY created_at ASC"))?;
	let rows: Vec<Value> = stmt.query_map([], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM cron_jobs WHERE id = ?1"), params![id], row_to_json).optional()?)
}

// Node의 new Date(ms) 로컬 타임존 기준 계산을 그대로 재현 — 서버 로컬 타임존(Local)을 쓴다.
pub fn compute_next_run(schedule_type: &str, schedule: &Value, from: i64) -> i64 {
	match schedule_type {
		"interval" => {
			let minutes = schedule.get("minutes").and_then(Value::as_i64).unwrap_or(60).max(1);
			from + minutes * 60_000
		}
		"daily" => {
			let hour = schedule.get("hour").and_then(Value::as_u64).map(|v| v as u32).unwrap_or(0);
			let minute = schedule.get("minute").and_then(Value::as_u64).map(|v| v as u32).unwrap_or(0);
			let d = Local.timestamp_millis_opt(from).single().unwrap_or_else(|| Local.timestamp_millis_opt(0).unwrap());
			let today_at = Local.from_local_datetime(&d.date_naive().and_hms_opt(hour, minute, 0).unwrap()).single().unwrap();
			if today_at.timestamp_millis() > from {
				today_at.timestamp_millis()
			} else {
				let tomorrow = d.date_naive() + chrono::Duration::days(1);
				Local.from_local_datetime(&tomorrow.and_hms_opt(hour, minute, 0).unwrap()).single().unwrap().timestamp_millis()
			}
		}
		"weekly" => {
			let hour = schedule.get("hour").and_then(Value::as_u64).map(|v| v as u32).unwrap_or(0);
			let minute = schedule.get("minute").and_then(Value::as_u64).map(|v| v as u32).unwrap_or(0);
			let target_dow = schedule.get("dow").and_then(Value::as_i64).unwrap_or(0); // 0=Sun
			let d = Local.timestamp_millis_opt(from).single().unwrap_or_else(|| Local.timestamp_millis_opt(0).unwrap());
			let cur_dow = d.weekday().num_days_from_sunday() as i64;
			let mut diff = (target_dow - cur_dow + 7) % 7;
			let base = Local.from_local_datetime(&d.date_naive().and_hms_opt(hour, minute, 0).unwrap()).single().unwrap();
			if diff == 0 && base.timestamp_millis() <= from {
				diff = 7;
			}
			let next_date = d.date_naive() + chrono::Duration::days(diff);
			Local.from_local_datetime(&next_date.and_hms_opt(hour, minute, 0).unwrap()).single().unwrap().timestamp_millis()
		}
		_ => from + 3_600_000,
	}
}

pub fn create(pool: &Pool, input: &Value) -> anyhow::Result<Value> {
	let name = input.get("name").and_then(Value::as_str).map(str::to_string);
	let schedule_type = input.get("scheduleType").and_then(Value::as_str).map(str::to_string);
	let schedule = input.get("schedule").cloned();
	let action = input.get("action").cloned();
	let (name, schedule_type, schedule, action) = match (name, schedule_type, schedule, action) {
		(Some(n), Some(st), Some(s), Some(a)) if !n.trim().is_empty() && !s.is_null() && !a.is_null() => (n, st, s, a),
		_ => return Ok(json!({"ok": false, "error": "name/scheduleType/schedule/action 필수"})),
	};
	let action_type = input.get("actionType").and_then(Value::as_str).unwrap_or("create_task").to_string();
	let enabled = input.get("enabled").and_then(Value::as_bool).unwrap_or(true);
	let now = chrono::Utc::now().timestamp_millis();
	let next_run = if enabled { Some(compute_next_run(&schedule_type, &schedule, now)) } else { None };

	let id = Uuid::new_v4().to_string();
	let conn = pool.get()?;
	conn.execute(
		"INSERT INTO cron_jobs (id, name, schedule_type, schedule_json, action_type, action_json, enabled, last_run_at, next_run_at, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9,?10)",
		params![id, name.trim(), schedule_type, schedule.to_string(), action_type, action.to_string(), enabled as i64, next_run, now, now],
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
	let schedule_type = patch.get("scheduleType").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cur["schedule_type"].as_str().unwrap_or_default().to_string());
	let schedule = patch.get("schedule").cloned().unwrap_or_else(|| cur["schedule"].clone());
	let action_type = patch.get("actionType").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cur["action_type"].as_str().unwrap_or_default().to_string());
	let action = patch.get("action").cloned().unwrap_or_else(|| cur["action"].clone());
	let enabled = if patch.get("enabled").is_some() { patch["enabled"].as_bool().unwrap_or(false) } else { cur["enabled"].as_i64().unwrap_or(1) != 0 };

	let schedule_changed = patch.get("schedule").is_some() || patch.get("scheduleType").is_some();
	let enabled_changed = patch.get("enabled").is_some();
	let was_enabled = cur["enabled"].as_i64().unwrap_or(1) != 0;
	let now = chrono::Utc::now().timestamp_millis();
	let next_run = if !enabled {
		None
	} else if schedule_changed || (enabled_changed && !was_enabled) {
		Some(compute_next_run(&schedule_type, &schedule, now))
	} else {
		cur["next_run_at"].as_i64()
	};

	let conn = pool.get()?;
	conn.execute(
		"UPDATE cron_jobs SET name=?1, schedule_type=?2, schedule_json=?3, action_type=?4, action_json=?5, enabled=?6, next_run_at=?7, updated_at=?8 WHERE id=?9",
		params![name, schedule_type, schedule.to_string(), action_type, action.to_string(), enabled as i64, next_run, now, id],
	)?;
	drop(conn);
	get(pool, id)
}

pub fn remove(pool: &Pool, id: &str) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM cron_jobs WHERE id = ?1", params![id])?;
	Ok(json!({"ok": true}))
}

// scheduler.cjs dueJobs() — enabled=1이고 next_run_at이 지금(now) 이하인 것들.
pub fn due_jobs(pool: &Pool, now: i64) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1"))?;
	let rows: Vec<Value> = stmt.query_map(params![now], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

// scheduler.cjs markRan() — 실행 직후 last_run_at/last_result 갱신 + 다음 실행 시각 재계산.
pub fn mark_ran(pool: &Pool, id: &str, result: Option<&str>) -> anyhow::Result<Option<Value>> {
	let cur = match get(pool, id)? {
		Some(v) => v,
		None => return Ok(None),
	};
	let now = chrono::Utc::now().timestamp_millis();
	let schedule_type = cur["schedule_type"].as_str().unwrap_or_default().to_string();
	let schedule = cur["schedule"].clone();
	let next = compute_next_run(&schedule_type, &schedule, now);
	let truncated_result = result.map(|s| s.chars().take(4000).collect::<String>());

	let conn = pool.get()?;
	conn.execute(
		"UPDATE cron_jobs SET last_run_at=?1, last_result=?2, next_run_at=?3, updated_at=?4 WHERE id=?5",
		params![now, truncated_result, next, now, id],
	)?;
	drop(conn);
	get(pool, id)
}
