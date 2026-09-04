// cockpit.rs — app/server/cockpit.cjs 이식. 병렬 개발 한눈 콕핏 — 워크트리마다 git·PR/CI·dev서버를
// 조인. 프론트는 /api/cockpit(byBranch/byPath/summary/devServers)만 폴링하므로(§ /api/prs·
// /api/pr-detail 미사용 확인) 이번 패스는 그 응답에 필요한 것까지만 다룬다.
//
// ⚠️ 축소: Cmux.focusedCwd()는 Node 원본에서도 이미 사내 비공개 도구 stub이라 항상 null을 반환한다
// (§ cmux.cjs 자체 주석) — 여기서도 그대로 None 고정, 별도 포팅 불필요.
use crate::app_config;
use crate::db::Pool;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::LazyLock;
use tokio::sync::Mutex;

const IGNORE_TOUCH_PATTERNS: &[&str] = &["svgr.tsx", "svgr.jsx", "svgr.ts", "svgr.js"];
fn is_ignored_touch(f: &str) -> bool {
	static GENERATED_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(^|/)(.*\.generated\..*|.*\.snap)$").unwrap());
	if GENERATED_RE.is_match(f) {
		return true;
	}
	let base = f.rsplit('/').next().unwrap_or(f);
	IGNORE_TOUCH_PATTERNS.contains(&base)
}

/// 미커밋 파일들의 최근 mtime = 사용자가 그 워크트리를 마지막으로 만진 시각.
fn touched_from_status(status: &str, root: &str) -> (i64, Option<String>) {
	let mut touched_ms = 0i64;
	let mut touched_file = None;
	for line in status.lines() {
		if line.is_empty() {
			continue;
		}
		let f = line.get(3..).unwrap_or_default().trim();
		let f = f.rsplit_once(" -> ").map(|(_, b)| b).unwrap_or(f);
		if f.is_empty() || is_ignored_touch(f) {
			continue;
		}
		if let Ok(meta) = std::fs::metadata(std::path::Path::new(root).join(f)) {
			if let Ok(modified) = meta.modified() {
				let ms = modified.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
				if ms > touched_ms {
					touched_ms = ms;
					touched_file = Some(f.to_string());
				}
			}
		}
	}
	(touched_ms, touched_file)
}

fn repo_paths(pool: &Pool) -> Vec<String> {
	let repos = crate::repos::list(pool).unwrap_or_default();
	if repos.is_empty() {
		vec![app_config::resolve_repo(pool)]
	} else {
		repos.into_iter().filter_map(|r| r["path"].as_str().map(str::to_string)).collect()
	}
}

fn proj_roots(pool: &Pool) -> Vec<String> {
	let mut seen = std::collections::HashSet::new();
	let mut out = Vec::new();
	for p in repo_paths(pool) {
		let dir = std::path::Path::new(&p).parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
		if seen.insert(dir.clone()) {
			out.push(dir);
		}
	}
	out
}

fn base_branch() -> String {
	std::env::var("OPENRM_BASE_BRANCH").unwrap_or_else(|_| "origin/main".to_string())
}

async fn sh(cmd: &str, args: &[&str], timeout_ms: u64) -> String {
	match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), tokio::process::Command::new(cmd).args(args).output()).await {
		Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
		_ => String::new(),
	}
}
async fn git(args: &[&str], repo: &str) -> String {
	let full: Vec<&str> = ["-C", repo].iter().chain(args.iter()).copied().collect();
	sh("git", &full, 6000).await
}
struct GitOk {
	ok: bool,
	out: String,
}
async fn git_ok(args: &[&str], repo: &str) -> GitOk {
	let full: Vec<&str> = ["-C", repo].iter().chain(args.iter()).copied().collect();
	match tokio::time::timeout(std::time::Duration::from_millis(12000), tokio::process::Command::new("git").args(&full).output()).await {
		Ok(Ok(out)) => GitOk { ok: out.status.success(), out: String::from_utf8_lossy(&out.stdout).into_owned() },
		_ => GitOk { ok: false, out: String::new() },
	}
}

fn classify(cmd: &str) -> &'static str {
	static STORYBOOK_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"storybook|:6006|6006").unwrap());
	static WEBPACK_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"webpack|react-scripts").unwrap());
	if STORYBOOK_RE.is_match(cmd) {
		"storybook"
	} else if cmd.contains("vite") {
		"vite"
	} else if cmd.contains("next") {
		"next"
	} else if WEBPACK_RE.is_match(cmd) {
		"webpack"
	} else {
		"node"
	}
}

/// devServers — 떠있는 dev 서버: lsof LISTEN → {port, pid, cwd, kind, ticket}.
async fn dev_servers(pool: &Pool) -> Vec<Value> {
	let out = sh("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN"], 5000).await;
	static PORT_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r":(\d+)\s+\(LISTEN\)").unwrap());
	let mut by_pid: HashMap<String, std::collections::HashSet<u32>> = HashMap::new();
	for line in out.lines() {
		if !line.contains("(LISTEN)") {
			continue;
		}
		let parts: Vec<&str> = line.split_whitespace().collect();
		let Some(pid) = parts.get(1) else { continue };
		let Some(caps) = PORT_RE.captures(line) else { continue };
		let Ok(port) = caps[1].parse::<u32>() else { continue };
		if !(3000..=6999).contains(&port) {
			continue;
		}
		by_pid.entry(pid.to_string()).or_default().insert(port);
	}
	let roots = proj_roots(pool);
	let mut servers = Vec::new();
	static NOISE_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)StreamDeck|Elgato|ControlCe|chrome-devtools-mcp").unwrap());
	for (pid, ports) in &by_pid {
		let cmd = sh("ps", &["-o", "command=", "-p", pid], 6000).await.trim().to_string();
		if NOISE_RE.is_match(&cmd) {
			continue;
		}
		let cwd_out = sh("lsof", &["-a", "-p", pid, "-d", "cwd", "-Fn"], 5000).await;
		let cwd = cwd_out.lines().find(|l| l.starts_with('n')).map(|l| l[1..].to_string()).unwrap_or_default();
		if cwd.is_empty() || !roots.iter().any(|root| cwd.starts_with(root.as_str())) {
			continue;
		}
		for port in ports {
			servers.push(json!({"port": port, "pid": pid.parse::<i64>().unwrap_or(0), "cwd": cwd, "kind": classify(&cmd), "ticket": crate::ticket::ticket_of(pool, &cwd)}));
		}
	}
	servers.sort_by_key(|s| s["port"].as_u64().unwrap_or(0));
	servers
}

struct WtEntry {
	path: String,
	repo: String,
	gone_set: std::collections::HashSet<String>,
	branch: Option<String>,
	detached: bool,
}

/// streams — 작업 스트림: 워크트리 + git상태 + PR/CI + devServer 조인.
async fn streams(pool: &Pool) -> (Vec<Value>, Vec<Value>, Option<String>) {
	let paths = repo_paths(pool);
	let base = base_branch();

	let mut wts: Vec<WtEntry> = Vec::new();
	for repo in &paths {
		let raw = git(&["worktree", "list", "--porcelain"], repo).await;
		let gone = crate::worktrees::gone_branches(repo).await;
		let mut cur: Option<usize> = None;
		for line in raw.lines() {
			if let Some(p) = line.strip_prefix("worktree ") {
				wts.push(WtEntry { path: p.trim().to_string(), repo: repo.clone(), gone_set: gone.clone(), branch: None, detached: false });
				cur = Some(wts.len() - 1);
			} else if let Some(b) = line.strip_prefix("branch ") {
				if let Some(i) = cur {
					wts[i].branch = Some(b.trim().trim_start_matches("refs/heads/").to_string());
				}
			} else if line.starts_with("detached") {
				if let Some(i) = cur {
					wts[i].detached = true;
				}
			}
		}
	}

	let (devs, pr_data) = tokio::join!(dev_servers(pool), async { crate::prs::list(pool, "open").await });
	let pr_error = pr_data["error"].as_str().map(str::to_string);
	let mut pr_by_branch: HashMap<String, Value> = HashMap::new();
	if let Some(prs) = pr_data["prs"].as_array() {
		for p in prs {
			if let Some(b) = p["branch"].as_str() {
				pr_by_branch.insert(b.to_string(), p.clone());
			}
		}
	}
	let mut dev_by_path: HashMap<String, Vec<Value>> = HashMap::new();
	for d in &devs {
		let cwd = d["cwd"].as_str().unwrap_or_default();
		let best = wts.iter().filter(|w| !cwd.is_empty() && cwd.starts_with(&w.path)).max_by_key(|w| w.path.len()).map(|w| w.path.clone());
		if let Some(best) = best {
			dev_by_path.entry(best).or_default().push(d.clone());
		}
	}

	let mut enriched = Vec::with_capacity(wts.len());
	for w in &wts {
		let ahead_range = format!("{base}..HEAD");
		let behind_range = format!("HEAD..{base}");
		let status_args = ["status", "--porcelain"];
		let log_args = ["log", "-1", "--format=%cr\x1f%s"];
		let ahead_args = ["rev-list", "--count", ahead_range.as_str()];
		let behind_args = ["rev-list", "--count", behind_range.as_str()];
		let (st, last, ahead, behind) = tokio::join!(git_ok(&status_args, &w.path), git(&log_args, &w.path), git(&ahead_args, &w.path), git(&behind_args, &w.path),);
		let dirty = st.out.lines().filter(|l| !l.is_empty()).count();
		let mut last_parts = last.trim().splitn(2, '\x1f');
		let rel = last_parts.next().filter(|s| !s.is_empty()).map(str::to_string);
		let subject = last_parts.next().map(str::to_string);
		let pr = w.branch.as_deref().and_then(|b| pr_by_branch.get(b)).cloned();
		let dev_list = dev_by_path.get(&w.path).cloned().unwrap_or_default();
		let is_main = paths.contains(&w.path);
		let gone = !is_main && w.branch.is_some() && w.gone_set.contains(w.branch.as_deref().unwrap_or_default());
		let (touched_ms, touched_file) = touched_from_status(&st.out, &w.path);
		enriched.push(json!({
			"path": w.path,
			"name": w.path.rsplit('/').next().unwrap_or_default(),
			"branch": w.branch.clone().unwrap_or_else(|| if w.detached { "(detached)".to_string() } else { String::new() }),
			"ticket": w.branch.as_deref().and_then(|b| crate::ticket::ticket_of(pool, b)).or_else(|| crate::ticket::ticket_of(pool, &w.path)),
			"isMain": is_main,
			"dirty": dirty,
			"gone": gone,
			"cleanable": gone && st.ok && dirty == 0,
			"repoPath": w.repo,
			"ahead": ahead.trim().parse::<i64>().unwrap_or(0),
			"behind": behind.trim().parse::<i64>().unwrap_or(0),
			"lastRel": rel,
			"lastSubject": subject,
			"pr": pr.as_ref().map(|p| json!({"number": p["number"], "state": p["state"], "draft": p["draft"], "ci": p["ci"], "review": p["review"], "url": p["url"]})),
			"dev": dev_list.iter().map(|d| json!({"port": d["port"], "kind": d["kind"]})).collect::<Vec<_>>(),
			"touchedMs": touched_ms,
			"touchedFile": touched_file,
		}));
	}

	let score = |s: &Value| -> i64 {
		(if !s["dev"].as_array().map(|a| a.is_empty()).unwrap_or(true) { 4 } else { 0 }) + (if s["dirty"].as_i64().unwrap_or(0) > 0 { 2 } else { 0 }) + (if !s["pr"].is_null() { 1 } else { 0 })
	};
	enriched.sort_by(|a, b| score(b).cmp(&score(a)).then_with(|| b["ahead"].as_i64().unwrap_or(0).cmp(&a["ahead"].as_i64().unwrap_or(0))));
	(enriched, devs, pr_error)
}

async fn build_cockpit(pool: &Pool) -> Value {
	let (all, devs, pr_error) = streams(pool).await;
	let agent_cwds: std::collections::HashSet<String> = crate::term::list().into_iter().filter_map(|s| s["cwd"].as_str().map(str::to_string)).collect();
	let active: Vec<&Value> = all.iter().filter(|s| !s["dev"].as_array().map(|a| a.is_empty()).unwrap_or(true) || s["dirty"].as_i64().unwrap_or(0) > 0 || !s["pr"].is_null() || s["ahead"].as_i64().unwrap_or(0) > 0 || agent_cwds.contains(s["path"].as_str().unwrap_or_default())).collect();

	// Cmux.focusedCwd()는 Node 원본도 사내 비공개 도구 stub이라 항상 null(§ 파일 상단 주석) — 그대로 None.
	let focused: Value = Value::Null;
	let mut recent: Vec<&Value> = all.iter().filter(|s| s["touchedMs"].as_i64().unwrap_or(0) > 0).collect();
	recent.sort_by(|a, b| b["touchedMs"].as_i64().unwrap_or(0).cmp(&a["touchedMs"].as_i64().unwrap_or(0)));
	let recent: Vec<Value> = recent
		.into_iter()
		.take(6)
		.map(|s| json!({"ticket": s["ticket"], "name": s["name"], "branch": s["branch"], "touchedMs": s["touchedMs"], "touchedFile": s["touchedFile"], "dirty": s["dirty"], "pr": s["pr"], "isMain": s["isMain"]}))
		.collect();

	let mut by_branch = serde_json::Map::new();
	let mut by_path = serde_json::Map::new();
	for s in &all {
		if let Some(b) = s["branch"].as_str().filter(|b| !b.is_empty()) {
			by_branch.insert(b.to_string(), json!({"dirty": s["dirty"], "ahead": s["ahead"], "behind": s["behind"], "pr": s["pr"]}));
		}
		if let Some(p) = s["path"].as_str() {
			by_path.insert(p.to_string(), json!({"dirty": s["dirty"], "ahead": s["ahead"], "behind": s["behind"], "pr": s["pr"], "branch": s["branch"]}));
		}
	}

	json!({
		"ok": true,
		"now": {"focused": focused, "recent": recent},
		"summary": {
			"devCount": devs.len(),
			"streamsTotal": all.len(),
			"streamsActive": active.len(),
			"dirty": all.iter().filter(|s| s["dirty"].as_i64().unwrap_or(0) > 0).count(),
			"prOpen": all.iter().filter(|s| !s["pr"].is_null() && s["pr"]["draft"].as_bool() != Some(true)).count(),
			"prDraft": all.iter().filter(|s| s["pr"]["draft"].as_bool() == Some(true)).count(),
			"ciFail": all.iter().filter(|s| s["pr"]["ci"].as_str() == Some("fail")).count(),
			"mainBranch": all.iter().find(|s| s["isMain"].as_bool() == Some(true)).and_then(|s| s["branch"].as_str()),
		},
		"devServers": devs,
		"active": active,
		"byBranch": by_branch,
		"byPath": by_path,
		"streamsTotal": all.len(),
		"prError": pr_error,
		"builtAt": chrono::Utc::now().to_rfc3339(),
	})
}

struct CockpitCache {
	at: i64,
	data: Option<Value>,
	building: bool,
}
static CACHE: LazyLock<Mutex<CockpitCache>> = LazyLock::new(|| Mutex::new(CockpitCache { at: 0, data: None, building: false }));
const COCKPIT_FRESH_MS: i64 = 15000;

/// cockpit() — stale-while-revalidate. 무거운 gh+git(워크트리 다수) 스캔이라 동기 대기하면 렉 — 캐시
/// 있으면 즉시 반환, 오래됐으면 백그라운드로만 갱신.
pub async fn cockpit(pool: &Pool) -> Value {
	let now = chrono::Utc::now().timestamp_millis();
	let (age, data, building) = {
		let c = CACHE.lock().await;
		(now - c.at, c.data.clone(), c.building)
	};
	if let Some(data) = data {
		if age < COCKPIT_FRESH_MS {
			return data;
		}
		if !building {
			CACHE.lock().await.building = true;
			let pool2 = pool.clone();
			tokio::spawn(async move {
				let d = build_cockpit(&pool2).await;
				let mut c = CACHE.lock().await;
				c.at = chrono::Utc::now().timestamp_millis();
				c.data = Some(d);
				c.building = false;
			});
		}
		return data; // stale 즉시 반환
	}
	let d = build_cockpit(pool).await;
	let mut c = CACHE.lock().await;
	c.at = chrono::Utc::now().timestamp_millis();
	c.data = Some(d.clone());
	c.building = false;
	d
}
