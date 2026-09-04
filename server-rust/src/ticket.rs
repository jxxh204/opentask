// ticket.rs — app/server/ticket.cjs 이식. 티켓 접두사(예: GBIZ, PROJ) 중앙 유틸.
use crate::app_config::ticket_prefix;
use crate::db::Pool;
use regex::Regex;

pub fn re(pool: &Pool) -> Regex {
	let prefix = regex::escape(&ticket_prefix(pool));
	Regex::new(&format!(r"(?i){prefix}-\d+")).unwrap()
}

pub fn ticket_of(pool: &Pool, text: &str) -> Option<String> {
	re(pool).find(text).map(|m| m.as_str().to_string())
}

#[allow(dead_code)]
pub fn normalize_branch_prefix(pool: &Pool, branch: &str) -> String {
	let prefix = ticket_prefix(pool);
	let re = re(pool);
	let head_len = (prefix.len() + 1).min(branch.len());
	if re.is_match(&branch[..head_len]) {
		let case_insensitive_prefix = Regex::new(&format!(r"(?i)^{}-", regex::escape(&prefix))).unwrap();
		case_insensitive_prefix.replace(branch, format!("{prefix}-")).into_owned()
	} else {
		branch.to_string()
	}
}
