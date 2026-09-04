// repo_add.rs — app/server/repoAdd.cjs 이식. "레포 추가" 모달의 clone/새 프로젝트 두 경로(기존 폴더
// 등록은 /api/setup/fs/*로 충분해 여기선 안 다룸 — § 원본 주석).
use crate::db::Pool;
use serde_json::{json, Value};

fn git(args: &[&str], cwd: &std::path::Path) -> Result<(), String> {
	match std::process::Command::new("git").args(args).current_dir(cwd).output() {
		Ok(out) if out.status.success() => Ok(()),
		Ok(out) => {
			let err = String::from_utf8_lossy(&out.stderr);
			let first_line = err.lines().find(|l| !l.trim().is_empty()).unwrap_or(&err);
			Err(first_line.chars().take(300).collect())
		}
		Err(e) => Err(e.to_string()),
	}
}

fn name_from_url(url: &str) -> String {
	let base = url.trim().trim_end_matches('/').rsplit('/').next().unwrap_or("repo");
	base.trim_end_matches(".git").to_string()
}

/// cloneRepo — URL에서 clone → parentPath/name 자리에 실제 git clone 실행 → 성공하면 레포로 등록.
pub fn clone_repo(pool: &Pool, url: &str, parent_path: &str, name: Option<&str>) -> anyhow::Result<Value> {
	if url.trim().is_empty() {
		return Ok(json!({"ok": false, "error": "URL이 필요합니다."}));
	}
	if parent_path.is_empty() {
		return Ok(json!({"ok": false, "error": "대상 폴더가 필요합니다."}));
	}
	let dir_name = name.map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).unwrap_or_else(|| name_from_url(url));
	let parent = std::path::Path::new(parent_path);
	let target = parent.join(&dir_name);
	if target.exists() {
		return Ok(json!({"ok": false, "error": format!("이미 존재하는 폴더: {}", target.display())}));
	}
	if !parent.exists() {
		return Ok(json!({"ok": false, "error": format!("대상 폴더가 없습니다: {parent_path}")}));
	}
	if let Err(e) = git(&["clone", url.trim(), &dir_name], parent) {
		return Ok(json!({"ok": false, "error": format!("git clone 실패: {e}")}));
	}
	let repo = crate::repos::create(pool, &json!({"name": dir_name, "path": target.to_string_lossy()}))?;
	Ok(json!({"ok": true, "repo": repo}))
}

/// initRepo — 빈 폴더 새로 만들고 git init → 레포로 등록.
pub fn init_repo(pool: &Pool, parent_path: &str, name: &str) -> anyhow::Result<Value> {
	if parent_path.is_empty() {
		return Ok(json!({"ok": false, "error": "대상 폴더가 필요합니다."}));
	}
	if name.trim().is_empty() {
		return Ok(json!({"ok": false, "error": "프로젝트 이름이 필요합니다."}));
	}
	let target = std::path::Path::new(parent_path).join(name.trim());
	if target.exists() {
		return Ok(json!({"ok": false, "error": format!("이미 존재하는 폴더: {}", target.display())}));
	}
	if let Err(e) = std::fs::create_dir_all(&target) {
		return Ok(json!({"ok": false, "error": format!("폴더 생성 실패: {e}")}));
	}
	if let Err(e) = git(&["init"], &target) {
		return Ok(json!({"ok": false, "error": format!("git init 실패: {e}")}));
	}
	let repo = crate::repos::create(pool, &json!({"name": name.trim(), "path": target.to_string_lossy()}))?;
	Ok(json!({"ok": true, "repo": repo}))
}
