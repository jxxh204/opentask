// bin/mcp_dispatch.rs — app/server/mcpDispatch.cjs 이식. 지휘자(conductor) 전용 로컬 MCP 서버 —
// term::trust_folder()가 지휘자 세션을 띄우기 직전 이 바이너리를 ~/.claude.json에 등록한다.
//
// ⚠️ mcp_control.rs와 달리 **HTTP로 메인 서버를 호출한다**(Rust 함수 직접 호출 아님) — 이 서버가 쓰는
// dispatch_subtask/log_event/set_subtask_kind/get_subtask_chain/start_subtask_work/advance_subtask_work
// 전부 오케스트레이터의 인메모리 STATES(폴더별 sessions/feed/blocked/verify)에 의존하는데, 그 상태는
// 메인 서버 프로세스 안에만 존재한다 — 이 바이너리가 자기 프로세스에서 orchestrator 함수를 직접 부르면
// 완전히 별개의(항상 비어있는) STATES를 보게 된다. Node판 mcpDispatch.cjs가 fetch()로 이미 떠 있는
// 서버를 호출하는 것과 정확히 같은 이유로, 여기도 HTTP를 거친다(§ mcpControl.cjs/mcp_control.rs는
// 전부 DB 전용 상태라 이 문제가 없어 직접 호출 그대로 둠).
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};
use rmcp::{tool, tool_handler, tool_router, transport::io::stdio, ErrorData, ServerHandler, ServiceExt};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

fn port() -> String {
	std::env::var("OPENTASK_PORT").or_else(|_| std::env::var("OPENRM_PORT")).unwrap_or_else(|_| "8770".to_string())
}
fn folder_id() -> String {
	std::env::var("OPENTASK_FOLDER_ID").unwrap_or_default()
}
fn base_url() -> String {
	format!("http://127.0.0.1:{}", port())
}

async fn api_post(path: &str, body: &Value) -> Value {
	let client = reqwest::Client::new();
	match client.post(format!("{}{path}", base_url())).json(body).send().await {
		Ok(resp) => resp.json::<Value>().await.unwrap_or(json!({"ok": false, "error": "invalid JSON response"})),
		Err(e) => json!({"ok": false, "error": e.to_string()}),
	}
}
async fn api_get(path: &str) -> Value {
	let client = reqwest::Client::new();
	match client.get(format!("{}{path}", base_url())).send().await {
		Ok(resp) => resp.json::<Value>().await.unwrap_or(json!({"ok": false, "error": "invalid JSON response"})),
		Err(e) => json!({"ok": false, "error": e.to_string()}),
	}
}

fn ok(data: Value) -> Result<CallToolResult, ErrorData> {
	let is_error = data.get("ok") == Some(&Value::Bool(false));
	let text = data.to_string();
	Ok(if is_error { CallToolResult::error(vec![ContentBlock::text(text)]) } else { CallToolResult::success(vec![ContentBlock::text(text)]) })
}

fn not_available(reason: &str) -> Result<CallToolResult, ErrorData> {
	Ok(CallToolResult::error(vec![ContentBlock::text(format!(
		"이 툴은 아직 Rust 백엔드에 없습니다({reason}) — Node 백엔드(mcpDispatch.cjs)를 쓰는 세션에서만 동작합니다."
	))]))
}

fn require_folder() -> Result<(), CallToolResult> {
	if folder_id().is_empty() {
		Err(CallToolResult::error(vec![ContentBlock::text("OPENTASK_FOLDER_ID가 설정되지 않았습니다 — 이 MCP 서버는 지휘자 세션 전용입니다.")]))
	} else {
		Ok(())
	}
}

macro_rules! guard {
	() => {
		if let Err(e) = require_folder() {
			return Ok(e);
		}
	};
}

#[derive(Deserialize, JsonSchema, Default)]
struct Empty {}

#[derive(Deserialize, JsonSchema)]
struct DispatchSubtaskParams {
	task_id: String,
	text: String,
}

#[derive(Deserialize, JsonSchema)]
struct LogEventParams {
	from: String,
	to: String,
	text: String,
	kind: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct SetKindParams {
	task_id: String,
	kind: String,
	reason: String,
}

#[derive(Deserialize, JsonSchema)]
struct CreateSubtaskParams {
	task_id: String,
	name: String,
	desc: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct TaskIdParams {
	task_id: String,
}

#[derive(Deserialize, JsonSchema)]
struct ReportTaskVerifyParams {
	task_id: String,
	text: String,
	url: Option<String>,
}

#[derive(Clone)]
struct DispatchServer {
	tool_router: ToolRouter<DispatchServer>,
}

#[tool_router]
impl DispatchServer {
	fn new() -> Self {
		Self { tool_router: Self::tool_router() }
	}

	#[tool(name = "dispatch_subtask", description = "이 mainTask 산하 \"기존\" subTask 세션에 지시를 전달한다. 새 subTask를 만드는 권한은 없다 — 목록에 있는 taskId에만 지시할 수 있다.")]
	async fn dispatch_subtask(&self, Parameters(p): Parameters<DispatchSubtaskParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		ok(api_post(&format!("/api/folders/{}/conductor/say", folder_id()), &json!({"taskId": p.task_id, "text": p.text})).await)
	}

	#[tool(name = "log_event", description = "지휘자 대화 로그에 이벤트를 기록한다(결과 보고 / 계획 공유용 — 실제 전송은 없음, 기록만).")]
	async fn log_event(&self, Parameters(p): Parameters<LogEventParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		ok(api_post(&format!("/api/folders/{}/conductor/event", folder_id()), &json!({"from": p.from, "to": p.to, "text": p.text, "kind": p.kind})).await)
	}

	#[tool(
		name = "set_subtask_kind",
		description = "⑤ subTask의 진행 방식(kind)을 판단·수정한다. single(기본, 독립 실행) / chain(이전 subTask 산출물 위에 이어서) / parallel(서로 독립적이라 동시에 여러 버전 시도). reason은 필수 — decisions 테이블에 영속 저장된다."
	)]
	async fn set_subtask_kind(&self, Parameters(p): Parameters<SetKindParams>) -> Result<CallToolResult, ErrorData> {
		guard!();
		ok(api_post(&format!("/api/folders/{}/conductor/set-kind", folder_id()), &json!({"taskId": p.task_id, "kind": p.kind, "reason": p.reason})).await)
	}

	#[tool(
		name = "create_subtask",
		description = "이 태스크를 실제로 처리할 서브태스크를 만든다(생성만 — 워크트리·세션은 start_subtask_work가 나중에 띄운다). 기준은 \"각각 독립적으로 커밋·PR 가능한 단위인가\" — 개발/QA/배포 같은 파이프라인 단계로 쪼개지 마라. 보통 2~5개. 여러 번 불러 순서대로 쌓으면 그 순서 그대로 체이닝된다."
	)]
	async fn create_subtask(&self, Parameters(p): Parameters<CreateSubtaskParams>) -> Result<CallToolResult, ErrorData> {
		ok(api_post(&format!("/api/tasks/{}/subtasks", p.task_id), &json!({"name": p.name, "desc": p.desc})).await)
	}

	#[tool(
		name = "get_subtask_chain",
		description = "이 태스크의 서브태스크 체인 전체를 순서대로 보여준다 — 각 서브태스크의 시작 여부, 세션 생존 여부, 워크트리·브랜치. 다음에 뭘 해야 할지 판단하기 전에 먼저 확인해라."
	)]
	async fn get_subtask_chain(&self, Parameters(p): Parameters<TaskIdParams>) -> Result<CallToolResult, ErrorData> {
		ok(api_get(&format!("/api/tasks/{}/subtask-work/state", p.task_id)).await)
	}

	#[tool(
		name = "start_subtask_work",
		description = "이 태스크의 첫 서브태스크에 실제 워크트리+클로드 세션을 만들어 개발을 시작한다. 이미 진행 중인 서브태스크가 있으면 아무것도 새로 만들지 않고(already:true) 그 상태만 알려준다."
	)]
	async fn start_subtask_work(&self, Parameters(p): Parameters<TaskIdParams>) -> Result<CallToolResult, ErrorData> {
		ok(api_post(&format!("/api/tasks/{}/subtask-work/start", p.task_id), &json!({})).await)
	}

	#[tool(
		name = "advance_subtask_work",
		description = "지금 진행 중인 서브태스크를 끝난 것으로 기록하고 다음 서브태스크의 워크트리+세션을 새로 만든다(PR 체이닝). 반드시 현재 서브태스크 세션과 직접 대화해 실제로 작업이 끝났는지 확인한 뒤에만 불러라 — 자동 완료 감지는 없다."
	)]
	async fn advance_subtask_work(&self, Parameters(p): Parameters<TaskIdParams>) -> Result<CallToolResult, ErrorData> {
		ok(api_post(&format!("/api/tasks/{}/subtask-work/advance", p.task_id), &json!({})).await)
	}

	#[tool(
		name = "report_task_verify",
		description = "이 태스크를 사람이 눈으로 확인할 방법을 현황판에 보고한다. 특정 서브태스크 하나가 아니라 태스크 전체를 종합한 관점일 때 쓴다. 확인할 방법이 여러 개면 각각 따로 여러 번 불러라."
	)]
	async fn report_task_verify(&self, Parameters(p): Parameters<ReportTaskVerifyParams>) -> Result<CallToolResult, ErrorData> {
		ok(api_post(&format!("/api/tasks/{}/verify", p.task_id), &json!({"text": p.text, "url": p.url, "source": "conductor"})).await)
	}

	#[tool(name = "browser_open", description = "(아직 미지원) 앱 내부 브라우저를 새 URL로 연다.")]
	async fn browser_open(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("debug/browserPool.cjs(헤드리스 Playwright) 미포팅")
	}
	#[tool(name = "browser_read", description = "(아직 미지원) 브라우저 화면 텍스트를 읽는다.")]
	async fn browser_read(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("debug/browserPool.cjs(헤드리스 Playwright) 미포팅")
	}
	#[tool(name = "browser_click", description = "(아직 미지원) 브라우저 요소를 클릭한다.")]
	async fn browser_click(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("debug/browserPool.cjs(헤드리스 Playwright) 미포팅")
	}
	#[tool(name = "browser_type", description = "(아직 미지원) 브라우저 입력창에 타이핑한다.")]
	async fn browser_type(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("debug/browserPool.cjs(헤드리스 Playwright) 미포팅")
	}
	#[tool(name = "browser_close", description = "(아직 미지원) 브라우저 세션을 닫는다.")]
	async fn browser_close(&self, _: Parameters<Empty>) -> Result<CallToolResult, ErrorData> {
		not_available("debug/browserPool.cjs(헤드리스 Playwright) 미포팅")
	}
}

#[tool_handler]
impl ServerHandler for DispatchServer {}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	let service = DispatchServer::new().serve(stdio()).await?;
	service.waiting().await?;
	Ok(())
}
