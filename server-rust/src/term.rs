// term.rs — app/server/term.cjs의 핵심(실터미널 PTY 스폰 + WS 브릿지 + claude 세션 시딩) 이식. 원본은
// 965줄짜리 파일로 tmux 래핑/세션 스냅샷 파일 복원/cleanup 안전망 등도 포함하지만, 여기선 오케스트레이터가
// 실제로 요구하는 계약만 재현한다.
//
// capturePane()은 원본처럼 헤드리스 터미널 에뮬레이터(vt100 크레이트 — Node의 @xterm/headless에
// 대응)로 실제 화면을 렌더링해 재현한다: PTY 출력 바이트를 vt100::Parser에 그대로 흘려 커서 이동·화면
// 지우기까지 정확히 반영된 현재 뷰포트를 얻는다(이전엔 최근 바이트를 그냥 이어붙인 롤링 버퍼로 근사
// 판정했으나, vt100 도입으로 그 근사를 걷어내고 원본과 동일한 방식이 됨). WS 재접속 시에도
// state_formatted()(SerializeAddon과 동일 발상 — 지금 화면을 그대로 재현하는 ANSI 이스케이프 시퀀스)를
// 접속 즉시 흘려보내 과거 화면을 그대로 복원한다(§ main.rs handle_term_socket).
//
// OPENRM_SESSIONS_FILE 스냅샷 기록(재부팅 후 "복원 가능" 표시용 — record_session/restorable/
// restore_session/restore/forget)은 포팅되어 orchestrator.rs의 restore_all_on_boot과 이어진다.
//
// ⚠️ 남은 축소 지점: 전역 설정 terminalTmux가 켜졌을 때 일반(비-claude) 세션 명령을 자동으로 tmux
// 래핑하는 opt-in 경로(create()가 AppCfg.getAppConfig()를 읽는 부분)는 포팅하지 않았다 — term::create()가
// pool 없이 순수 PTY 모듈로 남아있게 하기 위한 의도적 스코프 컷(기본 꺼짐 설정이라 기능 손실 낮음).
// control.rs 자신의 하이브마인드 tmux 래핑(§control.rs start/reset — hasTmux()만으로 판단, 이 전역
// 설정과 무관)은 이미 완전히 동작한다 — 별개 경로.
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

const PREFIX: &str = "orm-";

pub struct TermEntry {
	master: Mutex<Box<dyn MasterPty + Send>>,
	writer: Mutex<Box<dyn Write + Send>>,
	_child: Mutex<Box<dyn Child + Send + Sync>>,
	tx: broadcast::Sender<String>,
	pub exited: Arc<AtomicBool>,
	vt: Arc<Mutex<vt100::Parser>>,
	pub cwd: String,
	pub created_at: i64,
	pub label: Mutex<String>,
	pub command: Mutex<Option<String>>,
	pub model: Mutex<Option<String>>,
}

/// term.cjs capturePane() — 헤드리스 터미널의 지금 뷰포트를 그대로 텍스트로 뽑는다(tmux capture-pane -p 대응).
pub fn capture_pane(name: &str) -> Option<String> {
	let entry = find_by_name(name)?;
	let contents = entry.vt.lock().unwrap().screen().contents();
	Some(contents)
}

/// WS 재접속 시 지금까지의 화면을 그대로 복원하기 위한 ANSI 이스케이프 시퀀스(§SerializeAddon 대응).
pub fn state_formatted(entry: &TermEntry) -> Vec<u8> {
	entry.vt.lock().unwrap().screen().state_formatted()
}

static REGISTRY: LazyLock<Mutex<HashMap<String, Arc<TermEntry>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// term.cjs baseName() — "이름_숫자9자리이상_" 구간(리네임 접미사)을 잘라낸 접두부만 남긴다.
pub fn base_name(n: &str) -> String {
	static RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"_\d{9,}_").unwrap());
	RE.splitn(n, 2).next().unwrap_or(n).to_string()
}

/// index.cjs upgrade 핸들러의 세션명 검증(^orm-[\w가-힣./-]+$)과 동일.
pub fn is_valid_session_name(n: &str) -> bool {
	static RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^orm-[\w가-힣./-]+$").unwrap());
	RE.is_match(n)
}

fn spawn_env() -> Vec<(String, String)> {
	const IDENTITY_KEYS: &[&str] = &[
		"CLAUDECODE",
		"CLAUDE_CODE_ENTRYPOINT",
		"CLAUDE_CODE_EXECPATH",
		"CLAUDE_CODE_SESSION_ID",
		"CLAUDE_CODE_CHILD_SESSION",
		"CLAUDE_CODE_MESSAGING_SOCKET",
		"CLAUDE_CODE_MESSAGING_TOKEN",
		"CLAUDE_CODE_BRIDGE_SESSION_ID",
		"CLAUDE_PID",
		"CLAUDE_EFFORT",
		"AI_AGENT",
		"ORCA_WORKTREE_ID",
		"ORCA_WORKSPACE_ID",
	];
	let mut env: Vec<(String, String)> = std::env::vars().filter(|(k, _)| !IDENTITY_KEYS.contains(&k.as_str())).collect();
	env.retain(|(k, _)| k != "LANG" && k != "LC_CTYPE" && k != "DISABLE_UPDATE_PROMPT");
	env.push(("LANG".to_string(), std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string())));
	env.push(("LC_CTYPE".to_string(), std::env::var("LC_CTYPE").unwrap_or_else(|_| "en_US.UTF-8".to_string())));
	env.push(("DISABLE_UPDATE_PROMPT".to_string(), "true".to_string())); // §원본 주석 — oh-my-zsh 업데이트 프롬프트가 첫 입력을 삼키는 경합 방지
	env
}

fn spawn_entry(cwd: &str, cols: u16, rows: u16) -> anyhow::Result<Arc<TermEntry>> {
	let pty_system = native_pty_system();
	let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;

	let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
	let mut cmd = CommandBuilder::new(&shell);
	cmd.arg("-l");
	cmd.cwd(cwd);
	for (k, v) in spawn_env() {
		cmd.env(k, v);
	}

	let child = pair.slave.spawn_command(cmd)?;
	drop(pair.slave); // 부모 프로세스는 slave fd를 더 들고 있을 필요 없음(자식이 이어받음)

	let mut reader = pair.master.try_clone_reader()?;
	let writer = pair.master.take_writer()?;
	let (tx, _rx) = broadcast::channel::<String>(256);
	let exited = Arc::new(AtomicBool::new(false));
	let vt = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 0)));

	let tx_clone = tx.clone();
	let exited_clone = exited.clone();
	let vt_clone = vt.clone();
	// node-pty의 onData는 바이트를 문자열로 디코딩해서 넘긴다 — 이 앱은 한글 코멘트/UI가 아주 많아서,
	// 8KB 읽기 경계에 멀티바이트(UTF-8 3바이트) 문자가 걸리면 그대로 broadcast했을 때 글자가 깨진다.
	// 완결되지 않은 꼬리 바이트는 버리지 않고 다음 읽기와 이어붙여, 항상 완전한 문자 단위로만 내보낸다.
	// (vt100::Parser.process()는 vte 기반이라 조각난 멀티바이트 시퀀스를 자체적으로 이어붙이므로 원본
	// 바이트 청크를 그대로 넘겨도 안전 — WS로 브로드캐스트하는 텍스트만 이 경계 처리가 필요하다.)
	std::thread::spawn(move || {
		let mut buf = [0u8; 8192];
		let mut pending: Vec<u8> = Vec::new();
		loop {
			match reader.read(&mut buf) {
				Ok(0) => break,
				Ok(n) => {
					if let Ok(mut v) = vt_clone.lock() {
						v.process(&buf[..n]);
					}
					pending.extend_from_slice(&buf[..n]);
					let valid_len = match std::str::from_utf8(&pending) {
						Ok(_) => pending.len(),
						Err(e) => e.valid_up_to(),
					};
					if valid_len > 0 {
						let text = String::from_utf8_lossy(&pending[..valid_len]).into_owned();
						let _ = tx_clone.send(text);
						pending.drain(..valid_len);
					}
				}
				Err(_) => break,
			}
		}
		exited_clone.store(true, Ordering::SeqCst);
	});

	Ok(Arc::new(TermEntry {
		vt,
		cwd: cwd.to_string(),
		created_at: chrono::Utc::now().timestamp_millis(),
		master: Mutex::new(pair.master),
		writer: Mutex::new(writer),
		_child: Mutex::new(child),
		tx,
		exited,
		label: Mutex::new(String::new()),
		command: Mutex::new(None),
		model: Mutex::new(None),
	}))
}

/// term.cjs ensureNamed() — 이미 있으면(죽지 않은 채) 그대로 재사용, 없으면 cwd 검증 후 새로 스폰.
pub fn ensure_named(name: &str, cwd: &str) -> Result<Arc<TermEntry>, String> {
	{
		let reg = REGISTRY.lock().unwrap();
		if let Some(entry) = reg.get(name) {
			if !entry.exited.load(Ordering::SeqCst) {
				return Ok(entry.clone());
			}
		}
	}
	if !std::path::Path::new(cwd).is_dir() {
		return Err(format!("cwd 없음: {cwd}"));
	}
	let entry = spawn_entry(cwd, 120, 32).map_err(|e| e.to_string())?;
	REGISTRY.lock().unwrap().insert(name.to_string(), entry.clone());
	Ok(entry)
}

/// 이름으로 등록된 세션을 찾는다(생성은 안 함) — actuator.cjs dispatch()의 세션 조회에 대응.
pub fn find_by_name(name: &str) -> Option<Arc<TermEntry>> {
	REGISTRY.lock().unwrap().get(name).cloned()
}

pub fn exists(name: &str) -> bool {
	find_by_name(name).map(|e| !e.exited.load(Ordering::SeqCst)).unwrap_or(false)
}

/// actuator.cjs dispatch()의 실전송 경로 — 문자열을 그대로 입력한 뒤 Enter(§원본: "세션에 문자 그대로
/// 입력 후 Enter"). 원본의 knownSessions() 화이트리스트(legacy state.json 기반)는 이식하지 않음 —
/// 이 앱의 새 SQLite 기반 흐름에서는 term 레지스트리에 실제로 떠 있는 세션인지만으로 충분히 안전하다.
pub fn send(name: &str, message: &str) -> Result<(), String> {
	let entry = find_by_name(name).ok_or_else(|| format!("세션 없음: {name}"))?;
	if entry.exited.load(Ordering::SeqCst) {
		return Err(format!("세션 미기동: {name}"));
	}
	write_input(&entry, message.as_bytes());
	write_input(&entry, b"\r");
	Ok(())
}

pub fn subscribe(entry: &TermEntry) -> broadcast::Receiver<String> {
	entry.tx.subscribe()
}

pub fn write_input(entry: &TermEntry, data: &[u8]) {
	if let Ok(mut w) = entry.writer.lock() {
		let _ = w.write_all(data);
	}
}

// ── 세션 스냅샷(§OPENRM_SESSIONS_FILE) — 서버 재시작(코드 배포 등)마다 node-pty 자식이 같이 죽는
// 트레이드오프(§파일 상단 주석)를 메꾸는 "복원 가능" 경로의 기록부. 실제 화면 상태가 아니라 재생성에
// 필요한 최소 메타(cwd/label/command/model/kind)만 남긴다.
fn sessions_file() -> std::path::PathBuf {
	std::env::var("OPENRM_SESSIONS_FILE").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::PathBuf::from(".openrm-sessions.json"))
}
fn load_snap() -> Value {
	std::fs::read_to_string(sessions_file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}))
}
fn save_snap(s: &Value) {
	if let Ok(pretty) = serde_json::to_string_pretty(s) {
		let _ = std::fs::write(sessions_file(), pretty);
	}
}
fn kind_of(command: Option<&str>) -> &'static str {
	let c = command.unwrap_or("");
	static DEV_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"npm run dev|next dev|yarn dev|pnpm dev|\bvite\b").unwrap());
	if CLAUDE_WORD_RE.is_match(c) {
		"agent"
	} else if DEV_RE.is_match(c) {
		"dev"
	} else {
		"shell"
	}
}
fn port_of(command: Option<&str>) -> Option<i64> {
	static RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"-p\s+(\d{2,5})").unwrap());
	RE.captures(command?)?.get(1)?.as_str().parse().ok()
}
fn record_session(name: &str, cwd: &str, label: &str, command: Option<&str>, model: Option<&str>) {
	let mut snap = load_snap();
	if let Some(obj) = snap.as_object_mut() {
		obj.insert(
			name.to_string(),
			json!({
				"cwd": cwd,
				"label": if label.is_empty() { Value::Null } else { json!(label) },
				"command": command,
				"model": model,
				"kind": kind_of(command),
				"port": port_of(command),
				"savedAt": chrono::Utc::now().timestamp_millis(),
			}),
		);
		save_snap(&snap);
	}
}
/// term.cjs forgetSession() — 정확 일치 + (혹시 남아있는) 베이스 매칭으로 들어온 경우 base 키도 제거.
fn forget_session(name: &str) {
	let mut snap = load_snap();
	let Some(obj) = snap.as_object_mut() else { return };
	let keys: Vec<String> = obj.keys().cloned().collect();
	let mut changed = false;
	for k in keys {
		if k == name || name.starts_with(&format!("{k}_")) {
			obj.remove(&k);
			changed = true;
		}
	}
	if changed {
		save_snap(&snap);
	}
}

fn live_matches(snap_name: &str, live_names: &[String]) -> bool {
	live_names.iter().any(|ln| ln == snap_name || ln.starts_with(&format!("{snap_name}_")))
}

/// term.cjs restorable() — 지금 안 살아있는 스냅샷 항목들(=재부팅 등으로 죽은 세션)만.
pub fn restorable() -> Vec<Value> {
	let live_names: Vec<String> = list().into_iter().filter_map(|x| x.get("name").and_then(Value::as_str).map(str::to_string)).collect();
	let snap = load_snap();
	let Some(obj) = snap.as_object() else { return vec![] };
	obj.iter()
		.filter(|(n, _)| !live_matches(n, &live_names))
		.map(|(name, e)| {
			let cwd = e["cwd"].as_str().unwrap_or_default();
			json!({
				"name": name,
				"cwd": cwd,
				"label": e["label"],
				"kind": e["kind"],
				"port": e["port"],
				"command": e["command"],
				"dirExists": std::path::Path::new(cwd).is_dir(),
				"savedAt": e["savedAt"].as_i64().unwrap_or(0),
			})
		})
		.collect()
}

fn listening_ports() -> std::collections::HashSet<u16> {
	let mut set = std::collections::HashSet::new();
	let Ok(out) = std::process::Command::new("lsof").args(["-nP", "-iTCP", "-sTCP:LISTEN"]).output() else { return set };
	static RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r":(\d+)\s+\(LISTEN\)").unwrap());
	for line in String::from_utf8_lossy(&out.stdout).lines() {
		if let Some(caps) = RE.captures(line) {
			if let Ok(p) = caps[1].parse() {
				set.insert(p);
			}
		}
	}
	set
}
/// term.cjs freePort() — 3000~3099 중 LISTEN 안 된 첫 포트(§restoreSession의 dev kind 재기동용).
fn free_port() -> Option<u16> {
	let used = listening_ports();
	(3000..=3099).find(|p| !used.contains(p))
}

/// term.cjs restoreSession() — 스냅샷 메타로 재생성. dev → 빈 포트로 재시작, agent → claude --continue
/// (직전 대화 이어받기), shell → 저장된 명령 그대로.
pub async fn restore_session(name: &str) -> Value {
	let snap = load_snap();
	let Some(e) = snap.get(name).cloned() else { return json!({"ok": false, "error": "스냅샷에 없음"}) };
	if exists(name) {
		return json!({"ok": true, "name": name, "alreadyRunning": true});
	}
	let cwd = e["cwd"].as_str().unwrap_or_default().to_string();
	if !std::path::Path::new(&cwd).is_dir() {
		return json!({"ok": false, "error": format!("워크트리 없음: {cwd}")});
	}
	let kind = e["kind"].as_str().unwrap_or("shell");
	let command = match kind {
		"dev" => {
			let Some(port) = free_port() else { return json!({"ok": false, "error": "빈 포트 없음 (3000-3099)"}) };
			format!("npm run dev -- -p {port}")
		}
		"agent" => "claude --continue".to_string(),
		_ => e["command"].as_str().unwrap_or_default().to_string(),
	};
	let label = e["label"].as_str().map(str::to_string).unwrap_or_else(|| name[PREFIX.len()..].to_string());
	let r = create(CreateOptions { cwd: &cwd, command: Some(&command), label: Some(&label), ..Default::default() }).await;
	if r["ok"].as_bool() == Some(true) {
		json!({"ok": true, "name": r["name"], "kind": kind, "port": port_of(Some(&command))})
	} else {
		r
	}
}

/// term.cjs restore({name, kind, all}) — 단일 이름 지정 또는 dirExists인 것들 중 kind 필터(all이면 전부) 일괄 복원.
pub async fn restore(name: Option<&str>, kind: Option<&str>, all: bool) -> Value {
	if let Some(name) = name {
		let mut result = restore_session(name).await;
		if let Some(obj) = result.as_object_mut() {
			obj.insert("name".to_string(), json!(name));
		}
		return json!({"ok": true, "results": [result]});
	}
	let items = restorable();
	let targets: Vec<&Value> = items.iter().filter(|e| e["dirExists"].as_bool() == Some(true) && (all || kind.map(|k| e["kind"].as_str() == Some(k)).unwrap_or(false))).collect();
	let mut results = Vec::new();
	for t in targets {
		let name = t["name"].as_str().unwrap_or_default();
		let mut r = restore_session(name).await;
		if let Some(obj) = r.as_object_mut() {
			obj.insert("name".to_string(), json!(name));
			obj.insert("kind".to_string(), t["kind"].clone());
		}
		results.push(r);
	}
	json!({"ok": true, "results": results})
}

/// term.cjs forget({name, all})
pub fn forget(name: Option<&str>, all: bool) -> Value {
	if all {
		save_snap(&json!({}));
		return json!({"ok": true, "forgotten": "all"});
	}
	if let Some(name) = name {
		forget_session(name);
	}
	json!({"ok": true, "forgotten": name})
}

/// Term.kill() — 세션을 죽이고 레지스트리에서 제거.
/// term.cjs kill() — orm- 접두만 허용, 이름 정확 일치 + baseName 매칭되는 항목까지 전부 종료(리네임
/// 접미사가 붙은 잔여 항목까지 함께 정리). 스냅샷도 base 매칭으로 제거.
pub fn kill(name: &str) -> Value {
	if !name.starts_with(PREFIX) {
		return json!({"ok": false, "error": "OpenRM 세션만 종료 가능"});
	}
	let base = base_name(name);
	let mut reg = REGISTRY.lock().unwrap();
	let keys: Vec<String> = reg.keys().filter(|k| k.as_str() == name || base_name(k) == base).cloned().collect();
	let mut killed = 0;
	for k in keys {
		if let Some(entry) = reg.remove(&k) {
			entry.exited.store(true, Ordering::SeqCst);
			if let Ok(child) = entry._child.lock().as_mut() {
				let _ = child.kill();
			}
			killed += 1;
		}
	}
	drop(reg);
	forget_session(name);
	if killed > 0 {
		json!({"ok": true, "killed": killed})
	} else {
		json!({"ok": false, "error": "종료 실패 (세션을 못 찾음)"})
	}
}

pub fn resize(entry: &TermEntry, cols: u16, rows: u16) {
	if let Ok(master) = entry.master.lock() {
		let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
	}
	entry.vt.lock().unwrap().screen_mut().set_size(rows, cols);
}

#[allow(dead_code)]
pub fn prefix() -> &'static str {
	PREFIX
}

/// term.cjs list() — OpenRM 소유(orm- 접두) 세션 목록 + 메타. attached(WS 클라이언트 붙어있는지)는
/// 원본과 달리 항상 false — 이 서버는 WS 접속 수를 세션별로 추적하지 않는다(단순 표시용 필드라 기능
/// 영향 없음, § main.rs handle_term_socket).
pub fn list() -> Vec<Value> {
	let reg = REGISTRY.lock().unwrap();
	reg.iter()
		.filter(|(_, e)| !e.exited.load(Ordering::SeqCst))
		.map(|(name, e)| {
			json!({
				"id": name,
				"name": name,
				"label": e.label.lock().unwrap().clone(),
				"created": e.created_at,
				"attached": false,
				"cwd": e.cwd,
				"command": e.command.lock().unwrap().clone(),
				"model": e.model.lock().unwrap().clone(),
			})
		})
		.collect()
}

fn has_tmux_uncached() -> bool {
	std::process::Command::new("tmux").arg("-V").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}
static HAS_TMUX: LazyLock<bool> = LazyLock::new(has_tmux_uncached);
/// term.cjs hasTmux() — 최초 1회만 실제 확인(프로세스 도중 설치 여부가 바뀔 일은 없음).
pub fn has_tmux() -> bool {
	*HAS_TMUX
}

fn has_ghostty_uncached() -> bool {
	let home = std::env::var("HOME").unwrap_or_default();
	std::path::Path::new("/Applications/Ghostty.app").exists() || std::path::Path::new(&home).join("Applications").join("Ghostty.app").exists()
}
static HAS_GHOSTTY: LazyLock<bool> = LazyLock::new(has_ghostty_uncached);
pub fn has_ghostty() -> bool {
	*HAS_GHOSTTY
}

fn as_escape(s: &str) -> String {
	s.replace('\\', "\\\\").replace('"', "\\\"")
}
fn ghostty_script(cwd: &str, command: Option<&str>) -> String {
	let mut lines = vec!["tell application \"Ghostty\"".to_string(), "  set cfg to new surface configuration".to_string(), format!("  set initial working directory of cfg to \"{}\"", as_escape(cwd)), "  set win to new window with configuration cfg".to_string()];
	if let Some(c) = command {
		lines.push("  set term to focused terminal of selected tab of win".to_string());
		lines.push(format!("  input text (\"{}\" & return) to term", as_escape(c)));
	}
	lines.push("end tell".to_string());
	lines.join("\n")
}
/// term.cjs openExternal() — "고스티에서 열기" 버튼. ⚠️ 축소: tmux 전역 래핑 토글을 이식하지 않아
/// (§ 파일 상단 주석) entry.tmuxWrapped가 항상 false다 — 항상 그 워크트리에서 새 빈 셸만 연다
/// (기존 tmux 세션에 attach하는 경로는 없음).
pub fn open_external(name: &str) -> Value {
	let Some(entry) = find_by_name(name) else { return json!({"ok": false, "error": "세션을 찾을 수 없습니다"}) };
	if !has_ghostty() {
		return json!({"ok": false, "error": "Ghostty가 설치되어 있지 않습니다"});
	}
	let script = ghostty_script(&entry.cwd, None);
	match std::process::Command::new("osascript").arg("-e").arg(&script).output() {
		Ok(out) if out.status.success() => json!({"ok": true, "attached": false}),
		Ok(out) => json!({"ok": false, "error": String::from_utf8_lossy(&out.stderr).trim()}),
		Err(e) => json!({"ok": false, "error": e.to_string()}),
	}
}

/// term.cjs listLive() — list() + 각 세션 상태(개발실 그리드용).
pub async fn list_live() -> Vec<Value> {
	let mut out = Vec::new();
	for mut s in list() {
		let name = s["name"].as_str().unwrap_or_default().to_string();
		let st = status(&name).await;
		if let Some(obj) = s.as_object_mut() {
			obj.insert("status".to_string(), st.unwrap_or(Value::Null));
		}
		out.push(s);
	}
	out
}

/// control.cjs/orchestrator.cjs 공용 isLive() — list() 결과에 이 이름(또는 리네임 접미사를 뗀 base
/// 형태)의 살아있는 세션이 있는지.
pub fn is_live(live: &[Value], name: &str) -> bool {
	live.iter().any(|x| x.get("name").and_then(Value::as_str) == Some(name) || x.get("name").and_then(Value::as_str).map(base_name).as_deref() == Some(&base_name(name)))
}

/// term.cjs interrupt() — 지금 생성 중인 응답만 ESC로 끊는다(세션 자체는 안 죽임).
pub fn interrupt(name: &str) -> Result<(), String> {
	let entry = find_by_name(name).ok_or_else(|| "세션 없음".to_string())?;
	if entry.exited.load(Ordering::SeqCst) {
		return Err("세션 없음".to_string());
	}
	write_input(&entry, b"\x1b");
	Ok(())
}

static ESC_INTERRUPT_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)esc to interrupt").unwrap());
static TOKENS_ELLIPSIS_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)…\s*\([^)]*tokens?").unwrap());
static NEEDS_AUTH_RE: LazyLock<regex::Regex> =
	LazyLock::new(|| regex::Regex::new(r"(?i)MFA|ExpiredToken|재인증|인증.*만료|AccessDenied|권한.*요청").unwrap());
static WAITING_RE: LazyLock<regex::Regex> =
	LazyLock::new(|| regex::Regex::new(r"(?i)Do you want|계속할까|진행할까|\(y/n\)|Enter to select|to navigate|Esc to cancel|☐").unwrap());
static IS_CLAUDE_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)esc to interrupt|to manage|for agents|claude|tokens|⏵⏵").unwrap());
static LAST_WORKING_AT: LazyLock<Mutex<HashMap<String, i64>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// term.cjs status() — 지금 화면(마지막 24줄)만 보고 working/waiting/needsAuth/needsResume를 판정한다
/// (전체 스크롤백을 보면 이미 끝난 대화 속 문구가 우연히 겹쳐 오탐한다 — § 원본 주석 실측 버그).
pub async fn status(name: &str) -> Option<Value> {
	if !name.starts_with(PREFIX) {
		return None;
	}
	let Some(entry) = find_by_name(name) else {
		return Some(json!({"exists": false}));
	};
	if entry.exited.load(Ordering::SeqCst) {
		return Some(json!({"exists": false}));
	}
	let text = capture_pane(name).unwrap_or_default();
	let lines: Vec<&str> = text.split('\n').collect();
	let recent = lines[lines.len().saturating_sub(24)..].join("\n");
	let working = ESC_INTERRUPT_RE.is_match(&recent) || TOKENS_ELLIPSIS_RE.is_match(&recent);
	let needs_auth = NEEDS_AUTH_RE.is_match(&recent);
	let waiting = !working && WAITING_RE.is_match(&recent);
	let needs_resume = RESUME_PROMPT_RE.is_match(&recent);
	let is_claude = IS_CLAUDE_RE.is_match(&text);
	let tail_lines: Vec<&str> = text.split('\n').map(str::trim).filter(|s| !s.is_empty()).collect();
	let tail: String = tail_lines[tail_lines.len().saturating_sub(2)..].join(" · ").chars().take(160).collect();
	let mut map = LAST_WORKING_AT.lock().unwrap();
	if working || !map.contains_key(name) {
		map.insert(name.to_string(), chrono::Utc::now().timestamp_millis());
	}
	let last_working_at = map.get(name).copied();
	Some(json!({
		"exists": true,
		"working": working,
		"waiting": waiting,
		"needsAuth": needs_auth,
		"needsResume": needs_resume,
		"isClaude": is_claude,
		"tail": tail,
		"lastWorkingAt": last_working_at,
	}))
}

fn slug(s: &str) -> String {
	let cleaned = regex::Regex::new(r"[^a-zA-Z0-9가-힣_-]+").unwrap().replace_all(s.trim(), "-").into_owned();
	let trimmed = cleaned.trim_matches('-');
	let truncated: String = trimmed.chars().take(40).collect();
	if truncated.is_empty() {
		"sh".to_string()
	} else {
		truncated
	}
}

/// term.cjs trustFolder() — ~/.claude.json의 projects[gitRoot].hasTrustDialogAccepted를 미리 켜두고,
/// mcp_folder_id가 있으면 그 폴더 전용 opentask-dispatch MCP 서버(§ mcpDispatch.cjs, 아직 Node로만
/// 존재 — Rust로 재구현하지 않고 그 경로를 그대로 가리킨다, § scheduler.rs run_instruction과 동일 패턴)를
/// 등록한다. 신뢰 다이얼로그 없이 곧장 세션이 시작되게 하는 게 목적.
fn trust_folder(cwd: &str, mcp_folder_id: Option<&str>) {
	let git_root = std::process::Command::new("git")
		.args(["-C", cwd, "rev-parse", "--show-toplevel"])
		.output()
		.ok()
		.filter(|o| o.status.success())
		.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| cwd.to_string());

	let config_path = std::env::var("OPENRM_CLAUDE_CONFIG")
		.map(std::path::PathBuf::from)
		.unwrap_or_else(|_| dirs_home().join(".claude.json"));
	let Ok(raw) = std::fs::read_to_string(&config_path) else { return };
	let Ok(mut cfg) = serde_json::from_str::<Value>(&raw) else { return };
	if !cfg.get("projects").map(Value::is_object).unwrap_or(false) {
		cfg["projects"] = json!({});
	}
	let existing = cfg["projects"].get(&git_root).cloned().unwrap_or(json!({}));
	let already_trusted = existing.get("hasTrustDialogAccepted").and_then(Value::as_bool).unwrap_or(false);
	if already_trusted && mcp_folder_id.is_none() {
		return; // 더 손댈 게 없음 — 파일 쓰기 생략
	}
	let mut mcp_servers = existing.get("mcpServers").and_then(Value::as_object).cloned().unwrap_or_default();
	if let Some(folder_id) = mcp_folder_id {
		let port = std::env::var("OPENRM_PORT").unwrap_or_else(|_| "8770".to_string());
		mcp_servers.insert(
			"opentask-dispatch".to_string(),
			json!({
				"command": sibling_bin("mcp_dispatch").to_string_lossy(),
				"args": [],
				"env": {"OPENTASK_FOLDER_ID": folder_id, "OPENTASK_PORT": port},
			}),
		);
	}
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

/// 지금 떠 있는 메인 서버 바이너리와 같은 target 디렉터리에 있는 다른 바이너리(mcp_control/
/// mcp_dispatch)의 경로 — cargo가 워크스페이스의 여러 bin 타깃을 전부 같은 target/{debug,release}에
/// 빌드하므로, 패키징 여부와 무관하게 "지금 실행 중인 내 실행파일 옆"이 항상 맞는 위치다(Node의
/// __dirname 기준 상대경로에 대응 — § control.cjs 상단 주석의 app.asar.unpacked 함정과 같은 이유로
/// 컴파일타임 CARGO_MANIFEST_DIR이 아니라 런타임 current_exe를 쓴다).
pub fn sibling_bin(name: &str) -> std::path::PathBuf {
	std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(name))).unwrap_or_else(|| std::path::PathBuf::from(name))
}

/// term.cjs ensureOwnGitRoot() — control.cjs가 자기 전용 cwd를 독립 git 저장소로 만들어 gitRoot()가
/// 항상 그 cwd 자신을 가리키게 한다(§control.cjs 상단 주석 — 여러 인스턴스가 동시에 떠도 서로 다른
/// ~/.claude.json 등록 키를 갖게 하기 위함).
pub fn ensure_own_git_root(dir: &std::path::Path) {
	if !dir.join(".git").exists() {
		let _ = std::process::Command::new("git").args(["init", "-q"]).current_dir(dir).status();
	}
}

fn dirs_home() -> std::path::PathBuf {
	std::env::var("HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn contains_ignoring_whitespace(haystack: &str, needle: &str) -> bool {
	let strip = |s: &str| s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
	strip(haystack).contains(&strip(needle))
}

/// term.cjs injectSeed() — capturePane()으로 "화면에 아직 남아있는지"를 원본과 동일하게 판정한다.
/// Ctrl-U로 지우고 다시 쓰기를 반복하다 marker가 나타나면 Enter를 반복 전송해 실제 제출(=marker가
/// 다시 사라짐)을 확인한다.
pub async fn inject_seed(name: &str, one_line: &str) -> bool {
	let marker: String = one_line.chars().take(12).collect();
	let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
	while tokio::time::Instant::now() < deadline {
		let Some(entry) = find_by_name(name) else { return false };
		if entry.exited.load(Ordering::SeqCst) {
			return false;
		}
		write_input(&entry, b"\x15"); // Ctrl-U
		write_input(&entry, one_line.as_bytes());
		tokio::time::sleep(Duration::from_millis(400)).await;
		let screen = capture_pane(name).unwrap_or_default();
		if contains_ignoring_whitespace(&screen, &marker) {
			for _ in 0..15 {
				write_input(&entry, b"\r");
				tokio::time::sleep(Duration::from_millis(1200)).await;
				let after = capture_pane(name).unwrap_or_default();
				if !contains_ignoring_whitespace(&after, &marker) {
					break; // marker가 화면에서 사라짐 = 제출됨
				}
			}
			return true;
		}
		tokio::time::sleep(Duration::from_millis(2000)).await;
	}
	false
}

/// term.cjs trustFolder/watchContinueFallback 게이트(\bclaude\b) — 명령 어디든 "claude"라는 단어가 있으면 매치.
static CLAUDE_WORD_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"\bclaude\b").unwrap());
/// term.cjs --model 삽입 게이트((^|\/|\s)claude(\s|$)) — 위보다 좁음(§ create() 주석).
static CLAUDE_MODEL_INJECT_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(^|/|\s)claude(\s|$)").unwrap());
static LEADING_TOKEN_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^\s*\S+").unwrap());

static RESUME_PROMPT_RE: LazyLock<regex::Regex> =
	LazyLock::new(|| regex::Regex::new(r"(?i)Resuming the full session will consume|Resume from summary \(recommended\)").unwrap());
static CONTINUE_FLAG_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"--continue\b").unwrap());
static NO_CONVERSATION_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)No conversation found to continue").unwrap());

static CLAUDE_TUI_SIGNAL_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)esc to interrupt|for agents|Claude Code").unwrap());

/// term.cjs watchContinueFallback() — `claude --continue`가 이어받을 대화를 못 찾으면(새 워크트리 등)
/// --continue를 뗀 채로 자동 재시도한다. fallback_seed는 그 재시도가 확인되면(=대화를 못 이어받고
/// 맨몸으로 새로 켜진 것이 확정되면) 최초 생성 때와 같은 역할 시드를 마저 주입한다(§원본 주석 —
/// 안 넣으면 지휘자가 자기 역할을 모른 채 평범한 코딩 에이전트처럼 행동함).
async fn watch_continue_fallback(name: &str, cmd: &str, fallback_seed: Option<&str>) {
	if !CONTINUE_FLAG_RE.is_match(cmd) {
		return;
	}
	let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
	let mut resume_confirmed = false;
	while tokio::time::Instant::now() < deadline {
		tokio::time::sleep(Duration::from_millis(500)).await;
		let Some(entry) = find_by_name(name) else { return };
		if entry.exited.load(Ordering::SeqCst) {
			return;
		}
		let screen = capture_pane(name).unwrap_or_default();
		if !resume_confirmed && RESUME_PROMPT_RE.is_match(&screen) {
			write_input(&entry, b"\r");
			resume_confirmed = true;
			continue;
		}
		if NO_CONVERSATION_RE.is_match(&screen) {
			let fallback = CONTINUE_FLAG_RE.replace(cmd, "").trim().to_string();
			if fallback.is_empty() {
				return;
			}
			for _ in 0..5 {
				write_input(&entry, b"\x15");
				write_input(&entry, format!("{fallback}\r").as_bytes());
				tokio::time::sleep(Duration::from_millis(1500)).await;
				let after = capture_pane(name).unwrap_or_default();
				if !after.contains(&fallback) || CLAUDE_TUI_SIGNAL_RE.is_match(&after) {
					if let Some(seed) = fallback_seed {
						let one_line: String = seed.replace(['\r', '\n'], " ").chars().take(2000).collect();
						if !one_line.trim().is_empty() {
							inject_seed(name, &one_line).await;
						}
					}
					return;
				}
			}
			return;
		}
	}
}

pub struct CreateOptions<'a> {
	pub cwd: &'a str,
	pub command: Option<&'a str>,
	pub label: Option<&'a str>,
	pub seed: Option<&'a str>,
	pub model: Option<String>,
	pub mcp_folder_id: Option<&'a str>,
	/// `--continue`가 이어받을 대화를 못 찾고 새로 켜졌을 때만 주입되는 시드(§watch_continue_fallback).
	pub continue_fallback_seed: Option<&'a str>,
}

impl Default for CreateOptions<'_> {
	fn default() -> Self {
		Self { cwd: "", command: None, label: None, seed: None, model: None, mcp_folder_id: None, continue_fallback_seed: None }
	}
}

/// term.cjs create() — 유니크 세션명으로 새 pty를 띄우고 명령+시드를 그대로 타이핑해 넣는다. 오케스트레이터가
/// launchSubtask/conductor 세션을 시작하는 핵심 진입점(§ 파일 상단 주석 — tmux 래핑·스냅샷 기록은 축소).
pub async fn create(opts: CreateOptions<'_>) -> Value {
	if !std::path::Path::new(opts.cwd).is_dir() {
		return json!({"ok": false, "error": "cwd 디렉토리 아님"});
	}
	let base_name_str = format!("{PREFIX}{}", slug(opts.label.filter(|l| !l.is_empty()).unwrap_or_else(|| opts.cwd.rsplit('/').next().unwrap_or(opts.cwd))));
	let name = {
		let reg = REGISTRY.lock().unwrap();
		if !reg.contains_key(&base_name_str) {
			base_name_str.clone()
		} else {
			let mut i = 2;
			loop {
				let candidate = format!("{base_name_str}-{i}");
				if !reg.contains_key(&candidate) {
					break candidate;
				}
				i += 1;
			}
		}
	};

	let mut model = opts.model;
	if model.is_none() && opts.command.map(|c| CLAUDE_WORD_RE.is_match(c)).unwrap_or(false) {
		model = Some(crate::settings::model_for("dev"));
	}
	let mut cmd = opts.command.map(str::to_string);
	if let (Some(m), Some(c)) = (&model, &cmd) {
		// term.cjs: /(^|\/|\s)claude(\s|$)/ — \bclaude\b(아래 trustFolder 게이트)보다 더 좁다. control.rs가
		// 조립하는 tmux-래핑 명령(`tmux ... "claude --continue ..."`)처럼 "claude" 앞이 큰따옴표(")인
		// 경우엔 이 경계 조건에 안 걸려 매치하지 않는다 — 그 결과 첫 토큰(tmux)에 --model이 잘못 꽂혀
		// tmux 구문 자체가 깨지는 사고를 막는다(실측 재현 후 이 경계 규칙 자체가 원본의 의도였음을 확인).
		if CLAUDE_MODEL_INJECT_RE.is_match(c) && !c.contains("--model") {
			// 명령 첫 토큰(바이너리) 바로 뒤에 --model 삽입 — Node의 `$1 --model <model>` 치환과 동일.
			if let Some(mat) = LEADING_TOKEN_RE.find(c) {
				let end = mat.end();
				cmd = Some(format!("{} --model {m}{}", &c[..end], &c[end..]));
			}
		}
	}
	if let Some(c) = &cmd {
		if CLAUDE_WORD_RE.is_match(c) {
			trust_folder(opts.cwd, opts.mcp_folder_id);
		}
	}
	// tmux 래핑(전역 terminalTmux 설정)은 이식하지 않음 — 항상 순수 로그인 셸 경로(§ 파일 상단 주석).

	let entry = match spawn_entry(opts.cwd, 200, 50) {
		Ok(e) => e,
		Err(e) => return json!({"ok": false, "error": e.to_string()}),
	};
	REGISTRY.lock().unwrap().insert(name.clone(), entry.clone());
	*entry.command.lock().unwrap() = cmd.clone();
	let label = opts.label.filter(|l| !l.is_empty()).map(str::to_string).unwrap_or_else(|| name[PREFIX.len()..].to_string());
	*entry.label.lock().unwrap() = label.clone();
	*entry.model.lock().unwrap() = model.clone();

	if let Some(c) = &cmd {
		if !c.trim().is_empty() {
			// 갓 스폰한 로그인 셸이 첫 바이트를 먹어버리는 경합 방지(§원본 주석) — 빈 개행 하나 먼저.
			write_input(&entry, b"\r");
			write_input(&entry, format!("{c}\r").as_bytes());
			if CLAUDE_WORD_RE.is_match(c) {
				let name2 = name.clone();
				let cmd2 = c.clone();
				let fallback_seed2 = opts.continue_fallback_seed.map(str::to_string);
				tokio::spawn(async move { watch_continue_fallback(&name2, &cmd2, fallback_seed2.as_deref()).await });
			}
		}
	}
	let seeded = if let Some(seed) = opts.seed {
		let one_line: String = seed.replace(['\r', '\n'], " ").chars().take(2000).collect();
		if !one_line.trim().is_empty() {
			let name3 = name.clone();
			tokio::spawn(async move { inject_seed(&name3, &one_line).await });
			true
		} else {
			false
		}
	} else {
		false
	};

	record_session(&name, opts.cwd, &label, cmd.as_deref(), model.as_deref());

	let model_label = model.as_deref().map(crate::settings::model_label);
	json!({"ok": true, "name": name, "label": label, "cwd": opts.cwd, "command": cmd, "model": model, "modelLabel": model_label, "seeded": seeded})
}
