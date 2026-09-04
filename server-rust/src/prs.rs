// prs.rs — app/server/prs.cjs 이식. 이번 패스는 cockpit.rs가 실제로 쓰는 list()만 다룬다 — detail()은
// active.cjs(코드 verdict)·피그마 노드 조회에 의존하고 프론트가 직접 호출하지 않아(§ /api/cockpit만
// 폴링, /api/prs·/api/pr-detail은 미사용 확인) 이번 스코프에서 뺐다.
use crate::app_config;
use crate::db::Pool;
use serde_json::{json, Value};

/// ghEnv() — GitHub 연동을 Secrets(OAuth Device Flow/직접 붙여넣기)로 했으면 GH_TOKEN을 주입, 아니면
/// 로컬 `gh auth login` 세션(~/.config/gh/hosts.yml)에 그대로 위임.
fn gh_token(pool: &Pool) -> Option<String> {
	crate::secrets::get(pool, "githubToken").ok().flatten()
}

async fn gh(pool: &Pool, args: &[&str]) -> String {
	let mut cmd = tokio::process::Command::new("gh");
	cmd.args(args);
	if let Some(token) = gh_token(pool) {
		cmd.env("GH_TOKEN", token);
	}
	match tokio::time::timeout(std::time::Duration::from_millis(15000), cmd.output()).await {
		Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
		_ => String::new(),
	}
}

fn ci_summary(rollup: &Value) -> &'static str {
	let Some(items) = rollup.as_array().filter(|a| !a.is_empty()) else { return "none" };
	static FAIL_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"(?i)FAIL|ERROR|CANCELL|TIMED|ACTION_REQUIRED").unwrap());
	static OK_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"(?i)SUCCESS|NEUTRAL|SKIPPED|COMPLETED").unwrap());
	let mut fail = 0;
	let mut pending = 0;
	for c in items {
		let s = c["conclusion"].as_str().or_else(|| c["state"].as_str()).unwrap_or_default();
		if FAIL_RE.is_match(s) {
			fail += 1;
		} else if !OK_RE.is_match(s) {
			pending += 1;
		}
	}
	if fail > 0 {
		"fail"
	} else if pending > 0 {
		"pending"
	} else {
		"pass"
	}
}

/// 브랜치 → 워크트리 경로 (git worktree list 1회 파싱, per-worktree git 호출 없음).
async fn worktree_by_branch(repo: &str) -> std::collections::HashMap<String, String> {
	let out = match tokio::time::timeout(std::time::Duration::from_millis(7000), tokio::process::Command::new("git").args(["-C", repo, "worktree", "list", "--porcelain"]).output()).await {
		Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
		_ => String::new(),
	};
	let mut map = std::collections::HashMap::new();
	let mut cur_path: Option<String> = None;
	for line in out.lines() {
		if let Some(p) = line.strip_prefix("worktree ") {
			cur_path = Some(p.trim().to_string());
		} else if let Some(b) = line.strip_prefix("branch ") {
			if let Some(p) = &cur_path {
				map.insert(b.trim().trim_start_matches("refs/heads/").to_string(), p.clone());
			}
		}
	}
	map
}

const PR_FIELDS: &str = "number,title,headRefName,baseRefName,state,isDraft,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,url,updatedAt";

fn map_pr(pool: &Pool, p: &Value, repo_name: &str, wt_map: &std::collections::HashMap<String, String>) -> Value {
	let branch = p["headRefName"].as_str().unwrap_or_default();
	json!({
		"number": p["number"],
		"repo": repo_name,
		"title": p["title"],
		"branch": branch,
		"base": p["baseRefName"],
		"state": p["state"].as_str().unwrap_or_default().to_lowercase(),
		"draft": p["isDraft"].as_bool().unwrap_or(false),
		"review": p["reviewDecision"],
		"ci": ci_summary(&p["statusCheckRollup"]),
		"additions": p["additions"],
		"deletions": p["deletions"],
		"files": p["changedFiles"],
		"url": p["url"],
		"updatedAt": p["updatedAt"],
		"ticket": crate::ticket::ticket_of(pool, branch),
		"worktree": wt_map.get(branch),
	})
}

/// list — 내 PR(--author @me) 나열. repo마다 gh CLI 1회 호출.
pub async fn list(pool: &Pool, state: &str) -> Value {
	let st = if ["open", "merged", "closed"].contains(&state) { state } else { "open" };
	let repos = app_config::pr_repos(pool).unwrap_or_default();
	let repo_path = app_config::resolve_repo(pool);
	let wt_map = worktree_by_branch(&repo_path).await;

	let mut all: Vec<Value> = Vec::new();
	let mut by_repo = serde_json::Map::new();
	let mut failed: Vec<String> = Vec::new();
	for r in &repos {
		let slug = r["slug"].as_str().unwrap_or_default();
		let name = r["name"].as_str().unwrap_or_default();
		let raw = gh(pool, &["pr", "list", "-R", slug, "--author", "@me", "--state", st, "-L", "50", "--json", PR_FIELDS]).await;
		match serde_json::from_str::<Vec<Value>>(&raw) {
			Ok(prs) => {
				by_repo.insert(name.to_string(), json!(prs.len()));
				for p in &prs {
					all.push(map_pr(pool, p, name, &wt_map));
				}
			}
			Err(_) => {
				by_repo.insert(name.to_string(), json!(0));
				failed.push(name.to_string());
			}
		}
	}
	all.sort_by(|a, b| {
		let ra = a["repo"].as_str().unwrap_or_default();
		let rb = b["repo"].as_str().unwrap_or_default();
		ra.cmp(rb).then_with(|| b["updatedAt"].as_str().unwrap_or_default().cmp(a["updatedAt"].as_str().unwrap_or_default()))
	});

	let counts = json!({
		"total": all.len(),
		"draft": all.iter().filter(|p| p["draft"].as_bool() == Some(true)).count(),
		"ciFail": all.iter().filter(|p| p["ci"].as_str() == Some("fail")).count(),
		"verifiable": all.iter().filter(|p| !p["worktree"].is_null()).count(),
	});
	let mut out = json!({
		"state": st,
		"repos": repos.iter().map(|r| r["name"].clone()).collect::<Vec<_>>(),
		"byRepo": by_repo,
		"counts": counts,
		"prs": all,
		"builtAt": chrono::Utc::now().to_rfc3339(),
	});
	if !failed.is_empty() {
		out["error"] = json!(format!("레포 조회 실패: {} (gh 인증 확인)", failed.join(", ")));
	}
	out
}
