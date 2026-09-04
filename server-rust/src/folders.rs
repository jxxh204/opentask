// folders.rs — app/server/store/folders.cjs 이식. update()에서 repoId가 patch에 들어오면 그
// 폴더 산하 tasks.repo_id도 같이 맞추는 캐스케이드가 핵심(§원본 주석 — "레포 조정 코드가 흩어져있는
// 거야?" 이후 folders.repo_id가 항상 우선권을 갖도록 통합한 로직, 그대로 재현해야 함).
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

const SELECT_COLS: &str = "id, name, base, order_idx, created_at, updated_at, archived, archived_at, auto_merge, retry_limit, repo_id, rule_task, conductor_session, hidden, hidden_at";

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"name": row.get::<_, String>(1)?,
		"base": row.get::<_, Option<String>>(2)?,
		"order_idx": row.get::<_, i64>(3)?,
		"created_at": row.get::<_, i64>(4)?,
		"updated_at": row.get::<_, i64>(5)?,
		"archived": row.get::<_, i64>(6)?,
		"archived_at": row.get::<_, Option<i64>>(7)?,
		"auto_merge": row.get::<_, i64>(8)?,
		"retry_limit": row.get::<_, i64>(9)?,
		"repo_id": row.get::<_, Option<String>>(10)?,
		"rule_task": row.get::<_, Option<String>>(11)?,
		"conductor_session": row.get::<_, Option<String>>(12)?,
		"hidden": row.get::<_, i64>(13)?,
		"hidden_at": row.get::<_, Option<i64>>(14)?,
	}))
}

#[allow(dead_code)]
pub fn list(pool: &Pool) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM folders WHERE archived = 0 ORDER BY order_idx ASC, created_at ASC"))?;
	let rows: Vec<Value> = stmt.query_map([], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

#[allow(dead_code)]
pub fn list_archived(pool: &Pool) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM folders WHERE archived = 1 ORDER BY archived_at DESC"))?;
	let rows: Vec<Value> = stmt.query_map([], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM folders WHERE id = ?1"), params![id], row_to_json).optional()?)
}

fn opt_str(v: &Value, key: &str) -> Option<String> {
	v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

pub fn create(pool: &Pool, input: &Value) -> anyhow::Result<Value> {
	let name = opt_str(input, "name").unwrap_or_else(|| "새 폴더".to_string());
	let base = opt_str(input, "base");
	let auto_merge = input.get("autoMerge").and_then(Value::as_bool).unwrap_or(false) as i64;
	let retry_limit = input.get("retryLimit").and_then(Value::as_i64).map(|n| n.max(1)).unwrap_or(3);
	let repo_id = opt_str(input, "repoId");
	let id = Uuid::new_v4().to_string();
	let now = chrono::Utc::now().timestamp_millis();
	let conn = pool.get()?;
	let max_order: i64 = conn.query_row("SELECT COALESCE(MAX(order_idx), -1) FROM folders", [], |r| r.get(0))?;
	conn.execute(
		"INSERT INTO folders (id, name, base, order_idx, auto_merge, retry_limit, repo_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
		params![id, name, base, max_order + 1, auto_merge, retry_limit, repo_id, now, now],
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
	let base = if patch.get("base").is_some() { opt_str(patch, "base") } else { cur["base"].as_str().map(str::to_string) };
	let order_idx = patch.get("order").and_then(Value::as_i64).unwrap_or_else(|| cur["order_idx"].as_i64().unwrap_or(0));
	let auto_merge = if patch.get("autoMerge").is_some() {
		patch["autoMerge"].as_bool().unwrap_or(false) as i64
	} else {
		cur["auto_merge"].as_i64().unwrap_or(0)
	};
	let retry_limit = if patch.get("retryLimit").is_some() {
		patch["retryLimit"].as_i64().map(|n| n.max(1)).unwrap_or(3)
	} else {
		cur["retry_limit"].as_i64().unwrap_or(3)
	};
	let repo_id_patched = patch.get("repoId").is_some();
	let repo_id = if repo_id_patched { opt_str(patch, "repoId") } else { cur["repo_id"].as_str().map(str::to_string) };
	let rule_task = if patch.get("ruleTask").is_some() { opt_str(patch, "ruleTask").filter(|s| !s.trim().is_empty()) } else { cur["rule_task"].as_str().map(str::to_string) };
	let conductor_session = if patch.get("conductorSession").is_some() { opt_str(patch, "conductorSession") } else { cur["conductor_session"].as_str().map(str::to_string) };
	let (hidden, hidden_at) = if patch.get("hidden").is_some() {
		let h = patch["hidden"].as_bool().unwrap_or(false);
		(h as i64, if h { Some(chrono::Utc::now().timestamp_millis()) } else { None })
	} else {
		(cur["hidden"].as_i64().unwrap_or(0), cur["hidden_at"].as_i64())
	};

	let conn = pool.get()?;
	conn.execute(
		"UPDATE folders SET name = ?1, base = ?2, order_idx = ?3, auto_merge = ?4, retry_limit = ?5, repo_id = ?6, rule_task = ?7, conductor_session = ?8, hidden = ?9, hidden_at = ?10, updated_at = ?11 WHERE id = ?12",
		params![name, base, order_idx, auto_merge, retry_limit, repo_id, rule_task, conductor_session, hidden, hidden_at, chrono::Utc::now().timestamp_millis(), id],
	)?;
	if repo_id_patched {
		conn.execute("UPDATE tasks SET repo_id = ?1 WHERE folder_id = ?2", params![repo_id, id])?;
	}
	drop(conn);
	get(pool, id)
}

pub fn remove(pool: &Pool, id: &str) -> anyhow::Result<Value> {
	// tasks.folder_id는 ON DELETE SET NULL이라 이 폴더의 태스크는 삭제되지 않고 inbox(미분류)로 남는다.
	let conn = pool.get()?;
	conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
	Ok(json!({"ok": true}))
}

pub fn archive(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	if get(pool, id)?.is_none() {
		return Ok(None);
	}
	let conn = pool.get()?;
	conn.execute("UPDATE folders SET archived = 1, archived_at = ?1 WHERE id = ?2", params![chrono::Utc::now().timestamp_millis(), id])?;
	drop(conn);
	get(pool, id)
}

pub fn restore(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	if get(pool, id)?.is_none() {
		return Ok(None);
	}
	let conn = pool.get()?;
	conn.execute("UPDATE folders SET archived = 0, archived_at = NULL WHERE id = ?1", params![id])?;
	drop(conn);
	get(pool, id)
}
