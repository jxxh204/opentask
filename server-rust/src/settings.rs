// settings.rs — app/server/settings.cjs 이식. SQLite가 아니라 OPENRM_SETTINGS_FILE 플랫 JSON
// 파일 그대로(Node와 동일 파일을 가리키게 하면 안 됨 — 이 서버는 항상 별도 OPENRM_DATA_DIR).
use serde_json::{json, Map, Value};
use std::path::PathBuf;

fn model_policy() -> Value {
	json!({
		"design": "claude-fable-5-1",
		"orchestrator": "claude-fable-5-1",
		"control": "claude-fable-5-1",
		"dev": "claude-opus-5",
		"qa": "claude-sonnet-5",
		"verify": "claude-sonnet-5",
		"monitor": "claude-sonnet-5",
		"debug": "claude-sonnet-5",
		"backlog": "claude-sonnet-5",
		"enrich": "claude-sonnet-5",
		"classify": "claude-haiku-4-5",
		"ops": "claude-sonnet-5",
		"review": "claude-opus-5",
		"improve": "claude-opus-5",
		"link": "claude-sonnet-5",
		"translate": "claude-haiku-4-5",
		"ppt": "claude-sonnet-5",
		"estimateExplore": "claude-haiku-4-5",
		"estimateJudge": "claude-opus-5",
		"linkBrief": "claude-sonnet-5",
		"codeBrief": "claude-sonnet-5",
	})
}

fn defaults() -> Value {
	json!({
		"reviewMode": true,
		"modelPolicy": model_policy(),
		"fableLock": false,
		"agentNotify": true,
		"operatorName": "운영자",
		"opsMode": false,
	})
}

fn file_path() -> PathBuf {
	std::env::var("OPENRM_SETTINGS_FILE")
		.map(PathBuf::from)
		.unwrap_or_else(|_| PathBuf::from(".openrm-settings.json"))
}

fn merge(base: &mut Map<String, Value>, patch: &Map<String, Value>) {
	for (k, v) in patch {
		base.insert(k.clone(), v.clone());
	}
}

pub fn load() -> Value {
	let mut out = defaults().as_object().unwrap().clone();
	if let Ok(text) = std::fs::read_to_string(file_path()) {
		if let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&text) {
			merge(&mut out, &saved);
		}
	}
	Value::Object(out)
}

pub fn save(patch: &Value) -> Value {
	let mut next = load().as_object().unwrap().clone();
	if let Value::Object(patch_obj) = patch {
		merge(&mut next, patch_obj);
	}
	let value = Value::Object(next);
	let _ = std::fs::write(file_path(), value.to_string());
	value
}

/// modelFor(action) — 액션별 모델 배분. fableLock이 켜져 있으면 fable 계열을 opus로 강제 스왑(비용 차단).
pub fn model_for(action: &str) -> String {
	let s = load();
	let policy = s.get("modelPolicy").and_then(|v| v.as_object()).cloned().unwrap_or_default();
	let defaults = model_policy();
	let mut m = policy
		.get(action)
		.and_then(|v| v.as_str())
		.map(str::to_string)
		.or_else(|| defaults.as_object().and_then(|d| d.get(action)).and_then(|v| v.as_str()).map(str::to_string));
	let fable_lock = s.get("fableLock").and_then(Value::as_bool).unwrap_or(false);
	if fable_lock {
		if let Some(model) = &m {
			if model.contains("fable") {
				m = Some("claude-opus-5".to_string());
			}
		}
	}
	m.unwrap_or_default()
}

/// operatorName() — 운영자 이름 게터. 빈 값이면 기본값으로 안전하게 폴백(프롬프트 문법 깨짐 방지).
pub fn operator_name() -> String {
	let s = load();
	let n = s.get("operatorName").and_then(Value::as_str).unwrap_or_default().trim().to_string();
	if n.is_empty() {
		"운영자".to_string()
	} else {
		n
	}
}

/// modelLabelFor(action) — fableLock 때문에 정책과 실제 배정이 달라진 경우 "(비용 잠금)"을 붙인다.
pub fn model_label_for(action: &str) -> String {
	let s = load();
	let policy = s.get("modelPolicy").and_then(|v| v.as_object()).cloned().unwrap_or_default();
	let defaults = model_policy();
	let wanted = policy.get(action).and_then(Value::as_str).map(str::to_string).or_else(|| defaults.get(action).and_then(Value::as_str).map(str::to_string));
	let actual = model_for(action);
	let fable_lock = s.get("fableLock").and_then(Value::as_bool).unwrap_or(false);
	let locked = fable_lock && wanted.as_deref().map(|w| w.contains("fable")).unwrap_or(false) && wanted.as_deref() != Some(actual.as_str());
	format!("{}{}", model_label(&actual), if locked { " (비용 잠금)" } else { "" })
}

/// modelLabel(id) — 'claude-opus-5' → 'Opus 5' 같은 표시용 라벨.
pub fn model_label(id: &str) -> String {
	if id.is_empty() {
		return String::new();
	}
	static RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"^claude-(opus|sonnet|haiku|fable)-(.+)$").unwrap());
	match RE.captures(id) {
		Some(caps) => {
			let tier = &caps[1];
			let version = caps[2].replace('-', ".");
			let mut chars = tier.chars();
			let tier_cap = match chars.next() {
				Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
				None => tier.to_string(),
			};
			format!("{tier_cap} {version}")
		}
		None => id.trim_start_matches("claude-").to_string(),
	}
}
