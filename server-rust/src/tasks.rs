// tasks.rs — app/server/store/tasks.cjs 이식. 지금 포팅 범위: get/listByFolder/create/update/
// move/remove(순수 tasks 테이블 CRUD). composeTask/board는 branches.cjs/reviews.cjs/subtasks.cjs/
// agentJobs.cjs에 의존하는데 그것들은 아직 미포팅이라, compose_task()는 그 관계 필드를 빈 배열/null로
// 채운 "부분 스텁"이다 — 태스크 자체 필드는 정확하지만 branches/reviews/subtasks는 실제 데이터가
// 아니다(§ main.rs create_task/update_task 핸들러, 반드시 이 사실을 인지하고 쓸 것).
use crate::db::Pool;
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

/// 부분 스텁 — branches/reviews/review/subtasks는 아직 미포팅이라 항상 빈 배열/null(§ 파일 상단 주석).
pub fn compose_task(row: Value) -> Value {
	let mut out = row;
	out["branches"] = json!([]);
	out["reviews"] = json!([]);
	out["review"] = Value::Null;
	out["subtasks"] = json!([]);
	out
}
