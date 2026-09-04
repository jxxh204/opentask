// bin/mcp_control.rs — app/server/mcpControl.cjs 이식. "관제"(하이브마인드) 전용 로컬 MCP 서버.
// Node판은 모든 툴이 로컬 HTTP(apiGet/apiPost/...)로 이미 떠 있는 서버를 호출하지만, 여기선 그럴
// 필요 없이 이미 포팅된 Rust 모듈(tasks::create 등)을 같은 프로세스 안에서 직접 호출한다 — 별도 HTTP
// 클라이언트 의존성도 없고, 왕복 지연도 없다. DB는 메인 서버와 같은 OPENRM_DATA_DIR을 직접 연다
// (SQLite WAL이라 동시 접근 안전).
//
// 포팅 범위: list_tasks, reschedule_task, create_task, update_task, delete_task, create_subtask,
// update_subtask, delete_subtask, list_blocked_periods, create_blocked_period, delete_blocked_period,
// list_cron_jobs, create_cron_job, update_cron_job, delete_cron_job, run_cron_job_now.
// 스텁(오케스트레이터/설정 모듈 미포팅이라 "아직 없음" 에러 반환): report_task_verify, start_task,
// dispatch_to_task, read_settings, update_setting.
use opentask_server::{blocked_periods, cron_jobs, db, folders, scheduler, subtasks, tasks};

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};
use rmcp::{tool, tool_handler, tool_router, transport::io::stdio, ErrorData, ServerHandler, ServiceExt};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

// ── 날짜 입력 — Node의 z.union([z.string(), z.number(), z.null()]) 대응. "YYYY-MM-DD"는 로컬
// 자정 epoch ms로 변환(§원본 `new Date(v + 'T00:00:00').getTime()`과 동일 규칙).
#[derive(Deserialize, JsonSchema)]
#[serde(untagged)]
enum DateInput {
	Str(String),
	Num(i64),
}
fn date_to_ms(d: &DateInput) -> Option<i64> {
	match d {
		DateInput::Num(n) => Some(*n),
		DateInput::Str(s) => {
			use chrono::{Local, NaiveDate, TimeZone};
			let date = NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
			let dt = date.and_hms_opt(0, 0, 0)?;
			Local.from_local_datetime(&dt).single().map(|d| d.timestamp_millis())
		}
	}
}

#[derive(Clone)]
struct ControlServer {
	pool: db::Pool,
	tool_router: ToolRouter<ControlServer>,
}

fn ok(data: Value) -> Result<CallToolResult, ErrorData> {
	let is_error = data.get("ok") == Some(&Value::Bool(false));
	let text = data.to_string();
	Ok(if is_error { CallToolResult::error(vec![ContentBlock::text(text)]) } else { CallToolResult::success(vec![ContentBlock::text(text)]) })
}
fn not_available(reason: &str) -> Result<CallToolResult, ErrorData> {
	Ok(CallToolResult::error(vec![ContentBlock::text(format!(
		"이 툴은 아직 Rust 백엔드에 없습니다({reason}) — Node 백엔드(mcpControl.cjs)를 쓰는 세션에서만 동작합니다."
	))]))
}

fn require_control() -> Result<(), CallToolResult> {
	if std::env::var("OPENTASK_CONTROL").as_deref() == Ok("1") {
		Ok(())
	} else {
		Err(CallToolResult::error(vec![ContentBlock::text(
			"OPENTASK_CONTROL이 설정되지 않았습니다 — 이 MCP 서버는 하이브마인드 세션 전용입니다.",
		)]))
	}
}

macro_rules! guard {
	() => {
		if let Err(e) = require_control() {
			return Ok(e);
		}
	};
}

#[derive(Deserialize, JsonSchema, Default)]
struct Empty {}

#[derive(Deserialize, JsonSchema)]
struct RescheduleTaskParams {
	task_id: String,
	due_date: Option<DateInput>,
}

#[derive(Deserialize, JsonSchema)]
struct CreateTaskParams {
	name: String,
	desc: Option<String>,
	due_date: Option<DateInput>,
	repo_id: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateTaskParams {
	task_id: String,
	name: Option<String>,
	desc: Option<String>,
	kind: Option<String>,
	start_prompt: Option<String>,
	repo_id: Option<String>,
	due_date: Option<DateInput>,
	duration_days: Option<i64>,
	color: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct TaskIdParams {
	task_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateSubtaskParams {
	task_id: String,
	name: String,
	desc: Option<String>,
	due_date: Option<DateInput>,
	duration_days: Option<i64>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateSubtaskParams {
	subtask_id: String,
	name: Option<String>,
	desc: Option<String>,
	due_date: Option<DateInput>,
	duration_days: Option<i64>,
}

#[derive(Deserialize, JsonSchema)]
struct SubtaskIdParams {
	subtask_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateBlockedPeriodParams {
	name: String,
	start_date: DateInput,
	end_date: DateInput,
}

#[derive(Deserialize, JsonSchema)]
struct IdParams {
	id: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateCronJobParams {
	name: String,
	schedule_type: String,
	schedule_json: String,
	action_type: Option<String>,
	action_json: String,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateCronJobParams {
	id: String,
	name: Option<String>,
	enabled: Option<bool>,
	schedule_type: Option<String>,
	schedule_json: Option<String>,
	action_type: Option<String>,
	action_json: Option<String>,
}

#[tool_router]
impl ControlServer {
	fn new(pool: db::Pool) -> Self {
		Self { pool, tool_router: Self::tool_router() }
	}

	#[tool(name = "list_tasks", description = "모든 폴더(태스크)·서브태스크·마감일(캘린더 날짜)을 조회한다.")]
	async fn list_tasks(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let folders_list = folders::list(&self.pool).map_err(internal_err)?;
		let board = tasks::board(&self.pool, folders_list).map_err(internal_err)?;
		ok(board)
	}

	#[tool(
		name = "reschedule_task",
		description = "태스크의 마감일(캘린더 날짜)을 바꾼다. due_date는 로컬 자정 epoch ms 또는 \"YYYY-MM-DD\"(자동 변환). 생략하면 마감일 제거."
	)]
	async fn reschedule_task(&self, Parameters(p): Parameters<RescheduleTaskParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let ms = p.due_date.as_ref().and_then(date_to_ms);
		let patch = json!({"dueDate": ms});
		let r = tasks::update(&self.pool, &p.task_id, &patch).map_err(internal_err)?;
		ok(r.unwrap_or(json!({"ok": false, "error": "not found"})))
	}

	#[tool(
		name = "create_task",
		description = "새 태스크를 만든다(일감함/inbox에 들어감 — 아직 오케스트레이션 시작 전). 레포 자동 분류는 없다 — repo_id를 모르면 사람에게 먼저 물어봐라."
	)]
	async fn create_task(&self, Parameters(p): Parameters<CreateTaskParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let ms = p.due_date.as_ref().and_then(date_to_ms);
		let input = json!({"folderId": Value::Null, "name": p.name, "desc": p.desc, "dueDate": ms, "repoId": p.repo_id});
		let created = tasks::create(&self.pool, &input).and_then(|v| tasks::compose_task(&self.pool, v)).map_err(internal_err)?;
		ok(created)
	}

	#[tool(name = "update_task", description = "태스크의 이름/설명/진행방식(kind)/시작프롬프트/레포/마감일/기간/색상을 수정한다. 필요한 필드만 넘기면 된다.")]
	async fn update_task(&self, Parameters(p): Parameters<UpdateTaskParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let mut patch = json!({});
		if let Some(v) = &p.name {
			patch["name"] = json!(v);
		}
		if let Some(v) = &p.desc {
			patch["desc"] = json!(v);
		}
		if let Some(v) = &p.kind {
			patch["kind"] = json!(v);
		}
		if let Some(v) = &p.start_prompt {
			patch["startPrompt"] = json!(v);
		}
		if let Some(v) = &p.repo_id {
			patch["repoId"] = json!(v);
		}
		if let Some(d) = &p.due_date {
			patch["dueDate"] = json!(date_to_ms(d));
		}
		if let Some(v) = p.duration_days {
			patch["durationDays"] = json!(v);
		}
		if let Some(v) = &p.color {
			patch["color"] = json!(v);
		}
		let r = tasks::update(&self.pool, &p.task_id, &patch).map_err(internal_err)?;
		match r {
			Some(row) => ok(tasks::compose_task(&self.pool, row).map_err(internal_err)?),
			None => ok(json!({"ok": false, "error": "not found"})),
		}
	}

	#[tool(name = "delete_task", description = "태스크를 삭제한다. 되돌릴 수 없다 — 확실할 때만.")]
	async fn delete_task(&self, Parameters(p): Parameters<TaskIdParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		ok(tasks::remove(&self.pool, &p.task_id).map_err(internal_err)?)
	}

	#[tool(
		name = "create_subtask",
		description = "태스크 하나를 실제로 처리할 서브태스크로 쪼갠다. 기준은 \"각각 독립적으로 커밋·PR 가능한 단위인가\" — 파이프라인 단계(개발/QA/배포)로 쪼개지 마라."
	)]
	async fn create_subtask(&self, Parameters(p): Parameters<CreateSubtaskParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let ms = p.due_date.as_ref().and_then(date_to_ms);
		let input = json!({"taskId": p.task_id, "name": p.name, "desc": p.desc, "dueDate": ms, "durationDays": p.duration_days});
		let created = subtasks::create(&self.pool, &input).map_err(internal_err)?;
		tasks::recompute_from_subtasks(&self.pool, &p.task_id).map_err(internal_err)?;
		ok(created)
	}

	#[tool(name = "update_subtask", description = "서브태스크의 이름/설명/예정일/기간을 수정한다.")]
	async fn update_subtask(&self, Parameters(p): Parameters<UpdateSubtaskParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let mut patch = json!({});
		if let Some(v) = &p.name {
			patch["name"] = json!(v);
		}
		if let Some(v) = &p.desc {
			patch["desc"] = json!(v);
		}
		if let Some(d) = &p.due_date {
			patch["dueDate"] = json!(date_to_ms(d));
		}
		if let Some(v) = p.duration_days {
			patch["durationDays"] = json!(v);
		}
		let r = subtasks::update(&self.pool, &p.subtask_id, &patch).map_err(internal_err)?;
		match r {
			Some(row) => {
				if let Some(task_id) = row["task_id"].as_str() {
					tasks::recompute_from_subtasks(&self.pool, task_id).map_err(internal_err)?;
				}
				ok(row)
			}
			None => ok(json!({"ok": false, "error": "not found"})),
		}
	}

	#[tool(name = "delete_subtask", description = "서브태스크를 삭제한다.")]
	async fn delete_subtask(&self, Parameters(p): Parameters<SubtaskIdParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let existing = subtasks::get(&self.pool, &p.subtask_id).map_err(internal_err)?;
		let r = subtasks::remove(&self.pool, &p.subtask_id).map_err(internal_err)?;
		if let Some(task_id) = existing.and_then(|e| e["task_id"].as_str().map(str::to_string)) {
			tasks::recompute_from_subtasks(&self.pool, &task_id).map_err(internal_err)?;
		}
		ok(r)
	}

	#[tool(name = "list_blocked_periods", description = "등록된 캘린더 차단 기간(예: QA 기간) 전체를 조회한다.")]
	async fn list_blocked_periods(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		guard!();
		ok(json!(blocked_periods::list(&self.pool).map_err(internal_err)?))
	}

	#[tool(
		name = "create_blocked_period",
		description = "캘린더에 차단 기간을 만든다(예: \"QA 기간\"). 겹치는 기존 태스크/서브태스크 일정은 서버가 자동으로 이 기간만큼 뒤로 밀어준다."
	)]
	async fn create_blocked_period(&self, Parameters(p): Parameters<CreateBlockedPeriodParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let start = date_to_ms(&p.start_date);
		let end = date_to_ms(&p.end_date);
		let input = blocked_periods::CreateInput { name: Some(p.name), start_date: start, end_date: end };
		ok(blocked_periods::create(&self.pool, input).map_err(internal_err)?)
	}

	#[tool(name = "delete_blocked_period", description = "캘린더 차단 기간을 삭제한다(이미 밀린 일정은 되돌아가지 않는다).")]
	async fn delete_blocked_period(&self, Parameters(p): Parameters<IdParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		ok(blocked_periods::remove(&self.pool, &p.id).map_err(internal_err)?)
	}

	#[tool(name = "list_cron_jobs", description = "등록된 자동화(크론잡) 전체를 조회한다.")]
	async fn list_cron_jobs(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		guard!();
		ok(json!(cron_jobs::list(&self.pool).map_err(internal_err)?))
	}

	#[tool(
		name = "create_cron_job",
		description = "새 자동화를 만든다. schedule_type: interval(분단위)/daily/weekly. action_type: create_task 또는 run_instruction. schedule_json/action_json은 각 형식에 맞는 JSON 문자열(이 함수 안에서 파싱)."
	)]
	async fn create_cron_job(&self, Parameters(p): Parameters<CreateCronJobParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let (schedule, action) = match (serde_json::from_str::<Value>(&p.schedule_json), serde_json::from_str::<Value>(&p.action_json)) {
			(Ok(s), Ok(a)) => (s, a),
			_ => return ok(json!({"ok": false, "error": "schedule_json/action_json 파싱 실패"})),
		};
		let input = json!({"name": p.name, "scheduleType": p.schedule_type, "schedule": schedule, "actionType": p.action_type, "action": action});
		ok(cron_jobs::create(&self.pool, &input).map_err(internal_err)?)
	}

	#[tool(name = "update_cron_job", description = "기존 크론잡을 수정하거나 켜기/끄기(enabled)한다. action_json을 바꾸면 action_type도 같이 넘겨야 함.")]
	async fn update_cron_job(&self, Parameters(p): Parameters<UpdateCronJobParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let mut patch = json!({});
		if let Some(v) = &p.name {
			patch["name"] = json!(v);
		}
		if let Some(v) = p.enabled {
			patch["enabled"] = json!(v);
		}
		if let Some(v) = &p.schedule_type {
			patch["scheduleType"] = json!(v);
		}
		if let Some(s) = &p.schedule_json {
			match serde_json::from_str::<Value>(s) {
				Ok(v) => patch["schedule"] = v,
				Err(_) => return ok(json!({"ok": false, "error": "schedule_json 파싱 실패"})),
			}
		}
		if let Some(v) = &p.action_type {
			patch["actionType"] = json!(v);
		}
		if let Some(s) = &p.action_json {
			match serde_json::from_str::<Value>(s) {
				Ok(v) => patch["action"] = v,
				Err(_) => return ok(json!({"ok": false, "error": "action_json 파싱 실패"})),
			}
		}
		let r = cron_jobs::update(&self.pool, &p.id, &patch).map_err(internal_err)?;
		ok(r.unwrap_or(json!({"ok": false, "error": "not found"})))
	}

	#[tool(name = "delete_cron_job", description = "크론잡을 삭제한다.")]
	async fn delete_cron_job(&self, Parameters(p): Parameters<IdParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		ok(cron_jobs::remove(&self.pool, &p.id).map_err(internal_err)?)
	}

	#[tool(name = "run_cron_job_now", description = "스케줄을 기다리지 않고 지금 바로 한 번 실행한다.")]
	async fn run_cron_job_now(&self, Parameters(p): Parameters<IdParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		let job = cron_jobs::get(&self.pool, &p.id).map_err(internal_err)?;
		match job {
			Some(j) => {
				scheduler::run_job_public(&self.pool, j).await;
				ok(json!({"ok": true}))
			}
			None => ok(json!({"ok": false, "error": "not found"})),
		}
	}

	#[tool(name = "report_task_verify", description = "(아직 미지원) 태스크 검증 자료를 현황판에 보고한다.")]
	async fn report_task_verify(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("오케스트레이터의 인메모리 상태에 의존")
	}

	#[tool(name = "start_task", description = "(아직 미지원) 태스크 시작(폴더 승격 + 오케스트레이션 개시).")]
	async fn start_task(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("오케스트레이터 미포팅")
	}

	#[tool(name = "dispatch_to_task", description = "(아직 미지원) 태스크 지휘자에게 직접 지시를 전달한다.")]
	async fn dispatch_to_task(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("오케스트레이터 미포팅")
	}

	#[tool(name = "read_settings", description = "(아직 미지원) 운영 설정을 조회한다.")]
	async fn read_settings(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("Setup/AppConfig 모듈 미포팅")
	}

	#[tool(name = "update_setting", description = "(아직 미지원) 운영 설정을 변경한다.")]
	async fn update_setting(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("Setup/AppConfig 모듈 미포팅")
	}
}

fn internal_err(e: anyhow::Error) -> ErrorData {
	ErrorData::internal_error(e.to_string(), None)
}

#[tool_handler]
impl ServerHandler for ControlServer {}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	let data_dir = std::env::var("OPENRM_DATA_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::PathBuf::from(".openrm-rust"));
	let pool = db::open(&data_dir)?;
	let service = ControlServer::new(pool).serve(stdio()).await?;
	service.waiting().await?;
	Ok(())
}
