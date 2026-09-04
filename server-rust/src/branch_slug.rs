// branch_slug.rs — app/server/branchSlug.cjs 이식. 한글 제목 → 짧은 영어 브랜치 슬러그.
use crate::db::Pool;
use crate::{app_config, ticket};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

fn claude_bin() -> String {
	std::env::var("OPENRM_CLAUDE_BIN").unwrap_or_else(|_| "claude".to_string())
}

fn slugify(s: &str, max_len: usize) -> String {
	let lower = s.to_lowercase();
	let cleaned = regex::Regex::new(r"[^a-z0-9\s-]").unwrap().replace_all(&lower, " ").trim().to_string();
	let hyphenated = regex::Regex::new(r"\s+").unwrap().replace_all(&cleaned, "-").into_owned();
	let collapsed = regex::Regex::new(r"-+").unwrap().replace_all(&hyphenated, "-").into_owned();
	let trimmed = collapsed.trim_matches('-');
	trimmed.chars().take(max_len).collect()
}

pub async fn translate_to_english_slug(pool: &Pool, text: &str) -> String {
	let t = text.trim();
	if t.is_empty() {
		return String::new();
	}
	static PREFIX_RE: std::sync::LazyLock<regex::Regex> =
		std::sync::LazyLock::new(|| regex::Regex::new(r"(?i)^(fix|chore|feat|test|refactor|docs|style|perf)\s*(\([^)]*\))?\s*:?\s*").unwrap());
	let base = PREFIX_RE.replace(t, "").into_owned();
	let base = ticket::re(pool).replace_all(&base, "").into_owned();

	let en_words: Vec<String> = regex::Regex::new(r"[a-zA-Z][a-zA-Z0-9]*").unwrap().find_iter(&base).map(|m| m.as_str().to_lowercase()).collect();
	let fallback = {
		let joined = en_words.join("-");
		let collapsed = regex::Regex::new(r"-+").unwrap().replace_all(&joined, "-").into_owned();
		collapsed.trim_matches('-').chars().take(40).collect::<String>()
	};
	let ko_count = base.chars().filter(|c| ('가'..='힣').contains(c)).count();
	if ko_count == 0 && !fallback.is_empty() {
		return fallback; // 이미 영어
	}

	let model = crate::settings::model_for("translate");
	let prompt = format!(
		"Translate this Korean software task title into a concise English git branch slug: 2-4 words, all lowercase, hyphen-separated, no ticket numbers, no quotes/backticks. Output ONLY the slug.\n\n{t}"
	);
	let repo = app_config::resolve_repo(pool);
	let output = Command::new(claude_bin())
		.args(["-p", &prompt, "--output-format", "json", "--model", &model])
		.current_dir(&repo)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::null())
		.spawn()
		.ok();
	let Some(child) = output else { return fallback };
	let result = tokio::time::timeout(Duration::from_secs(45), child.wait_with_output()).await;
	let Ok(Ok(out)) = result else { return fallback };
	let raw = String::from_utf8_lossy(&out.stdout).into_owned();
	let text_out = serde_json::from_str::<serde_json::Value>(&raw).ok().and_then(|j| j.get("result").and_then(|r| r.as_str()).map(str::to_string)).unwrap_or(raw);
	let slug = slugify(&text_out, 40);
	if slug.is_empty() {
		fallback
	} else {
		slug
	}
}
