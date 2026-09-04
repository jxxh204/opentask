// github_connect.rs — app/server/githubConnect.cjs 이식. GitHub를 "버튼 한 번"으로 연동하는 두 방법.
//   ① gh CLI 위임(ghStatus) — 로컬에 이미 `gh auth login`돼 있으면 그 세션을 그대로 씀. 설정 0.
//   ② OAuth Device Flow(start/poll) — client_secret이 필요 없는 공개 클라이언트 플로우.
use crate::app_config;
use crate::db::Pool;
use crate::secrets;
use serde_json::{json, Value};
use std::sync::LazyLock;
use tokio::sync::Mutex;

/// ① gh CLI 위임.
pub async fn gh_status(pool: &Pool) -> Value {
	let mut cmd = tokio::process::Command::new("gh");
	cmd.args(["api", "user", "--jq", ".login"]);
	if let Ok(Some(token)) = secrets::get(pool, "githubToken") {
		cmd.env("GH_TOKEN", token);
	}
	let login = match tokio::time::timeout(std::time::Duration::from_millis(10000), cmd.output()).await {
		Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
		_ => String::new(),
	};
	if login.is_empty() {
		json!({"ok": true, "loggedIn": false})
	} else {
		json!({"ok": true, "loggedIn": true, "username": login})
	}
}

async fn https_json(path: &str, payload: &Value) -> Result<(u16, String), String> {
	let client = reqwest::Client::new();
	let resp = tokio::time::timeout(std::time::Duration::from_millis(15000), client.post(format!("https://github.com{path}")).header("accept", "application/json").json(payload).send()).await;
	match resp {
		Ok(Ok(r)) => {
			let status = r.status().as_u16();
			let body = r.text().await.unwrap_or_default();
			Ok((status, body))
		}
		Ok(Err(e)) => Err(e.to_string()),
		Err(_) => Err("요청 타임아웃".to_string()),
	}
}

struct PendingDevice {
	device_code: String,
	client_id: String,
	expires_at: i64,
}
static PENDING: LazyLock<Mutex<Option<PendingDevice>>> = LazyLock::new(|| Mutex::new(None));

/// ② OAuth Device Flow — 시작(사용자에게 보여줄 코드 발급).
pub async fn oauth_start(pool: &Pool) -> Value {
	let cfg = match app_config::get_app_config(pool) {
		Ok(c) => c,
		Err(e) => return json!({"ok": false, "error": e.to_string()}),
	};
	let Some(client_id) = cfg["githubOAuthClientId"].as_str().filter(|s| !s.is_empty()) else {
		return json!({"ok": false, "error": "GitHub OAuth App Client ID가 설정되지 않았습니다."});
	};
	let (status, body) = match https_json("/login/device/code", &json!({"client_id": client_id, "scope": "repo"})).await {
		Ok(v) => v,
		Err(e) => return json!({"ok": false, "error": e}),
	};
	if status != 200 {
		return json!({"ok": false, "error": format!("GitHub 응답 오류 ({status})")});
	}
	let Ok(data) = serde_json::from_str::<Value>(&body) else {
		return json!({"ok": false, "error": "응답 파싱 실패"});
	};
	let Some(device_code) = data["device_code"].as_str() else {
		return json!({"ok": false, "error": data["error_description"].as_str().unwrap_or("device_code 발급 실패")});
	};
	let expires_in = data["expires_in"].as_i64().unwrap_or(900);
	*PENDING.lock().await = Some(PendingDevice { device_code: device_code.to_string(), client_id: client_id.to_string(), expires_at: chrono::Utc::now().timestamp_millis() + expires_in * 1000 });
	json!({"ok": true, "userCode": data["user_code"], "verificationUri": data["verification_uri"], "interval": data["interval"].as_i64().unwrap_or(5), "expiresIn": expires_in})
}

/// ② OAuth Device Flow — 폴링(사용자가 코드를 승인했는지 확인).
pub async fn oauth_poll(pool: &Pool) -> Value {
	let (device_code, client_id) = {
		let mut guard = PENDING.lock().await;
		let Some(p) = guard.as_ref() else { return json!({"ok": false, "error": "먼저 연동을 시작하세요."}) };
		if chrono::Utc::now().timestamp_millis() > p.expires_at {
			*guard = None;
			return json!({"ok": false, "error": "코드가 만료됐습니다 — 다시 시도하세요."});
		}
		(p.device_code.clone(), p.client_id.clone())
	};
	let (status, body) = match https_json("/login/oauth/access_token", &json!({"client_id": client_id, "device_code": device_code, "grant_type": "urn:ietf:params:oauth:grant-type:device_code"})).await {
		Ok(v) => v,
		Err(e) => return json!({"ok": false, "error": e}),
	};
	if status != 200 {
		return json!({"ok": false, "error": format!("GitHub 응답 오류 ({status})")});
	}
	let Ok(data) = serde_json::from_str::<Value>(&body) else {
		return json!({"ok": false, "error": "응답 파싱 실패"});
	};
	match data["error"].as_str() {
		Some("authorization_pending") => return json!({"ok": true, "done": false}),
		Some("slow_down") => return json!({"ok": true, "done": false, "slowDown": true}),
		Some(_) => {
			*PENDING.lock().await = None;
			return json!({"ok": false, "error": data["error_description"].as_str().or_else(|| data["error"].as_str()).unwrap_or("oauth error")});
		}
		None => {}
	}
	let Some(access_token) = data["access_token"].as_str() else {
		return json!({"ok": false, "error": "토큰 발급 실패"});
	};
	if let Err(e) = secrets::set(pool, "githubToken", access_token) {
		return json!({"ok": false, "error": e.to_string()});
	}
	*PENDING.lock().await = None;

	let client = reqwest::Client::new();
	let who = tokio::time::timeout(std::time::Duration::from_millis(10000), client.get("https://api.github.com/user").header("user-agent", "openrm").header("accept", "application/json").bearer_auth(access_token).send()).await;
	let username = match who {
		Ok(Ok(r)) => r.json::<Value>().await.ok().and_then(|v| v["login"].as_str().map(str::to_string)),
		_ => None,
	};
	json!({"ok": true, "done": true, "username": username})
}
