// setup.rs — app/server/index.cjs의 Setup 페이지 전용 헬퍼(setupStatus/resolveFsPath/resolveFsList)
// 이식. 실제 폴더 선택 모달(FolderBrowserModal)이 첫 설정과 "레포 추가" 모달 양쪽에서 재사용하므로
// 이 셋은 온보딩뿐 아니라 상시 기능이다.
use crate::app_config;
use crate::db::Pool;
use crate::secrets;
use serde_json::{json, Value};
use std::path::PathBuf;

pub fn setup_status(pool: &Pool) -> anyhow::Result<Value> {
	let app_config = app_config::get_app_config(pool)?;
	let secret_keys = secrets::list_keys(pool)?;
	let configured = app_config["rootPath"].as_str().map(|s| !s.is_empty()).unwrap_or(false) && app_config["wtPath"].as_str().map(|s| !s.is_empty()).unwrap_or(false);
	Ok(json!({"appConfig": app_config, "secretKeys": secret_keys, "configured": configured}))
}

/// SETUP_CONNECTOR_MAP — "필드 하나 = AppConfig 한 키(or Secrets 한 키)" 매핑. 커넥터 id별로 어떤
/// 필드가 config(appConfig 패치) 대상이고 어떤 필드가 secret(store/secrets) 대상인지 정의.
fn connector_field_dest(connector_id: &str, field: &str) -> Option<(&'static str, &'static str)> {
	// (kind, key) — kind는 "config" | "secret"
	let m: &[(&str, &str)] = match connector_id {
		"dev" => &[("devServerUrl", "config:devServerUrl"), ("webviewPort", "config:webviewPort")],
		"github" => &[("repo", "config:githubRepo"), ("token", "secret:githubToken")],
		"githubOAuth" => &[("clientId", "config:githubOAuthClientId")],
		"db" => &[("connString", "secret:dbConnString"), ("schema", "config:dbSchema")],
		"paths" => &[("rootPath", "config:rootPath"), ("wtPath", "config:wtPath"), ("branchPrefix", "config:branchPrefix"), ("ticketPrefix", "config:ticketPrefix")],
		"app" => &[("apiRoot", "config:apiRoot"), ("nextRoot", "config:nextRoot")],
		"aws" => &[("webhook", "config:awsDeployWebhookUrl")],
		"vitals" => &[("endpoint", "config:vitalsEndpoint")],
		"slack" => &[("channelId", "config:slackAlertChannel")],
		"notion" => &[("db", "config:notionBacklogDb"), ("assignee", "config:notionBacklogAssignee"), ("service", "config:notionBacklogService"), ("platform", "config:notionBacklogPlatform")],
		"slackSign" => &[("secret", "secret:slackSigningSecret")],
		"deploy" => &[("repo", "config:deployRepo"), ("base", "config:deployBase")],
		// "고스티도 tmux도 설정 토글로 제공해야해" — SetupPage 온보딩 커넥터는 아니지만 같은 메커니즘 재사용.
		"terminal" => &[("ghostty", "config:terminalGhostty"), ("tmux", "config:terminalTmux")],
		_ => return None,
	};
	let (_, dest) = m.iter().find(|(f, _)| *f == field)?;
	dest.split_once(':')
}

fn connector_known(connector_id: &str) -> bool {
	["dev", "github", "githubOAuth", "db", "paths", "app", "aws", "vitals", "slack", "notion", "slackSign", "deploy", "terminal"].contains(&connector_id)
}

/// POST /api/setup/connectors/:id — 필드별로 매핑에 없으면 추측하지 말고 건너뛴다(skipped로 보고).
pub fn post_connector(pool: &Pool, connector_id: &str, fields: &Value) -> anyhow::Result<Value> {
	if !connector_known(connector_id) {
		return Ok(json!({"ok": false, "error": format!("unknown connector: {connector_id}"), "status": 404}));
	}
	let mut cfg_patch = serde_json::Map::new();
	let mut skipped = Vec::new();
	if let Some(obj) = fields.as_object() {
		for (k, v) in obj {
			match connector_field_dest(connector_id, k) {
				Some(("config", key)) => {
					cfg_patch.insert(key.to_string(), v.clone());
				}
				Some(("secret", key)) => {
					let s = if v.is_null() { String::new() } else { v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()) };
					secrets::set(pool, key, &s)?;
				}
				_ => skipped.push(k.clone()),
			}
		}
	}
	if !cfg_patch.is_empty() {
		app_config::update_app_config(pool, &Value::Object(cfg_patch))?;
	}
	let mut status = setup_status(pool)?;
	status["skipped"] = json!(skipped);
	Ok(status)
}

fn expand_tilde(raw: &str) -> String {
	if raw == "~" || raw.starts_with("~/") {
		let home = std::env::var("HOME").unwrap_or_default();
		return format!("{home}{}", &raw[1..]);
	}
	raw.to_string()
}

fn git_out(args: &[&str], cwd: &str) -> String {
	std::process::Command::new("git")
		.arg("-C")
		.arg(cwd)
		.args(args)
		.output()
		.ok()
		.filter(|o| o.status.success())
		.map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
		.unwrap_or_default()
}

fn blank_fs_resolve() -> Value {
	json!({"exists": false, "isDirectory": false, "isGitRepo": false, "gitRoot": null, "existingWorktrees": []})
}

/// FolderPicker 실시간 검증(타이핑 중 라이브 호출) — ~ 확장, 절대경로 resolve, 디렉토리/깃레포/워크트리
/// 조회. 절대 실패하지 않는다 — 어떤 문제든 "아직 없음"(전부 false/빈배열)으로 degrade.
/// ⚠️ 축소: Node의 path.resolve()는 순수 문자열 정규화(파일시스템 접근 없음)라 심볼릭 링크를 그대로
/// 남기는데, 여기선 std::fs::canonicalize()를 써서 심볼릭 링크를 실제 타깃으로 풀어 보여준다 — 존재
/// 여부/디렉토리 여부/git 정보는 동일하게 맞지만, 심볼릭 링크로 들어간 경로일 때 화면에 보이는 경로
/// 문자열 자체가 사용자가 타이핑한 것과 달라질 수 있다(기능에는 영향 없음).
pub fn resolve_fs_path(raw: &str) -> Value {
	let p = raw.trim();
	if p.is_empty() {
		return blank_fs_resolve();
	}
	let expanded = expand_tilde(p);
	let resolved = match std::fs::canonicalize(&expanded) {
		Ok(p) => p,
		// canonicalize 실패(경로가 아직 없음 등)해도 exists:false로 정상 응답 — Node의 catch-and-degrade와 동일.
		Err(_) => return blank_fs_resolve(),
	};
	let resolved_str = resolved.to_string_lossy().into_owned();
	let Ok(meta) = std::fs::metadata(&resolved) else { return blank_fs_resolve() };
	if !meta.is_dir() {
		return json!({"exists": true, "isDirectory": false, "isGitRepo": false, "gitRoot": null, "existingWorktrees": []});
	}
	let top = git_out(&["rev-parse", "--show-toplevel"], &resolved_str).trim().to_string();
	if top.is_empty() {
		return json!({"exists": true, "isDirectory": true, "isGitRepo": false, "gitRoot": null, "existingWorktrees": []});
	}
	let porcelain = git_out(&["worktree", "list", "--porcelain"], &resolved_str);
	let mut worktrees = Vec::new();
	let mut cur_path: Option<String> = None;
	let mut cur_branch: Option<String> = None;
	for line in porcelain.lines() {
		if let Some(v) = line.strip_prefix("worktree ") {
			cur_path = Some(v.trim().to_string());
			cur_branch = None;
		} else if let Some(v) = line.strip_prefix("branch ") {
			cur_branch = Some(v.trim().trim_start_matches("refs/heads/").to_string());
		} else if line.is_empty() {
			if let Some(p) = cur_path.take() {
				worktrees.push(json!({"path": p, "branch": cur_branch.take()}));
			}
		}
	}
	if let Some(p) = cur_path {
		worktrees.push(json!({"path": p, "branch": cur_branch}));
	}
	json!({"exists": true, "isDirectory": true, "isGitRepo": true, "gitRoot": top, "existingWorktrees": worktrees})
}

/// resolveFsList — 폴더 선택 모달용 서버측 디렉토리 브라우저(브라우저 showDirectoryPicker의 대체).
pub fn resolve_fs_list(raw: &str) -> Value {
	let raw = if raw.trim().is_empty() { "~" } else { raw.trim() };
	let expanded = expand_tilde(raw);
	let resolved: PathBuf = match std::fs::canonicalize(&expanded) {
		Ok(p) => p,
		Err(_) => match std::path::Path::new(&expanded).is_absolute() {
			true => PathBuf::from(&expanded),
			false => return json!({"ok": false, "error": "잘못된 경로"}),
		},
	};
	let meta = match std::fs::metadata(&resolved) {
		Ok(m) => m,
		Err(_) => return json!({"ok": false, "error": format!("경로를 찾을 수 없습니다: {}", resolved.display())}),
	};
	if !meta.is_dir() {
		return json!({"ok": false, "error": format!("디렉토리가 아닙니다: {}", resolved.display())});
	}
	let entries_iter = match std::fs::read_dir(&resolved) {
		Ok(e) => e,
		Err(e) => return json!({"ok": false, "error": format!("읽기 실패: {e}")}),
	};
	let mut entries: Vec<(String, String)> = Vec::new();
	for entry in entries_iter.filter_map(Result::ok) {
		let name = entry.file_name().to_string_lossy().into_owned();
		if name.starts_with('.') {
			continue;
		}
		if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
			entries.push((name.clone(), entry.path().to_string_lossy().into_owned()));
		}
	}
	entries.sort_by(|a, b| a.0.cmp(&b.0));
	let entries_json: Vec<Value> = entries.into_iter().map(|(name, path)| json!({"name": name, "path": path})).collect();
	let parent = resolved.parent().map(|p| p.to_string_lossy().into_owned());
	json!({"ok": true, "path": resolved.to_string_lossy(), "parent": parent, "entries": entries_json})
}
