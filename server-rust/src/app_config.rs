// app_config.rs — app/server/store/settings.cjs 이식(이름이 같은 server/settings.cjs, 이미 포팅한
// src/settings.rs와는 다른 모듈 — 이쪽은 SQLite `settings` 테이블의 범용 key/value_json 저장소 +
// AppConfig(rootPath 등 Setup 페이지 값) 하나만 다룬다. 혼동 방지를 위해 파일명을 app_config로 분리).
use crate::db::Pool;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

const APP_CONFIG_KEY: &str = "appConfig";

fn app_config_defaults() -> Value {
	json!({
		"rootPath": Value::Null,
		"wtPath": Value::Null,
		"branchPrefix": Value::Null,
		"operatorName": "",
		"githubRepo": Value::Null,
		"githubRepos": [],
		"devServerUrl": Value::Null,
		"webviewPort": Value::Null,
		"dbSchema": "public",
		"apiRoot": Value::Null,
		"apiBaseUrl": Value::Null,
		"nextRoot": Value::Null,
		"nextPort": Value::Null,
		"nextRouterMode": "app",
		"sentryOrg": Value::Null,
		"sentryProject": Value::Null,
		"awsDeployWebhookUrl": Value::Null,
		"vitalsEndpoint": Value::Null,
		"slackAlertChannel": Value::Null,
		"alertAutoConvertThreshold": 3,
		"ticketPrefix": Value::Null,
		"notionBacklogDb": Value::Null,
		"notionBacklogAssignee": Value::Null,
		"notionBacklogService": Value::Null,
		"notionBacklogPlatform": Value::Null,
		"deployRepo": Value::Null,
		"deployBase": Value::Null,
		"githubOAuthClientId": Value::Null,
		"terminalGhostty": false,
		"terminalTmux": false,
	})
}

pub fn get(pool: &Pool, key: &str) -> anyhow::Result<Option<Value>> {
	let conn = pool.get()?;
	let raw: Option<String> = conn.query_row("SELECT value_json FROM settings WHERE key = ?1", params![key], |r| r.get(0)).optional()?;
	Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set(pool: &Pool, key: &str, value: &Value) -> anyhow::Result<()> {
	let conn = pool.get()?;
	conn.execute(
		"INSERT INTO settings (key, value_json) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
		params![key, value.to_string()],
	)?;
	Ok(())
}

pub fn get_app_config(pool: &Pool) -> anyhow::Result<Value> {
	let mut out = app_config_defaults().as_object().unwrap().clone();
	if let Some(Value::Object(saved)) = get(pool, APP_CONFIG_KEY)? {
		for (k, v) in saved {
			out.insert(k, v);
		}
	}
	Ok(Value::Object(out))
}

/// prRepos — 내 PR을 모을 레포 목록. Setup 페이지의 githubRepo(콤마 구분)/githubRepos 설정이
/// 있으면 그걸 우선(수동 지정), 없으면 등록된 레포들에서 origin remote로 slug를 자동 유도한다.
pub fn pr_repos(pool: &Pool) -> anyhow::Result<Vec<Value>> {
	let cfg = get_app_config(pool)?;
	let manual_raw = cfg["githubRepo"]
		.as_str()
		.filter(|s| !s.trim().is_empty())
		.map(str::to_string)
		.or_else(|| cfg["githubRepos"].as_array().filter(|a| !a.is_empty()).map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(",")))
		.or_else(|| std::env::var("OPENRM_PR_REPOS").ok())
		.unwrap_or_default();
	let manual: Vec<Value> = manual_raw
		.split(',')
		.map(str::trim)
		.filter(|s| !s.is_empty())
		.map(|slug| json!({"slug": slug, "name": slug.rsplit('/').next().unwrap_or(slug)}))
		.collect();
	if !manual.is_empty() {
		return Ok(manual);
	}
	let mut seen = std::collections::HashSet::new();
	let mut out = Vec::new();
	for r in crate::repos::list(pool)? {
		let Some(path) = r["path"].as_str() else { continue };
		let Some(slug) = crate::repos::derive_slug(path) else { continue };
		if !seen.insert(slug.clone()) {
			continue;
		}
		out.push(json!({"slug": slug, "name": r["name"]}));
	}
	Ok(out)
}

#[allow(dead_code)]
pub fn update_app_config(pool: &Pool, patch: &Value) -> anyhow::Result<Value> {
	let mut cur = get_app_config(pool)?.as_object().unwrap().clone();
	if let Value::Object(patch_obj) = patch {
		for (k, v) in patch_obj {
			cur.insert(k.clone(), v.clone());
		}
	}
	let next = Value::Object(cur);
	set(pool, APP_CONFIG_KEY, &next)?;
	Ok(next)
}

/// collector.cjs resolveRepo() — AppConfig.rootPath → REPO_PATH env → 앱 자신의 상위 디렉토리(데모 폴백).
/// 매번 새로 계산해야 한다(Setup에서 바꾸면 재시작 없이 반영) — Node 원본과 동일 원칙.
pub fn resolve_repo(pool: &Pool) -> String {
	if let Ok(cfg) = get_app_config(pool) {
		if let Some(rp) = cfg.get("rootPath").and_then(Value::as_str) {
			if !rp.trim().is_empty() {
				return rp.trim().to_string();
			}
		}
	}
	std::env::var("REPO_PATH").unwrap_or_else(|_| {
		std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("app").to_string_lossy().into_owned()
	})
}

/// ticket.cjs currentPrefix() — Setup의 ticketPrefix → OPENRM_TICKET_PREFIX env → 'PROJ'.
pub fn ticket_prefix(pool: &Pool) -> String {
	if let Ok(cfg) = get_app_config(pool) {
		if let Some(p) = cfg.get("ticketPrefix").and_then(Value::as_str) {
			if !p.trim().is_empty() {
				return p.trim().to_string();
			}
		}
	}
	std::env::var("OPENRM_TICKET_PREFIX").unwrap_or_else(|_| "PROJ".to_string())
}
