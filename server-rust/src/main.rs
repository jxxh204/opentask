// main.rs — app/server/index.cjs(2460줄, 150개 라우트)의 Rust 이식 시작점.
// 지금 포팅된 범위: /api/health, /api/settings(GET/POST), /api/blocked-periods(GET/POST/DELETE),
// 정적 프론트(app/dist) 서빙. 나머지 라우트는 아직 없음 — index.cjs와 나란히 두고 커버리지를
// 넓혀가는 중(§PORT_STATUS.md 없음, 진행상황은 대화/커밋 로그 참고).
mod blocked_periods;
mod db;
mod folders;
mod repos;
mod settings;
mod tasks;

use axum::{
	extract::{Path, State},
	http::StatusCode,
	response::IntoResponse,
	routing::{delete, get},
	Json, Router,
};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::services::ServeDir;

struct AppState {
	pool: db::Pool,
	host: String,
	port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	tracing_subscriber::fmt::init();

	let host = std::env::var("OPENRM_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
	let port: u16 = std::env::var("OPENRM_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8770);

	// Node의 OPENRM_DATA_DIR 관례 그대로 — 이 값이 없으면(단독 실행 테스트) 로컬 ./.openrm-rust로.
	let data_dir = std::env::var("OPENRM_DATA_DIR")
		.map(std::path::PathBuf::from)
		.unwrap_or_else(|_| std::path::PathBuf::from(".openrm-rust"));
	let pool = db::open(&data_dir)?;

	let state = Arc::new(AppState { pool, host: host.clone(), port });

	// app/dist(vite build 산출물) — 이 바이너리 기준 상대경로. Node index.cjs와 같은 규칙
	// (path.join(__dirname, '..', 'dist')): 이 크레이트가 <repo>/server-rust에 있으므로 ../app/dist.
	let dist_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("app").join("dist");

	let app = Router::new()
		.route("/api/health", get(health))
		.route("/api/settings", get(get_settings).post(post_settings))
		.route("/api/blocked-periods", get(list_blocked_periods).post(create_blocked_period))
		.route("/api/blocked-periods/:id", delete(delete_blocked_period))
		.route("/api/repos", get(list_repos).post(create_repo))
		.route("/api/repos/:id", axum::routing::patch(update_repo).delete(delete_repo))
		.route("/api/folders", axum::routing::post(create_folder))
		.route("/api/folders/:id", axum::routing::patch(update_folder).delete(delete_folder))
		.route("/api/folders/:id/archive", axum::routing::post(archive_folder))
		.route("/api/folders/:id/restore", axum::routing::post(restore_folder))
		.route("/api/tasks", axum::routing::post(create_task))
		.route("/api/tasks/:id", axum::routing::patch(update_task).delete(delete_task))
		.fallback_service(ServeDir::new(dist_dir))
		.with_state(state);

	let addr: SocketAddr = format!("{host}:{port}").parse()?;
	tracing::info!("🦀  Rust 백엔드 — http://{addr}");
	let listener = tokio::net::TcpListener::bind(addr).await?;
	axum::serve(listener, app).await?;
	Ok(())
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
	Json(json!({
		"ok": true,
		"repo": std::env::var("OPENRM_DATA_DIR").unwrap_or_default(),
		"state": "rust",
		"host": state.host,
		"port": state.port,
	}))
}

async fn get_settings() -> Json<Value> {
	Json(json!({"ok": true, "settings": settings::load()}))
}

async fn post_settings(Json(patch): Json<Value>) -> Json<Value> {
	Json(json!({"ok": true, "settings": settings::save(&patch)}))
}

async fn list_blocked_periods(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	match blocked_periods::list(&state.pool) {
		Ok(items) => (StatusCode::OK, Json(json!(items))).into_response(),
		Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
	}
}

async fn create_blocked_period(State(state): State<Arc<AppState>>, Json(input): Json<blocked_periods::CreateInput>) -> impl IntoResponse {
	match blocked_periods::create(&state.pool, input) {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
	}
}

async fn delete_blocked_period(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match blocked_periods::remove(&state.pool, &id) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
	}
}

async fn list_repos(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	match repos::list(&state.pool) {
		Ok(items) => {
			let with_avatar: Vec<Value> = items
				.into_iter()
				.map(|mut r| {
					if let Some(path) = r.get("path").and_then(|v| v.as_str()).map(str::to_string) {
						r["ownerAvatarUrl"] = repos::derive_owner_avatar(&path).map(Value::String).unwrap_or(Value::Null);
					}
					r
				})
				.collect();
			(StatusCode::OK, Json(json!(with_avatar))).into_response()
		}
		Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
	}
}

async fn create_repo(State(state): State<Arc<AppState>>, Json(input): Json<Value>) -> impl IntoResponse {
	match repos::create(&state.pool, &input) {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
	}
}

async fn update_repo(State(state): State<Arc<AppState>>, Path(id): Path<String>, Json(patch): Json<Value>) -> impl IntoResponse {
	match repos::update(&state.pool, &id, &patch) {
		Ok(Some(v)) => (StatusCode::OK, Json(v)).into_response(),
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
	}
}

async fn delete_repo(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match repos::remove(&state.pool, &id) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
	}
}

fn err500(e: anyhow::Error) -> axum::response::Response {
	(StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response()
}

async fn create_folder(State(state): State<Arc<AppState>>, Json(input): Json<Value>) -> impl IntoResponse {
	match folders::create(&state.pool, &input) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn update_folder(State(state): State<Arc<AppState>>, Path(id): Path<String>, Json(patch): Json<Value>) -> impl IntoResponse {
	match folders::update(&state.pool, &id, &patch) {
		Ok(Some(v)) => (StatusCode::OK, Json(v)).into_response(),
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => err500(e),
	}
}

// Node판은 삭제 전 Orchestrator.stopConductor(id)로 살아있는 지휘자 세션을 먼저 정리한다 — 오케스트레이터가
// 아직 미포팅이라 이 부수효과는 지금 없음(§ folders.rs 상단에 대응 없음, TODO로 남김).
async fn delete_folder(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match folders::remove(&state.pool, &id) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn archive_folder(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match folders::archive(&state.pool, &id) {
		Ok(Some(v)) => (StatusCode::OK, Json(v)).into_response(),
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn restore_folder(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match folders::restore(&state.pool, &id) {
		Ok(Some(v)) => (StatusCode::OK, Json(v)).into_response(),
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn create_task(State(state): State<Arc<AppState>>, Json(input): Json<Value>) -> impl IntoResponse {
	match tasks::create(&state.pool, &input) {
		Ok(v) => (StatusCode::OK, Json(tasks::compose_task(v))).into_response(),
		Err(e) => err500(e),
	}
}

// PATCH /api/tasks/:id — index.cjs 795~812와 동일 순서: 필드 패치(해당 키 있을 때만) → refile/reorder
// (folderId/beforeTaskId 키가 있을 때만) → composeTask로 재조회.
async fn update_task(State(state): State<Arc<AppState>>, Path(id): Path<String>, Json(patch): Json<Value>) -> impl IntoResponse {
	let cur = match tasks::get(&state.pool, &id) {
		Ok(Some(v)) => v,
		Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => return err500(e),
	};
	let has_edit_key = ["name", "desc", "kind", "startPrompt", "repoId", "dueDate", "durationDays", "completedAt", "color"]
		.iter()
		.any(|k| patch.get(*k).is_some());
	if has_edit_key {
		if let Err(e) = tasks::update(&state.pool, &id, &patch) {
			return err500(e);
		}
	}
	if patch.get("folderId").is_some() || patch.get("beforeTaskId").is_some() {
		let target_folder = if patch.get("folderId").is_some() {
			patch.get("folderId").and_then(|v| v.as_str()).map(str::to_string)
		} else {
			cur["folder_id"].as_str().map(str::to_string)
		};
		let before = patch.get("beforeTaskId").and_then(|v| v.as_str());
		if let Err(e) = tasks::move_task(&state.pool, &id, target_folder.as_deref(), before) {
			return err500(e);
		}
	}
	match tasks::get(&state.pool, &id) {
		Ok(Some(v)) => (StatusCode::OK, Json(tasks::compose_task(v))).into_response(),
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn delete_task(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match tasks::remove(&state.pool, &id) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}
