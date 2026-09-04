// main.rs — app/server/index.cjs(2460줄, 150개 라우트)의 Rust 이식 시작점.
// 지금 포팅된 범위: /api/health, /api/settings(GET/POST), /api/blocked-periods(GET/POST/DELETE),
// 정적 프론트(app/dist) 서빙. 나머지 라우트는 아직 없음 — index.cjs와 나란히 두고 커버리지를
// 넓혀가는 중(§PORT_STATUS.md 없음, 진행상황은 대화/커밋 로그 참고).
use opentask_server::{blocked_periods, branches, cockpit, control, cron_jobs, db, decisions, env_vars, folders, github_connect, holidays, link_brief, link_briefs, notify, orchestrator, repo_add, repos, scheduler, settings, setup, subtask_sessions, subtasks, tasks, term, transcript, worktrees};

use axum::{
	extract::{
		ws::{Message, WebSocket, WebSocketUpgrade},
		Path, Query, State,
	},
	http::StatusCode,
	response::IntoResponse,
	routing::{delete, get},
	Json, Router,
};
use futures_util::{SinkExt, StreamExt};
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
	scheduler::start(pool.clone());

	// "맥북 껏다킬거야. 세션전부 다시 살아나고 태스크도 살아나야해" — 서버가 뜨자마자 재시작 전 실제로
	// 떠 있었던 세션(스냅샷 있는 것)만 골라 한 번에 복원 + 하이브마인드 백그라운드 세션도 미리 켜둔다.
	// 부팅을 막지 않는 fire-and-forget(§ index.cjs 동일 주석).
	{
		let pool2 = pool.clone();
		tokio::spawn(async move {
			match orchestrator::restore_all_on_boot(&pool2).await {
				Ok(r) => tracing::info!("🔁  세션 복원: 태스크 매니저 {}건 (폴더 {}개 확인)", r["restoredConductors"], r["folders"]),
				Err(e) => tracing::warn!("⚠️  세션 복원 실패: {e}"),
			}
		});
	}
	tokio::spawn(async {
		control::start(None).await;
	});

	// control.cjs의 loop(Control.checkStalled, 60000) / loop(Control.runOpsModeTick, 15*60000)와 동일 —
	// index.cjs의 broadcast()(보드 변경 WS 푸시)는 아직 포팅 안 해 생략(§ 알려진 축소 지점, 기능 영향 없음).
	tokio::spawn(async {
		loop {
			control::check_stalled().await;
			tokio::time::sleep(std::time::Duration::from_secs(60)).await;
		}
	});
	tokio::spawn(async {
		loop {
			control::run_ops_mode_tick().await;
			tokio::time::sleep(std::time::Duration::from_secs(15 * 60)).await;
		}
	});
	// orchestrator.cjs의 loop(Orchestrator.checkStalledSubtasks, 60000)와 동일 — 침묵형 막힘 안전망.
	{
		let pool2 = pool.clone();
		tokio::spawn(async move {
			loop {
				orchestrator::check_stalled_subtasks(&pool2).await;
				tokio::time::sleep(std::time::Duration::from_secs(60)).await;
			}
		});
	}

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
		.route("/api/repos/clone", axum::routing::post(post_repos_clone))
		.route("/api/repos/init", axum::routing::post(post_repos_init))
		.route("/api/repos/:id", axum::routing::patch(update_repo).delete(delete_repo))
		.route("/api/folders", axum::routing::post(create_folder))
		.route("/api/folders/:id", axum::routing::patch(update_folder).delete(delete_folder))
		.route("/api/folders/:id/archive", axum::routing::post(archive_folder))
		.route("/api/folders/:id/restore", axum::routing::post(restore_folder))
		.route("/api/tasks", axum::routing::post(create_task))
		.route("/api/tasks/:id", axum::routing::patch(update_task).delete(delete_task))
		.route("/api/sessions/board", get(get_board))
		.route("/api/cockpit", get(get_cockpit))
		.route("/api/link-briefs", get(get_link_briefs))
		.route("/api/link-briefs/ensure", axum::routing::post(post_link_briefs_ensure))
		.route("/api/folders/archived", get(get_archived_folders))
		.route("/api/subtasks", axum::routing::post(create_orphan_subtask))
		.route("/api/subtasks/reorder", axum::routing::post(reorder_orphan_subtasks))
		.route("/api/subtasks/:id", axum::routing::patch(update_subtask).delete(delete_subtask))
		.route("/api/tasks/:id/subtasks", axum::routing::post(create_task_subtask))
		.route("/api/tasks/:id/subtasks/reorder", axum::routing::post(reorder_task_subtasks))
		.route("/api/folders/:id/decisions", get(get_folder_decisions))
		.route("/api/cron-jobs", get(list_cron_jobs).post(create_cron_job))
		.route("/api/cron-jobs/:id", axum::routing::patch(update_cron_job).delete(delete_cron_job))
		.route("/api/setup/env", get(list_env_vars).post(create_env_var))
		.route("/api/setup/env/:id", axum::routing::patch(update_env_var).delete(delete_env_var))
		.route("/term", get(term_ws_upgrade))
		.route("/api/setup/status", get(get_setup_status))
		.route("/api/setup/connectors/:id", axum::routing::post(post_setup_connector))
		.route("/api/setup/fs/resolve", get(get_setup_fs_resolve))
		.route("/api/setup/fs/list", get(get_setup_fs_list))
		.route("/api/setup/tmux", get(get_setup_tmux))
		.route("/api/setup/terminal-capabilities", get(get_setup_terminal_capabilities))
		.route("/api/setup/github/gh-status", get(get_setup_github_status))
		.route("/api/setup/github/oauth/start", axum::routing::post(post_setup_github_oauth_start))
		.route("/api/setup/github/oauth/poll", axum::routing::post(post_setup_github_oauth_poll))
		.route("/api/localip", get(get_localip))
		.route("/api/holidays/countries", get(get_holidays_countries))
		.route("/api/holidays", get(get_holidays))
		.route("/api/dev/upload-image", axum::routing::post(post_dev_upload_image))
		.route("/api/branches", axum::routing::post(create_branch))
		.route("/api/branches/:id", axum::routing::patch(update_branch).delete(delete_branch))
		.route("/api/branches/:id/links", axum::routing::post(add_branch_link))
		.route("/api/branch-links/:id", delete(delete_branch_link))
		.route("/api/term", get(get_term_list))
		.route("/api/term/create", axum::routing::post(post_term_create))
		.route("/api/term/kill", axum::routing::post(post_term_kill))
		.route("/api/term/open-external", axum::routing::post(post_term_open_external))
		.route("/api/repos/:id/worktrees", get(get_repo_worktrees))
		.route("/api/repos/:id/worktrees/count", get(get_repo_worktrees_count))
		.route("/api/repos/:id/worktrees/prune-stale", axum::routing::post(post_prune_stale_worktrees))
		.route("/api/notify/heartbeat", axum::routing::post(post_notify_heartbeat))
		.route("/api/notify/pending", get(get_notify_pending))
		.route("/api/tasks/:id/subtask-work/start", axum::routing::post(post_subtask_work_start))
		.route("/api/tasks/:id/subtask-work/advance", axum::routing::post(post_subtask_work_advance))
		.route("/api/tasks/:id/subtask-work/report-blocked", axum::routing::post(post_subtask_work_blocked))
		.route("/api/tasks/:id/subtask-work/progress", axum::routing::post(post_subtask_work_progress))
		.route("/api/tasks/:id/subtask-work/verify", axum::routing::post(post_subtask_work_verify))
		.route("/api/tasks/:id/subtask-work/state", get(get_subtask_work_state))
		.route("/api/subtask-sessions/:id/report", get(get_subtask_session_report))
		.route("/api/tasks/:id/verify", axum::routing::post(post_task_verify))
		.route("/api/folders/:id/orchestrate/start", axum::routing::post(post_orch_start))
		.route("/api/folders/:id/orchestrate/advance", axum::routing::post(post_orch_advance))
		.route("/api/folders/:id/orchestrate/stop", axum::routing::post(post_orch_stop))
		.route("/api/folders/:id/orchestrate/state", get(get_orch_state))
		.route("/api/folders/:id/conductor/start", axum::routing::post(post_conductor_start))
		.route("/api/folders/:id/conductor/stop", axum::routing::post(post_conductor_stop))
		.route("/api/folders/:id/conductor/say", axum::routing::post(post_conductor_say))
		.route("/api/folders/:id/conductor/tell", axum::routing::post(post_conductor_tell))
		.route("/api/folders/:id/conductor/event", axum::routing::post(post_conductor_event))
		.route("/api/folders/:id/conductor/feed", get(get_conductor_feed))
		.route("/api/folders/:id/conductor/set-kind", axum::routing::post(post_conductor_set_kind))
		.route("/api/control/state", get(get_control_state))
		.route("/api/control/start", axum::routing::post(post_control_start))
		.route("/api/control/stop", axum::routing::post(post_control_stop))
		.route("/api/control/reset", axum::routing::post(post_control_reset))
		.route("/api/control/interrupt", axum::routing::post(post_control_interrupt))
		.route("/api/control/ask", axum::routing::post(post_control_ask))
		.route("/api/control/live-prompt", get(get_control_live_prompt))
		.route("/api/control/live-action", axum::routing::post(post_control_live_action))
		.route("/api/control/transcript", get(get_control_transcript))
		.route("/api/sessions/restorable", get(get_sessions_restorable))
		.route("/api/sessions/restore", axum::routing::post(post_sessions_restore))
		.route("/api/sessions/forget", axum::routing::post(post_sessions_forget))
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
	match tasks::create(&state.pool, &input).and_then(|v| tasks::compose_task(&state.pool, v)) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
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
		Ok(Some(v)) => match tasks::compose_task(&state.pool, v) {
			Ok(composed) => (StatusCode::OK, Json(composed)).into_response(),
			Err(e) => err500(e),
		},
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

// GET /api/sessions/board — index.cjs 541~542과 동일: 활성 폴더 목록 + 각 폴더의 태스크(중첩 브랜치/
// 리뷰/서브태스크까지) + inbox(미분류) + notes(메인태스크 없는 서브태스크).
async fn get_board(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	let folders_list = match folders::list(&state.pool) {
		Ok(v) => v,
		Err(e) => return err500(e),
	};
	match tasks::board(&state.pool, folders_list) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn get_archived_folders(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	let folders_list = match folders::list_archived(&state.pool) {
		Ok(v) => v,
		Err(e) => return err500(e),
	};
	match tasks::board(&state.pool, folders_list) {
		Ok(v) => (StatusCode::OK, Json(json!({"folders": v["folders"]}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn create_orphan_subtask(State(state): State<Arc<AppState>>, Json(mut input): Json<Value>) -> impl IntoResponse {
	input["taskId"] = Value::Null;
	match subtasks::create(&state.pool, &input) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize)]
struct ReorderInput {
	ids: Vec<String>,
}

async fn reorder_orphan_subtasks(State(state): State<Arc<AppState>>, Json(input): Json<ReorderInput>) -> impl IntoResponse {
	match subtasks::reorder(&state.pool, None, &input.ids) {
		Ok(list) => (StatusCode::OK, Json(json!({"ok": true, "subtasks": list}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn create_task_subtask(State(state): State<Arc<AppState>>, Path(task_id): Path<String>, Json(mut input): Json<Value>) -> impl IntoResponse {
	input["taskId"] = Value::String(task_id.clone());
	match subtasks::create(&state.pool, &input) {
		Ok(v) => {
			// "모든 일정을 더하기해서 자동으로 적용" — Node판과 동일하게 생성 직후 부모 태스크 기간을 재계산.
			if let Err(e) = tasks::recompute_from_subtasks(&state.pool, &task_id) {
				return err500(e);
			}
			(StatusCode::OK, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

async fn reorder_task_subtasks(State(state): State<Arc<AppState>>, Path(task_id): Path<String>, Json(input): Json<ReorderInput>) -> impl IntoResponse {
	match subtasks::reorder(&state.pool, Some(&task_id), &input.ids) {
		Ok(list) => (StatusCode::OK, Json(json!({"ok": true, "subtasks": list}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn update_subtask(State(state): State<Arc<AppState>>, Path(id): Path<String>, Json(patch): Json<Value>) -> impl IntoResponse {
	match subtasks::update(&state.pool, &id, &patch) {
		Ok(Some(v)) => {
			if let Some(task_id) = v["task_id"].as_str() {
				if let Err(e) = tasks::recompute_from_subtasks(&state.pool, task_id) {
					return err500(e);
				}
			}
			(StatusCode::OK, Json(v)).into_response()
		}
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn get_folder_decisions(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match decisions::list_by_folder(&state.pool, &id, 100) {
		Ok(v) => (StatusCode::OK, Json(json!({"ok": true, "decisions": v}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn list_cron_jobs(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	match cron_jobs::list(&state.pool) {
		Ok(v) => (StatusCode::OK, Json(json!(v))).into_response(),
		Err(e) => err500(e),
	}
}

async fn create_cron_job(State(state): State<Arc<AppState>>, Json(input): Json<Value>) -> impl IntoResponse {
	match cron_jobs::create(&state.pool, &input) {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

async fn update_cron_job(State(state): State<Arc<AppState>>, Path(id): Path<String>, Json(patch): Json<Value>) -> impl IntoResponse {
	match cron_jobs::update(&state.pool, &id, &patch) {
		Ok(Some(v)) => (StatusCode::OK, Json(v)).into_response(),
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn delete_cron_job(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match cron_jobs::remove(&state.pool, &id) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn list_env_vars(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	match env_vars::list(&state.pool) {
		Ok(v) => (StatusCode::OK, Json(json!(v))).into_response(),
		Err(e) => err500(e),
	}
}

async fn create_env_var(State(state): State<Arc<AppState>>, Json(input): Json<Value>) -> impl IntoResponse {
	match env_vars::create(&state.pool, &input) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn update_env_var(State(state): State<Arc<AppState>>, Path(id): Path<String>, Json(patch): Json<Value>) -> impl IntoResponse {
	match env_vars::update(&state.pool, &id, &patch) {
		Ok(Some(v)) => (StatusCode::OK, Json(v)).into_response(),
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn delete_env_var(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match env_vars::remove(&state.pool, &id) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn resolve_repo_path(pool: &db::Pool, id: &str) -> Result<String, axum::response::Response> {
	match repos::get(pool, id) {
		Ok(Some(r)) => Ok(r["path"].as_str().unwrap_or_default().to_string()),
		Ok(None) => Err((StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "repo not found"}))).into_response()),
		Err(e) => Err(err500(e)),
	}
}

async fn get_repo_worktrees(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	let path = match resolve_repo_path(&state.pool, &id).await {
		Ok(p) => p,
		Err(e) => return e,
	};
	(StatusCode::OK, Json(worktrees::list(&state.pool, Some(&path)).await)).into_response()
}

async fn get_repo_worktrees_count(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	let path = match resolve_repo_path(&state.pool, &id).await {
		Ok(p) => p,
		Err(e) => return e,
	};
	(StatusCode::OK, Json(json!({"count": worktrees::count(&state.pool, Some(&path)).await}))).into_response()
}

#[derive(serde::Deserialize, Default)]
struct PruneStaleInput {
	#[serde(rename = "dryRun", default)]
	dry_run: bool,
	#[serde(rename = "includeDirty", default)]
	include_dirty: bool,
}

async fn get_subtask_work_state(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match orchestrator::get_subtask_work_state(&state.pool, &id).await {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn get_subtask_session_report(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match subtask_sessions::get_by_id(&state.pool, &id) {
		Ok(Some(s)) if s["report_html"].as_str().is_some() => {
			let html = s["report_html"].as_str().unwrap_or_default().to_string();
			(StatusCode::OK, [("content-type", "text/html; charset=utf-8")], html).into_response()
		}
		Ok(_) => (StatusCode::NOT_FOUND, [("content-type", "text/plain; charset=utf-8")], "리포트 없음".to_string()).into_response(),
		Err(e) => err500(e),
	}
}

async fn post_notify_heartbeat() -> impl IntoResponse {
	notify::heartbeat();
	(StatusCode::OK, Json(json!({"ok": true}))).into_response()
}

async fn get_notify_pending() -> impl IntoResponse {
	(StatusCode::OK, Json(json!({"ok": true, "items": notify::drain_pending()}))).into_response()
}

async fn post_subtask_work_start(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match orchestrator::start_subtask_work(&state.pool, &id).await {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize, Default)]
struct AdvanceInput {
	#[serde(rename = "reportHtml")]
	report_html: Option<String>,
}

async fn post_subtask_work_advance(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<AdvanceInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match orchestrator::advance_subtask_work(&state.pool, &id, input.report_html.as_deref()).await {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize, Default)]
struct ReasonInput {
	reason: Option<String>,
}

async fn post_subtask_work_blocked(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<ReasonInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match orchestrator::report_subtask_blocked(&state.pool, &id, input.reason.as_deref().unwrap_or_default()).await {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize, Default)]
struct TextInput {
	text: Option<String>,
}

async fn post_subtask_work_progress(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<TextInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match orchestrator::report_subtask_progress(&state.pool, &id, input.text.as_deref().unwrap_or_default()).await {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize, Default)]
struct VerifyInput {
	text: Option<String>,
	url: Option<String>,
	source: Option<String>,
}

async fn post_subtask_work_verify(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<VerifyInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match orchestrator::report_subtask_verify(&state.pool, &id, input.text.as_deref().unwrap_or_default(), input.url.as_deref()).await {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

async fn post_task_verify(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<VerifyInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match orchestrator::report_task_verify(&state.pool, &id, input.text.as_deref().unwrap_or_default(), input.url.as_deref(), input.source.as_deref()).await {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

async fn post_orch_start(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match orchestrator::start(&state.pool, &id).await {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

async fn post_orch_advance(Path(id): Path<String>) -> impl IntoResponse {
	let v = orchestrator::advance(&id).await;
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn post_orch_stop(Path(id): Path<String>) -> impl IntoResponse {
	(StatusCode::OK, Json(orchestrator::stop(&id))).into_response()
}

async fn get_orch_state(Path(id): Path<String>) -> impl IntoResponse {
	(StatusCode::OK, Json(orchestrator::get_state(&id))).into_response()
}

async fn post_conductor_start(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match orchestrator::start_conductor(&state.pool, &id).await {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

async fn post_conductor_stop(Path(id): Path<String>) -> impl IntoResponse {
	(StatusCode::OK, Json(orchestrator::stop_conductor(&id))).into_response()
}

#[derive(serde::Deserialize, Default)]
struct ConductorSayInput {
	#[serde(rename = "taskId")]
	task_id: Option<String>,
	text: Option<String>,
}

async fn post_conductor_say(Path(id): Path<String>, body: Option<Json<ConductorSayInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = orchestrator::conductor_say(&id, input.task_id.as_deref().unwrap_or_default(), input.text.as_deref().unwrap_or_default());
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn post_conductor_tell(Path(id): Path<String>, body: Option<Json<TextInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = orchestrator::conductor_tell(&id, input.text.as_deref().unwrap_or_default());
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

#[derive(serde::Deserialize, Default)]
struct ConductorEventInput {
	from: Option<String>,
	to: Option<String>,
	text: Option<String>,
	kind: Option<String>,
}

async fn post_conductor_event(Path(id): Path<String>, body: Option<Json<ConductorEventInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = orchestrator::conductor_event(
		&id,
		input.from.as_deref().unwrap_or("orch"),
		input.to.as_deref().unwrap_or("orch"),
		input.text.as_deref().unwrap_or_default(),
		input.kind.as_deref().unwrap_or("msg"),
	);
	(StatusCode::OK, Json(v)).into_response()
}

async fn get_conductor_feed(Path(id): Path<String>) -> impl IntoResponse {
	(StatusCode::OK, Json(orchestrator::conductor_feed(&id))).into_response()
}

#[derive(serde::Deserialize, Default)]
struct SetKindInput {
	#[serde(rename = "taskId")]
	task_id: Option<String>,
	kind: Option<String>,
	reason: Option<String>,
}

async fn post_conductor_set_kind(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<SetKindInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match orchestrator::conductor_set_kind(&state.pool, &id, input.task_id.as_deref().unwrap_or_default(), input.kind.as_deref().unwrap_or_default(), input.reason.as_deref()) {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

async fn post_prune_stale_worktrees(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<PruneStaleInput>>) -> impl IntoResponse {
	let path = match resolve_repo_path(&state.pool, &id).await {
		Ok(p) => p,
		Err(e) => return e,
	};
	let input = body.map(|Json(b)| b).unwrap_or_default();
	(StatusCode::OK, Json(worktrees::prune_stale(&state.pool, Some(&path), input.dry_run, input.include_dirty).await)).into_response()
}

#[derive(serde::Deserialize)]
struct TermQuery {
	session: String,
	cols: Option<u16>,
	rows: Option<u16>,
	cwd: Option<String>,
}

// GET /term?session=orm-XXX&cols=&rows=&cwd= — index.cjs server.on('upgrade')와 동일 계약(§term.rs
// 상단 주석 — 재접속 스크롤백 복원은 없음, 라이브 스트리밍/리사이즈는 완전 동작).
async fn term_ws_upgrade(ws: WebSocketUpgrade, Query(q): Query<TermQuery>) -> impl IntoResponse {
	if !term::is_valid_session_name(&q.session) {
		return (StatusCode::BAD_REQUEST, "invalid session name").into_response();
	}
	let cols = q.cols.unwrap_or(120).min(400);
	let rows = q.rows.unwrap_or(32).min(150);
	let cwd = q
		.cwd
		.filter(|c| std::path::Path::new(c).is_dir())
		.unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/".to_string()));
	let target = term::base_name(&q.session);

	let entry = match term::ensure_named(&target, &cwd) {
		Ok(e) => e,
		Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
	};

	ws.on_upgrade(move |socket| handle_term_socket(socket, entry, cols, rows)).into_response()
}

async fn handle_term_socket(socket: WebSocket, entry: Arc<term::TermEntry>, cols: u16, rows: u16) {
	term::resize(&entry, cols, rows);
	let mut rx = term::subscribe(&entry);
	let (mut sink, mut stream) = socket.split();

	// 재접속(WS 재연결) 시 지금까지의 화면을 그대로 복원 — @xterm/headless+SerializeAddon과 동일 발상
	// (§ term.rs state_formatted). 라이브 브로드캐스트 구독 전에 먼저 보내야 그 사이 새 출력과 순서가
	// 안 꼬인다. 프론트(XTerm.tsx)는 문자열 메시지만 처리하므로(binaryType 미설정 — Blob은 무시) 텍스트로 보낸다.
	let restore = term::state_formatted(&entry);
	if !restore.is_empty() {
		let _ = sink.send(Message::Text(String::from_utf8_lossy(&restore).into_owned())).await;
	}

	let mut send_task = tokio::spawn(async move {
		loop {
			match rx.recv().await {
				Ok(text) => {
					if sink.send(Message::Text(text)).await.is_err() {
						break;
					}
				}
				Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
				Err(_) => break,
			}
		}
	});

	let entry2 = entry.clone();
	let mut recv_task = tokio::spawn(async move {
		while let Some(Ok(msg)) = stream.next().await {
			// index.cjs: 첫 바이트가 '\x00'이면 리사이즈 제어('\x00<cols>,<rows>'), 아니면 그대로 입력.
			let bytes: Option<Vec<u8>> = match msg {
				Message::Text(s) => Some(s.into_bytes()),
				Message::Binary(b) => Some(b),
				Message::Close(_) => None,
				_ => continue,
			};
			let Some(bytes) = bytes else { break };
			if bytes.first() == Some(&0) {
				if let Ok(rest) = std::str::from_utf8(&bytes[1..]) {
					if let Some((c, r)) = rest.split_once(',') {
						if let (Ok(c), Ok(r)) = (c.parse::<u16>(), r.parse::<u16>()) {
							term::resize(&entry2, c, r);
						}
					}
				}
			} else {
				term::write_input(&entry2, &bytes);
			}
		}
	});

	tokio::select! {
		_ = &mut send_task => recv_task.abort(),
		_ = &mut recv_task => send_task.abort(),
	}
}

// 관제(control) — index.cjs의 /api/control/* 계약(§control.rs 주석) 그대로.
async fn get_control_state() -> impl IntoResponse {
	(StatusCode::OK, Json(control::get_state().await)).into_response()
}

async fn post_control_start() -> impl IntoResponse {
	let v = control::start(None).await;
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn post_control_stop() -> impl IntoResponse {
	(StatusCode::OK, Json(control::stop())).into_response()
}

async fn post_control_reset() -> impl IntoResponse {
	let v = control::reset(None).await;
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn post_control_interrupt() -> impl IntoResponse {
	let v = control::interrupt();
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

#[derive(serde::Deserialize, Default)]
struct ControlAskInput {
	text: Option<String>,
}

async fn post_control_ask(body: Option<Json<ControlAskInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = control::ask(input.text.as_deref().unwrap_or_default()).await;
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn get_control_live_prompt() -> impl IntoResponse {
	(StatusCode::OK, Json(control::get_live_prompt().await)).into_response()
}

#[derive(serde::Deserialize, Default)]
struct ControlLiveActionInput {
	action: Option<Value>,
}

async fn post_control_live_action(body: Option<Json<ControlLiveActionInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = control::send_live_action(&input.action.unwrap_or(Value::Null)).await;
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

#[derive(serde::Deserialize, Default)]
struct RepoCloneInput {
	url: Option<String>,
	#[serde(rename = "parentPath")]
	parent_path: Option<String>,
	name: Option<String>,
}

async fn post_repos_clone(State(state): State<Arc<AppState>>, body: Option<Json<RepoCloneInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match repo_add::clone_repo(&state.pool, input.url.as_deref().unwrap_or_default(), input.parent_path.as_deref().unwrap_or_default(), input.name.as_deref()) {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize, Default)]
struct RepoInitInput {
	#[serde(rename = "parentPath")]
	parent_path: Option<String>,
	name: Option<String>,
}

async fn post_repos_init(State(state): State<Arc<AppState>>, body: Option<Json<RepoInitInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match repo_add::init_repo(&state.pool, input.parent_path.as_deref().unwrap_or_default(), input.name.as_deref().unwrap_or_default()) {
		Ok(v) => {
			let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
			(status, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}

/// index.cjs '/api/localip' — 같은 Wi-Fi의 실기기가 로컬서버에 접속할 수 있는 이 맥의 LAN IP.
/// os.networkInterfaces() 대신 ifconfig 파싱(러스트 표준 라이브러리엔 인터페이스 열거가 없음).
async fn get_localip() -> impl IntoResponse {
	let out = tokio::process::Command::new("ifconfig").output().await.ok().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
	static IFACE_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"^(\S+):").unwrap());
	static INET_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"^\s*inet (\d+\.\d+\.\d+\.\d+)\b").unwrap());
	let mut cur_name = String::new();
	let mut all: Vec<(String, String)> = Vec::new();
	for line in out.lines() {
		if let Some(caps) = IFACE_RE.captures(line) {
			cur_name = caps[1].to_string();
			continue;
		}
		if let Some(caps) = INET_RE.captures(line) {
			let addr = caps[1].to_string();
			if addr != "127.0.0.1" {
				all.push((cur_name.clone(), addr));
			}
		}
	}
	static PRIVATE_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"^(192\.168|10\.|172\.)").unwrap());
	let pick = all.iter().find(|(n, _)| n == "en0").or_else(|| all.iter().find(|(_, a)| PRIVATE_RE.is_match(a))).or_else(|| all.first());
	let ip = pick.map(|(_, a)| a.clone());
	let all_json: Vec<Value> = all.iter().map(|(n, a)| json!({"name": n, "addr": a})).collect();

	// SSID(best-effort) — ipconfig getsummary en0. Sonoma+는 위치서비스 권한 없으면 <redacted>.
	let summary = tokio::process::Command::new("ipconfig")
		.args(["getsummary", "en0"])
		.output()
		.await
		.ok()
		.map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
		.unwrap_or_default();
	static SSID_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"(?m)\bSSID\s*:\s*(.+)").unwrap());
	let ssid_raw = SSID_RE.captures(&summary).map(|c| c[1].trim().to_string());
	let redacted = ssid_raw.as_deref().map(|s| s.is_empty()).unwrap_or(true) || ssid_raw.as_deref().map(|s| s.to_lowercase().contains("redacted")).unwrap_or(false);

	(StatusCode::OK, Json(json!({"ok": true, "ip": ip, "all": all_json, "ssid": if redacted { Value::Null } else { ssid_raw.map(Value::from).unwrap_or(Value::Null) }, "ssidRedacted": redacted}))).into_response()
}

#[derive(serde::Deserialize, Default)]
struct UploadImageInput {
	#[serde(rename = "dataUrl")]
	data_url: Option<String>,
	cwd: Option<String>,
}

/// index.cjs '/api/dev/upload-image' — data: URL을 파일로 저장하고 절대경로를 돌려준다(비서 채팅
/// 이미지 붙여넣기 등 — 에이전트가 그 경로를 Read 툴로 직접 확인).
async fn post_dev_upload_image(body: Option<Json<UploadImageInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let data_url = input.data_url.unwrap_or_default();
	static DATA_URL_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"(?s)^data:image/([\w+.-]+);base64,(.+)$").unwrap());
	let Some(caps) = DATA_URL_RE.captures(&data_url) else {
		return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "이미지 dataUrl 아님"}))).into_response();
	};
	let ext = caps[1].replace("jpeg", "jpg").chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>();
	let ext = if ext.is_empty() { "png".to_string() } else { ext };
	use base64::Engine;
	let Ok(buf) = base64::engine::general_purpose::STANDARD.decode(caps[2].as_bytes()) else {
		return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "base64 디코딩 실패"}))).into_response();
	};
	if buf.len() > 12 << 20 {
		return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "이미지 12MB 초과"}))).into_response();
	}
	let base_dir = input.cwd.filter(|c| std::path::Path::new(c).exists()).map(|c| std::path::Path::new(&c).join(".openrm-cmd-images")).unwrap_or_else(|| {
		std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("app").join(".openrm-cmd-images")
	});
	if let Err(e) = std::fs::create_dir_all(&base_dir) {
		return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": format!("저장 실패: {e}")}))).into_response();
	}
	let file = base_dir.join(format!("cmd-{}-{}.{ext}", chrono::Utc::now().timestamp_millis(), rand_u16()));
	if let Err(e) = std::fs::write(&file, &buf) {
		return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": format!("저장 실패: {e}")}))).into_response();
	}
	(StatusCode::OK, Json(json!({"ok": true, "path": file.to_string_lossy(), "bytes": buf.len()}))).into_response()
}

fn rand_u16() -> u16 {
	use std::time::{SystemTime, UNIX_EPOCH};
	(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().subsec_nanos() % 10000) as u16
}

async fn get_holidays_countries() -> impl IntoResponse {
	match holidays::list_countries().await {
		Ok(countries) => (StatusCode::OK, Json(json!({"ok": true, "countries": countries}))).into_response(),
		Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e}))).into_response(),
	}
}

#[derive(serde::Deserialize, Default)]
struct HolidaysQuery {
	country: Option<String>,
	years: Option<String>,
}

async fn get_holidays(Query(q): Query<HolidaysQuery>) -> impl IntoResponse {
	let country = q.country.unwrap_or_else(|| "KR".to_string()).to_uppercase();
	let years: Vec<i32> = q.years.unwrap_or_default().split(',').filter_map(|y| y.trim().parse::<i32>().ok()).filter(|y| *y > 1900 && *y < 2200).collect();
	if years.is_empty() {
		return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "years 필수 (예: years=2025,2026)"}))).into_response();
	}
	match holidays::get_holidays(&country, &years).await {
		Ok(list) => (StatusCode::OK, Json(json!({"ok": true, "country": country, "holidays": list}))).into_response(),
		Err(_) => (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": format!("알 수 없는 국가 코드: {country}")}))).into_response(),
	}
}

async fn get_cockpit(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	(StatusCode::OK, Json(cockpit::cockpit(&state.pool).await)).into_response()
}

#[derive(serde::Deserialize, Default)]
struct LinkBriefsQuery {
	#[serde(rename = "ownerType")]
	owner_type: Option<String>,
	#[serde(rename = "ownerId")]
	owner_id: Option<String>,
}

async fn get_link_briefs(State(state): State<Arc<AppState>>, Query(q): Query<LinkBriefsQuery>) -> impl IntoResponse {
	match link_briefs::list_by_owner(&state.pool, q.owner_type.as_deref().unwrap_or_default(), q.owner_id.as_deref().unwrap_or_default()) {
		Ok(briefs) => (StatusCode::OK, Json(json!({"ok": true, "briefs": briefs}))).into_response(),
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize, Default)]
struct LinkBriefEnsureInput {
	#[serde(rename = "ownerType")]
	owner_type: Option<String>,
	#[serde(rename = "ownerId")]
	owner_id: Option<String>,
	url: Option<String>,
}

async fn post_link_briefs_ensure(State(state): State<Arc<AppState>>, body: Option<Json<LinkBriefEnsureInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = link_brief::ensure_brief(state.pool.clone(), input.owner_type.as_deref().unwrap_or_default(), input.owner_id.as_deref().unwrap_or_default(), input.url.as_deref().unwrap_or_default()).await;
	(StatusCode::OK, Json(v)).into_response()
}

#[derive(serde::Deserialize, Default)]
struct SetupConnectorInput {
	fields: Option<Value>,
}

async fn post_setup_connector(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<SetupConnectorInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let fields = input.fields.unwrap_or(json!({}));
	match setup::post_connector(&state.pool, &id, &fields) {
		Ok(v) => {
			if v.get("status").and_then(Value::as_u64) == Some(404) {
				(StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": v["error"]}))).into_response()
			} else {
				(StatusCode::OK, Json(v)).into_response()
			}
		}
		Err(e) => err500(e),
	}
}

async fn get_setup_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	match setup::setup_status(&state.pool) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize, Default)]
struct FsPathQuery {
	path: Option<String>,
}

async fn get_setup_fs_resolve(Query(q): Query<FsPathQuery>) -> impl IntoResponse {
	(StatusCode::OK, Json(setup::resolve_fs_path(q.path.as_deref().unwrap_or_default()))).into_response()
}

async fn get_setup_fs_list(Query(q): Query<FsPathQuery>) -> impl IntoResponse {
	let v = setup::resolve_fs_list(q.path.as_deref().unwrap_or_default());
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn get_setup_tmux() -> impl IntoResponse {
	// term.cjs checkAvailable() — 옛 tmux 아키텍처 시절 온보딩용 하드코딩 stub(§ 프론트 주석). 실제
	// disabled 판단은 /api/setup/terminal-capabilities가 담당.
	(StatusCode::OK, Json(json!({"available": true, "version": Value::Null, "error": Value::Null}))).into_response()
}

async fn get_setup_terminal_capabilities() -> impl IntoResponse {
	(StatusCode::OK, Json(json!({"tmux": term::has_tmux(), "ghostty": term::has_ghostty()}))).into_response()
}

async fn get_setup_github_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	(StatusCode::OK, Json(github_connect::gh_status(&state.pool).await)).into_response()
}

async fn post_setup_github_oauth_start(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	let v = github_connect::oauth_start(&state.pool).await;
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn post_setup_github_oauth_poll(State(state): State<Arc<AppState>>) -> impl IntoResponse {
	let v = github_connect::oauth_poll(&state.pool).await;
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn create_branch(State(state): State<Arc<AppState>>, Json(input): Json<Value>) -> impl IntoResponse {
	match branches::create(&state.pool, &input) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn update_branch(State(state): State<Arc<AppState>>, Path(id): Path<String>, Json(patch): Json<Value>) -> impl IntoResponse {
	match branches::update(&state.pool, &id, &patch) {
		Ok(Some(v)) => (StatusCode::OK, Json(v)).into_response(),
		Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "not found"}))).into_response(),
		Err(e) => err500(e),
	}
}

async fn delete_branch(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match branches::remove(&state.pool, &id) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

#[derive(serde::Deserialize, Default)]
struct AddLinkInput {
	kind: Option<String>,
	url: Option<String>,
}

async fn add_branch_link(State(state): State<Arc<AppState>>, Path(id): Path<String>, body: Option<Json<AddLinkInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	match branches::add_link(&state.pool, &id, input.kind.as_deref().unwrap_or_default(), input.url.as_deref().unwrap_or_default()) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn delete_branch_link(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	match branches::remove_link(&state.pool, &id) {
		Ok(v) => (StatusCode::OK, Json(v)).into_response(),
		Err(e) => err500(e),
	}
}

async fn get_term_list() -> impl IntoResponse {
	(StatusCode::OK, Json(json!({"ok": true, "sessions": term::list_live().await}))).into_response()
}

#[derive(serde::Deserialize, Default)]
struct TermCreateInput {
	cwd: Option<String>,
	command: Option<String>,
	label: Option<String>,
	seed: Option<String>,
}

async fn post_term_create(body: Option<Json<TermCreateInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let Some(cwd) = input.cwd.filter(|c| !c.is_empty()) else {
		return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "cwd 필수"}))).into_response();
	};
	let v = term::create(term::CreateOptions {
		cwd: &cwd,
		command: input.command.as_deref(),
		label: input.label.as_deref(),
		seed: input.seed.as_deref(),
		..Default::default()
	})
	.await;
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

#[derive(serde::Deserialize, Default)]
struct TermNameInput {
	name: Option<String>,
}

async fn post_term_kill(body: Option<Json<TermNameInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = term::kill(input.name.as_deref().unwrap_or_default());
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn post_term_open_external(body: Option<Json<TermNameInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = term::open_external(input.name.as_deref().unwrap_or_default());
	let status = if v.get("ok") == Some(&Value::Bool(false)) { StatusCode::BAD_REQUEST } else { StatusCode::OK };
	(status, Json(v)).into_response()
}

async fn get_sessions_restorable() -> impl IntoResponse {
	(StatusCode::OK, Json(json!({"ok": true, "sessions": term::restorable()}))).into_response()
}

#[derive(serde::Deserialize, Default)]
struct SessionsRestoreInput {
	name: Option<String>,
	kind: Option<String>,
	all: Option<bool>,
}

async fn post_sessions_restore(body: Option<Json<SessionsRestoreInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	let v = term::restore(input.name.as_deref(), input.kind.as_deref(), input.all.unwrap_or(false)).await;
	(StatusCode::OK, Json(v)).into_response()
}

#[derive(serde::Deserialize, Default)]
struct SessionsForgetInput {
	name: Option<String>,
	all: Option<bool>,
}

async fn post_sessions_forget(body: Option<Json<SessionsForgetInput>>) -> impl IntoResponse {
	let input = body.map(|Json(b)| b).unwrap_or_default();
	(StatusCode::OK, Json(term::forget(input.name.as_deref(), input.all.unwrap_or(false)))).into_response()
}

async fn get_control_transcript() -> impl IntoResponse {
	let cwd = control::control_cwd();
	let cwd_str = cwd.to_string_lossy().to_string();
	let Some(file) = transcript::find_control_transcript(&cwd_str) else {
		return (StatusCode::OK, Json(json!({"ok": true, "turns": []}))).into_response();
	};
	let turns = transcript::parse_transcript(&file, true, 60);
	(StatusCode::OK, Json(json!({"ok": true, "turns": turns}))).into_response()
}

async fn delete_subtask(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
	let existing = match subtasks::get(&state.pool, &id) {
		Ok(v) => v,
		Err(e) => return err500(e),
	};
	match subtasks::remove(&state.pool, &id) {
		Ok(v) => {
			if let Some(task_id) = existing.and_then(|e| e["task_id"].as_str().map(str::to_string)) {
				if let Err(e) = tasks::recompute_from_subtasks(&state.pool, &task_id) {
					return err500(e);
				}
			}
			(StatusCode::OK, Json(v)).into_response()
		}
		Err(e) => err500(e),
	}
}
