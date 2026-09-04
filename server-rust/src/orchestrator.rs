// orchestrator.rs — app/server/orchestrator.cjs 이식 착수. 1188줄짜리 파일 중 이번 패스 범위는
// launchSubtask(서브태스크 착수 — 워크트리 생성부터 claude 세션 시딩까지, 이 앱의 핵심 동작)와 그
// 직접 의존 헬퍼들. start/advance/stop/conductorSeed 등 나머지 상태머신은 아직 없음.
//
// ⚠️ codeBrief.cjs(착수 시 백그라운드 코드 조사)는 미포팅 — Node판의 "best-effort, 실패해도 착수는
// 안 막음" 원칙 그대로 이번 패스에서는 그 호출 자체를 생략한다(기능 손실이지만 착수 자체는 완전 동작).
use crate::db::Pool;
use crate::{app_config, branch_slug, branches, folders, notify, repos, settings, subtask_sessions, subtasks, tasks, term, worktrees};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

const MAX_VERIFY_ITEMS: usize = 5;

// ── 폴더별 인메모리 오케스트레이션 상태(§원본 states Map) — 서버 재시작 시 소실은 의도된 설계
// (서브태스크 체인 자체는 subtask_sessions에 영속되므로 재시작해도 "어디까지 진행했는지"는 안 잃는다).
static STATES: std::sync::LazyLock<Mutex<HashMap<String, Value>>> = std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn blank_state() -> Value {
	json!({
		"running": false, "currentWaveIndex": 0, "sessions": [], "log": [], "conductor": Value::Null,
		"conductorStalled": false, "feed": [], "blocked": {}, "stalled": {}, "verify": {}, "taskVerify": {}
	})
}

#[allow(dead_code)]
pub fn get_state(folder_id: &str) -> Value {
	STATES.lock().unwrap().get(folder_id).cloned().unwrap_or_else(blank_state)
}

fn ensure_state_and<T>(folder_id: &str, f: impl FnOnce(&mut Value) -> T) -> T {
	let mut states = STATES.lock().unwrap();
	let s = states.entry(folder_id.to_string()).or_insert_with(blank_state);
	f(s)
}

/// resolveRepoId — subtask.repo_id > folder.repo_id > task.repo_id 우선순위(§원본 주석: 세 곳에 저장되는
/// 이유와 우선순위가 launchSubtask/startOrchestration에 흩어져 있던 걸 여기 하나로 모은 것).
fn resolve_repo_id(subtask: Option<&Value>, folder: Option<&Value>, task: Option<&Value>) -> Option<String> {
	subtask
		.and_then(|s| s["repo_id"].as_str())
		.or_else(|| folder.and_then(|f| f["repo_id"].as_str()))
		.or_else(|| task.and_then(|t| t["repo_id"].as_str()))
		.map(str::to_string)
}

fn team_rules_section(pairs: &[(&str, Option<&str>)]) -> String {
	let filled: Vec<(&str, &str)> = pairs.iter().filter_map(|(label, text)| text.filter(|t| !t.trim().is_empty()).map(|t| (*label, t.trim()))).collect();
	if filled.is_empty() {
		return String::new();
	}
	let body = filled.iter().map(|(label, text)| format!("[{label}]\n{text}")).collect::<Vec<_>>().join("\n\n");
	format!("\n\n■ 아주 중요한 원칙 — 이 레포의 팀 규칙(사람이 직접 정한 것, 절대 무시하거나 생략하지 않는다):\n{body}\n")
}

fn team_rules_reminder(pairs: &[(&str, Option<&str>)], note: &str) -> String {
	let has = pairs.iter().any(|(_, text)| text.filter(|t| !t.trim().is_empty()).is_some());
	if has {
		format!("위에서 정한 팀 규칙을 {note}")
	} else {
		String::new()
	}
}

#[allow(dead_code)]
fn tokenize(s: &str) -> Vec<String> {
	regex::Regex::new(r"[^a-z0-9가-힣]+").unwrap().split(&s.to_lowercase()).filter(|t| t.chars().count() >= 2).map(str::to_string).collect()
}

/// "오케스트레이터는 일감만들때 만든 Html문서도 자동으로 보고 일을 시작해줘" — AI 사전 검토 결과를
/// 시드 프롬프트에 얹는다. 실패/tooVague/미검토면 조용히 빈 문자열.
fn build_review_context(review: &Value) -> String {
	if review.is_null() {
		return String::new();
	}
	let result = &review["result"];
	if result.is_null() || result["ok"].as_bool() != Some(true) {
		return String::new();
	}
	let mut parts = vec!["[AI 사전 조사 — 태스크 등록 전에 미리 코드를 읽고 나온 판단이다, 착수 전 참고하되 실제 코드는 직접 다시 확인해라]".to_string()];
	if let Some(detail) = result["detail"].as_str() {
		parts.push(detail.to_string());
	}
	if let Some(plan) = result["plan"].as_array() {
		if !plan.is_empty() {
			let lines: Vec<String> = plan.iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
			parts.push(format!("개발 계획:\n{}", lines.join("\n")));
		}
	}
	if let Some(changes) = result["changes"].as_array() {
		if !changes.is_empty() {
			let lines: Vec<String> = changes
				.iter()
				.map(|c| {
					let path = c["path"].as_str().unwrap_or("");
					let is_new = c["isNew"].as_bool().unwrap_or(false);
					let summary = c["summary"].as_str().unwrap_or("");
					format!("- {path}{}: {summary}", if is_new { " (신규 파일)" } else { "" })
				})
				.collect();
			parts.push(format!("변경이 예상되는 파일(경로만 참고 — 아래 요약은 스케치일 뿐 실제 코드가 아니니 그대로 베끼지 말고 파일을 직접 열어서 확인해라):\n{}", lines.join("\n")));
		}
	}
	format!("\n\n{}", parts.join("\n\n"))
}

/// "코드작업은 무조건 서브태스크를 만들고" — 아직 서브태스크가 없으면 AI 검토의 workUnits로 자동 생성,
/// 없으면(리뷰 안 돌렸거나 tooVague) 태스크 자신을 그대로 옮겨담은 서브태스크 하나(가장 단순한 체인).
fn ensure_work_unit_subtasks(pool: &Pool, task: &Value) -> anyhow::Result<Vec<Value>> {
	let task_id = task["id"].as_str().unwrap_or_default();
	let existing = subtasks::list_by_task(pool, task_id)?;
	if !existing.is_empty() {
		return Ok(existing);
	}
	let review = tasks::latest_review_for(pool, task_id)?;
	let units: Vec<Value> = if review["result"]["ok"].as_bool() == Some(true) {
		review["result"]["workUnits"].as_array().cloned().unwrap_or_default()
	} else {
		Vec::new()
	};
	if !units.is_empty() {
		for u in &units {
			subtasks::create(pool, &json!({"taskId": task_id, "name": u["name"], "desc": u["summary"]}))?;
		}
	} else {
		subtasks::create(pool, &json!({"taskId": task_id, "name": task["name"], "desc": task["desc"].as_str().unwrap_or("")}))?;
	}
	subtasks::list_by_task(pool, task_id)
}

fn subtask_started(pool: &Pool, subtask_id: &str) -> bool {
	subtask_sessions::list_by_subtask(pool, subtask_id).map(|v| !v.is_empty()).unwrap_or(false)
}

/// 사이드바(FolderCard/TaskRow)가 states(folderId).sessions로 "이 태스크의 지금 세션"을 읽는다 —
/// 누가 건드렸든(사람/지휘자/재시작 복원) 항상 최신 서브태스크 세션을 한 곳에서 동기화.
fn sync_folder_session(task: &Value, rec: Value) {
	let Some(folder_id) = task["folder_id"].as_str() else { return };
	ensure_state_and(folder_id, |s| {
		let sessions = s["sessions"].as_array_mut().unwrap();
		let task_id = rec["taskId"].clone();
		if let Some(idx) = sessions.iter().position(|x| x["taskId"] == task_id) {
			sessions[idx] = rec;
		} else {
			sessions.push(rec);
		}
	});
}

/// launchSubtask — 서브태스크 하나를 실제로 착수시킨다: 레포 확정 → 워크트리 생성(또는 이전 서브태스크
/// 브랜치 이어받기/입양된 브랜치 재사용) → 팀 규칙·AI 사전조사 컨텍스트를 얹은 시드 프롬프트 조립 →
/// claude 세션 스폰(§ term::create) → subtask_sessions에 영구 기록.
pub async fn launch_subtask(pool: &Pool, task: &Value, subtask: &Value) -> anyhow::Result<Value> {
	let task_id = task["id"].as_str().unwrap_or_default();
	let subtask_id = subtask["id"].as_str().unwrap_or_default();
	let folder = task["folder_id"].as_str().and_then(|fid| folders::get(pool, fid).ok().flatten());

	// "pr도 체이닝으로" — 바로 앞 서브태스크가 이미 브랜치를 만들었으면 그 브랜치 위에서 이어 만든다.
	let all_subtasks = subtasks::list_by_task(pool, task_id)?;
	let idx = all_subtasks.iter().position(|s| s["id"] == subtask["id"]);
	let prev_subtask = idx.filter(|&i| i > 0).map(|i| &all_subtasks[i - 1]);
	let prev_session = match prev_subtask {
		Some(p) => subtask_sessions::latest_for_subtask(pool, p["id"].as_str().unwrap_or_default())?,
		None => None,
	};
	let base = prev_session
		.as_ref()
		.and_then(|s| s["branch"].as_str())
		.map(str::to_string)
		.or_else(|| folder.as_ref().and_then(|f| f["base"].as_str()).map(str::to_string));

	let repo_id = resolve_repo_id(Some(subtask), folder.as_ref(), Some(task));
	let repo = match repo_id.and_then(|id| repos::get(pool, &id).ok().flatten()) {
		Some(r) => r,
		None => return Ok(json!({"ok": false, "error": "이 태스크에 레포가 지정되지 않았습니다 — 먼저 레포를 선택하세요."})),
	};
	let repo_path = repo["path"].as_str().map(str::to_string);

	// 이미 "연결"로 태스크에 입양된 브랜치가 있으면(첫 서브태스크만) 새 워크트리 대신 그대로 이어받는다.
	let adopted_branch = if idx == Some(0) {
		branches::list_by_task(pool, task_id)?.into_iter().find(|b| b["subtask_id"].is_null())
	} else {
		None
	};
	let adopted_path = match &adopted_branch {
		Some(b) => worktrees::path_for_branch(pool, b["name"].as_str().unwrap_or_default(), repo_path.as_deref()).await,
		None => None,
	};

	let ticket = {
		let t = branch_slug::translate_to_english_slug(pool, subtask["name"].as_str().unwrap_or_default()).await;
		if t.is_empty() {
			subtask["name"].as_str().unwrap_or_default().to_string()
		} else {
			t
		}
	};
	let wt = if let (Some(path), Some(branch)) = (&adopted_path, adopted_branch.as_ref().and_then(|b| b["name"].as_str())) {
		json!({"ok": true, "path": path, "branch": branch, "base": folder.as_ref().and_then(|f| f["base"].as_str())})
	} else {
		worktrees::ensure(
			pool,
			worktrees::CreateInput {
				ticket: Some(ticket),
				base,
				desc: Some(format!("{} — {}", task["name"].as_str().unwrap_or_default(), subtask["name"].as_str().unwrap_or_default())),
				repo_path: repo_path.clone(),
				repo_base: repo["base"].as_str().map(str::to_string),
				..Default::default()
			},
		)
		.await
	};
	if wt["ok"].as_bool() != Some(true) {
		return Ok(json!({"ok": false, "error": wt["error"]}));
	}
	let wt_branch = wt["branch"].as_str().map(str::to_string);
	let wt_path = wt["path"].as_str().unwrap_or_default().to_string();

	if let Some(ab) = &adopted_branch {
		// linkToSubtask 전용 함수 대신 update로 subtask_id만 세팅(branches.rs에 별도 함수 없어 SQL 직접 처리 대신 patch 사용).
		let conn = pool.get()?;
		conn.execute("UPDATE branches SET subtask_id = ?1 WHERE id = ?2", rusqlite::params![subtask_id, ab["id"].as_str().unwrap_or_default()])?;
	} else if let Some(branch_name) = &wt_branch {
		if branches::list_by_task(pool, task_id)?.iter().all(|b| b["subtask_id"].as_str() != Some(subtask_id)) {
			branches::create(pool, &json!({"taskId": task_id, "subtaskId": subtask_id, "name": branch_name, "repo": repo["name"]}))?;
		}
	}

	let review = tasks::latest_review_for(pool, task_id)?;
	let rule_pairs: Vec<(&str, Option<&str>)> = vec![
		("이 태스크만의 특별 규칙 — 같은 레포의 다른 태스크에는 안 쓰인다", folder.as_ref().and_then(|f| f["rule_task"].as_str())),
		("일반 규칙", repo["rule_general"].as_str()),
		("워크트리 · 브랜치 생성 규칙 — 지금 브랜치명은 자동 생성된 것이다. 규칙과 안 맞으면 git branch -m으로 먼저 바꿔라", repo["rule_branch"].as_str()),
		("개발 시작 전 필수 조건 — 충족 전엔 코드를 작성하지 마라", repo["rule_predev"].as_str()),
	];
	let rules = team_rules_section(&rule_pairs);
	let reminder = team_rules_reminder(&rule_pairs, "잊지 마라 — 코드를 작성하기 전에 다시 한번 확인해라.");

	let task_line = format!(
		"이 서브태스크를 진행해줘: \"{}\"(태스크 \"{}\"의 일부). {}",
		subtask["name"].as_str().unwrap_or_default(),
		task["name"].as_str().unwrap_or_default(),
		subtask["desc"].as_str().unwrap_or_default()
	)
	.trim()
	.to_string();

	let port = std::env::var("OPENRM_PORT").unwrap_or_else(|_| "8770".to_string());
	let advance_line = format!(
		"■ 이 서브태스크를 실제로 다 마쳤으면(테스트 통과·리뷰 반영 등 확인까지 끝난 상태) 사람이나 태스크 매니저를 기다리지 말고 바로 다음 단계를 직접 시작해라. \
그 전에 뭘 했고 어떻게 끝났는지 정리한 완성된 HTML 리포트를 만들어라(<html>부터 시작하는 완전한 문서). \
파일로 먼저 써두고(예: /tmp/report.html), curl로 보내라: node -e \"const fs=require('fs');fs.writeFileSync('/tmp/report-body.json',JSON.stringify({{reportHtml:fs.readFileSync('/tmp/report.html','utf8')}}))\" && \
curl -s -X POST http://localhost:{port}/api/tasks/{task_id}/subtask-work/advance -H 'Content-Type: application/json' -d @/tmp/report-body.json"
	);
	let blocked_line = format!(
		"■ 혼자 판단 못 할 결정이나 막힘(정책·크리덴셜·애매한 요구사항 등)을 만나면 조용히 멈추지 말고 바로 이 curl로 보고해라: \
curl -s -X POST http://localhost:{port}/api/tasks/{task_id}/subtask-work/report-blocked -H 'Content-Type: application/json' -d '{{\"reason\":\"<막힌 이유를 한두 문장으로>\"}}'"
	);
	let progress_line = format!(
		"■ 작업 중간중간 의미 있는 진행이 있을 때마다 짧게 알려라: curl -s -X POST http://localhost:{port}/api/tasks/{task_id}/subtask-work/progress -H 'Content-Type: application/json' -d '{{\"text\":\"<지금 뭘 하고 있는지 한두 문장>\"}}'"
	);
	let verify_line = format!(
		"■ 지금 작업 중인 걸 사람이 직접 확인해볼 수 있는 자료가 생기면 아무 때나 이 curl로 알려라: \
curl -s -X POST http://localhost:{port}/api/tasks/{task_id}/subtask-work/verify -H 'Content-Type: application/json' -d '{{\"text\":\"<어떻게 확인하면 되는지 한두 문장>\",\"url\":\"<접속 가능한 URL이 있으면, 없으면 생략>\"}}'"
	);

	let seed = format!(
		"{}{}{}{}{}\n\n{advance_line}\n\n{blocked_line}\n\n{progress_line}\n\n{verify_line}",
		if !rules.is_empty() { format!("{}\n\n", rules.trim()) } else { String::new() },
		task_line,
		wt_branch.as_ref().map(|b| format!("\n지금 브랜치: {b}")).unwrap_or_default(),
		build_review_context(&review),
		if !reminder.is_empty() { format!("\n\n■ {reminder}") } else { String::new() },
	);

	let model = settings::model_for("dev");
	let t = term::create(term::CreateOptions {
		cwd: &wt_path,
		command: Some("claude"),
		label: subtask["name"].as_str(),
		seed: Some(&seed),
		model: Some(model.clone()),
		mcp_folder_id: task["folder_id"].as_str(),
		..Default::default()
	})
	.await;
	if t["ok"].as_bool() != Some(true) {
		return Ok(json!({"ok": false, "error": t["error"]}));
	}
	let tmux_session = t["name"].as_str().unwrap_or_default().to_string();
	let model_label = settings::model_label(&model);

	subtask_sessions::create(
		pool,
		subtask_sessions::CreateInput {
			subtask_id: subtask_id.to_string(),
			task_id: task_id.to_string(),
			tmux_session: tmux_session.clone(),
			worktree_path: wt_path.clone(),
			branch: wt_branch.clone(),
			model: Some(model),
			model_label: Some(model_label.clone()),
		},
	)?;
	sync_folder_session(
		task,
		json!({"taskId": task_id, "tmuxSession": tmux_session, "worktreePath": wt_path, "model": t["model"], "modelLabel": model_label}),
	);

	// codeBrief.cjs(착수 시 백그라운드 코드 조사)는 미포팅 — best-effort 기능이라 생략해도 착수 자체는 완전 동작(§ 파일 상단 주석).

	Ok(json!({
		"ok": true, "subtaskId": subtask_id, "subtaskName": subtask["name"], "tmuxSession": tmux_session,
		"worktreePath": wt_path, "modelLabel": model_label, "base": wt["base"],
	}))
}

/// 태스크의 "개발형" 서브태스크 체인을 시작 — 이미 살아있는 세션이 있으면 그대로 재사용, 없으면
/// 아직 아무 세션도 안 시작한 첫 서브태스크 하나만 착수(전부 한 번에 안 띄움, 순차 진행).
///
/// ended_at은 안 찍혔는데(=advanceSubtaskWork로 명시적으로 안 끝냄) 지금 안 살아있으면 서버 재시작으로
/// 죽은 것 — "이미 시작됨"으로 건너뛰지 말고 먼저 restore_by_name()으로 `claude --continue` 복원부터
/// 시도한다.
pub async fn start_subtask_work(pool: &Pool, task_id: &str) -> anyhow::Result<Value> {
	let task = match tasks::get(pool, task_id)? {
		Some(t) => t,
		None => return Ok(json!({"ok": false, "error": "task not found"})),
	};
	let subs = ensure_work_unit_subtasks(pool, &task)?;
	if subs.is_empty() {
		return Ok(json!({"ok": false, "error": "서브태스크가 없습니다 — AI 검토를 먼저 완료하거나 직접 추가해주세요."}));
	}
	let live = term::list();
	let mut dead_active: Option<(Value, Value)> = None;
	for st in &subs {
		if let Some(active) = subtask_sessions::get_active_for_subtask(pool, st["id"].as_str().unwrap_or_default())? {
			let tmux = active["tmux_session"].as_str().unwrap_or_default();
			if term::is_live(&live, tmux) {
				sync_folder_session(
					&task,
					json!({"taskId": task_id, "tmuxSession": tmux, "worktreePath": active["worktree_path"], "model": active["model"], "modelLabel": active["model_label"]}),
				);
				return Ok(json!({"ok": true, "already": true, "subtaskId": st["id"], "subtaskName": st["name"], "tmuxSession": tmux}));
			}
			if dead_active.is_none() {
				dead_active = Some((st.clone(), active));
			}
		}
	}
	if let Some((st, active)) = &dead_active {
		let tmux = active["tmux_session"].as_str().unwrap_or_default();
		if let Some(restored) = restore_by_name(tmux).await {
			let restored_name = restored["name"].as_str().unwrap_or_default();
			subtask_sessions::create(
				pool,
				subtask_sessions::CreateInput {
					subtask_id: st["id"].as_str().unwrap_or_default().to_string(),
					task_id: task_id.to_string(),
					tmux_session: restored_name.to_string(),
					worktree_path: active["worktree_path"].as_str().unwrap_or_default().to_string(),
					branch: active["branch"].as_str().map(str::to_string),
					model: active["model"].as_str().map(str::to_string),
					model_label: active["model_label"].as_str().map(str::to_string),
				},
			)?;
			sync_folder_session(
				&task,
				json!({"taskId": task_id, "tmuxSession": restored_name, "worktreePath": active["worktree_path"], "model": active["model"], "modelLabel": active["model_label"]}),
			);
			return Ok(json!({"ok": true, "restored": true, "subtaskId": st["id"], "subtaskName": st["name"], "tmuxSession": restored_name}));
		}
	}
	let next = subs.iter().find(|s| !subtask_started(pool, s["id"].as_str().unwrap_or_default()));
	match next {
		Some(s) => launch_subtask(pool, &task, s).await,
		None => Ok(json!({"ok": false, "error": "모든 서브태스크가 이미 시작됐습니다 — 다음으로 넘기려면 진행을 쓰세요."})),
	}
}

fn push_feed(state: &mut Value, from: &str, to: &str, text: &str, kind: &str, report_url: Option<&str>) {
	let feed = state["feed"].as_array_mut().unwrap();
	let truncated: String = text.chars().take(500).collect();
	feed.push(json!({"ts": chrono::Utc::now().timestamp_millis(), "from": from, "to": to, "text": truncated, "kind": kind, "reportUrl": report_url}));
	let len = feed.len();
	if len > 120 {
		feed.drain(0..len - 120);
	}
}

/// notifyConductor — 지휘자 pty에 직접 타이핑해 능동 통보(서브태스크→지휘자 다리). 지휘자 세션이
/// 아직 없으면(§start/startConductor 미포팅) Node와 동일하게 에러를 돌려줄 뿐 실패하지 않는다.
async fn notify_conductor(folder_id: &str, from_label: &str, text: &str, kind: &str, report_url: Option<&str>) -> Value {
	let conductor_session = { STATES.lock().unwrap().get(folder_id).and_then(|s| s["conductor"]["session"].as_str().map(str::to_string)) };
	let Some(session) = conductor_session else {
		return json!({"ok": false, "error": "태스크 매니저 세션이 없습니다."});
	};
	if !term::exists(&session) {
		return json!({"ok": false, "error": "태스크 매니저 세션이 죽었습니다."});
	}
	let send_result = term::send(&session, text);
	ensure_state_and(folder_id, |s| push_feed(s, from_label, "orch", text, kind, report_url));
	match send_result {
		Ok(_) => json!({"ok": true}),
		Err(e) => json!({"ok": false, "error": e}),
	}
}

fn strip_html_excerpt(html: &str, max_len: usize) -> String {
	let no_tags = regex::Regex::new(r"<[^>]+>").unwrap().replace_all(html, " ").into_owned();
	let collapsed = regex::Regex::new(r"\s+").unwrap().replace_all(no_tags.trim(), " ").into_owned();
	collapsed.chars().take(max_len).collect()
}

/// advanceSubtaskWork — 지금 진행 중인 서브태스크를 끝난 걸로 기록하고 다음 서브태스크를 착수한다.
/// 마지막 단계면 verify 보고(서브태스크 자신 또는 taskVerify)가 최소 하나는 있어야 완료 처리된다.
pub async fn advance_subtask_work(pool: &Pool, task_id: &str, report_html: Option<&str>) -> anyhow::Result<Value> {
	let task = match tasks::get(pool, task_id)? {
		Some(t) => t,
		None => return Ok(json!({"ok": false, "error": "task not found"})),
	};
	let subs = subtasks::list_by_task(pool, task_id)?;
	let mut live_idx = None;
	for (i, st) in subs.iter().enumerate() {
		if subtask_sessions::get_active_for_subtask(pool, st["id"].as_str().unwrap_or_default())?.is_some() {
			live_idx = Some(i);
			break;
		}
	}
	let Some(live_idx) = live_idx else {
		return Ok(json!({"ok": false, "error": "진행 중인 서브태스크가 없습니다 — 먼저 시작하세요."}));
	};
	let current = subs[live_idx].clone();
	let current_id = current["id"].as_str().unwrap_or_default().to_string();
	let next = subs.get(live_idx + 1).cloned();

	if next.is_none() {
		if let Some(folder_id) = task["folder_id"].as_str() {
			let has_verify = {
				let states = STATES.lock().unwrap();
				states
					.get(folder_id)
					.map(|s| {
						let has_sub = s["verify"][&current_id].as_array().map(|a| !a.is_empty()).unwrap_or(false);
						let has_task = s["taskVerify"][task_id].as_array().map(|a| !a.is_empty()).unwrap_or(false);
						has_sub || has_task
					})
					.unwrap_or(false)
			};
			if !has_verify {
				let port = std::env::var("OPENRM_PORT").unwrap_or_else(|_| "8770".to_string());
				return Ok(json!({"ok": false, "error": format!(
					"이 태스크의 마지막 단계인데 사람이 확인할 방법이 아직 하나도 보고되지 않았습니다. 완료 처리하기 전에 curl -s -X POST http://localhost:{port}/api/tasks/{task_id}/subtask-work/verify -H 'Content-Type: application/json' -d '{{\"text\":\"<어떻게 확인하면 되는지 — 로컬서버 URL이든, 앱 스크린샷 경로든, 확인용 명령어든 상관없음>\"}}' 로 먼저 보고하세요."
				)}));
			}
		}
	}

	let current_session = match subtask_sessions::get_active_for_subtask(pool, &current_id)? {
		Some(s) => s,
		None => return Ok(json!({"ok": false, "error": "진행 중인 세션을 찾을 수 없습니다."})),
	};
	subtask_sessions::mark_ended(pool, current_session["id"].as_str().unwrap_or_default(), report_html)?;
	// codeBrief.cjs runPostJob(완료 후 변경점 조사)는 미포팅 — best-effort 기능이라 생략해도 완료 처리 자체는 정상 동작.

	if let Some(folder_id) = task["folder_id"].as_str() {
		ensure_state_and(folder_id, |s| {
			if let Some(o) = s["blocked"].as_object_mut() {
				o.remove(&current_id);
			}
			if let Some(o) = s["stalled"].as_object_mut() {
				o.remove(&current_id);
			}
		});
		let excerpt = report_html.map(|h| strip_html_excerpt(h, 240)).unwrap_or_default();
		let done_line = match &next {
			Some(n) => format!("\"{}\" 완료 → 다음 단계 \"{}\" 자동 시작", current["name"].as_str().unwrap_or_default(), n["name"].as_str().unwrap_or_default()),
			None => format!("\"{}\" 완료 — 마지막 단계였습니다.", current["name"].as_str().unwrap_or_default()),
		};
		let text = if !excerpt.is_empty() { format!("{done_line}\n리포트 요약: {excerpt}…") } else { done_line };
		let report_url = report_html.map(|_| format!("/api/subtask-sessions/{}/report", current_session["id"].as_str().unwrap_or_default()));
		notify_conductor(folder_id, &current_id, &text, "result", report_url.as_deref()).await;
		if next.is_none() {
			notify::notify_escalation(
				&format!("🏁 \"{}\" 체인 완료", task["name"].as_str().unwrap_or_default()),
				&format!("\"{}\"까지 모든 단계가 끝났습니다.", current["name"].as_str().unwrap_or_default()),
			);
		}
	}

	match next {
		None => Ok(json!({"ok": true, "done": true})),
		Some(n) => launch_subtask(pool, &task, &n).await,
	}
}

/// reportSubtaskBlocked — advance와 대칭되는 "막힘" 보고. 세션은 안 죽인다.
pub async fn report_subtask_blocked(pool: &Pool, task_id: &str, reason: &str) -> anyhow::Result<Value> {
	let task = match tasks::get(pool, task_id)? {
		Some(t) => t,
		None => return Ok(json!({"ok": false, "error": "task not found"})),
	};
	let Some(folder_id) = task["folder_id"].as_str().map(str::to_string) else {
		return Ok(json!({"ok": false, "error": "메인 태스크에 아직 연결되지 않았습니다."}));
	};
	let subs = subtasks::list_by_task(pool, task_id)?;
	let mut current = None;
	for st in &subs {
		if subtask_sessions::get_active_for_subtask(pool, st["id"].as_str().unwrap_or_default())?.is_some() {
			current = Some(st.clone());
			break;
		}
	}
	let Some(current) = current else {
		return Ok(json!({"ok": false, "error": "진행 중인 서브태스크가 없습니다."}));
	};
	let current_id = current["id"].as_str().unwrap_or_default().to_string();
	let clean_reason = { let t = reason.trim(); if t.is_empty() { "(사유 없음)".to_string() } else { t.chars().take(500).collect() } };
	ensure_state_and(&folder_id, |s| {
		s["blocked"][&current_id] = json!(clean_reason);
	});
	notify_conductor(&folder_id, &current_id, &format!("\"{}\" 막힘 — {clean_reason}", current["name"].as_str().unwrap_or_default()), "blocked", None).await;
	notify::notify_escalation(&format!("🆘 \"{}\" 도움 요청", current["name"].as_str().unwrap_or_default()), &clean_reason);
	Ok(json!({"ok": true, "subtaskId": current_id}))
}

/// reportSubtaskProgress — 완료/막힘 사이의 가벼운 체크인. 세션 상태는 안 건드림.
pub async fn report_subtask_progress(pool: &Pool, task_id: &str, text: &str) -> anyhow::Result<Value> {
	let task = match tasks::get(pool, task_id)? {
		Some(t) => t,
		None => return Ok(json!({"ok": false, "error": "task not found"})),
	};
	let Some(folder_id) = task["folder_id"].as_str().map(str::to_string) else {
		return Ok(json!({"ok": false, "error": "메인 태스크에 아직 연결되지 않았습니다."}));
	};
	let subs = subtasks::list_by_task(pool, task_id)?;
	let mut current = None;
	for st in &subs {
		if subtask_sessions::get_active_for_subtask(pool, st["id"].as_str().unwrap_or_default())?.is_some() {
			current = Some(st.clone());
			break;
		}
	}
	let Some(current) = current else {
		return Ok(json!({"ok": false, "error": "진행 중인 서브태스크가 없습니다."}));
	};
	let current_id = current["id"].as_str().unwrap_or_default().to_string();
	let clean_text = { let t = text.trim(); if t.is_empty() { "(내용 없음)".to_string() } else { t.chars().take(300).collect() } };
	notify_conductor(&folder_id, &current_id, &clean_text, "progress", None).await;
	Ok(json!({"ok": true, "subtaskId": current_id}))
}

fn push_verify_item(list: &mut Vec<Value>, entry: Value) {
	let same_as_last = list.last().map(|last| entry.as_object().unwrap().keys().all(|k| k == "at" || last.get(k) == entry.get(k))).unwrap_or(false);
	if same_as_last {
		let idx = list.len() - 1;
		list[idx]["at"] = entry["at"].clone();
		return;
	}
	list.push(entry);
	if list.len() > MAX_VERIFY_ITEMS {
		list.remove(0);
	}
}

/// reportSubtaskVerify — "지금 살아있는 서브태스크" 관점의 검증 자료 보고. 부를 때마다 쌓인다.
pub async fn report_subtask_verify(pool: &Pool, task_id: &str, text: &str, url: Option<&str>) -> anyhow::Result<Value> {
	let task = match tasks::get(pool, task_id)? {
		Some(t) => t,
		None => return Ok(json!({"ok": false, "error": "task not found"})),
	};
	let Some(folder_id) = task["folder_id"].as_str().map(str::to_string) else {
		return Ok(json!({"ok": false, "error": "메인 태스크에 아직 연결되지 않았습니다."}));
	};
	let subs = subtasks::list_by_task(pool, task_id)?;
	let mut current = None;
	for st in &subs {
		if subtask_sessions::get_active_for_subtask(pool, st["id"].as_str().unwrap_or_default())?.is_some() {
			current = Some(st.clone());
			break;
		}
	}
	let Some(current) = current else {
		return Ok(json!({"ok": false, "error": "진행 중인 서브태스크가 없습니다."}));
	};
	let current_id = current["id"].as_str().unwrap_or_default().to_string();
	let clean_text = { let t = text.trim(); if t.is_empty() { "(내용 없음)".to_string() } else { t.chars().take(300).collect() } };
	let clean_url = url.map(|u| u.trim()).filter(|u| !u.is_empty()).map(|u| u.chars().take(500).collect::<String>());
	let entry = json!({"text": clean_text, "url": clean_url, "at": chrono::Utc::now().timestamp_millis()});
	ensure_state_and(&folder_id, |s| {
		let list = s["verify"].as_object_mut().unwrap().entry(current_id.clone()).or_insert_with(|| json!([]));
		let arr = list.as_array_mut().unwrap();
		push_verify_item(arr, entry.clone());
	});
	let notify_text = match &clean_url {
		Some(u) => format!("{clean_text} → {u}"),
		None => clean_text,
	};
	notify_conductor(&folder_id, &current_id, &notify_text, "progress", None).await;
	Ok(json!({"ok": true, "subtaskId": current_id}))
}

/// reportTaskVerify — 특정 서브태스크에 안 묶인 태스크 전체 관점의 검증 보고(지휘자 또는 하이브마인드).
pub async fn report_task_verify(pool: &Pool, task_id: &str, text: &str, url: Option<&str>, source: Option<&str>) -> anyhow::Result<Value> {
	let task = match tasks::get(pool, task_id)? {
		Some(t) => t,
		None => return Ok(json!({"ok": false, "error": "task not found"})),
	};
	let Some(folder_id) = task["folder_id"].as_str().map(str::to_string) else {
		return Ok(json!({"ok": false, "error": "메인 태스크에 아직 연결되지 않았습니다."}));
	};
	let clean_text = { let t = text.trim(); if t.is_empty() { "(내용 없음)".to_string() } else { t.chars().take(300).collect() } };
	let clean_url = url.map(|u| u.trim()).filter(|u| !u.is_empty()).map(|u| u.chars().take(500).collect::<String>());
	let clean_source = if source == Some("hivemind") { "hivemind" } else { "conductor" };
	let entry = json!({"text": clean_text, "url": clean_url, "at": chrono::Utc::now().timestamp_millis(), "source": clean_source});
	ensure_state_and(&folder_id, |s| {
		let list = s["taskVerify"].as_object_mut().unwrap().entry(task_id.to_string()).or_insert_with(|| json!([]));
		let arr = list.as_array_mut().unwrap();
		push_verify_item(arr, entry.clone());
	});
	if clean_source == "hivemind" {
		let notify_text = match &clean_url {
			Some(u) => format!("{clean_text} → {u}"),
			None => clean_text,
		};
		notify_conductor(&folder_id, "하이브마인드", &notify_text, "progress", None).await;
	}
	Ok(json!({"ok": true, "taskId": task_id}))
}

// ── 지휘자(conductor) — 오케스트레이터 자체의 claude 세션 ──────────────────────────────────────

fn operator_name() -> String {
	let s = settings::load();
	let n = s.get("operatorName").and_then(Value::as_str).unwrap_or("").trim().to_string();
	if n.is_empty() {
		"운영자".to_string()
	} else {
		n
	}
}

fn conductor_cwd(folder_id: &str) -> std::path::PathBuf {
	let data_dir = std::env::var("OPENRM_DATA_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| {
		std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(".openrm")
	});
	let dir = data_dir.join("conductor-cwds").join(folder_id);
	let _ = std::fs::create_dir_all(&dir);
	dir
}

/// conductorSeed — 지휘자(태스크 매니저) 세션의 역할 지시 프롬프트. launchSubtask의 seed와 같은
/// "팀 규칙 3중 반복" 원칙(초두·실행단계 0번·최신 효과).
fn conductor_seed(pool: &Pool, folder: &Value, tasks: &[Value], cwd: &str) -> String {
	let port = std::env::var("OPENRM_PORT").unwrap_or_else(|_| "8770".to_string());
	let operator = operator_name();
	let list = if tasks.is_empty() {
		"(아직 태스크 없음)".to_string()
	} else {
		tasks
			.iter()
			.map(|t| {
				let desc = t["desc"].as_str().filter(|d| !d.is_empty()).map(|d| format!(" — {d}")).unwrap_or_default();
				format!("- {}: {}{desc}", t["id"].as_str().unwrap_or_default(), t["name"].as_str().unwrap_or_default())
			})
			.collect::<Vec<_>>()
			.join("\n")
	};
	let repo = resolve_repo_id(None, Some(folder), None).and_then(|id| repos::get(pool, &id).ok().flatten()).unwrap_or(Value::Null);
	let rule_pairs: Vec<(&str, Option<&str>)> = vec![
		("이 태스크만의 특별 규칙 — 같은 레포의 다른 태스크에는 안 쓰인다", folder["rule_task"].as_str()),
		("일반 규칙", repo["rule_general"].as_str()),
		("태스크 작성 규칙 — 서브태스크를 만들거나 다듬을 때 따른다", repo["rule_task_writing"].as_str()),
	];
	let rules = team_rules_section(&rule_pairs);
	let reminder = team_rules_reminder(&rule_pairs, "절대 잊지 마라 — 특히 서브태스크에 지시를 내릴 때마다.");
	let folder_name = folder["name"].as_str().unwrap_or_default();
	let folder_id = folder["id"].as_str().unwrap_or_default();
	let step0 = if !rules.is_empty() {
		"위 팀 규칙이 있으면 아래 단계를 진행하기 전에 다시 한번 확인해라 — 서브태스크를 만들거나 진행시킬 때마다 그 규칙에 맞는지 스스로 점검한다.".to_string()
	} else {
		"(이 레포엔 등록된 팀 규칙이 없다 — 특별한 제약 없이 진행)".to_string()
	};

	format!(
		"[역할: \"{folder_name}\" 태스크 매니저 — PO/기획자] 너는 OpenTask라는 조직의 PO(기획자)야. 위로는 하이브마인드(대표 — {operator}와 직접 대화하며 전체를 총괄)가 있고, \
아래로는 개발자·디자이너 역할을 하는 서브태스크들이 있다. PO가 늘 그렇듯 기획·설계·지시·검토만 하고, 코드는 절대 네가 직접 짜지 않는다 — 실제 개발은 전부 서브태스크(개발자)의 몫이다. \
{operator}가 너와 직접 대화한다. 바로 실행하지 말고 계획부터 보고하고 승인받아.{rules}\n\n\
■ 언어: {operator}가 쓰는 언어에 맞춰 답변해라 — 영어로 물으면 영어로, 한국어로 물으면 한국어로.\n\n\
■ 아주 중요한 원칙 — 너 자신은 절대 코드를 직접 작성하지 않는다. 지금 이 세션(cwd: {cwd})은 실제 레포 워킹카피가 아니라 이 태스크 전용 오케스트레이션 자리다(다른 태스크의 매니저와 절대 안 겹침). \
실제 코드 작업은 전부 아래 서브태스크 체인 툴로 만든 \"서브태스크\"의 자기 워크트리 안에서만 일어난다 — 너는 그 체인을 시작·확인·진행시키기만 한다.\n\n\
■ 이 폴더의 태스크 목록 (taskId: 이름):\n{list}\n\n\
■ 태스크 하나의 실제 작업 진행 — create_subtask / get_subtask_chain / start_subtask_work / advance_subtask_work / report_task_verify (taskId만 넘기면 됨):\n\
0. {step0}\n\
1. get_subtask_chain({{taskId}})로 지금 서브태스크 체인 상태(뭐가 있고, 어느 게 살아있고, 워크트리·브랜치가 뭔지)를 먼저 확인해라.\n\
2. 서브태스크가 하나도 없으면 네가(PO로서) 직접 create_subtask({{taskId, name, desc}})를 순서대로 여러 번 불러 작업 단위를 계획해라 — 기준은 \"각각 독립적으로 커밋·PR 가능한 단위인가\"(개발/QA/배포 같은 파이프라인 단계로 쪼개지 마라, 보통 2~5개). \
계획을 다 세웠으면(또는 AI 검토 workUnits를 그대로 써도 충분하다고 판단했으면) start_subtask_work({{taskId}})로 첫 서브태스크의 워크트리+세션을 띄운다.\n\
3. 서브태스크가 실제로 다 끝나면 그 서브태스크 세션 자신이 advance_subtask_work를 호출해 스스로 다음 단계로 넘기고, 그 결과가 네 이 화면(pty)에 직접 타이핑돼 들어온다 — 네가 advance_subtask_work를 먼저 호출해 판단할 필요는 없다. \
통보가 의심스럽거나 한참 조용하면 get_subtask_chain/dispatch_subtask로 직접 확인해라. 막힌 서브태스크가 있으면 dispatch_subtask로 맥락을 주거나 {operator}에게 물어봐서 풀어줘라.\n\
4. 모든 서브태스크가 끝나면(마지막 단계 완료 통보가 옴) {operator}에게 완료를 보고해.\n\
5. 현황판에 이 태스크를 어떻게 확인하면 되는지 보여줘라 — report_task_verify({{taskId, text, url?}})로 언제든 추가할 수 있다. 마지막 서브태스크는 이 태스크(또는 서브태스크 자신)에 검증 자료가 하나도 없으면 완료 처리 자체가 거부된다.\n\n\
■ 서브에게 말 걸기·기록은 반드시 OpenRM API/MCP 경유(관측·대화 로그 기록용) — tmux로 직접 하지 마. MCP 툴 dispatch_subtask/log_event/set_subtask_kind가 있으면(도구 목록 확인) 그걸 우선 써. 없거나 호출이 실패하면 아래 curl로 폴백해:\n\
- 지금 진행 중인 서브태스크에 지시: curl -s -X POST http://localhost:{port}/api/folders/{folder_id}/conductor/say -H 'Content-Type: application/json' -d '{{\"taskId\":\"<위 목록의 taskId>\",\"text\":\"<지시>\"}}'\n\
- 결과/진행을 받으면 기록: curl -s -X POST http://localhost:{port}/api/folders/{folder_id}/conductor/event -H 'Content-Type: application/json' -d '{{\"from\":\"<taskId>\",\"to\":\"orch\",\"text\":\"<요약>\",\"kind\":\"result\"}}'\n\
- 서브태스크 생성(계획): curl -s -X POST http://localhost:{port}/api/tasks/<taskId>/subtasks -H 'Content-Type: application/json' -d '{{\"name\":\"<8~16자 업무 단위 이름>\",\"desc\":\"<1~2문장>\"}}'\n\
- 서브태스크 체인 시작/진행: curl -s -X POST http://localhost:{port}/api/tasks/<taskId>/subtask-work/start (또는 /advance)\n\
- 태스크 전체 검증 자료 갱신(5번): curl -s -X POST http://localhost:{port}/api/tasks/<taskId>/verify -H 'Content-Type: application/json' -d '{{\"text\":\"<확인 방법>\",\"url\":\"<URL 있으면>\",\"source\":\"conductor\"}}'\n\n\
■ 원칙: 태스크 목표를 이해하고, 서브태스크별 진행 상황을 확인하고, 결과를 검증·종합해서 {operator}에게 보고해. 지금 상황을 파악해 계획을 {operator}에게 보고해줘.{}\n\n\
■ 다시 한번 — 너(PO)는 절대 코드를 직접 작성하지 않는다. 막힌 서브태스크를 도와줄 때도 네가 대신 파일을 고치지 말고 방향을 지시(dispatch_subtask)하거나 {operator}에게 판단을 물어라. \
서브태스크가 진행(progress) 알림을 보내면 무시하지 말고 필요하면 dispatch_subtask로 짧게 반응해줘(확인했다는 한마디라도) — 대화가 실제로 오가는 걸 보여주는 것 자체가 신뢰를 준다.",
		if !reminder.is_empty() { format!("\n\n■ {reminder}") } else { String::new() },
	)
}

/// conductorEverStarted — folders.conductor_session(§ db.cjs v24)만으로 판단.
/// ⚠️ 축소 지점: Node판의 Term.restorable() 스냅샷 폴백(v24 이전 레거시 폴더용)은 생략 — 세션 스냅샷
/// 파일 메커니즘 자체가 미포팅(§ term.rs 축소 지점 3).
async fn conductor_ever_started(folder: &Value) -> bool {
	if folder["conductor_session"].as_str().map(|s| !s.is_empty()).unwrap_or(false) {
		return true;
	}
	let folder_name = folder["name"].as_str().unwrap_or_default();
	let expected_label = format!("conductor-{folder_name}");
	term::restorable().into_iter().any(|r| r["kind"].as_str() == Some("agent") && r["label"].as_str() == Some(expected_label.as_str()))
}

/// orchestrator.cjs restoreByName() — term::restore({name})의 단일 결과 래퍼(§ start_subtask_work/
/// get_subtask_work_state가 죽은 세션을 다시 살릴 때도 재사용).
pub async fn restore_by_name(name: &str) -> Option<Value> {
	let r = term::restore(Some(name), None, false).await;
	let result = r["results"].as_array()?.first()?.clone();
	if result["ok"].as_bool() == Some(true) {
		Some(result)
	} else {
		None
	}
}

/// restoreConductorSession — `claude --continue`를 그 폴더 전용 cwd에서 새로 스폰해 대화를 이어받는다.
/// --continue가 이어받을 대화를 못 찾으면(term::watch_continue_fallback) 이 시드로 새로 시작한다.
async fn restore_conductor_session(pool: &Pool, folder: &Value) -> Option<Value> {
	if !conductor_ever_started(folder).await {
		return None;
	}
	let folder_id = folder["id"].as_str().unwrap_or_default();
	let cwd = conductor_cwd(folder_id);
	let cwd_str = cwd.to_string_lossy().into_owned();
	let model = settings::model_for("orchestrator");
	let tasks = tasks::list_by_folder(pool, Some(folder_id)).ok()?;
	let fallback_seed = conductor_seed(pool, folder, &tasks, &cwd_str);
	let t = term::create(term::CreateOptions {
		cwd: &cwd_str,
		command: Some("claude --continue"),
		label: Some(&format!("conductor-{}", folder["name"].as_str().unwrap_or_default())),
		model: Some(model),
		mcp_folder_id: Some(folder_id),
		continue_fallback_seed: Some(&fallback_seed),
		..Default::default()
	})
	.await;
	if t["ok"].as_bool() != Some(true) {
		return None;
	}
	let _ = folders::update(pool, folder_id, &json!({"conductorSession": t["name"]}));
	Some(t)
}

/// startConductor — 이미 살아있으면 재사용, 아니면 복원(--continue) 시도 후 실패하면 새 세션+시드.
pub async fn start_conductor(pool: &Pool, folder_id: &str) -> anyhow::Result<Value> {
	let folder = match folders::get(pool, folder_id)? {
		Some(f) => f,
		None => return Ok(json!({"ok": false, "error": "folder not found"})),
	};
	{
		let states = STATES.lock().unwrap();
		if let Some(s) = states.get(folder_id) {
			if let Some(session) = s["conductor"]["session"].as_str() {
				if term::exists(session) {
					return Ok(json!({"ok": true, "already": true}).as_object().unwrap().iter().chain(s["conductor"].as_object().unwrap()).map(|(k, v)| (k.clone(), v.clone())).collect::<serde_json::Map<_, _>>().into());
				}
			}
		}
	}
	let tasks = tasks::list_by_folder(pool, Some(folder_id))?;
	let model = settings::model_for("orchestrator");
	let model_label = settings::model_label(&model); // fableLock "(비용 잠금)" 표시(§ modelLabelFor)는 미포팅 — 순수 라벨만.
	let cwd = conductor_cwd(folder_id);
	let cwd_str = cwd.to_string_lossy().into_owned();

	if let Some(restored) = restore_conductor_session(pool, &folder).await {
		let session = restored["name"].as_str().unwrap_or_default().to_string();
		let conductor = json!({"session": session, "model": model, "modelLabel": model_label, "startedAt": chrono::Utc::now().timestamp_millis(), "cwd": cwd_str});
		ensure_state_and(folder_id, |s| {
			s["conductor"] = conductor.clone();
			push_feed(s, "orch", &operator_name(), &format!("태스크 매니저 세션 복원 ({model_label}) — 직전 대화를 이어받습니다."), "plan", None);
		});
		return Ok(json!({"ok": true}).as_object().unwrap().iter().chain(conductor.as_object().unwrap()).map(|(k, v)| (k.clone(), v.clone())).collect::<serde_json::Map<_, _>>().into());
	}

	let seed = conductor_seed(pool, &folder, &tasks, &cwd_str);
	let t = term::create(term::CreateOptions {
		cwd: &cwd_str,
		command: Some("claude"),
		label: Some(&format!("conductor-{}", folder["name"].as_str().unwrap_or_default())),
		seed: Some(&seed),
		model: Some(model.clone()),
		mcp_folder_id: Some(folder_id),
		..Default::default()
	})
	.await;
	if t["ok"].as_bool() != Some(true) {
		return Ok(json!({"ok": false, "error": t["error"]}));
	}
	let session = t["name"].as_str().unwrap_or_default().to_string();
	folders::update(pool, folder_id, &json!({"conductorSession": session}))?;
	let conductor = json!({"session": session, "model": model, "modelLabel": model_label, "startedAt": chrono::Utc::now().timestamp_millis(), "cwd": cwd_str});
	ensure_state_and(folder_id, |s| {
		s["conductor"] = conductor.clone();
		push_feed(s, "orch", &operator_name(), &format!("태스크 매니저 세션 투입 ({model_label}) — 서브태스크 {}건. 계획 수립 중…", tasks.len()), "plan", None);
	});
	Ok(json!({"ok": true}).as_object().unwrap().iter().chain(conductor.as_object().unwrap()).map(|(k, v)| (k.clone(), v.clone())).collect::<serde_json::Map<_, _>>().into())
}

/// restoreConductorIfSnapshotted — 서버가 뜨는 순간 이미 살아있었던 지휘자 세션(스냅샷은 있는데 지금
/// 안 살아있는 것)을 복원한다. "아직 한 번도 시작 안 한" 지휘자까지 새로 만들지는 않는다(그건 사람이
/// 직접 시작해야 하는 행동) — restore_conductor_session이 conductor_ever_started로 이미 그 경계를 지킨다.
async fn restore_conductor_if_snapshotted(pool: &Pool, folder: &Value) {
	let Some(folder_id) = folder["id"].as_str() else { return };
	let live = term::list();
	let already_live = ensure_state_and(folder_id, |s| s["conductor"]["session"].as_str().map(|sess| term::is_live(&live, sess)).unwrap_or(false));
	if already_live {
		return;
	}
	let Some(restored) = restore_conductor_session(pool, folder).await else { return };
	let model = settings::model_for("orchestrator");
	let model_label = settings::model_label_for("orchestrator");
	let session = restored["name"].as_str().unwrap_or_default().to_string();
	let cwd_str = conductor_cwd(folder_id).to_string_lossy().into_owned();
	ensure_state_and(folder_id, |s| {
		s["conductor"] = json!({"session": session, "model": model, "modelLabel": model_label, "startedAt": chrono::Utc::now().timestamp_millis(), "cwd": cwd_str});
		push_feed(s, "orch", &operator_name(), &format!("태스크 매니저 세션 복원 ({model_label}) — 컴퓨터 재시작 후 자동 복원."), "plan", None);
	});
}

/// restoreSubtasksIfSnapshotted — 태스크의 서브태스크 중 "시작한 적 있는데(subtask_sessions 기록 있음)
/// 지금 안 살아있는" 것들을 복원한다.
async fn restore_subtasks_if_snapshotted(pool: &Pool, task: &Value) -> anyhow::Result<()> {
	let task_id = task["id"].as_str().unwrap_or_default();
	let subs = subtasks::list_by_task(pool, task_id)?;
	let live = term::list();
	for st in &subs {
		let st_id = st["id"].as_str().unwrap_or_default();
		let Some(active) = subtask_sessions::get_active_for_subtask(pool, st_id)? else { continue };
		let tmux = active["tmux_session"].as_str().unwrap_or_default();
		if term::is_live(&live, tmux) {
			continue; // 시작한 적 없거나 이미 살아있음
		}
		let Some(restored) = restore_by_name(tmux).await else { continue };
		let restored_name = restored["name"].as_str().unwrap_or_default();
		subtask_sessions::create(
			pool,
			subtask_sessions::CreateInput {
				subtask_id: st_id.to_string(),
				task_id: task_id.to_string(),
				tmux_session: restored_name.to_string(),
				worktree_path: active["worktree_path"].as_str().unwrap_or_default().to_string(),
				branch: active["branch"].as_str().map(str::to_string),
				model: active["model"].as_str().map(str::to_string),
				model_label: active["model_label"].as_str().map(str::to_string),
			},
		)?;
		sync_folder_session(
			task,
			json!({"taskId": task_id, "tmuxSession": restored_name, "worktreePath": active["worktree_path"], "model": active["model"], "modelLabel": active["model_label"]}),
		);
	}
	Ok(())
}

/// "맥북 껏다킬거야. 세션전부 다시 살아나고 태스크도 살아나야해" — 서버가 뜨는 순간 이미 살아있었던
/// 세션(스냅샷은 있는데 지금 안 살아있는 것)을 전부 한 번에 복원한다. main.rs가 서버 시작 시 한 번
/// 호출한다(§ Node판 index.cjs 서버 listen 콜백의 Orchestrator.restoreAllOnBoot()).
pub async fn restore_all_on_boot(pool: &Pool) -> anyhow::Result<Value> {
	let folders_list = folders::list(pool)?;
	let mut restored_count = 0;
	for folder in &folders_list {
		let Some(folder_id) = folder["id"].as_str() else { continue };
		let before = ensure_state_and(folder_id, |s| !s["conductor"].is_null());
		restore_conductor_if_snapshotted(pool, folder).await;
		let after = ensure_state_and(folder_id, |s| !s["conductor"].is_null());
		if !before && after {
			restored_count += 1;
		}
		let tasks_list = tasks::list_by_folder(pool, Some(folder_id))?;
		for task in &tasks_list {
			let _ = restore_subtasks_if_snapshotted(pool, task).await;
		}
		// "메인 태스크 진행중 표기가 안나와" — restoreSubtasksIfSnapshotted가 sync_folder_session으로
		// s.sessions는 채워주지만, running 자체는 start()/stop()에서만 손대는 별도 플래그라 여기선 한
		// 번도 안 켜졌다. 서버 재시작마다 이미 돌던 메인 태스크의 스피너가 꺼진 채로 보이던 원인 —
		// start()와 같은 기준(세션이 하나라도 있으면 running)으로 여기서도 맞춰준다.
		ensure_state_and(folder_id, |s| {
			let running = s["sessions"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
			s["running"] = json!(running);
		});
	}
	Ok(json!({"ok": true, "folders": folders_list.len(), "restoredConductors": restored_count}))
}

pub fn stop_conductor(folder_id: &str) -> Value {
	let session = { STATES.lock().unwrap().get(folder_id).and_then(|s| s["conductor"]["session"].as_str().map(str::to_string)) };
	let Some(session) = session else {
		return json!({"ok": true});
	};
	term::kill(&session);
	ensure_state_and(folder_id, |s| {
		push_feed(s, "orch", &operator_name(), "태스크 매니저 세션 종료", "msg", None);
		s["conductor"] = Value::Null;
	});
	json!({"ok": true})
}

/// conductorSay — 지휘자 자신이 특정 서브태스크 세션에 지시 전달.
pub fn conductor_say(folder_id: &str, task_id: &str, text: &str) -> Value {
	if task_id.is_empty() || text.is_empty() {
		return json!({"ok": false, "error": "taskId·text 필수"});
	}
	if STATES.lock().unwrap().get(folder_id).is_none() {
		return json!({"ok": false, "error": "오케스트레이션 상태 없음"});
	}
	let target_session = {
		let states = STATES.lock().unwrap();
		states.get(folder_id).and_then(|s| s["sessions"].as_array()).and_then(|arr| arr.iter().find(|x| x["taskId"] == task_id)).and_then(|x| x["tmuxSession"].as_str()).map(str::to_string)
	};
	let Some(target_session) = target_session else {
		ensure_state_and(folder_id, |s| push_feed(s, "orch", task_id, &format!("(전달 실패: 세션 없음) {text}"), "error", None));
		return json!({"ok": false, "error": format!("taskId {task_id}의 세션이 없습니다.")});
	};
	let result = term::send(&target_session, text);
	ensure_state_and(folder_id, |s| push_feed(s, "orch", task_id, text, if result.is_ok() { "dispatch" } else { "error" }, None));
	match result {
		Ok(_) => json!({"ok": true, "session": target_session}),
		Err(e) => json!({"ok": false, "error": e}),
	}
}

/// conductorTell — 사람(UI)이 지휘자 세션에 직접 말 걸기.
pub fn conductor_tell(folder_id: &str, text: &str) -> Value {
	if text.is_empty() {
		return json!({"ok": false, "error": "text 필수"});
	}
	let session = { STATES.lock().unwrap().get(folder_id).and_then(|s| s["conductor"]["session"].as_str().map(str::to_string)) };
	let Some(session) = session else {
		return json!({"ok": false, "error": "태스크 매니저 세션이 없습니다(먼저 시작)."});
	};
	if !term::exists(&session) {
		return json!({"ok": false, "error": "태스크 매니저 세션이 죽었습니다."});
	}
	let result = term::send(&session, text);
	ensure_state_and(folder_id, |s| push_feed(s, &operator_name(), "orch", text, "msg", None));
	match result {
		Ok(_) => json!({"ok": true}),
		Err(e) => json!({"ok": false, "error": e}),
	}
}

pub fn conductor_event(folder_id: &str, from: &str, to: &str, text: &str, kind: &str) -> Value {
	ensure_state_and(folder_id, |s| push_feed(s, from, to, text, kind, None));
	json!({"ok": true})
}

pub fn conductor_feed(folder_id: &str) -> Value {
	let feed = STATES.lock().unwrap().get(folder_id).map(|s| s["feed"].clone()).unwrap_or_else(|| json!([]));
	json!({"ok": true, "feed": feed})
}

/// conductorSetKind — 지휘자가 이미 있는 서브태스크의 kind(single/chain/parallel)만 판단·수정.
pub fn conductor_set_kind(pool: &Pool, folder_id: &str, task_id: &str, kind: &str, reason: Option<&str>) -> anyhow::Result<Value> {
	if task_id.is_empty() || kind.is_empty() {
		return Ok(json!({"ok": false, "error": "taskId·kind 필수"}));
	}
	if !["single", "chain", "parallel"].contains(&kind) {
		return Ok(json!({"ok": false, "error": format!("알 수 없는 kind: {kind}")}));
	}
	let task = match tasks::get(pool, task_id)? {
		Some(t) => t,
		None => return Ok(json!({"ok": false, "error": "task not found"})),
	};
	let prev_kind = task["kind"].as_str().unwrap_or_default().to_string();
	tasks::update(pool, task_id, &json!({"kind": kind}))?;
	crate::decisions::record(pool, Some(folder_id), Some(task_id), "kind_judge", reason.unwrap_or("(근거 없음)"), Some(&json!({"from": prev_kind, "to": kind})))?;
	ensure_state_and(folder_id, |s| {
		push_feed(
			s,
			"orch",
			&operator_name(),
			&format!("kind 판단: \"{}\" {prev_kind} → {kind} — {}", task["name"].as_str().unwrap_or_default(), reason.unwrap_or("(근거 없음)")),
			"plan",
			None,
		)
	});
	Ok(json!({"ok": true, "task": tasks::get(pool, task_id)?}))
}

fn stall_threshold_ms() -> i64 {
	std::env::var("OPENRM_STALL_MIN").ok().and_then(|s| s.parse::<i64>().ok()).unwrap_or(10) * 60 * 1000
}
fn stall_renotify_cooldown_ms() -> i64 {
	std::env::var("OPENRM_STALL_COOLDOWN_MIN").ok().and_then(|s| s.parse::<i64>().ok()).unwrap_or(30) * 60 * 1000
}

/// checkStalledSubtasks — 명시적 보고(report-blocked) 없이 그냥 조용해지는 경우(컨텍스트 한도, 크래시,
/// 보고를 잊음)를 잡는 안전망. blocked(확정 신호)와 달리 추정이라 stalled에 따로 저장(§원본 주석).
/// 지휘자 자신의 침묵도 같은 방식으로 감지한다(폴더당 하나뿐이라 맵이 아니라 단일 불리언).
pub async fn check_stalled_subtasks(pool: &Pool) {
	let now = chrono::Utc::now().timestamp_millis();
	let live = term::list();
	let threshold = stall_threshold_ms();
	let cooldown = stall_renotify_cooldown_ms();
	let folders_list = match folders::list(pool) {
		Ok(v) => v,
		Err(_) => return,
	};
	for folder in folders_list {
		let Some(folder_id) = folder["id"].as_str().map(str::to_string) else { continue };

		let conductor_session = ensure_state_and(&folder_id, |s| s["conductor"]["session"].as_str().map(str::to_string));
		if let Some(session) = conductor_session {
			if term::is_live(&live, &session) {
				let status = term::status(&session).await;
				let working = status.as_ref().and_then(|s| s.get("working")).and_then(Value::as_bool).unwrap_or(false);
				let waiting = status.as_ref().and_then(|s| s.get("waiting")).and_then(Value::as_bool).unwrap_or(false);
				let needs_auth = status.as_ref().and_then(|s| s.get("needsAuth")).and_then(Value::as_bool).unwrap_or(false);
				if status.is_none() || working || waiting || needs_auth {
					ensure_state_and(&folder_id, |s| s["conductorStalled"] = json!(false));
				} else {
					let last = status.as_ref().and_then(|s| s.get("lastWorkingAt")).and_then(Value::as_i64).unwrap_or_else(|| ensure_state_and(&folder_id, |s| s["conductor"]["startedAt"].as_i64().unwrap_or(now)));
					let (already_stalled, notified_at) = ensure_state_and(&folder_id, |s| (s["conductorStalled"].as_bool().unwrap_or(false), s["conductorStalledNotifiedAt"].as_i64().unwrap_or(0)));
					if now - last >= threshold && !already_stalled && now - notified_at >= cooldown {
						let mins = (now - last) / 60000;
						ensure_state_and(&folder_id, |s| {
							s["conductorStalled"] = json!(true);
							s["conductorStalledNotifiedAt"] = json!(now);
							push_feed(s, "conductor", "human", &format!("지휘자 {mins}분째 응답 없음 — 확인해봐라(막힌 게 아니라면 무시해도 됨)."), "stalled", None);
						});
						notify::notify_escalation(&format!("💤 \"{}\" 지휘자 응답 없음", folder["name"].as_str().unwrap_or_default()), &format!("{mins}분째 조용합니다."));
					}
				}
			} else {
				ensure_state_and(&folder_id, |s| s["conductorStalled"] = json!(false));
			}
		} else {
			ensure_state_and(&folder_id, |s| s["conductorStalled"] = json!(false));
		}

		let Ok(tasks_list) = tasks::list_by_folder(pool, Some(&folder_id)) else { continue };
		for task in tasks_list {
			let Some(task_id) = task["id"].as_str() else { continue };
			let Ok(subtask_list) = subtasks::list_by_task(pool, task_id) else { continue };
			for st in subtask_list {
				let Some(subtask_id) = st["id"].as_str() else { continue };
				let session = subtask_sessions::get_active_for_subtask(pool, subtask_id).ok().flatten();
				let Some(session) = session else {
					ensure_state_and(&folder_id, |s| {
						s["stalled"].as_object_mut().unwrap().remove(subtask_id);
					});
					continue;
				};
				let tmux_session = session["tmux_session"].as_str().unwrap_or_default();
				if !term::is_live(&live, tmux_session) {
					ensure_state_and(&folder_id, |s| {
						s["stalled"].as_object_mut().unwrap().remove(subtask_id);
					});
					continue;
				}
				let already_blocked = ensure_state_and(&folder_id, |s| s["blocked"].get(subtask_id).is_some());
				if already_blocked {
					continue; // 이미 명시적으로 막힘 보고됨 — 중복 알림 방지
				}
				let status = term::status(tmux_session).await;
				let working = status.as_ref().and_then(|s| s.get("working")).and_then(Value::as_bool).unwrap_or(false);
				let waiting = status.as_ref().and_then(|s| s.get("waiting")).and_then(Value::as_bool).unwrap_or(false);
				let needs_auth = status.as_ref().and_then(|s| s.get("needsAuth")).and_then(Value::as_bool).unwrap_or(false);
				if status.is_none() || working || waiting || needs_auth {
					ensure_state_and(&folder_id, |s| {
						s["stalled"].as_object_mut().unwrap().remove(subtask_id);
					});
					continue;
				}
				let last = status.as_ref().and_then(|s| s.get("lastWorkingAt")).and_then(Value::as_i64).unwrap_or_else(|| session["started_at"].as_i64().unwrap_or(now));
				let already_stalled = ensure_state_and(&folder_id, |s| s["stalled"].get(subtask_id).is_some());
				if now - last < threshold || already_stalled {
					continue;
				}
				let notified_at = ensure_state_and(&folder_id, |s| s["stalledNotifiedAt"][subtask_id].as_i64().unwrap_or(0));
				if now - notified_at < cooldown {
					continue;
				}
				ensure_state_and(&folder_id, |s| {
					s["stalled"][subtask_id] = json!(true);
					s["stalledNotifiedAt"][subtask_id] = json!(now);
				});
				let mins = (now - last) / 60000;
				let name = st["name"].as_str().unwrap_or_default();
				notify_conductor(&folder_id, subtask_id, &format!("\"{name}\" {mins}분째 응답 없음 — 확인해봐라(막힌 게 아니라면 무시해도 됨)."), "stalled", None).await;
				notify::notify_escalation(&format!("💤 \"{name}\" 응답 없음"), &format!("{mins}분째 조용합니다."));
			}
		}
	}
}

// ── 폴더 단위 오케스트레이션 진입점 ───────────────────────────────────────────────────────────
static STARTING: std::sync::LazyLock<Mutex<std::collections::HashSet<String>>> = std::sync::LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

/// start — 폴더의 모든 태스크에 대해 서브태스크 체인을 착수(순차 진행은 startSubtaskWork/launchSubtask가
/// 이미 담당)하고, 지휘자 세션도 동시에(대기 없이) 띄운다.
pub async fn start(pool: &Pool, folder_id: &str) -> anyhow::Result<Value> {
	{
		let mut starting = STARTING.lock().unwrap();
		if starting.contains(folder_id) {
			return Ok(json!({"ok": false, "error": "이미 시작 중입니다 — 잠시 후 다시 시도하세요."}));
		}
		starting.insert(folder_id.to_string());
	}
	let result = start_inner(pool, folder_id).await;
	STARTING.lock().unwrap().remove(folder_id);
	result
}

async fn start_inner(pool: &Pool, folder_id: &str) -> anyhow::Result<Value> {
	let folder = match folders::get(pool, folder_id)? {
		Some(f) => f,
		None => return Ok(json!({"ok": false, "error": "folder not found"})),
	};
	let tasks_list = tasks::list_by_folder(pool, Some(folder_id))?;
	if tasks_list.is_empty() {
		return Ok(json!({"ok": false, "error": "폴더에 태스크가 없습니다."}));
	}
	let conductor_task = start_conductor(pool, folder_id);
	tokio::pin!(conductor_task);

	for task in &tasks_list {
		let task_id = task["id"].as_str().unwrap_or_default();
		let existing_session = { STATES.lock().unwrap().get(folder_id).and_then(|s| s["sessions"].as_array().and_then(|a| a.iter().find(|x| x["taskId"] == task_id).cloned())) };
		if let Some(existing) = &existing_session {
			if let Some(tmux) = existing["tmuxSession"].as_str() {
				if term::exists(tmux) {
					ensure_state_and(folder_id, |s| push_log(s, &format!("재사용: \"{}\" → {tmux}", task["name"].as_str().unwrap_or_default()), "blue"));
					continue;
				}
			}
		}
		let repo_id = resolve_repo_id(None, Some(&folder), Some(task));
		if task["repo_auto"].as_i64() == Some(1) {
			if let Some(repo) = repo_id.as_ref().and_then(|id| repos::get(pool, id).ok().flatten()) {
				if !repo_assignment_looks_right(task, &repo) {
					crate::decisions::record(
						pool,
						Some(folder_id),
						Some(task_id),
						"repo_verify_hold",
						&format!("AI가 자동배정한 레포({})와 태스크명 사이에 겹치는 키워드가 없어 재확인이 필요합니다.", repo["name"].as_str().unwrap_or_default()),
						Some(&json!({"repoId": repo["id"], "repoName": repo["name"]})),
					)?;
					ensure_state_and(folder_id, |s| {
						push_log(s, &format!("⚠️ 레포 배정 재확인 필요: \"{}\" → {} (키워드 안 겹침)", task["name"].as_str().unwrap_or_default(), repo["name"].as_str().unwrap_or_default()), "amber")
					});
				}
			}
		}
		let r = start_subtask_work(pool, task_id).await?;
		if r["ok"].as_bool() != Some(true) {
			ensure_state_and(folder_id, |s| push_log(s, &format!("세션 시작 실패: \"{}\" — {}", task["name"].as_str().unwrap_or_default(), r["error"].as_str().unwrap_or_default()), "amber"));
			continue;
		}
		if folder["base"].is_null() {
			if let Some(base) = r["base"].as_str() {
				folders::update(pool, folder_id, &json!({"base": base}))?;
			}
		}
		let already = r["already"].as_bool().unwrap_or(false);
		let msg = if already {
			format!("재사용: \"{}\" → {}", task["name"].as_str().unwrap_or_default(), r["tmuxSession"].as_str().unwrap_or_default())
		} else {
			format!("투입: \"{}\" → 서브태스크 \"{}\" ({})", task["name"].as_str().unwrap_or_default(), r["subtaskName"].as_str().unwrap_or_default(), r["tmuxSession"].as_str().unwrap_or_default())
		};
		ensure_state_and(folder_id, |s| push_log(s, &msg, if already { "blue" } else { "green" }));
	}

	let session_count = ensure_state_and(folder_id, |s| {
		let running = s["sessions"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
		s["running"] = json!(running);
		s["currentWaveIndex"] = json!(0);
		s["sessions"].as_array().map(|a| a.len()).unwrap_or(0)
	});
	ensure_state_and(folder_id, |s| push_log(s, &format!("오케스트레이션 시작 — {session_count}개 세션 (총 {}개 태스크)", tasks_list.len()), "violet"));
	let _ = conductor_task.await;
	Ok(json!({"ok": true}).as_object().unwrap().iter().chain(get_state(folder_id).as_object().unwrap()).map(|(k, v)| (k.clone(), v.clone())).collect::<serde_json::Map<_, _>>().into())
}

fn push_log(state: &mut Value, text: &str, dot: &str) {
	let log = state["log"].as_array_mut().unwrap();
	log.push(json!({"t": text, "dot": dot, "at": chrono::Utc::now().timestamp_millis()}));
	let len = log.len();
	if len > 200 {
		log.drain(0..len - 200);
	}
}

fn repo_assignment_looks_right(task: &Value, repo: &Value) -> bool {
	fn tokenize(s: &str) -> std::collections::HashSet<String> {
		regex::Regex::new(r"[^a-z0-9가-힣]+").unwrap().split(&s.to_lowercase()).filter(|t| t.chars().count() >= 2).map(str::to_string).collect()
	}
	let task_tokens: std::collections::HashSet<String> =
		tokenize(task["name"].as_str().unwrap_or_default()).into_iter().chain(tokenize(task["desc"].as_str().unwrap_or_default())).collect();
	let repo_tokens = tokenize(repo["name"].as_str().unwrap_or_default());
	repo_tokens.iter().any(|t| task_tokens.contains(t)) || task_tokens.is_empty() || repo_tokens.is_empty()
}

/// advance — 현재 웨이브 세션에 "계속 진행" nudge(수동 진행, 완료 자동감지는 범위 밖).
pub async fn advance(folder_id: &str) -> Value {
	let running = STATES.lock().unwrap().get(folder_id).map(|s| s["running"].as_bool().unwrap_or(false)).unwrap_or(false);
	if !running {
		return json!({"ok": false, "error": "오케스트레이션이 실행 중이 아닙니다. 먼저 start 하세요."});
	}
	let sessions = STATES.lock().unwrap().get(folder_id).and_then(|s| s["sessions"].as_array().cloned()).unwrap_or_default();
	if sessions.is_empty() {
		return json!({"ok": false, "error": "진행할 세션이 없습니다."});
	}
	let idx = STATES.lock().unwrap().get(folder_id).and_then(|s| s["currentWaveIndex"].as_u64()).unwrap_or(0) as usize;
	let idx = idx.min(sessions.len() - 1);
	let cur = &sessions[idx];
	let mut dispatched = false;
	if let Some(tmux) = cur["tmuxSession"].as_str() {
		let result = term::send(tmux, "계속 진행해줘.");
		dispatched = result.is_ok();
		let msg = if dispatched { format!("▶ 진행 지시 → {tmux}") } else { format!("진행 지시 실패 → {tmux}: {}", result.err().unwrap_or_default()) };
		ensure_state_and(folder_id, |s| push_log(s, &msg, if dispatched { "blue" } else { "amber" }));
	}
	let next_idx = ensure_state_and(folder_id, |s| {
		let len = s["sessions"].as_array().map(|a| a.len()).unwrap_or(1);
		let cur_idx = s["currentWaveIndex"].as_u64().unwrap_or(0) as usize;
		if cur_idx < len - 1 {
			s["currentWaveIndex"] = json!(cur_idx + 1);
		}
		s["currentWaveIndex"].as_u64().unwrap_or(0)
	});
	ensure_state_and(folder_id, |s| push_log(s, &format!("웨이브 인덱스 → {next_idx}"), "violet"));
	let mut out = json!({"ok": true, "dispatched": dispatched});
	for (k, v) in get_state(folder_id).as_object().unwrap() {
		out[k] = v.clone();
	}
	out
}

/// stop — 이 폴더의 모든 세션(서브태스크 세션들)을 종료. 지휘자는 별도(stopConductor)로 남긴다
/// (Node 원본과 동일 — stop()이 conductor는 안 건드림, 사람이 명시적으로 지휘자를 따로 끄게 함).
pub fn stop(folder_id: &str) -> Value {
	let sessions = STATES.lock().unwrap().get(folder_id).and_then(|s| s["sessions"].as_array().cloned()).unwrap_or_default();
	for sess in &sessions {
		if let Some(tmux) = sess["tmuxSession"].as_str() {
			term::kill(tmux);
			ensure_state_and(folder_id, |s| push_log(s, &format!("세션 종료: {tmux}"), "amber"));
		}
	}
	ensure_state_and(folder_id, |s| {
		s["running"] = json!(false);
		s["sessions"] = json!([]);
		s["currentWaveIndex"] = json!(0);
		push_log(s, "오케스트레이션 정지", "violet");
	});
	let mut out = json!({"ok": true});
	for (k, v) in get_state(folder_id).as_object().unwrap() {
		out[k] = v.clone();
	}
	out
}

/// getSubtaskWorkState — 이 태스크의 서브태스크 체인 전체를 순서대로: 시작 여부·생존 여부·완료 여부·
/// 막힘/침묵형 막힘 표시·워크트리·브랜치·리포트 URL.
/// ⚠️ 축소 지점: Node판은 세션이 죽어있으면(ended_at 없이 안 살아있음) restoreByName()으로 복원부터
/// 시도한 뒤 alive를 판정한다 — 그 복원 경로는 미포팅이라 여기선 그냥 alive:false로 보고한다.
/// getSubtaskWorkState — 폴링될 때마다, ended_at 없이(=명시적으로 안 끝남) 죽어있는 세션을 발견하면
/// restore_by_name()으로 자동 복원을 시도한다(서버 재시작 등으로 죽은 경우 사람 개입 없이 다음 폴링에서
/// 스스로 회복 — § Node판과 동일한 GET에 부수효과가 있는 설계).
pub async fn get_subtask_work_state(pool: &Pool, task_id: &str) -> anyhow::Result<Value> {
	let subs = subtasks::list_by_task(pool, task_id)?;
	let task = tasks::get(pool, task_id)?;
	let folder_id = task.as_ref().and_then(|t| t["folder_id"].as_str().map(str::to_string));
	let (blocked_map, stalled_map) = match &folder_id {
		Some(fid) => {
			let states = STATES.lock().unwrap();
			match states.get(fid) {
				Some(s) => (s["blocked"].clone(), s["stalled"].clone()),
				None => (json!({}), json!({})),
			}
		}
		None => (json!({}), json!({})),
	};

	let mut live = term::list();
	let mut result = Vec::with_capacity(subs.len());
	for st in &subs {
		let st_id = st["id"].as_str().unwrap_or_default();
		let session = subtask_sessions::latest_for_subtask(pool, st_id)?;
		let branch = branches::list_by_subtask(pool, st_id)?.into_iter().next();
		if let Some(s) = &session {
			let tmux = s["tmux_session"].as_str().unwrap_or_default();
			if s["ended_at"].is_null() && !term::is_live(&live, tmux) {
				if restore_by_name(tmux).await.is_some() {
					live = term::list();
				}
			}
		}
		let alive = session.as_ref().map(|s| s["ended_at"].is_null() && term::is_live(&live, s["tmux_session"].as_str().unwrap_or_default())).unwrap_or(false);
		let done = session.as_ref().map(|s| !s["ended_at"].is_null()).unwrap_or(false);
		result.push(json!({
			"id": st_id,
			"name": st["name"],
			"started": session.is_some(),
			"alive": alive,
			"done": done,
			"blocked": blocked_map.get(st_id).is_some(),
			"blockedReason": blocked_map.get(st_id).cloned().unwrap_or(Value::Null),
			"stalled": stalled_map.get(st_id).is_some(),
			"tmuxSession": session.as_ref().map(|s| s["tmux_session"].clone()).unwrap_or(Value::Null),
			"worktreePath": session.as_ref().map(|s| s["worktree_path"].clone()).unwrap_or(Value::Null),
			"branch": branch.map(|b| b["name"].clone()).unwrap_or(Value::Null),
			"reportUrl": session.as_ref().filter(|s| !s["report_html"].is_null()).map(|s| json!(format!("/api/subtask-sessions/{}/report", s["id"].as_str().unwrap_or_default()))).unwrap_or(Value::Null),
		}));
	}
	Ok(json!({"ok": true, "subtasks": result}))
}

#[allow(dead_code)]
pub fn app_config_repo(pool: &Pool) -> String {
	app_config::resolve_repo(pool)
}
