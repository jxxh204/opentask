// control.rs — app/server/control.cjs 이식. "관제(하이브마인드)" 에이전트: 태스크 하나가 아니라
// OpenTask 앱 전체(캘린더 일정·크론잡·운영 설정)를 대화로 조작하는 별도의 최상위 세션.
// orchestrator.rs의 conductor 패턴(term::create + seed + MCP 툴)을 그대로 따르되, git worktree가
// 아니라 이 앱 자체가 대상이라 특정 폴더에 묶이지 않는다(전역 상태 하나, 폴더별 Map 아님).
//
// 대화 이력 파싱(claude CLI 자신의 jsonl)은 별도 모듈 § transcript.rs가 담당 — 여기는 세션
// 시작/정지/재설정/지시/실시간 프롬프트(AskUserQuestion류) 판독까지.
use serde_json::{json, Value};
use std::sync::{LazyLock, Mutex};

fn port() -> String {
	std::env::var("OPENRM_PORT").unwrap_or_else(|_| "8770".to_string())
}

pub fn control_cwd() -> std::path::PathBuf {
	let data_dir = std::env::var("OPENRM_DATA_DIR").unwrap_or_else(|_| ".openrm-rust".to_string());
	let dir = std::path::Path::new(&data_dir).join(format!("control-cwd-{}", port()));
	let _ = std::fs::create_dir_all(&dir);
	crate::term::ensure_own_git_root(&dir);
	dir
}

fn tmux_session() -> String {
	format!("opentask-control-{}", port())
}

#[derive(Clone)]
struct ControlState {
	session: String,
	model: Option<String>,
	model_label: String,
	started_at: i64,
	cwd: String,
}

static STATE: LazyLock<Mutex<Option<ControlState>>> = LazyLock::new(|| Mutex::new(None));
static CONTROL_STALLED: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));
static LAST_OPS_TICK_AT: LazyLock<Mutex<Option<i64>>> = LazyLock::new(|| Mutex::new(None));

const STALLED_THRESHOLD_MS: i64 = 3 * 60 * 1000;

/// control.cjs registerControlMcp() — mcp_control.rs(§ 컴파일된 형제 바이너리, 이미 검증됨)를
/// opentask-control MCP 서버로 등록한다.
fn register_control_mcp(cwd: &std::path::Path) {
	let git_root = std::process::Command::new("git")
		.args(["-C", cwd.to_string_lossy().as_ref(), "rev-parse", "--show-toplevel"])
		.output()
		.ok()
		.filter(|o| o.status.success())
		.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| cwd.to_string_lossy().to_string());

	let config_path = std::env::var("OPENRM_CLAUDE_CONFIG")
		.map(std::path::PathBuf::from)
		.unwrap_or_else(|_| std::env::var("HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::PathBuf::from(".")).join(".claude.json"));
	let Ok(raw) = std::fs::read_to_string(&config_path) else { return };
	let Ok(mut cfg) = serde_json::from_str::<Value>(&raw) else { return };
	if !cfg.get("projects").map(Value::is_object).unwrap_or(false) {
		cfg["projects"] = json!({});
	}
	let existing = cfg["projects"].get(&git_root).cloned().unwrap_or(json!({}));
	let mut mcp_servers = existing.get("mcpServers").and_then(Value::as_object).cloned().unwrap_or_default();
	mcp_servers.insert(
		"opentask-control".to_string(),
		json!({
			"command": crate::term::sibling_bin("mcp_control").to_string_lossy(),
			"args": [],
			"env": {"OPENTASK_CONTROL": "1", "OPENTASK_PORT": port()},
		}),
	);
	let mut project_entry = existing.as_object().cloned().unwrap_or_default();
	project_entry.entry("allowedTools".to_string()).or_insert(json!([]));
	project_entry.entry("mcpContextUris".to_string()).or_insert(json!([]));
	project_entry.entry("enabledMcpjsonServers".to_string()).or_insert(json!([]));
	project_entry.entry("disabledMcpjsonServers".to_string()).or_insert(json!([]));
	project_entry.insert("mcpServers".to_string(), Value::Object(mcp_servers));
	project_entry.insert("hasTrustDialogAccepted".to_string(), json!(true));
	cfg["projects"][&git_root] = Value::Object(project_entry);
	if let Ok(pretty) = serde_json::to_string_pretty(&cfg) {
		let _ = std::fs::write(&config_path, pretty);
	}
}

fn control_seed(extra: Option<&str>) -> String {
	let port = port();
	let operator = crate::settings::operator_name();
	let extra_block = extra.map(|e| format!("\n\n■ 지금 바로 이걸 도와줘:\n{e}")).unwrap_or_default();
	format!(
		r#"[역할: OpenTask 하이브마인드] 너는 특정 태스크가 아니라 OpenTask 앱 전체를 대화로 조작하는 하이브마인드야. {operator}가 너와 직접 대화한다. 바로 실행하지 말고 계획부터 보고하고 승인받아.

■ 코드는 네가 직접 안 건드린다 — 하이브마인드=설계, 메인태스크(지휘자)=명령, 서브태스크=업무. 이 3단
구조가 무너지면 안 된다. Bash로 조사하는 것(grep/read/git log, 스크린샷으로 화면 확인 등)은 괜찮지만,
Edit/Write로 레포 파일을 고치거나 git commit/push를 하는 건 네 역할이 아니다 — {operator}가 이미지
붙여서 "이것도 저거처럼 고쳐줘"처럼 바로 손대고 싶은 요청을 해도 마찬가지다. 코드 작업이 필요하면:
- 그 태스크가 이미 시작돼 지휘자가 살아있으면 dispatch_to_task로 구체적으로 지시해라.
- 아직 시작 안 됐거나(일감함) 서브태스크가 전부 완료돼 지휘자가 없으면, create_subtask로 뭘 해야
  하는지 명확히 적은 서브태스크를 만들고, {operator}에게 "서브태스크 만들어뒀습니다 — 상세페이지에서
  개발 시작을 눌러주세요"라고 안내해라. 네가 대신 실제 워크트리+클로드 세션을 못 띄운다(§ 아래
  create_subtask 설명) — 이건 제약이지 우회할 방법을 찾으라는 뜻이 아니다.

■ 언어: {operator}가 쓰는 언어에 맞춰 답변해라 — 영어로 물으면 영어로, 한국어로 물으면 한국어로. 대화
도중 상대가 언어를 바꾸면 너도 바로 그 언어로 전환한다.

■ 할 수 있는 일 — MCP 툴(도구 목록에서 opentask-control로 시작하는 것들)을 우선 써라:
- list_tasks: 전체 보드(폴더/태스크/서브태스크/마감일) 조회
- create_task / update_task / delete_task: 태스크 생성·상세정보(이름/설명/진행방식/레포/마감일/기간/색상) 수정·삭제
- start_task: 일감함 태스크를 실제로 착수(폴더 승격 + 오케스트레이션 개시) — 사이드바 "시작" 버튼과 동일. 레포 자동배정은 없다(과거에 있었지만 검증 없이 엉뚱한 레포에 배정되는 사고로 꺼짐) —
  레포가 안 정해진 채로 start_task를 부르면 서브태스크가 레포 없이 오케스트레이션을 시도하다 막힌다.
  create_task에 repo를 안 채웠으면 start_task 전에 반드시 사람에게 레포를 물어봐서 채워라 — "자동으로
  알아서 배정될 거예요" 같은 말은 절대 하지 마라.
- reschedule_task: 태스크 마감일(캘린더 날짜)만 빠르게 변경
- dispatch_to_task: 이미 시작된 태스크의 지휘자(태스크 매니저) 세션에 직접 지시를 전달. 운영 모드 점검 중 방향 수정·재촉·막힘 해소 지시에 쓴다 — 아직 시작 안 된(일감함) 태스크엔 지휘자가 없어 못 쓴다.
- report_task_verify: 캘린더 위 현황판에 "이 태스크는 이렇게 확인하면 된다"를 보고(로컬서버 URL, 스크린샷 경로, 확인용 명령어 등). {operator}와 대화하다가 직접 확인한 방법이 생기면(예: 사람이 보여준 화면을 보고 판단했거나, 리포트를 읽고 정리한 확인 방법이 있으면) 이걸로 남겨라 — 서브태스크·태스크 매니저도 각자 자기 관점에서 같은 걸 보고하니, 네 게 최신이면 그게 그대로 보인다.
- create_subtask / update_subtask / delete_subtask: 태스크 하나를 개발/개발자테스트/QA/배포 같은 단계로 쪼갠 서브태스크 관리(각자 자기 설명·예정일·기간을 가짐). 실제 워크트리+클로드 세션을 띄우는 건 이 툴셋에 없다 — 그건 태스크 상세페이지에서 사람이 직접 하는 무거운 동작이라 하이브마인드가 대신하지 않는다.
- list_blocked_periods / create_blocked_period / delete_blocked_period: 캘린더 차단 기간(예: "QA 기간") 관리 — 만들면 겹치는 기존 일정이 자동으로 뒤로 밀린다.
- list_cron_jobs / create_cron_job / update_cron_job / delete_cron_job / run_cron_job_now: 크론잡(자동화) 관리
- read_settings / update_setting: 운영 설정 조회·변경 (경로/앱/배포/웹훅 등만 — GitHub 토큰, DB 연결문자열 같은 비밀값은 이 툴로 못 건드린다. 그건 설정 화면에서 사람이 직접 해야 함)

MCP 툴이 안 보이거나 호출이 실패하면 curl로 폴백: curl -s http://localhost:{port}/api/... (엔드포인트는 OpenTask 서버 코드 기준)

■ 하이브마인드답게 — "태스크 만들어줘"처럼 이름만 던져주고 끝나는 요청이 흔하다. 설명·마감일·기간·레포처럼
뭘 만들지에 실제로 영향을 주는 정보가 비어있으면 추측해서 그냥 만들지 말고, 짧게 하나씩 물어봐서
채운 뒤에 만들어라(팀 규칙 빈칸을 물어보며 채우는 것과 같은 태도). 사소한 값(색상 등)까지 전부 캐물어
피곤하게 만들 필요는 없다 — 실제로 판단이 갈리는 것만.

■ 원칙: 요청을 이해하고, 뭘 할지 먼저 {operator}에게 확인받은 뒤 실행해. 완료하면 뭘 했는지 요약해서 보고해.{extra_block}"#
	)
}

const CONTROL_DISALLOWED_TOOLS: &str = "'Edit,Write,NotebookEdit,Bash(git commit:*),Bash(git add:*),Bash(git push:*)'";

pub async fn get_state() -> Value {
	let ops_mode = crate::settings::load().get("opsMode").and_then(Value::as_bool).unwrap_or(false);
	let last_tick = *LAST_OPS_TICK_AT.lock().unwrap();
	let cwd_str = control_cwd().to_string_lossy().to_string();
	let empty = || json!({"running": false, "session": null, "cwd": cwd_str, "modelLabel": null, "persistent": crate::term::has_tmux(), "opsMode": ops_mode, "lastOpsTickAt": last_tick});

	let snapshot = STATE.lock().unwrap().clone();
	let Some(st) = snapshot else { return empty() };
	let live = crate::term::list();
	if !crate::term::is_live(&live, &st.session) {
		*STATE.lock().unwrap() = None;
		return empty();
	}
	let stalled = *CONTROL_STALLED.lock().unwrap();
	json!({
		"running": true,
		"stalled": stalled,
		"persistent": crate::term::has_tmux(),
		"opsMode": ops_mode,
		"lastOpsTickAt": last_tick,
		"session": st.session,
		"model": st.model,
		"modelLabel": st.model_label,
		"startedAt": st.started_at,
		"cwd": st.cwd,
	})
}

/// control.cjs checkStalled() — 하이브마인드용 응답없음 안전망(§ orchestrator.rs checkStalledSubtasks와 같은 개념).
pub async fn check_stalled() {
	let snapshot = STATE.lock().unwrap().clone();
	let Some(st) = snapshot else {
		*CONTROL_STALLED.lock().unwrap() = false;
		return;
	};
	let live = crate::term::list();
	if !crate::term::is_live(&live, &st.session) {
		*CONTROL_STALLED.lock().unwrap() = false;
		return;
	}
	let Some(status) = crate::term::status(&st.session).await else {
		*CONTROL_STALLED.lock().unwrap() = false;
		return;
	};
	let working = status.get("working").and_then(Value::as_bool).unwrap_or(false);
	let waiting = status.get("waiting").and_then(Value::as_bool).unwrap_or(false);
	let needs_auth = status.get("needsAuth").and_then(Value::as_bool).unwrap_or(false);
	if working || waiting || needs_auth {
		*CONTROL_STALLED.lock().unwrap() = false;
		return;
	}
	let last = status.get("lastWorkingAt").and_then(Value::as_i64).unwrap_or(st.started_at);
	let already_stalled = *CONTROL_STALLED.lock().unwrap();
	if chrono::Utc::now().timestamp_millis() - last < STALLED_THRESHOLD_MS || already_stalled {
		return;
	}
	*CONTROL_STALLED.lock().unwrap() = true;
	let mins = (chrono::Utc::now().timestamp_millis() - last) / 60000;
	crate::notify::notify_escalation("💤 하이브마인드 응답 없음", &format!("{mins}분째 조용합니다."));
}

pub async fn start(extra: Option<&str>) -> Value {
	let cwd = control_cwd();
	let cwd_str = cwd.to_string_lossy().to_string();
	let live = crate::term::list();
	{
		let snapshot = STATE.lock().unwrap().clone();
		if let Some(st) = &snapshot {
			if crate::term::is_live(&live, &st.session) {
				return json!({"ok": true, "already": true, "session": st.session, "model": st.model, "modelLabel": st.model_label, "startedAt": st.started_at, "cwd": st.cwd});
			}
		}
	}
	register_control_mcp(&cwd);
	let model = crate::settings::model_for("control");
	let command = if crate::term::has_tmux() {
		format!("tmux new-session -A -s {} -c \"{}\" \"claude --continue --disallowedTools {}\"", tmux_session(), cwd_str, CONTROL_DISALLOWED_TOOLS)
	} else {
		format!("claude --continue --disallowedTools {}", CONTROL_DISALLOWED_TOOLS)
	};
	let seed = control_seed(extra);
	let t = crate::term::create(crate::term::CreateOptions {
		cwd: &cwd_str,
		command: Some(&command),
		label: Some("control"),
		model: Some(model.clone()),
		continue_fallback_seed: Some(&seed),
		..Default::default()
	})
	.await;
	if t.get("ok").and_then(Value::as_bool) != Some(true) {
		return json!({"ok": false, "error": t.get("error").cloned().unwrap_or(json!("세션 생성 실패"))});
	}
	let name = t.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
	let model_label = crate::settings::model_label_for("control");
	let started_at = chrono::Utc::now().timestamp_millis();
	*STATE.lock().unwrap() = Some(ControlState { session: name.clone(), model: Some(model.clone()), model_label: model_label.clone(), started_at, cwd: cwd_str.clone() });
	json!({"ok": true, "session": name, "model": model, "modelLabel": model_label, "startedAt": started_at, "cwd": cwd_str})
}

pub fn stop() -> Value {
	let snapshot = STATE.lock().unwrap().take();
	let Some(st) = snapshot else { return json!({"ok": true}) };
	crate::term::kill(&st.session);
	if crate::term::has_tmux() {
		let _ = std::process::Command::new("tmux").args(["kill-session", "-t", &tmux_session()]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
	}
	json!({"ok": true})
}

pub async fn reset(extra: Option<&str>) -> Value {
	{
		let snapshot = STATE.lock().unwrap().take();
		if let Some(st) = snapshot {
			crate::term::kill(&st.session);
		}
	}
	if crate::term::has_tmux() {
		let _ = std::process::Command::new("tmux").args(["kill-session", "-t", &tmux_session()]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
	}
	let cwd = control_cwd();
	let cwd_str = cwd.to_string_lossy().to_string();
	register_control_mcp(&cwd);
	let model = crate::settings::model_for("control");
	let command = if crate::term::has_tmux() {
		format!("tmux new-session -A -s {} -c \"{}\" \"claude --disallowedTools {}\"", tmux_session(), cwd_str, CONTROL_DISALLOWED_TOOLS)
	} else {
		format!("claude --disallowedTools {}", CONTROL_DISALLOWED_TOOLS)
	};
	let seed = control_seed(extra);
	let t = crate::term::create(crate::term::CreateOptions { cwd: &cwd_str, command: Some(&command), label: Some("control"), model: Some(model.clone()), seed: Some(&seed), ..Default::default() }).await;
	if t.get("ok").and_then(Value::as_bool) != Some(true) {
		return json!({"ok": false, "error": t.get("error").cloned().unwrap_or(json!("세션 생성 실패"))});
	}
	let name = t.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
	let model_label = crate::settings::model_label_for("control");
	let started_at = chrono::Utc::now().timestamp_millis();
	*STATE.lock().unwrap() = Some(ControlState { session: name.clone(), model: Some(model.clone()), model_label: model_label.clone(), started_at, cwd: cwd_str.clone() });
	json!({"ok": true, "session": name, "model": model, "modelLabel": model_label, "startedAt": started_at, "cwd": cwd_str})
}

pub fn interrupt() -> Value {
	let snapshot = STATE.lock().unwrap().clone();
	let Some(st) = snapshot else { return json!({"ok": false, "error": "하이브마인드 세션이 없습니다."}) };
	match crate::term::interrupt(&st.session) {
		Ok(()) => json!({"ok": true}),
		Err(e) => json!({"ok": false, "error": e}),
	}
}

pub async fn ask(text: &str) -> Value {
	if text.trim().is_empty() {
		return json!({"ok": false, "error": "text 필수"});
	}
	let live = crate::term::list();
	let snapshot = STATE.lock().unwrap().clone();
	if let Some(st) = &snapshot {
		if crate::term::is_live(&live, &st.session) {
			let one_line: String = text.replace(['\r', '\n'], " ").chars().take(2000).collect();
			crate::term::inject_seed(&st.session, &one_line).await;
			return json!({"ok": true, "already": true, "session": st.session, "model": st.model, "modelLabel": st.model_label, "startedAt": st.started_at, "cwd": st.cwd});
		}
	}
	start(Some(text)).await
}

pub const OPS_TICK_MARKER: &str = "[운영 모드 자동 점검]";

pub async fn run_ops_mode_tick() -> Value {
	if !crate::settings::load().get("opsMode").and_then(Value::as_bool).unwrap_or(false) {
		return json!({"ok": true, "skipped": "off"});
	}
	let snapshot = STATE.lock().unwrap().clone();
	let Some(st) = snapshot else { return json!({"ok": true, "skipped": "not-running"}) };
	let live = crate::term::list();
	let Some(m) = live.iter().find(|x| {
		let n = x.get("name").and_then(Value::as_str).unwrap_or_default();
		n == st.session || crate::term::base_name(n) == crate::term::base_name(&st.session)
	}) else {
		return json!({"ok": true, "skipped": "no-session"});
	};
	let match_name = m.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
	let Some(status) = crate::term::status(&match_name).await else { return json!({"ok": true, "skipped": "busy"}) };
	let working = status.get("working").and_then(Value::as_bool).unwrap_or(false);
	let waiting = status.get("waiting").and_then(Value::as_bool).unwrap_or(false);
	if working || waiting {
		return json!({"ok": true, "skipped": "busy"});
	}
	let prompt = format!("{OPS_TICK_MARKER} list_tasks로 전체 태스크 그래프를 확인하고, 각 태스크가 기한 안에 끝날 방향으로 가고 있는지 점검해라. 멈췄거나(막힘·응답없음) 방향이 어긋난 게 있으면 dispatch_to_task로 해당 태스크의 지휘자에게 구체적으로 지시해라. 전부 정상이면 지시 없이 짧게 \"이상 없음\"이라고만 보고해라. 판단이 필요한 애매한 사안이면 지시하지 말고 사람에게 물어봐라.");
	let one_line = prompt.replace(['\r', '\n'], " ");
	crate::term::inject_seed(&match_name, &one_line).await;
	*LAST_OPS_TICK_AT.lock().unwrap() = Some(chrono::Utc::now().timestamp_millis());
	json!({"ok": true})
}

// ── 실시간 프롬프트(AskUserQuestion류) 화면 파싱 — control.cjs parseLivePrompt/getLivePrompt/sendLiveAction ──

static ASK_TRIGGER_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"Type something").unwrap());
static CONFIRM_TRIGGER_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)Do you want to\b|Would you like to proceed\?").unwrap());
static READY_SUBMIT_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"Ready to submit your answers\?").unwrap());
static REVIEW_SUMMARY_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?s)Review your answers\s*\n(.*?)\n\s*Ready to submit your answers\?").unwrap());
static OPTION_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^\s*❯?\s*(\d+)\.\s*(\[[ x✔]\]\s*)?(.+?)\s*$").unwrap());

fn parse_live_prompt(text: &str) -> Option<Value> {
	if text.is_empty() {
		return None;
	}
	if READY_SUBMIT_RE.is_match(text) {
		let summary = REVIEW_SUMMARY_RE.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
		return Some(json!({"kind": "review", "summary": summary}));
	}
	if !ASK_TRIGGER_RE.is_match(text) && !CONFIRM_TRIGGER_RE.is_match(text) {
		return None;
	}
	let lines: Vec<&str> = text.split('\n').collect();
	let mut first_option_idx: Option<usize> = None;
	for (i, line) in lines.iter().enumerate() {
		if let Some(caps) = OPTION_RE.captures(line) {
			if &caps[1] == "1" {
				first_option_idx = Some(i);
				break;
			}
		}
	}
	let first_option_idx = first_option_idx?;
	let mut question = String::new();
	for j in (0..first_option_idx).rev() {
		let t = lines[j].trim();
		if t.is_empty() {
			continue;
		}
		question = t.to_string();
		break;
	}
	let mut options: Vec<Value> = Vec::new();
	let mut multi_select = false;
	let mut n = 1;
	for line in &lines[first_option_idx..] {
		let Some(caps) = OPTION_RE.captures(line) else { continue };
		if caps[1].parse::<i64>().unwrap_or(-1) != n {
			break;
		}
		let label = caps.get(3).map(|m| m.as_str()).unwrap_or("").trim_end_matches('.').trim().to_string();
		if regex::Regex::new(r"(?i)^Type something$").unwrap().is_match(&label) {
			break;
		}
		let checkbox = caps.get(2).map(|m| m.as_str());
		if checkbox.is_some() {
			multi_select = true;
		}
		let checked = checkbox.map(|c| c.contains('x') || c.contains('✔')).unwrap_or(false);
		options.push(json!({"label": label, "checked": checked}));
		n += 1;
	}
	if options.is_empty() {
		return None;
	}
	Some(json!({"kind": "question", "question": question, "multiSelect": multi_select, "options": options}))
}

static LAST_CAPTURE_BY_SESSION: LazyLock<Mutex<std::collections::HashMap<String, String>>> = LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

pub async fn get_live_prompt() -> Value {
	let snapshot = STATE.lock().unwrap().clone();
	let Some(st) = snapshot else { return json!({"ok": true, "waiting": false, "working": false, "prompt": null}) };
	let live = crate::term::list();
	let Some(m) = live.iter().find(|x| {
		let n = x.get("name").and_then(Value::as_str).unwrap_or_default();
		n == st.session || crate::term::base_name(n) == crate::term::base_name(&st.session)
	}) else {
		return json!({"ok": true, "waiting": false, "working": false, "prompt": null});
	};
	let match_name = m.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
	let status = crate::term::status(&match_name).await;
	let text = crate::term::capture_pane(&match_name).unwrap_or_default();
	let prompt = parse_live_prompt(&text);
	let prev_text = { let mut map = LAST_CAPTURE_BY_SESSION.lock().unwrap(); map.insert(match_name.clone(), text.clone()) };
	let changed_since_last_poll = prev_text.is_some() && prev_text.as_deref() != Some(text.as_str());
	let status_waiting = status.as_ref().and_then(|s| s.get("waiting")).and_then(Value::as_bool).unwrap_or(false);
	let status_working = status.as_ref().and_then(|s| s.get("working")).and_then(Value::as_bool).unwrap_or(false);
	json!({
		"ok": true,
		"waiting": prompt.is_some() || status_waiting,
		"working": status_working || changed_since_last_poll,
		"prompt": prompt,
	})
}

fn key_for_action(action: &Value) -> Option<String> {
	let action_type = action.get("type").and_then(Value::as_str)?;
	match action_type {
		"select" | "toggle" => {
			let idx = action.get("index").and_then(Value::as_i64)?;
			if idx >= 0 {
				Some((idx + 1).to_string())
			} else {
				None
			}
		}
		"next" => Some("\x1b[C".to_string()),
		"submit" => Some("1".to_string()),
		"cancel" => Some("2".to_string()),
		_ => None,
	}
}

pub async fn send_live_action(action: &Value) -> Value {
	let snapshot = STATE.lock().unwrap().clone();
	let Some(st) = snapshot else { return json!({"ok": false, "error": "하이브마인드 세션이 없습니다."}) };
	let Some(key) = key_for_action(action) else { return json!({"ok": false, "error": "알 수 없는 동작"}) };
	let live = crate::term::list();
	let Some(m) = live.iter().find(|x| {
		let n = x.get("name").and_then(Value::as_str).unwrap_or_default();
		n == st.session || crate::term::base_name(n) == crate::term::base_name(&st.session)
	}) else {
		return json!({"ok": false, "error": "하이브마인드 세션이 살아있지 않습니다."});
	};
	let match_name = m.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
	match crate::term::find_by_name(&match_name) {
		Some(entry) => {
			crate::term::write_input(&entry, key.as_bytes());
			json!({"ok": true})
		}
		None => json!({"ok": false, "error": "하이브마인드 세션이 살아있지 않습니다."}),
	}
}
