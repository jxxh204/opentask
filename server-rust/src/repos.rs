// repos.rs — app/server/store/repos.cjs 이식. update()의 "패치에 그 키가 있는지"(Node의 `'x' in
// patch`) 구분이 중요해서 타입 구조체 대신 serde_json::Value를 그대로 받아 키 존재 여부를 판별한다
// (Option<T>만으로는 "키 없음"과 "키는 있는데 null"을 구분 못 함).
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::process::Command;
use uuid::Uuid;

pub fn derive_owner_avatar(repo_path: &str) -> Option<String> {
	let slug = derive_owner(repo_path)?;
	Some(format!("https://github.com/{slug}.png?size=64"))
}

fn derive_owner(repo_path: &str) -> Option<String> {
	let out = Command::new("git").args(["-C", repo_path, "remote", "get-url", "origin"]).output().ok()?;
	if !out.status.success() {
		return None;
	}
	let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
	owner_from_git_url(&url)
}

fn owner_from_git_url(url: &str) -> Option<String> {
	// git@host:owner/repo.git 또는 https://host/owner/repo(.git) 둘 다 owner만 뽑는다(§repos.cjs 원본과 동일).
	let after_colon = url.split_once(':').map(|(_, b)| b);
	let after_scheme = url.split_once("://").and_then(|(_, b)| b.split_once('/')).map(|(_, b)| b);
	let rest = after_scheme.or(after_colon)?;
	rest.split('/').next().map(|s| s.to_string())
}

// prs.cjs 등 아직 포팅 안 된 모듈이 쓸 예정 — 지금은 미사용.
#[allow(dead_code)]
pub fn derive_slug(repo_path: &str) -> Option<String> {
	let out = Command::new("git").args(["-C", repo_path, "remote", "get-url", "origin"]).output().ok()?;
	if !out.status.success() {
		return None;
	}
	let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
	let after_colon = url.split_once(':').map(|(_, b)| b);
	let after_scheme = url.split_once("://").and_then(|(_, b)| b.split_once('/')).map(|(_, b)| b);
	let rest = (after_scheme.or(after_colon)?).trim_end_matches(".git");
	let mut parts = rest.splitn(2, '/');
	let owner = parts.next()?;
	let repo = parts.next()?;
	Some(format!("{owner}/{repo}"))
}

fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
	Ok(json!({
		"id": row.get::<_, String>(0)?,
		"name": row.get::<_, String>(1)?,
		"path": row.get::<_, String>(2)?,
		"base": row.get::<_, Option<String>>(3)?,
		"description": row.get::<_, String>(4)?,
		"order_idx": row.get::<_, i64>(5)?,
		"created_at": row.get::<_, i64>(6)?,
		"color": row.get::<_, Option<String>>(7)?,
		"rule_general": row.get::<_, Option<String>>(8)?,
		"rule_task_writing": row.get::<_, Option<String>>(9)?,
		"rule_branch": row.get::<_, Option<String>>(10)?,
		"rule_predev": row.get::<_, Option<String>>(11)?,
	}))
}

const SELECT_COLS: &str = "id, name, path, base, description, order_idx, created_at, color, rule_general, rule_task_writing, rule_branch, rule_predev";

pub fn list(pool: &Pool) -> anyhow::Result<Vec<Value>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM repos ORDER BY order_idx ASC, created_at ASC"))?;
	let rows: Vec<Value> = stmt.query_map([], row_to_json)?.filter_map(Result::ok).collect();
	Ok(rows)
}

pub fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	Ok(conn.query_row(&format!("SELECT {SELECT_COLS} FROM repos WHERE id = ?1"), params![id], row_to_json).optional()?)
}

fn s(v: &Value) -> String {
	v.as_str().unwrap_or_default().trim().to_string()
}

pub fn create(pool: &Pool, input: &Value) -> anyhow::Result<Value> {
	let name = input.get("name").map(s).unwrap_or_default();
	let path = input.get("path").map(s).unwrap_or_default();
	if name.is_empty() || path.is_empty() {
		return Ok(json!({"ok": false, "error": "이름과 경로는 필수입니다."}));
	}
	let base = input.get("base").map(s).filter(|v| !v.is_empty());
	let description = input.get("description").map(s).unwrap_or_default();
	let id = Uuid::new_v4().to_string();
	let conn = pool.get()?;
	let max_order: i64 = conn.query_row("SELECT COALESCE(MAX(order_idx), -1) FROM repos", [], |r| r.get(0))?;
	conn.execute(
		"INSERT INTO repos (id, name, path, base, description, order_idx, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
		params![id, name, path, base, description, max_order + 1, chrono::Utc::now().timestamp_millis()],
	)?;
	drop(conn);
	Ok(get(pool, &id)?.unwrap_or(Value::Null))
}

// Node의 `'key' in patch ? (값 있으면 trim, 없으면/빈문자열이면 null) : 기존값 유지` 패턴을 그대로.
fn patched_nullable(patch: &Value, key: &str, current: Option<&str>) -> Option<String> {
	match patch.get(key) {
		None => current.map(|s| s.to_string()),
		Some(Value::Null) => None,
		Some(v) => {
			let t = v.as_str().unwrap_or_default().trim().to_string();
			if t.is_empty() { None } else { Some(t) }
		}
	}
}

pub fn update(pool: &Pool, id: &str, patch: &Value) -> anyhow::Result<Option<Value>> {
	let cur = match get(pool, id)? {
		Some(v) => v,
		None => return Ok(None),
	};
	let name = patch.get("name").and_then(|v| v.as_str()).map(str::to_string).unwrap_or_else(|| cur["name"].as_str().unwrap_or_default().to_string());
	let path = patch.get("path").and_then(|v| v.as_str()).map(str::to_string).unwrap_or_else(|| cur["path"].as_str().unwrap_or_default().to_string());
	let base = patched_nullable(patch, "base", cur["base"].as_str());
	let description = patch.get("description").and_then(|v| v.as_str()).map(str::to_string).unwrap_or_else(|| cur["description"].as_str().unwrap_or_default().to_string());
	let color = patched_nullable(patch, "color", cur["color"].as_str());
	let rule_general = patched_nullable(patch, "ruleGeneral", cur["rule_general"].as_str());
	let rule_task_writing = patched_nullable(patch, "ruleTaskWriting", cur["rule_task_writing"].as_str());
	let rule_branch = patched_nullable(patch, "ruleBranch", cur["rule_branch"].as_str());
	let rule_predev = patched_nullable(patch, "rulePredev", cur["rule_predev"].as_str());

	let conn = pool.get()?;
	conn.execute(
		"UPDATE repos SET name = ?1, path = ?2, base = ?3, description = ?4, color = ?5, rule_general = ?6, rule_task_writing = ?7, rule_branch = ?8, rule_predev = ?9 WHERE id = ?10",
		params![name, path, base, description, color, rule_general, rule_task_writing, rule_branch, rule_predev, id],
	)?;
	drop(conn);
	get(pool, id)
}

pub fn remove(pool: &Pool, id: &str) -> anyhow::Result<Value> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM repos WHERE id = ?1", params![id])?;
	Ok(json!({"ok": true}))
}
