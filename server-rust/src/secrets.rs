// secrets.rs — app/server/store/secrets.cjs 이식. GitHub 토큰·DB 연결문자열·Sentry 토큰 등을 파일
// 권한으로만 보호되는 평문으로 저장(openrm.db가 chmod 0600 — § db.rs). list_keys()는 절대 값을
// 돌려주지 않는다(키 이름만) — Setup 페이지의 마스킹 표시용으로 값이 실수로 로그/응답에 새지 않게.
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};

#[allow(dead_code)]
pub fn get(pool: &Pool, key: &str) -> anyhow::Result<Option<String>> {
	let conn = pool.get()?;
	Ok(conn.query_row("SELECT value FROM secrets WHERE key = ?1", params![key], |r| r.get(0)).optional()?)
}

#[allow(dead_code)]
pub fn has(pool: &Pool, key: &str) -> anyhow::Result<bool> {
	Ok(get(pool, key)?.is_some())
}

#[allow(dead_code)]
pub fn set(pool: &Pool, key: &str, value: &str) -> anyhow::Result<()> {
	let conn = pool.get()?;
	conn.execute("INSERT INTO secrets (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
	Ok(())
}

#[allow(dead_code)]
pub fn remove(pool: &Pool, key: &str) -> anyhow::Result<()> {
	let conn = pool.get()?;
	conn.execute("DELETE FROM secrets WHERE key = ?1", params![key])?;
	Ok(())
}

pub fn list_keys(pool: &Pool) -> anyhow::Result<Vec<String>> {
	let conn = pool.get()?;
	let mut stmt = conn.prepare("SELECT key FROM secrets")?;
	let rows: Vec<String> = stmt.query_map([], |r| r.get(0))?.filter_map(Result::ok).collect();
	Ok(rows)
}
