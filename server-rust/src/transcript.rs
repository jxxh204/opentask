// transcript.rs — app/server/transcript.cjs 이식. control.rs의 하이브마인드 채팅 UI용 — claude CLI가
// 이미 디스크에 구조화해서 쓰고 있는 진짜 대화 기록(~/.claude/projects/<cwd>/<uuid>.jsonl, --continue가
// 쓰는 바로 그 파일)을 읽어 채팅 턴으로 파싱한다. 순수 파일 읽기·파싱이라 PTY/프로세스 스폰이 전혀
// 없다 — control.rs를 require하지 않는다(원본과 동일 원칙, § OPS_TICK_MARKER/UI_BLOCK_EDIT_MARKER를
// 문자열로 직접 복제하는 이유).
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const SEED_MARKER: &str = "[역할: OpenTask";
const OPS_TICK_MARKER: &str = "[운영 모드 자동 점검]";
const UI_BLOCK_EDIT_MARKER: &str = "[서브태스크 UI 변경]";
const AUTO_MARKERS: [&str; 2] = [OPS_TICK_MARKER, UI_BLOCK_EDIT_MARKER];

/// claude CLI의 project 디렉토리 인코딩 — cwd의 '/'와 '.'을 각각 '-'로(뭉치지 않고 문자 하나씩) 바꾼 이름.
pub fn project_dir_for(cwd: &str) -> PathBuf {
	let encoded: String = cwd.chars().map(|c| if c == '/' || c == '.' { '-' } else { c }).collect();
	let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
	home.join(".claude").join("projects").join(encoded)
}

fn looks_like_control_transcript(file_path: &Path) -> bool {
	std::fs::read_to_string(file_path).map(|s| s.contains(SEED_MARKER)).unwrap_or(false)
}

/// findControlTranscript — 이 cwd에서 실행된 여러 claude 세션의 jsonl 중, 비서 세션 seed 마커가
/// 들어있는 것 중 가장 최근 수정된 파일 하나만 고른다(§원본 주석 — mtime만으로는 다른 세션과 헷갈림).
pub fn find_control_transcript(cwd: &str) -> Option<PathBuf> {
	let dir = project_dir_for(cwd);
	let entries = std::fs::read_dir(&dir).ok()?;
	let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
	for entry in entries.filter_map(Result::ok) {
		let path = entry.path();
		if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
			continue;
		}
		if !looks_like_control_transcript(&path) {
			continue;
		}
		let Ok(meta) = entry.metadata() else { continue };
		let Ok(mtime) = meta.modified() else { continue };
		if best.as_ref().map(|(_, t)| mtime > *t).unwrap_or(true) {
			best = Some((path, mtime));
		}
	}
	best.map(|(p, _)| p)
}

/// content가 문자열이면 그대로, 블록 배열이면 text 블록만 이어붙인다(tool_result의 content가 이
/// 두 형태 다 가능 — 툴마다 다름).
fn text_from_content(content: &Value) -> String {
	match content {
		Value::String(s) => s.clone(),
		Value::Array(blocks) => blocks
			.iter()
			.filter(|b| b.get("type").and_then(Value::as_str) == Some("text") && b.get("text").and_then(Value::as_str).is_some())
			.map(|b| b["text"].as_str().unwrap_or_default())
			.collect::<Vec<_>>()
			.join("\n"),
		_ => String::new(),
	}
}

static RESUME_SUMMARY_RE: std::sync::LazyLock<regex::Regex> =
	std::sync::LazyLock::new(|| regex::Regex::new(r"^This session is being continued from a previous conversation").unwrap());
static SYNTHETIC_TAG_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"^<(local-command-caveat|command-name|local-command-stdout)>").unwrap());

fn is_synthetic_user_content(content: &str) -> bool {
	RESUME_SUMMARY_RE.is_match(content) || SYNTHETIC_TAG_RE.is_match(content)
}

static ANSI_SGR_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"\x1b\[[0-9;]*m").unwrap());
fn strip_ansi(s: &str) -> String {
	ANSI_SGR_RE.replace_all(s, "").into_owned()
}

/// parseTranscript — jsonl 한 줄(entry)마다 이미 claude 자신의 턴 경계라 그대로 1턴=1버블로 쓴다.
/// skip_first_user: 첫 user 턴은 항상 controlSeed()가 주입한 역할 시드 그 자체라(사람이 친 게 아님)
/// 채팅에는 안 보여준다.
pub fn parse_transcript(file_path: &Path, skip_first_user: bool, max_turns: usize) -> Vec<Value> {
	let Ok(raw) = std::fs::read_to_string(file_path) else { return vec![] };
	let records: Vec<Value> = raw.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| serde_json::from_str(l).ok()).collect();

	// tool_use_id → 결과 텍스트. tool_result는 항상 "user" 롤의 content 배열 블록으로 뒤에 따로 온다.
	let mut results_by_tool_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();
	for r in &records {
		if r["type"].as_str() != Some("user") {
			continue;
		}
		let Some(content) = r["message"]["content"].as_array() else { continue };
		for b in content {
			if b.get("type").and_then(Value::as_str) == Some("tool_result") {
				if let Some(tool_use_id) = b.get("tool_use_id").and_then(Value::as_str) {
					let text: String = text_from_content(&b["content"]).chars().take(4000).collect();
					results_by_tool_id.insert(tool_use_id.to_string(), text);
				}
			}
		}
	}

	let mut turns: Vec<Value> = Vec::new();
	let mut seen_first_user = false;
	for r in &records {
		let content = &r["message"]["content"];
		match r["type"].as_str() {
			Some("user") => {
				let Some(content_str) = content.as_str() else { continue }; // 배열이면 tool_result뿐 — 이미 흡수함
				if r["isMeta"].as_bool() == Some(true) || is_synthetic_user_content(content_str) {
					continue;
				}
				if !seen_first_user {
					seen_first_user = true;
					if skip_first_user {
						continue;
					}
				}
				let marker = AUTO_MARKERS.iter().find(|m| content_str.starts_with(*m));
				let text = strip_ansi(marker.map(|m| content_str[m.len()..].trim()).unwrap_or(content_str));
				let mut turn = json!({"id": r["uuid"], "role": "user", "ts": r["timestamp"], "parts": [{"kind": "text", "text": text}]});
				if marker.is_some() {
					turn["auto"] = json!(true);
				}
				turns.push(turn);
			}
			Some("assistant") => {
				let Some(blocks) = content.as_array() else { continue };
				let mut parts: Vec<Value> = Vec::new();
				for b in blocks {
					match b.get("type").and_then(Value::as_str) {
						Some("text") => {
							let text = b.get("text").and_then(Value::as_str).unwrap_or_default();
							if !text.trim().is_empty() {
								parts.push(json!({"kind": "text", "text": strip_ansi(text)}));
							}
						}
						Some("tool_use") => {
							let id = b.get("id").and_then(Value::as_str).unwrap_or_default();
							let result = results_by_tool_id.get(id).map(|s| strip_ansi(s));
							parts.push(json!({"kind": "tool", "name": b.get("name"), "input": b.get("input"), "result": result}));
						}
						// thinking 블록은 화면에 안 보여준다 — 내부 추론이라 장황하고, 사람이 볼 대화가 아니다.
						_ => {}
					}
				}
				if !parts.is_empty() {
					turns.push(json!({"id": r["uuid"], "role": "assistant", "ts": r["timestamp"], "parts": parts}));
				}
			}
			_ => {}
		}
	}
	if max_turns > 0 && turns.len() > max_turns {
		let drop = turns.len() - max_turns;
		turns.drain(0..drop);
	}
	turns
}
