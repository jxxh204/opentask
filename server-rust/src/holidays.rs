// holidays.rs — app/server/holidays.cjs 이식. 200여개 국가·음력/대체공휴일 규칙을 Rust로 다시
// 구현하지 않는다(나라마다 규칙이 다르고 자주 바뀜 — 직접 하드코딩하면 매번 놓치기 쉽다는 게 원본의
// 명시적 설계 근거). 대신 이미 설치된 date-holidays npm 패키지를 그대로 재사용하는 얇은 Node CLI
// 쉼(§ app/server/holidays-cli.cjs)을 subprocess로 호출한다 — scheduler.rs가 아직 Node 쪽
// mcpControl.cjs를 그대로 가리키는 것과 같은 하이브리드 패턴.
use serde_json::Value;

fn cli_path() -> std::path::PathBuf {
	std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("app").join("server").join("holidays-cli.cjs")
}

async fn run_node(args: &[&str]) -> Result<Value, String> {
	let script = cli_path();
	let output = tokio::time::timeout(std::time::Duration::from_millis(10000), tokio::process::Command::new("node").arg(&script).args(args).output())
		.await
		.map_err(|_| "timeout".to_string())?
		.map_err(|e| e.to_string())?;
	if !output.status.success() {
		return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
	}
	serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

pub async fn list_countries() -> Result<Value, String> {
	run_node(&["countries"]).await
}

pub async fn get_holidays(country: &str, years: &[i32]) -> Result<Value, String> {
	let mut args: Vec<String> = vec!["holidays".to_string(), country.to_string()];
	args.extend(years.iter().map(|y| y.to_string()));
	let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
	run_node(&args_ref).await
}
