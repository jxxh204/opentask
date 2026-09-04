// worktrees.rs — app/server/worktrees.cjs 이식. git worktree 플릿 조회/생성/정리.
use crate::app_config::resolve_repo;
use crate::db::Pool;
use crate::ticket;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

fn base_branch() -> String {
	std::env::var("OPENRM_BASE_BRANCH").unwrap_or_else(|_| "origin/main".to_string())
}

/// git.cjs git() — 읽기 전용, 실패해도 빈 문자열(호출부가 "에러=빈 결과"를 감수하는 자리에서만 씀).
async fn git(args: &[&str], repo: &str, timeout_ms: u64) -> String {
	let full_args: Vec<&str> = ["-C", repo].iter().chain(args.iter()).copied().collect();
	match tokio::time::timeout(Duration::from_millis(timeout_ms), Command::new("git").args(&full_args).output()).await {
		Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
		_ => String::new(),
	}
}

struct GitResult {
	ok: bool,
	out: String,
	err: String,
}

/// gitX() — 쓰기 작업용, 에러 메시지까지 회수.
async fn git_x(args: &[&str], repo: &str, timeout_ms: u64) -> GitResult {
	let full_args: Vec<&str> = ["-C", repo].iter().chain(args.iter()).copied().collect();
	match tokio::time::timeout(Duration::from_millis(timeout_ms), Command::new("git").args(&full_args).output()).await {
		Ok(Ok(out)) => GitResult { ok: out.status.success(), out: String::from_utf8_lossy(&out.stdout).into_owned(), err: String::from_utf8_lossy(&out.stderr).into_owned() },
		Ok(Err(e)) => GitResult { ok: false, out: String::new(), err: e.to_string() },
		Err(_) => GitResult { ok: false, out: String::new(), err: "timeout".to_string() },
	}
}

fn last_nonempty_line(s: &str) -> String {
	s.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string()
}
fn slug_from_desc(pool: &Pool, desc: &str) -> String {
	let d = desc.trim();
	if d.is_empty() {
		return String::new();
	}
	// "fix(PROJ-x): " 같은 conventional prefix 제거
	static PREFIX_RE: std::sync::LazyLock<regex::Regex> =
		std::sync::LazyLock::new(|| regex::Regex::new(r"(?i)^(fix|chore|feat|test|refactor|docs|style|perf|build|ci)\s*(\([^)]*\))?\s*:?\s*").unwrap());
	let d = PREFIX_RE.replace(d, "").into_owned();
	let ticket_re = ticket::re(pool);
	let d = ticket_re.replace_all(&d, "").into_owned();

	let mut slug = d.trim().to_string();
	slug = regex::Regex::new(r"\s+").unwrap().replace_all(&slug, "-").into_owned();
	slug = regex::Regex::new(r"[^a-zA-Z0-9가-힣_-]+").unwrap().replace_all(&slug, "-").into_owned();
	slug = regex::Regex::new(r"-+").unwrap().replace_all(&slug, "-").into_owned();
	slug = slug.trim_matches('-').to_string();
	if slug.chars().count() > 32 {
		let truncated: String = slug.chars().take(32).collect();
		if let Some(last_dash) = truncated.rfind('-') {
			if last_dash > 8 {
				slug = truncated[..last_dash].to_string();
			} else {
				slug = truncated;
			}
		} else {
			slug = truncated;
		}
	}
	slug.trim_end_matches('-').to_string()
}

struct Names {
	branch: String,
	dir: String,
}

/// "PROJ-1234-foo" | "1234-foo" | "1234" | "popup-fix" → {branch, dir}. desc가 있으면 번호만 있을 때
/// "PROJ-1234-내용"으로 만든다(§원본 deriveNames).
fn derive_names(pool: &Pool, raw: &str, desc: &str) -> Option<Names> {
	let s = raw.trim();
	if s.is_empty() {
		return None;
	}
	let num_re = regex::Regex::new(r"\d{3,}").unwrap();
	let num = num_re.find(s).map(|m| m.as_str().to_string());

	let mut branch = regex::Regex::new(r"\s+").unwrap().replace_all(s, "-").into_owned();
	branch = regex::Regex::new(r"[^a-zA-Z0-9가-힣_/-]+").unwrap().replace_all(&branch, "-").into_owned();
	branch = branch.trim_matches('-').to_string();

	let prefix = crate::app_config::ticket_prefix(pool);
	let starts_with_prefix = regex::Regex::new(&format!(r"(?i)^{}-", regex::escape(&prefix))).unwrap();
	if num.is_some() && !starts_with_prefix.is_match(&branch) {
		branch = format!("{prefix}-{branch}");
	}
	let leading_prefix_re = regex::Regex::new(&format!(r"(?i)^{}-", regex::escape(&prefix))).unwrap();
	branch = leading_prefix_re.replace(&branch, format!("{prefix}-")).into_owned();

	let bare_prefix_num_re = regex::Regex::new(&format!(r"(?i)^{}-\d+$", regex::escape(&prefix))).unwrap();
	if bare_prefix_num_re.is_match(&branch) {
		let ds = slug_from_desc(pool, desc);
		if !ds.is_empty() {
			branch = format!("{branch}-{ds}");
		}
	}
	let stripped = leading_prefix_re.replace(&branch, "").into_owned();
	let dir_slug = num.unwrap_or_else(|| {
		let s: String = stripped.chars().take(28).collect();
		if s.is_empty() {
			"task".to_string()
		} else {
			s
		}
	});
	Some(Names { branch, dir: format!("at-{dir_slug}") })
}

async fn detect_current_branch(repo: &str) -> Option<String> {
	let r = git_x(&["rev-parse", "--abbrev-ref", "HEAD"], repo, 7000).await;
	if !r.ok {
		return None;
	}
	let b = r.out.trim().to_string();
	if b.is_empty() || b == "HEAD" {
		None
	} else {
		Some(b)
	}
}

const ENV_FILES_DEFAULT: &str = ".env.local,.env.development.local,.env.test.local,.env.production.local,.env.sentry-build-plugin";

/// gitignore된 env 파일을 워크트리로 복사(멱등 — 대상에 이미 있으면 안 건드림).
pub fn copy_env_files(wt_path: &str, repo: &str) -> Vec<String> {
	let files = std::env::var("OPENRM_WORKTREE_COPY").unwrap_or_else(|_| ENV_FILES_DEFAULT.to_string());
	let mut copied = Vec::new();
	for f in files.split(',').map(str::trim).filter(|s| !s.is_empty()) {
		let src = Path::new(repo).join(f);
		let dst = Path::new(wt_path).join(f);
		if src.exists() && !dst.exists() {
			if std::fs::copy(&src, &dst).is_ok() {
				copied.push(f.to_string());
			}
		}
	}
	copied
}

#[derive(Default)]
pub struct CreateInput {
	pub ticket: Option<String>,
	pub base: Option<String>,
	pub desc: Option<String>,
	pub dir: Option<String>,
	pub branch: Option<String>,
	pub repo_path: Option<String>,
	pub repo_base: Option<String>,
}

pub async fn create(pool: &Pool, input: CreateInput) -> Value {
	let repo = input.repo_path.clone().unwrap_or_else(|| resolve_repo(pool));
	let mut remote_fetched = false;
	let (branch, dir) = if let Some(explicit) = &input.branch {
		let branch = explicit.trim().to_string();
		let prefix = crate::app_config::ticket_prefix(pool);
		let strip_re = regex::Regex::new(&format!(r"(?i)^{}-", regex::escape(&prefix))).unwrap();
		let sanitize_re = regex::Regex::new(r"[^a-zA-Z0-9._-]").unwrap();
		let auto_dir: String = {
			let stripped = strip_re.replace(&branch, "").into_owned();
			let cleaned = sanitize_re.replace_all(&stripped, "-").into_owned();
			format!("at-{cleaned}").chars().take(60).collect()
		};
		let dir = input.dir.clone().filter(|d| !d.trim().is_empty()).unwrap_or(auto_dir);
		let _ = git_x(&["fetch", "origin", &branch], &repo, 20000).await;
		remote_fetched = true;
		(branch, dir)
	} else {
		let names = match derive_names(pool, input.ticket.as_deref().unwrap_or(""), input.desc.as_deref().unwrap_or("")) {
			Some(n) => n,
			None => return json!({"ok": false, "error": "티켓/브랜치명을 입력하세요."}),
		};
		let dir = input.dir.clone().filter(|d| !d.trim().is_empty()).unwrap_or(names.dir);
		(names.branch, dir)
	};

	let parent = Path::new(&repo).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
	let wt_path = parent.join(&dir);
	if wt_path.exists() {
		return json!({"ok": false, "error": format!("이미 존재하는 폴더: {dir} (기존 워크트리에서 시작하세요)")});
	}
	let wt_path_str = wt_path.to_string_lossy().into_owned();

	// detect_current_branch()는 async라 Option 체인(or_else) 안에서 바로 못 불러 마지막만 별도 처리.
	let base_ref = match input.base.filter(|b| !b.trim().is_empty()).or(input.repo_base).or_else(|| std::env::var("OPENRM_NEW_TASK_BASE").ok()) {
		Some(b) => b,
		None => detect_current_branch(&repo).await.unwrap_or_else(|| "main".to_string()),
	};

	let local_exists = git_x(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")], &repo, 7000).await.ok;
	let r = if local_exists {
		git_x(&["worktree", "add", &wt_path_str, &branch], &repo, 20000).await
	} else if input.branch.is_some() {
		let r1 = git_x(&["worktree", "add", "-b", &branch, &wt_path_str, &format!("origin/{branch}")], &repo, 20000).await;
		if r1.ok {
			r1
		} else {
			git_x(&["worktree", "add", "-b", &branch, &wt_path_str, "FETCH_HEAD"], &repo, 20000).await
		}
	} else {
		let base_ok = git_x(&["rev-parse", "--verify", "--quiet", &base_ref], &repo, 7000).await.ok;
		if !base_ok {
			return json!({"ok": false, "error": format!("base 브랜치를 찾을 수 없음: {base_ref} (git fetch 필요할 수 있음)")});
		}
		git_x(&["worktree", "add", "-b", &branch, &wt_path_str, &base_ref], &repo, 20000).await
	};
	if !r.ok {
		let msg = last_nonempty_line(&r.err);
		return json!({"ok": false, "error": if msg.is_empty() { "git worktree add 실패".to_string() } else { msg }});
	}
	let env_copied = copy_env_files(&wt_path_str, &repo);
	json!({"ok": true, "path": wt_path_str, "dir": dir, "branch": branch, "base": base_ref, "created": true, "attached": local_exists, "remoteFetched": remote_fetched, "envCopied": env_copied})
}

pub async fn remove_from(repo: &str, wt_path: &str, branch: Option<&str>) -> Value {
	let mut errors = Vec::new();
	let mut worktree_removed = false;
	let mut branch_deleted = false;
	if wt_path.is_empty() {
		return json!({"ok": false, "errors": ["워크트리 경로 없음"]});
	}
	let rm = git_x(&["worktree", "remove", "--force", wt_path], repo, 20000).await;
	if rm.ok {
		worktree_removed = true;
	} else {
		let _ = git_x(&["worktree", "prune"], repo, 20000).await;
		if !Path::new(wt_path).exists() {
			worktree_removed = true;
		} else {
			let msg: String = last_nonempty_line(&rm.err).chars().take(120).collect();
			errors.push(format!("워크트리 제거 실패: {msg}"));
		}
	}
	if let Some(b) = branch {
		static PROTECTED: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"(?i)^(develop|main|master)$").unwrap());
		if !PROTECTED.is_match(b) {
			let bd = git_x(&["branch", "-D", b], repo, 20000).await;
			if bd.ok {
				branch_deleted = true;
			} else {
				let msg: String = last_nonempty_line(&bd.err).chars().take(120).collect();
				errors.push(format!("브랜치 삭제 실패: {msg}"));
			}
		}
	}
	json!({"ok": worktree_removed && errors.is_empty(), "worktreeRemoved": worktree_removed, "branchDeleted": branch_deleted, "errors": errors})
}

pub async fn ensure(pool: &Pool, input: CreateInput) -> Value {
	let repo = input.repo_path.clone().unwrap_or_else(|| resolve_repo(pool));
	let names = match derive_names(pool, input.ticket.as_deref().unwrap_or(""), input.desc.as_deref().unwrap_or("")) {
		Some(n) => n,
		None => return json!({"ok": false, "error": "티켓/브랜치명을 입력하세요."}),
	};
	let parent = Path::new(&repo).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
	let wt_path = parent.join(&names.dir);
	if wt_path.exists() {
		let wt_path_str = wt_path.to_string_lossy().into_owned();
		let env_copied = copy_env_files(&wt_path_str, &repo);
		let head = git(&["rev-parse", "--abbrev-ref", "HEAD"], &wt_path_str, 7000).await.trim().to_string();
		return json!({"ok": true, "path": wt_path_str, "dir": names.dir, "branch": if head.is_empty() { names.branch } else { head }, "existed": true, "created": false, "envCopied": env_copied});
	}
	create(pool, input).await
}

pub async fn gone_branches(repo: &str) -> HashSet<String> {
	let raw = git(&["for-each-ref", "--format=%(refname:short) %(upstream:track)", "refs/heads"], repo, 7000).await;
	let mut set = HashSet::new();
	for line in raw.lines() {
		if line.trim().is_empty() {
			continue;
		}
		if line.trim_end().ends_with("[gone]") {
			let name = line.trim_end().trim_end_matches("[gone]").trim().to_string();
			set.insert(name);
		}
	}
	set
}

struct WtRaw {
	path: String,
	branch: Option<String>,
	head: Option<String>,
	detached: bool,
}

fn parse_worktree_porcelain(raw: &str) -> Vec<WtRaw> {
	let mut out = Vec::new();
	let mut cur: Option<WtRaw> = None;
	for line in raw.lines() {
		if let Some(p) = line.strip_prefix("worktree ") {
			if let Some(c) = cur.take() {
				out.push(c);
			}
			cur = Some(WtRaw { path: p.trim().to_string(), branch: None, head: None, detached: false });
		} else if let Some(b) = line.strip_prefix("branch ") {
			if let Some(c) = cur.as_mut() {
				c.branch = Some(b.trim().trim_start_matches("refs/heads/").to_string());
			}
		} else if let Some(h) = line.strip_prefix("HEAD ") {
			if let Some(c) = cur.as_mut() {
				c.head = Some(h.trim().chars().take(9).collect());
			}
		} else if line.starts_with("detached") {
			if let Some(c) = cur.as_mut() {
				c.detached = true;
			}
		}
	}
	if let Some(c) = cur.take() {
		out.push(c);
	}
	out
}

pub async fn list(pool: &Pool, repo_path: Option<&str>) -> Value {
	let repo = repo_path.map(str::to_string).unwrap_or_else(|| resolve_repo(pool));
	let (raw, gone) = tokio::join!(git(&["worktree", "list", "--porcelain"], &repo, 7000), gone_branches(&repo));
	let wts = parse_worktree_porcelain(&raw);

	let mut worktrees = Vec::new();
	let ahead_range = format!("{}..HEAD", base_branch());
	let behind_range = format!("HEAD..{}", base_branch());
	for w in &wts {
		let status_args = ["status", "--porcelain"];
		let log_args = ["log", "-1", "--format=%cr\x1f%s\x1f%an\x1f%ct"];
		let ahead_args = ["rev-list", "--count", &ahead_range];
		let behind_args = ["rev-list", "--count", &behind_range];
		let (st, last, ahead, behind) = tokio::join!(
			git_x(&status_args, &w.path, 15000),
			git(&log_args, &w.path, 7000),
			git(&ahead_args, &w.path, 7000),
			git(&behind_args, &w.path, 7000),
		);
		let status_ok = st.ok;
		let dirty_lines: Vec<&str> = st.out.lines().filter(|l| !l.is_empty()).collect();
		let dirty_src = dirty_lines.iter().filter(|l| l.contains(" src/") || (l.len() > 3 && l[3..].contains("src/"))).count();
		let parts: Vec<&str> = last.trim().split('\u{1f}').collect();
		let last_rel = parts.first().copied().unwrap_or("");
		let last_subject = parts.get(1).copied().unwrap_or("");
		let author = parts.get(2).copied().unwrap_or("");
		let last_ts: i64 = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
		let branch = w.branch.clone().unwrap_or_else(|| if w.detached { "(detached)".to_string() } else { "?".to_string() });
		let is_main = w.path == repo;
		let is_gone = !is_main && w.branch.as_ref().map(|b| gone.contains(b)).unwrap_or(false);
		let cleanable = is_gone && status_ok && dirty_lines.is_empty();
		worktrees.push(json!({
			"path": w.path,
			"name": Path::new(&w.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
			"branch": branch,
			"ticket": ticket::ticket_of(pool, &branch),
			"head": w.head,
			"dirty": dirty_lines.len(),
			"dirtySrc": dirty_src,
			"statusOk": status_ok,
			"lastRel": if last_rel.is_empty() { Value::Null } else { json!(last_rel) },
			"lastSubject": if last_subject.is_empty() { Value::Null } else { json!(last_subject) },
			"author": if author.is_empty() { Value::Null } else { json!(author) },
			"lastTs": last_ts,
			"ahead": ahead.trim().parse::<i64>().unwrap_or(0),
			"behind": behind.trim().parse::<i64>().unwrap_or(0),
			"isMain": is_main,
			"gone": is_gone,
			"cleanable": cleanable,
		}));
	}
	worktrees.sort_by(|a, b| {
		let a_dirty = a["dirty"].as_i64().unwrap_or(0) > 0;
		let b_dirty = b["dirty"].as_i64().unwrap_or(0) > 0;
		(b_dirty as i32).cmp(&(a_dirty as i32)).then_with(|| b["lastTs"].as_i64().unwrap_or(0).cmp(&a["lastTs"].as_i64().unwrap_or(0)))
	});
	let stale_cleanable = worktrees.iter().filter(|w| w["cleanable"].as_bool().unwrap_or(false)).count();
	let stale_dirty = worktrees.iter().filter(|w| w["gone"].as_bool().unwrap_or(false) && !w["cleanable"].as_bool().unwrap_or(false)).count();
	json!({"base": base_branch(), "count": worktrees.len(), "staleCleanable": stale_cleanable, "staleDirty": stale_dirty, "worktrees": worktrees, "builtAt": chrono::Utc::now().to_rfc3339()})
}

pub async fn prune_stale(pool: &Pool, repo_path: Option<&str>, dry_run: bool, include_dirty: bool) -> Value {
	let repo = repo_path.map(str::to_string).unwrap_or_else(|| resolve_repo(pool));
	let listed = list(pool, Some(&repo)).await;
	let worktrees = listed["worktrees"].as_array().cloned().unwrap_or_default();
	let targets: Vec<&Value> = worktrees
		.iter()
		.filter(|w| !w["isMain"].as_bool().unwrap_or(false) && w["gone"].as_bool().unwrap_or(false) && (include_dirty || w["cleanable"].as_bool().unwrap_or(false)))
		.collect();
	let skipped_dirty: Vec<Value> = worktrees
		.iter()
		.filter(|w| !w["isMain"].as_bool().unwrap_or(false) && w["gone"].as_bool().unwrap_or(false) && !w["cleanable"].as_bool().unwrap_or(false))
		.map(|w| json!({"path": w["path"], "branch": w["branch"], "dirty": w["dirty"]}))
		.collect();

	let mut removed = Vec::new();
	let mut failed = Vec::new();
	if !dry_run {
		for w in &targets {
			let path = w["path"].as_str().unwrap_or_default();
			let branch = w["branch"].as_str();
			if !include_dirty {
				let chk = git_x(&["status", "--porcelain"], path, 15000).await;
				if !chk.ok || chk.out.lines().filter(|l| !l.is_empty()).count() > 0 {
					failed.push(json!({"path": path, "branch": branch, "errors": ["삭제 직전 재확인에서 미커밋 변경 또는 status 실패 — 건너뜀"]}));
					continue;
				}
			}
			let r = remove_from(&repo, path, branch).await;
			if r["ok"].as_bool().unwrap_or(false) {
				removed.push(json!({"path": path, "branch": branch}));
			} else {
				failed.push(json!({"path": path, "branch": branch, "errors": r["errors"]}));
			}
		}
	}
	let targets_out: Vec<Value> = targets.iter().map(|w| json!({"path": w["path"], "branch": w["branch"], "dirty": w["dirty"]})).collect();
	json!({"ok": true, "dryRun": dry_run, "base": base_branch(), "targets": targets_out, "removed": removed, "failed": failed, "skippedDirty": skipped_dirty})
}

pub async fn count(pool: &Pool, repo_path: Option<&str>) -> i64 {
	let repo = repo_path.map(str::to_string).unwrap_or_else(|| resolve_repo(pool));
	let raw = git(&["worktree", "list", "--porcelain"], &repo, 7000).await;
	raw.lines().filter(|l| l.starts_with("worktree ")).count() as i64
}

#[allow(dead_code)]
pub async fn path_for_branch(pool: &Pool, branch: &str, repo_path: Option<&str>) -> Option<String> {
	let repo = repo_path.map(str::to_string).unwrap_or_else(|| resolve_repo(pool));
	let r = git_x(&["worktree", "list", "--porcelain"], &repo, 7000).await;
	if !r.ok {
		return None;
	}
	let mut cur_path: Option<String> = None;
	for line in r.out.lines() {
		if let Some(p) = line.strip_prefix("worktree ") {
			cur_path = Some(p.trim().to_string());
		} else if let Some(b) = line.strip_prefix("branch ") {
			if b.trim() == format!("refs/heads/{branch}") {
				return cur_path;
			}
		}
	}
	None
}

#[allow(dead_code)]
pub async fn create_deploy_branch(pool: &Pool, num: &str, base: Option<&str>) -> Value {
	let repo = resolve_repo(pool);
	let m = regex::Regex::new(r"\d+").unwrap().find(num);
	let num = match m {
		Some(m) => m.as_str().to_string(),
		None => return json!({"ok": false, "error": "배포 번호(숫자)를 입력하세요. 예: 286"}),
	};
	let branch = format!("deploy-{num}");
	let base_ref = base.filter(|b| !b.trim().is_empty()).map(str::to_string).or_else(|| std::env::var("OPENRM_DEPLOY_BASE").ok()).unwrap_or_else(|| "develop".to_string());
	if !git_x(&["rev-parse", "--verify", "--quiet", &base_ref], &repo, 7000).await.ok {
		return json!({"ok": false, "error": format!("base 브랜치를 찾을 수 없음: {base_ref}")});
	}
	if git_x(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")], &repo, 7000).await.ok {
		return json!({"ok": false, "error": format!("이미 있는 브랜치: {branch}")});
	}
	let c = git_x(&["branch", &branch, &base_ref], &repo, 20000).await;
	if !c.ok {
		let msg: String = last_nonempty_line(&c.err).chars().take(140).collect();
		return json!({"ok": false, "error": if msg.is_empty() { "branch 생성 실패".to_string() } else { msg }});
	}
	let p = git_x(&["push", "-u", "origin", &branch], &repo, 60000).await;
	json!({"ok": true, "branch": branch, "base": base_ref, "pushed": p.ok, "pushError": if p.ok { Value::Null } else { json!(last_nonempty_line(&p.err).chars().take(160).collect::<String>()) }})
}

fn group_slug(s: &str) -> String {
	let mut slug = regex::Regex::new(r"\s+").unwrap().replace_all(s.trim(), "-").into_owned();
	slug = regex::Regex::new(r"[^a-zA-Z0-9가-힣_-]+").unwrap().replace_all(&slug, "-").into_owned();
	slug = regex::Regex::new(r"-+").unwrap().replace_all(&slug, "-").into_owned();
	slug = slug.trim_matches('-').to_string();
	let truncated: String = slug.chars().take(40).collect();
	if truncated.is_empty() {
		"group".to_string()
	} else {
		truncated
	}
}

#[allow(dead_code)]
pub async fn build_group_branch(pool: &Pool, group: &str, base: Option<&str>, branches: &[Value]) -> Value {
	let repo = resolve_repo(pool);
	let g = group.trim();
	if g.is_empty() {
		return json!({"ok": false, "error": "그룹 필수"});
	}
	let branch = format!("group-{}", group_slug(g));
	let base_ref = base.filter(|b| !b.trim().is_empty()).map(str::to_string).or_else(|| std::env::var("OPENRM_NEW_TASK_BASE").ok()).unwrap_or_else(|| "develop".to_string());
	if !git_x(&["rev-parse", "--verify", "--quiet", &base_ref], &repo, 7000).await.ok {
		return json!({"ok": false, "error": format!("base 브랜치를 찾을 수 없음: {base_ref}")});
	}
	let parent = Path::new(&repo).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
	let wt_path = parent.join(format!("grp-{}", group_slug(g)));
	let wt_path_str = wt_path.to_string_lossy().into_owned();
	if !wt_path.exists() {
		let add = git_x(&["worktree", "add", "-b", &branch, &wt_path_str, &base_ref], &repo, 20000).await;
		if !add.ok {
			let local_exists = git_x(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")], &repo, 7000).await.ok;
			let add2 = if local_exists { Some(git_x(&["worktree", "add", &wt_path_str, &branch], &repo, 20000).await) } else { None };
			if add2.as_ref().map(|a| !a.ok).unwrap_or(true) {
				let msg = last_nonempty_line(&add.err);
				return json!({"ok": false, "error": if msg.is_empty() { "워크트리 생성 실패".to_string() } else { msg }});
			}
		}
	}
	let reset = git_x(&["checkout", "-B", &branch, &base_ref], &wt_path_str, 20000).await;
	if !reset.ok {
		return json!({"ok": false, "error": format!("브랜치 리셋 실패: {}", last_nonempty_line(&reset.err))});
	}
	let _ = git_x(&["clean", "-fd"], &wt_path_str, 20000).await;

	let mut merged = Vec::new();
	let mut skipped = Vec::new();
	let mut conflicts = Vec::new();
	for b in branches {
		let branch_name = match b.get("branch").and_then(Value::as_str) {
			Some(v) if !v.is_empty() => v.to_string(),
			_ => continue,
		};
		let local_exists = git_x(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch_name}")], &repo, 7000).await.ok;
		let ref_to_merge = if local_exists {
			branch_name.clone()
		} else {
			let fetched = git_x(&["fetch", "origin", &branch_name], &repo, 30000).await;
			if !fetched.ok {
				let mut entry = b.clone();
				entry["reason"] = json!("브랜치를 찾을 수 없음(로컬/원격 모두 없음)");
				skipped.push(entry);
				continue;
			}
			"FETCH_HEAD".to_string()
		};
		let m = git_x(&["merge", "--no-edit", "--no-verify", &ref_to_merge], &wt_path_str, 30000).await;
		if m.ok {
			merged.push(b.clone());
		} else {
			let combined = format!("{}\n{}", m.out, m.err);
			let lines: Vec<&str> = combined.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
			let reason = lines
				.iter()
				.find(|l| l.starts_with("CONFLICT"))
				.or_else(|| lines.iter().find(|l| l.contains("Automatic merge failed")))
				.or_else(|| lines.last())
				.map(|s| s.to_string())
				.unwrap_or_else(|| "병합 충돌".to_string());
			let _ = git_x(&["merge", "--abort"], &wt_path_str, 20000).await;
			let mut entry = b.clone();
			entry["error"] = json!(reason);
			conflicts.push(entry);
		}
	}
	copy_env_files(&wt_path_str, &repo);
	json!({"ok": true, "branch": branch, "path": wt_path_str, "base": base_ref, "merged": merged, "skipped": skipped, "conflicts": conflicts})
}
