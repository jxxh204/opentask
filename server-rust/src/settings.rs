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
