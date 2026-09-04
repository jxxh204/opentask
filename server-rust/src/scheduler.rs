// scheduler.rs — app/server/scheduler.cjs 이식. Automations 실행 루프(30초 폴링, 서버 켜져 있는
// 동안만 동작 — OS cron/launchd 연동 없음, § 원본 주석과 동일 원칙).
//
// run_instruction 액션은 여전히 app/server/mcpControl.cjs(Node, 미포팅)를 --mcp-config로 그대로
// 가리켜 claude CLI가 그 MCP 서버를 자식 프로세스로 띄우게 한다 — mcpControl.cjs 자체를 Rust로 다시
// 짜지 않고도(그건 훨씬 큰 별도 작업, § MCP 서버 포팅과 동일 스코프) 트리거 메커니즘만 정확히 재현.
use crate::cron_jobs;
use crate::db::Pool;
use crate::tasks;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

const CHECK_INTERVAL: Duration = Duration::from_secs(30);
const RUN_TIMEOUT: Duration = Duration::from_secs(180);

fn claude_bin() -> String {
	std::env::var("OPENRM_CLAUDE_BIN").unwrap_or_else(|_| "claude".to_string())
}

fn mcp_control_path() -> PathBuf {
	std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("app").join("server").join("mcpControl.cjs")
}

async fn run_instruction(job: &Value) -> Result<String, String> {
	let instruction = job["action"].get("instruction").and_then(Value::as_str).unwrap_or("").trim().to_string();
	if instruction.is_empty() {
		return Err("지시문이 비어 있습니다.".to_string());
	}
	let port = std::env::var("OPENRM_PORT").unwrap_or_else(|_| "8770".to_string());
	let mcp_config = json!({
		"mcpServers": {
			"opentask-control": {
				"command": "node",
				"args": [mcp_control_path().to_string_lossy()],
				"env": {"OPENTASK_CONTROL": "1", "OPENTASK_PORT": port},
			}
		}
	})
	.to_string();
	let name = job["name"].as_str().unwrap_or_default();
	let prompt = format!(
		"[자동화 \"{name}\"가 예정된 시각에 트리거됨] 아래 지시를 지금 그대로 실행해라. 사람이 미리 정해둔 지시이니 되묻지 말고, \
새로운 판단이나 범위 확장 없이 지시된 것만 정확히 수행한다. 실행 후 무엇을 했는지 한두 문장으로 간단히 요약해라.\n\n지시: {instruction}"
	);

	let child = Command::new(claude_bin())
		.args([
			"-p",
			&prompt,
			"--mcp-config",
			&mcp_config,
			"--strict-mcp-config",
			"--allowedTools",
			"mcp__opentask-control__*",
			"--permission-mode",
			"bypassPermissions",
			"--output-format",
			"json",
		])
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn();

	let child = match child {
		Ok(c) => c,
		Err(e) => return Err(format!("claude 실행 실패: {e}")),
	};

	let output = match tokio::time::timeout(RUN_TIMEOUT, child.wait_with_output()).await {
		Ok(Ok(o)) => o,
		Ok(Err(e)) => return Err(format!("claude 실행 실패: {e}")),
		Err(_) => return Err("claude 실행 타임아웃(180초)".to_string()),
	};

	if !output.status.success() {
		let err_text = String::from_utf8_lossy(&output.stderr);
		let first_line = err_text.lines().find(|l| !l.trim().is_empty()).unwrap_or("claude 실행 실패");
		return Err(format!("실행 실패: {}", first_line.chars().take(300).collect::<String>()));
	}

	let out_text = String::from_utf8_lossy(&output.stdout).to_string();
	let text = serde_json::from_str::<Value>(&out_text)
		.ok()
		.and_then(|j| j.get("result").or_else(|| j.get("text")).and_then(Value::as_str).map(str::to_string))
		.unwrap_or(out_text);
	let trimmed = text.trim();
	Ok(if trimmed.is_empty() { "(응답 없음)".to_string() } else { trimmed.chars().take(2000).collect() })
}

/// mcp_control.rs의 run_cron_job_now 툴이 "지금 바로 실행"할 때 쓰는 공개 진입점 — tick()과 동일 경로.
pub async fn run_job_public(pool: &Pool, job: Value) {
	run_job(pool, job).await
}

async fn run_job(pool: &Pool, job: Value) {
	let id = job["id"].as_str().unwrap_or_default().to_string();
	let name = job["name"].as_str().unwrap_or_default().to_string();
	let action_type = job["action_type"].as_str().unwrap_or_default();

	let result: Option<String> = match action_type {
		"create_task" => {
			let action = &job["action"];
			let task_input = json!({
				"folderId": Value::Null,
				"name": action.get("name").and_then(Value::as_str).unwrap_or(&name),
				"desc": action.get("desc").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("Automations \"{name}\"에서 자동 생성")),
				"repoId": action.get("repoId").cloned().unwrap_or(Value::Null),
			});
			if let Err(e) = tasks::create(pool, &task_input) {
				tracing::error!("[scheduler] job \"{name}\" create_task 실패: {e}");
			}
			None
		}
		"run_instruction" => match run_instruction(&job).await {
			Ok(r) => Some(r),
			Err(e) => Some(e),
		},
		_ => None,
	};

	if let Err(e) = cron_jobs::mark_ran(pool, &id, result.as_deref()) {
		tracing::error!("[scheduler] job \"{name}\" mark_ran 실패: {e}");
	}
}

async fn tick(pool: &Pool) {
	let now = chrono::Utc::now().timestamp_millis();
	let due = match cron_jobs::due_jobs(pool, now) {
		Ok(v) => v,
		Err(_) => return,
	};
	for job in due {
		run_job(pool, job).await;
	}
}

/// 서버 부팅 시 호출 — 즉시 한 번 tick + 30초 간격 백그라운드 루프 시작.
pub fn start(pool: Pool) {
	tokio::spawn(async move {
		tick(&pool).await;
		let mut interval = tokio::time::interval(CHECK_INTERVAL);
		interval.tick().await; // 첫 tick은 위에서 이미 했으니 한 번 소비
		loop {
			interval.tick().await;
			tick(&pool).await;
		}
	});
}
