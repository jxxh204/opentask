// link_brief.rs — app/server/linkBrief.cjs 이식. 태스크/서브태스크 설명에 붙은 노션·피그마 URL마다
// 헤드리스 claude(+Notion/Figma MCP — 사용자 전역 설정에 이미 등록돼 있다고 가정)로 핵심 정책 요약을
// 뽑아 캐싱한다.
//
// ⚠️ 축소: 원본은 피그마 링크일 때 완성 이미지도 figma.cjs의 로컬 Dev Mode MCP 직결 경로로 텍스트
// 요약과 병렬로 받는다(§ figma.cjs screenshotForUrl) — 그 경로는 원시 MCP 클라이언트 구현이 필요해
// 이번 패스에서 뺐다. imageUrl은 원본에서도 실패 시 null로 두는 게 이미 정상 경로였으므로(Promise.
// catch(() => null)), 항상 null로 degrade — 텍스트 요약(summary/policies)은 완전히 동작한다.
use crate::agent_jobs;
use crate::app_config;
use crate::db::Pool;
use crate::link_briefs;
use crate::prompts;
use crate::settings;
use serde_json::{json, Value};
use std::collections::HashMap;

const STALE_MS: i64 = 24 * 3600 * 1000; // 이보다 오래된 'ok' 캐시는 다시 물어봐도 됨.

pub fn link_kind(url: &str) -> Option<&'static str> {
	let s = url.to_lowercase();
	if s.contains("figma.com") {
		Some("figma")
	} else if s.contains("notion") {
		Some("doc")
	} else {
		None
	}
}

fn parse_final_json(text: &str) -> Option<Value> {
	let t = serde_json::from_str::<Value>(text).ok().and_then(|j| j.get("result").or_else(|| j.get("text")).and_then(Value::as_str).map(str::to_string)).unwrap_or_else(|| text.to_string());
	let start = t.find('{')?;
	let end = t.rfind('}')?;
	if end < start {
		return None;
	}
	serde_json::from_str(&t[start..=end]).ok()
}

struct ClaudeResult {
	ok: bool,
	out: String,
	err: String,
	code: Option<i32>,
}

async fn run_claude(prompt: &str, model: &str, cwd: &str) -> ClaudeResult {
	let bin = std::env::var("OPENRM_CLAUDE_BIN").unwrap_or_else(|_| "claude".to_string());
	let result = tokio::time::timeout(
		std::time::Duration::from_millis(170000),
		tokio::process::Command::new(&bin).args(["-p", prompt, "--output-format", "json", "--model", model]).current_dir(cwd).output(),
	)
	.await;
	match result {
		Ok(Ok(out)) => ClaudeResult { ok: out.status.success(), out: String::from_utf8_lossy(&out.stdout).into_owned(), err: String::from_utf8_lossy(&out.stderr).into_owned(), code: out.status.code() },
		Ok(Err(e)) => ClaudeResult { ok: false, out: String::new(), err: e.to_string(), code: None },
		Err(_) => ClaudeResult { ok: false, out: String::new(), err: "timeout".to_string(), code: None },
	}
}

fn claude_error_message(r: &ClaudeResult) -> String {
	if let Some(line) = r.err.lines().find(|l| !l.trim().is_empty()) {
		return line.chars().take(160).collect();
	}
	match r.code {
		Some(c) => format!("claude 종료 코드 {c}(자세한 오류 없음 — 다시 시도해 보세요)"),
		None => "claude 실행 실패".to_string(),
	}
}

async fn run_job(pool: &Pool, owner_type: &str, owner_id: &str, url: &str, kind: &str) {
	let prompt_key = if kind == "figma" { "link.brief.figma" } else { "link.brief.notion" };
	let model = settings::model_for("linkBrief");
	let cwd = app_config::resolve_repo(pool);
	let mut vars = HashMap::new();
	vars.insert("url", url.to_string());
	let prompt = prompts::render(prompt_key, &vars);
	let claude_result = run_claude(&prompt, &model, &cwd).await;
	// 피그마 완성 이미지(§ 파일 상단 축소 지점)는 항상 null — 텍스트 요약과 병렬로 받던 원본의 best-effort 슬롯.
	let image_url: Option<String> = None;

	if !claude_result.ok {
		let _ = link_briefs::mark_error(pool, owner_type, owner_id, url, &format!("요약 실패: {}", claude_error_message(&claude_result)));
		return;
	}
	let Some(data) = parse_final_json(&claude_result.out) else {
		let _ = link_briefs::mark_error(pool, owner_type, owner_id, url, "AI 응답 파싱 실패");
		return;
	};
	let Some(summary) = data.get("summary").and_then(Value::as_str).filter(|s| !s.is_empty()) else {
		let _ = link_briefs::mark_error(pool, owner_type, owner_id, url, "AI 응답 파싱 실패");
		return;
	};
	let policies: Vec<String> = data
		.get("policies")
		.and_then(Value::as_array)
		.map(|a| a.iter().filter_map(Value::as_str).map(|s| s.chars().take(200).collect::<String>()).take(6).collect())
		.unwrap_or_default();
	let _ = link_briefs::mark_ok(pool, owner_type, owner_id, url, &json!({"summary": summary.chars().take(600).collect::<String>(), "policies": policies, "imageUrl": image_url}));
}

/// ensureBrief — "자동 생성, 링크가 붙는 즉시 백그라운드로". 이미 'ok'로 캐싱돼 있고 24시간 안
/// 지났으면 그대로 재사용, 'pending'이면 이미 도는 잡이 있으니 중복 생성 안 함.
pub async fn ensure_brief(pool: Pool, owner_type: &str, owner_id: &str, url: &str) -> Value {
	let Some(kind) = link_kind(url) else { return json!({"ok": false, "error": "지원하지 않는 링크 종류"}) };
	let existing = link_briefs::get(&pool, owner_type, owner_id, url).unwrap_or(None);
	if let Some(existing) = &existing {
		if existing["status"].as_str() == Some("pending") {
			return json!({"ok": true, "status": "pending"});
		}
		if existing["status"].as_str() == Some("ok") {
			let generated_at = existing["generated_at"].as_i64().unwrap_or(0);
			if generated_at > 0 && chrono::Utc::now().timestamp_millis() - generated_at < STALE_MS {
				return json!({"ok": true, "status": "ok"});
			}
		}
	}
	let job = match agent_jobs::create(&pool, agent_jobs::CreateInput { kind: "link-brief", ref_type: Some(owner_type), ref_id: Some(owner_id), input: Some(&json!({"url": url, "kind": kind})), label: Some("요약 생성 중…") }) {
		Ok(j) => j,
		Err(e) => return json!({"ok": false, "error": e.to_string()}),
	};
	let job_id = job["id"].as_str().unwrap_or_default().to_string();
	if let Err(e) = link_briefs::upsert_pending(&pool, owner_type, owner_id, url, kind, &job_id) {
		return json!({"ok": false, "error": e.to_string()});
	}

	let (owner_type, owner_id, url, kind, job_id2) = (owner_type.to_string(), owner_id.to_string(), url.to_string(), kind.to_string(), job_id.clone());
	tokio::spawn(async move {
		run_job(&pool, &owner_type, &owner_id, &url, &kind).await;
		let _ = agent_jobs::mark_done(&pool, &job_id2, &json!({"ok": true}));
	});
	json!({"ok": true, "status": "pending", "jobId": job_id})
}
