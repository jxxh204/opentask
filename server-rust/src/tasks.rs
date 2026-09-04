// tasks.rs — app/server/store/tasks.cjs 이식.
use crate::db::Pool;
use crate::{agent_jobs, branches, reviews, subtasks};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

const SELECT_COLS: &str = "id, folder_id, order_idx, name, desc, kind, ticket, created_at, updated_at, start_prompt, repo_id, repo_auto, due_date, duration_days, completed_at, color";

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"folder_id": row.get::<_, Option<String>>(1)?,
		"order_idx": row.get::<_, i64>(2)?,
		"name": row.get::<_, String>(3)?,
		"desc": row.get::<_, String>(4)?,
		"kind": row.get::<_, String>(5)?,
		"ticket": row.get::<_, Option<String>>(6)?,
		"created_at": row.get::<_, i64>(7)?,
		"updated_at": row.get::<_, i64>(8)?,
		"start_prompt": row.get::<_, Option<String>>(9)?,
		"repo_id": row.get::<_, Option<String>>(10)?,
		"repo_auto": row.get::<_, i64>(11)?,
		"due_date": row.get::<_, Option<i64>>(12)?,
		"duration_days": row.get::<_, Option<i64>>(13)?,
		"completed_at": row.get::<_, Option<i64>>(14)?,
		"color": row.get::<_, Option<String>>(15)?,
	}))
}

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM tasks WHERE id = ?1"), params![id], row_to_json).optional()?)
}

pub fn list_by_folder(pool: &Pool, folder_id: Option<&str>) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let rows: Vec<Value> = match folder_id {
		None => {
			let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM tasks WHERE folder_id IS NULL ORDER BY order_idx ASC"))?;
			let v: Vec<Value> = stmt.query_map([], row_to_json)?.filter_map(Result::ok).collect();
			v
		}
		Some(fid) => {
			let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM tasks WHERE folder_id = ?1 ORDER BY order_idx ASC"))?;
			let v: Vec<Value> = stmt.query_map(params![fid], row_to_json)?.filter_map(Result::ok).collect();
			v
		}
	};
	Ok(rows)
}

fn opt_str(v: &Value, key: &str) -> Option<String> {
	v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

pub fn create(pool: &Pool, input: &Value) -> anyhow::Result<Value> {
	let folder_id = opt_str(input, "folderId");
	let name = opt_str(input, "name").unwrap_or_default();
	let desc = opt_str(input, "desc").unwrap_or_default();
	let kind = opt_str(input, "kind").unwrap_or_else(|| "single".to_string());
	let ticket = opt_str(input, "ticket");
	let start_prompt = opt_str(input, "startPrompt");
	let due_date = input.get("dueDate").and_then(Value::as_i64);
	let mut repo_id = opt_str(input, "repoId");

	let id = Uuid::new_v4().to_string();
	let now = chrono::Utc::now().timestamp_millis();
	let conn = pool.get()?;
	let max_order: i64 = match &folder_id {
		Some(fid) => conn.query_row("SELECT COALESCE(MAX(order_idx), -1) FROM tasks WHERE folder_id = ?1", params![fid], |r| r.get(0))?,
		None => conn.query_row("SELECT COALESCE(MAX(order_idx), -1) FROM tasks WHERE folder_id IS NULL", [], |r| r.get(0))?,
	};
	// 이미 레포가 정해진 폴더에 새 태스크(서브태스크)를 만드는 거면 그 폴더 repo_id를 물려받는다(§원본 주석).
	if let (Some(fid), None) = (&folder_id, &repo_id) {
		repo_id = conn.query_row("SELECT repo_id FROM folders WHERE id = ?1", params![fid], |r| r.get::<_, Option<String>>(0)).optional()?.flatten();
	}
	conn.execute(
		"INSERT INTO tasks (id, folder_id, order_idx, name, desc, kind, ticket, start_prompt, repo_id, due_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
		params![id, folder_id, max_order + 1, name, desc, kind, ticket, start_prompt, repo_id, due_date, now, now],
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
	let kind = patch.get("kind").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| cur["kind"].as_str().unwrap_or_default().to_string());
	let start_prompt = if patch.get("startPrompt").is_some() { opt_str(patch, "startPrompt") } else { cur["start_prompt"].as_str().map(str::to_string) };
	let repo_id_patched = patch.get("repoId").is_some();
	let repo_id = if repo_id_patched { opt_str(patch, "repoId") } else { cur["repo_id"].as_str().map(str::to_string) };
	let repo_auto = if patch.get("repoAuto").is_some() {
		patch["repoAuto"].as_bool().unwrap_or(false) as i64
	} else if repo_id_patched {
		0
	} else {
		cur["repo_auto"].as_i64().unwrap_or(0)
	};
	let due_date = if patch.get("dueDate").is_some() { patch["dueDate"].as_i64() } else { cur["due_date"].as_i64() };
	let duration_days = if patch.get("durationDays").is_some() { patch["durationDays"].as_i64() } else { cur["duration_days"].as_i64() };
	let completed_at = if patch.get("completedAt").is_some() { patch["completedAt"].as_i64() } else { cur["completed_at"].as_i64() };
	let color = if patch.get("color").is_some() { opt_str(patch, "color") } else { cur["color"].as_str().map(str::to_string) };

	let conn = pool.get()?;
	conn.execute(
		"UPDATE tasks SET name=?1, desc=?2, kind=?3, start_prompt=?4, repo_id=?5, repo_auto=?6, due_date=?7, duration_days=?8, completed_at=?9, color=?10, updated_at=?11 WHERE id=?12",
		params![name, desc, kind, start_prompt, repo_id, repo_auto, due_date, duration_days, completed_at, color, chrono::Utc::now().timestamp_millis(), id],
	)?;
	drop(conn);
	get(pool, id)
}

/// 드래그앤드롭으로 폴더 이동 + 형제간 순서 재배치(§원본 move()). before_task_id가 있으면 그 앞에 끼워넣고,
/// 없으면 맨 뒤로.
pub fn move_task(pool: &Pool, id: &str, folder_id: Option<&str>, before_task_id: Option<&str>) -> anyhow::Result<Option<Value>> {
	if get(pool, id)?.is_none() {
		return Ok(None);
	}
	let mut siblings = list_by_folder(pool, folder_id)?;
	siblings.retain(|t| t["id"].as_str() != Some(id));
	let insert_at = before_task_id.and_then(|bid| siblings.iter().position(|t| t["id"].as_str() == Some(bid))).unwrap_or(siblings.len());
	let ids: Vec<String> = {
		let mut order: Vec<String> = siblings.iter().map(|t| t["id"].as_str().unwrap_or_default().to_string()).collect();
		order.insert(insert_at.min(order.len()), id.to_string());
		order
	};

	let now = chrono::Utc::now().timestamp_millis();
	let mut conn = pool.get()?;
	let tx = conn.transaction()?;
	tx.execute("UPDATE tasks SET folder_id = ?1, updated_at = ?2 WHERE id = ?3", params![folder_id, now, id])?;
	for (i, tid) in ids.iter().enumerate() {
		tx.execute("UPDATE tasks SET order_idx = ?1 WHERE id = ?2", params![i as i64, tid])?;
	}
	tx.commit()?;
	drop(conn);
	get(pool, id)
}

pub fn remove(pool: &Pool, id: &str) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
	Ok(json!({"ok": true}))
}

const DAY_MS: i64 = 86_400_000;

fn is_weekend(ms: i64) -> bool {
	use chrono::{Datelike, TimeZone, Utc, Weekday};
	let dt = Utc.timestamp_millis_opt(ms).single().unwrap_or_else(|| Utc.timestamp_millis_opt(0).unwrap());
	matches!(dt.weekday(), Weekday::Sat | Weekday::Sun)
}

fn add_business_days(start_ms: i64, duration_days: i64) -> i64 {
	if duration_days <= 1 {
		return start_ms;
	}
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

fn business_days_between(start_ms: i64, end_ms: i64) -> i64 {
	if end_ms <= start_ms {
		return 1;
	}
	let mut count = 1;
	let mut ms = start_ms;
	while ms < end_ms {
		ms += DAY_MS;
		if !is_weekend(ms) {
			count += 1;
		}
	}
	count
}

// "메인 태스크의 기간은... 모든 일정을 더하기해서 자동으로 적용되게 해줘" — 서브태스크 전체 범위
// (가장 이른 시작 ~ 가장 늦은 종료)로 태스크 자신의 due_date/duration_days를 다시 계산해 저장한다.
pub fn recompute_from_subtasks(pool: &Pool, task_id: &str) -> anyhow::Result<()> {
	let subs: Vec<Value> = subtasks::list_by_task(pool, task_id)?.into_iter().filter(|s| s["due_date"].is_i64()).collect();
	if subs.is_empty() {
		return Ok(());
	}
	let mut min_start = i64::MAX;
	let mut max_end = i64::MIN;
	for s in &subs {
		let start = s["due_date"].as_i64().unwrap();
		let duration = s["duration_days"].as_i64().unwrap_or(1);
		let end = add_business_days(start, duration);
		min_start = min_start.min(start);
		max_end = max_end.max(end);
	}
	update(pool, task_id, &json!({"dueDate": min_start, "durationDays": business_days_between(min_start, max_end)}))?;
	Ok(())
}

// "검토한 일감은... 사라지면안돼" — agent_jobs에 영구 저장된 완료 검토 결과를 taskId로 다시 찾는다.
// kind 문자열('estimate-duration')은 durationEstimate.cjs의 JOB_KIND와 반드시 같아야 한다(§원본 주석).
pub fn latest_review_for(pool: &Pool, task_id: &str) -> anyhow::Result<Value> {
	match agent_jobs::latest_done(pool, "estimate-duration", "task", task_id)? {
		None => Ok(Value::Null),
		Some(j) => {
			let envelope = j.get("result").cloned().unwrap_or(Value::Null);
			let result = envelope.get("result").cloned().unwrap_or(Value::Null);
			Ok(json!({"jobId": j["id"], "result": result, "doneAt": j["done_at"]}))
		}
	}
}

pub fn compose_task(pool: &Pool, row: Value) -> anyhow::Result<Value> {
	let task_id = row["id"].as_str().unwrap_or_default().to_string();
	let raw_branches = branches::list_by_task(pool, &task_id)?;
	let mut branches_out = Vec::with_capacity(raw_branches.len());
	let mut reviews_out = Vec::new();
	for b in raw_branches {
		let bid = b["id"].as_str().unwrap_or_default().to_string();
		let mut bb = b;
		bb["links"] = json!(branches::links(pool, &bid)?);
		reviews_out.extend(reviews::list_by_branch(pool, &bid)?);
		branches_out.push(bb);
	}
	let review = latest_review_for(pool, &task_id)?;
	let subtasks_out = subtasks::list_by_task(pool, &task_id)?;

	let mut out = row;
	out["branches"] = json!(branches_out);
	out["reviews"] = json!(reviews_out);
	out["review"] = review;
	out["subtasks"] = json!(subtasks_out);
	Ok(out)
}

// GET /api/sessions/board — 사이드바가 실제로 부르는 메인 조회. folders는 이미 조회된 목록(활성/보관함
// 둘 다 이 함수로 넘어올 수 있음, § index.cjs 541/574)을 받아 그대로 태스크를 얹는다.
pub fn board(pool: &Pool, folders_list: Vec<Value>) -> anyhow::Result<Value> {
	let inbox_raw = list_by_folder(pool, None)?;
	let mut inbox = Vec::with_capacity(inbox_raw.len());
	for t in inbox_raw {
		inbox.push(compose_task(pool, t)?);
	}

	let mut folders_out = Vec::with_capacity(folders_list.len());
	for f in folders_list {
		let fid = f["id"].as_str().unwrap_or_default().to_string();
		let tasks_raw = list_by_folder(pool, Some(&fid))?;
		let mut tasks_composed = Vec::with_capacity(tasks_raw.len());
		for t in tasks_raw {
			tasks_composed.push(compose_task(pool, t)?);
		}
		let mut fo = f;
		fo["tasks"] = json!(tasks_composed);
		folders_out.push(fo);
	}
	let notes = subtasks::list_orphans(pool)?;
	Ok(json!({"folders": folders_out, "inbox": inbox, "notes": notes}))
}
