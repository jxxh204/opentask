#!/usr/bin/env node
// mcpControl.cjs — "관제" 에이전트 전용 로컬 MCP 서버(§control.cjs). mcpDispatch.cjs(지휘자 전용,
// 서브태스크 dispatch)와 같은 발상·같은 구현 패턴(공식 SDK, stdio, Claude Code가 세션마다 직접
// spawn)이지만 대상이 다르다 — 폴더 하나가 아니라 OpenTask 앱 전체(캘린더/크론잡/운영 설정).
// 등록: control.cjs의 registerControlMcp()가 세션을 띄우기 직전 ~/.claude.json에 등록.
'use strict'
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')

const PORT = process.env.OPENTASK_PORT || process.env.OPENRM_PORT || 8770
const IS_CONTROL = process.env.OPENTASK_CONTROL === '1'
// 비밀값(토큰/연결문자열/서명키)이 걸린 커넥터는 이 툴로 못 건드리게 화이트리스트로 막는다 — 관제
// 에이전트가 프롬프트 인젝션이나 실수로 GitHub 토큰·DB 연결문자열을 읽거나 덮어쓰는 사고를 막기
// 위함(§control.cjs controlSeed에도 이 제약을 사람이 읽는 문장으로 명시). 그 값들은 설정 화면에서
// 사람이 직접 넣어야 한다.
const SAFE_CONNECTORS = new Set(['paths', 'app', 'aws', 'vitals', 'deploy', 'terminal'])

async function apiGet(path) {
	const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
	return res.json()
}
async function apiPost(path, body) {
	const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body || {}),
	})
	return res.json()
}
async function apiPatch(path, body) {
	const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body || {}),
	})
	return res.json()
}
async function apiDelete(path) {
	const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'DELETE' })
	return res.json()
}
function requireControl() {
	if (IS_CONTROL) return null
	return { content: [{ type: 'text', text: 'OPENTASK_CONTROL이 설정되지 않았습니다 — 이 MCP 서버는 하이브마인드 세션 전용입니다.' }], isError: true }
}
function ok(data) {
	return { content: [{ type: 'text', text: JSON.stringify(data) }], isError: data && data.ok === false }
}

const server = new McpServer({ name: 'opentask-control', version: '1.0.0' })

server.registerTool(
	'list_tasks',
	{ title: '전체 보드 조회', description: '모든 폴더(태스크)·서브태스크·마감일(캘린더 날짜)을 조회한다.', inputSchema: {} },
	async () => {
		const guard = requireControl()
		if (guard) return guard
		return ok(await apiGet('/api/sessions/board'))
	},
)

server.registerTool(
	'reschedule_task',
	{
		title: '태스크 마감일 변경',
		description: '태스크의 마감일(캘린더 날짜)을 바꾼다. dueDate는 로컬 자정 epoch ms 또는 "YYYY-MM-DD"(자동 변환). null이면 마감일 제거.',
		inputSchema: { taskId: z.string(), dueDate: z.union([z.string(), z.number(), z.null()]) },
	},
	async ({ taskId, dueDate }) => {
		const guard = requireControl()
		if (guard) return guard
		const ms = typeof dueDate === 'string' ? new Date(dueDate + 'T00:00:00').getTime() : dueDate
		return ok(await apiPatch(`/api/tasks/${taskId}`, { dueDate: ms }))
	},
)

server.registerTool(
	'create_task',
	{
		title: '태스크 생성',
		description: '새 태스크를 만든다(일감함/inbox에 들어감 — 아직 오케스트레이션 시작 전). 바로 시작까지 하려면 이어서 start_task를 불러라. 레포 자동 분류는 없다(과거에 검증 없는 LLM 추론으로 엉뚱한 레포에 배정되는 사고가 있어 꺼짐) — repoId를 안 넘기면 start_task 이후 서브태스크가 레포 없이 오케스트레이션을 시도하다 막힌다. 사람이 어느 레포인지 모르면 반드시 먼저 물어봐라.',
		inputSchema: {
			name: z.string(),
			desc: z.string().optional(),
			dueDate: z.union([z.string(), z.number(), z.null()]).optional().describe('"YYYY-MM-DD" 또는 epoch ms'),
			repoId: z.string().optional(),
		},
	},
	async ({ name, desc, dueDate, repoId }) => {
		const guard = requireControl()
		if (guard) return guard
		const ms = typeof dueDate === 'string' ? new Date(dueDate + 'T00:00:00').getTime() : dueDate
		return ok(await apiPost('/api/tasks', { folderId: null, name, desc, dueDate: ms, repoId }))
	},
)

server.registerTool(
	'update_task',
	{
		title: '태스크 상세정보 수정',
		description: '태스크의 이름/설명/진행방식(kind)/시작프롬프트/레포/마감일/기간/색상을 수정한다. 필요한 필드만 넘기면 된다.',
		inputSchema: {
			taskId: z.string(),
			name: z.string().optional(),
			desc: z.string().optional(),
			kind: z.enum(['single', 'chain', 'parallel']).optional(),
			startPrompt: z.string().nullable().optional(),
			repoId: z.string().nullable().optional(),
			dueDate: z.union([z.string(), z.number(), z.null()]).optional(),
			durationDays: z.number().nullable().optional().describe('영업일 기준 소요 기간'),
			color: z.string().nullable().optional().describe('캘린더 배경색(hex, 예: "#3b82f6"). null이면 기본 배경으로 해제'),
		},
	},
	async ({ taskId, dueDate, ...patch }) => {
		const guard = requireControl()
		if (guard) return guard
		const ms = typeof dueDate === 'string' ? new Date(dueDate + 'T00:00:00').getTime() : dueDate
		return ok(await apiPatch(`/api/tasks/${taskId}`, dueDate !== undefined ? { ...patch, dueDate: ms } : patch))
	},
)

server.registerTool('delete_task', { title: '태스크 삭제', description: '태스크를 삭제한다. 되돌릴 수 없다 — 확실할 때만.', inputSchema: { taskId: z.string() } }, async ({ taskId }) => {
	const guard = requireControl()
	if (guard) return guard
	return ok(await apiDelete(`/api/tasks/${taskId}`))
})

// "여기 들어가는 정보들이 여러 단계에서 적용되어야할것같은데 서브태스크, 메인태스크, 하이브마인드가
// 만들어갈 수 있도록" — 현황판(StatusBoard)의 검증 자료는 서브태스크(§ orchestrator.cjs
// reportSubtaskVerify)·태스크 매니저(§ mcpDispatch.cjs report_task_verify) 다음으로, 대표(너)가
// ${operator}와 직접 대화하며 확인한 것도 보고할 수 있어야 한다 — 예: 사람이 보여준 스크린샷을 보고
// 판단했거나, 리포트를 직접 읽고 확인 방법을 정리했거나.
server.registerTool(
	'report_task_verify',
	{
		title: '태스크 검증 자료 보고',
		description:
			'이 태스크를 사람이 눈으로 확인할 방법을 현황판(StatusBoard)에 보고한다 — 로컬서버 URL, 스크린샷 경로, 확인용 명령어나 로그 위치 등(웹 화면이 아니어도 된다). 다시 부르면 최신 내용으로 덮어쓴다.',
		inputSchema: {
			taskId: z.string(),
			text: z.string().describe('어떻게 확인하면 되는지 한두 문장'),
			url: z.string().optional().describe('접속 가능한 URL이 있으면, 없으면 생략'),
		},
	},
	async ({ taskId, text, url }) => {
		const guard = requireControl()
		if (guard) return guard
		return ok(await apiPost(`/api/tasks/${taskId}/verify`, { text, url, source: 'hivemind' }))
	},
)

// 서브태스크 — 태스크 하나를 개발/개발자테스트/QA/배포처럼 단계로 쪼갠 것(list_tasks가 돌려주는
// 각 태스크의 subtasks 배열 참고). "태스크 시작"이 폴더 안에 태스크를 늘어놓는 것과는 다른 개념 —
// 이건 태스크 하나 밑에 딸린 하위 항목이다. 자기만의 예정일/기간/설명을 갖고 캘린더에도 따로 뜬다.
// 실제 워크트리+클로드 세션을 띄우는 "개발 시작"/"다음 단계로"는 이 툴셋에 없다 — 그건 무거운 동작이라
// 태스크 상세페이지에서 사람이 직접 누르거나 해당 태스크의 지휘자에게 맡긴다.
server.registerTool(
	'create_subtask',
	{
		title: '서브태스크 생성',
		// "이 단위로 안 하고있는데? 태스크 매니저는?" — 예전엔 여기 "개발/QA/배포 단계"로 쪼개라고
		// 돼 있어서, 태스크 매니저(§ mcpDispatch.cjs create_subtask)가 쓰는 "커밋·PR 가능한 단위"
		// (§ prompts.cjs workUnits) 기준과 서로 달랐다 — 같은 앱 안에서 서브태스크를 만드는 기준이
		// 어디서 만드느냐에 따라 달라지는 건 이상하다. 하나로 통일한다.
		description: '태스크 하나를 실제로 처리할 서브태스크로 쪼갠다. 기준은 개수가 아니라 "각각 독립적으로 커밋·PR 가능한 단위인가"다 — 그 자체로 완결된 작은 업무 단위로 나눠라(예: "결제 API 연동", "웹뷰 호스트 화면 구현"). 개발/개발자테스트/QA/배포 같은 파이프라인 단계로 쪼개거나 너무 잘게 나누지 마라. 각 서브태스크는 자기만의 설명·예정일·기간을 갖고 캘린더에 독립적으로 표시된다.',
		inputSchema: {
			taskId: z.string(),
			name: z.string(),
			desc: z.string().optional(),
			dueDate: z.union([z.string(), z.number(), z.null()]).optional().describe('"YYYY-MM-DD" 또는 epoch ms'),
			durationDays: z.number().optional().describe('영업일 기준'),
		},
	},
	async ({ taskId, dueDate, ...rest }) => {
		const guard = requireControl()
		if (guard) return guard
		const ms = typeof dueDate === 'string' ? new Date(dueDate + 'T00:00:00').getTime() : dueDate
		return ok(await apiPost(`/api/tasks/${taskId}/subtasks`, { ...rest, dueDate: ms }))
	},
)

server.registerTool(
	'update_subtask',
	{
		title: '서브태스크 수정',
		description: '서브태스크의 이름/설명/예정일/기간을 수정한다.',
		inputSchema: {
			subtaskId: z.string(),
			name: z.string().optional(),
			desc: z.string().optional(),
			dueDate: z.union([z.string(), z.number(), z.null()]).optional(),
			durationDays: z.number().nullable().optional(),
		},
	},
	async ({ subtaskId, dueDate, ...patch }) => {
		const guard = requireControl()
		if (guard) return guard
		const ms = typeof dueDate === 'string' ? new Date(dueDate + 'T00:00:00').getTime() : dueDate
		return ok(await apiPatch(`/api/subtasks/${subtaskId}`, dueDate !== undefined ? { ...patch, dueDate: ms } : patch))
	},
)

server.registerTool('delete_subtask', { title: '서브태스크 삭제', description: '서브태스크를 삭제한다.', inputSchema: { subtaskId: z.string() } }, async ({ subtaskId }) => {
	const guard = requireControl()
	if (guard) return guard
	return ok(await apiDelete(`/api/subtasks/${subtaskId}`))
})

// 일정 막기 — 태스크가 아니라 캘린더 자체의 제약(QA 기간 등). 그 기간의 모든 날짜가 캘린더에
// 줄무늬로 표시된다. 겹치는 기존 일정은 서버가 자동으로 그 기간만큼 뒤로 밀어준다.
server.registerTool('list_blocked_periods', { title: '일정 막기 목록', description: '등록된 캘린더 차단 기간(예: QA 기간) 전체를 조회한다.', inputSchema: {} }, async () => {
	const guard = requireControl()
	if (guard) return guard
	return ok(await apiGet('/api/blocked-periods'))
})

server.registerTool(
	'create_blocked_period',
	{
		title: '일정 막기 생성',
		description:
			'캘린더에 차단 기간을 만든다(예: "QA 기간"). 이 기간과 겹치는 기존 태스크/서브태스크 일정은 서버가 자동으로 이 기간의 길이만큼 뒤로 밀어준다.',
		inputSchema: { name: z.string().describe('막는 이유(예: "QA 기간")'), startDate: z.union([z.string(), z.number()]), endDate: z.union([z.string(), z.number()]) },
	},
	async ({ name, startDate, endDate }) => {
		const guard = requireControl()
		if (guard) return guard
		const toMs = (v) => (typeof v === 'string' ? new Date(v + 'T00:00:00').getTime() : v)
		return ok(await apiPost('/api/blocked-periods', { name, startDate: toMs(startDate), endDate: toMs(endDate) }))
	},
)

server.registerTool('delete_blocked_period', { title: '일정 막기 삭제', description: '캘린더 차단 기간을 삭제한다(이미 밀린 일정은 되돌아가지 않는다).', inputSchema: { id: z.string() } }, async ({ id }) => {
	const guard = requireControl()
	if (guard) return guard
	return ok(await apiDelete(`/api/blocked-periods/${id}`))
})

server.registerTool(
	'start_task',
	{
		title: '태스크 시작(폴더 승격 + 오케스트레이션 개시)',
		description:
			'일감함(inbox)에 있는 태스크를 실제로 착수시킨다 — 그 태스크 이름으로 폴더를 만들고, 태스크를 그 폴더의 첫 서브태스크로 옮긴 뒤, 오케스트레이션(지휘자 세션)을 시작한다. 사이드바 "시작" 버튼과 동일한 동작.',
		inputSchema: { taskId: z.string(), taskName: z.string().describe('폴더 이름으로 쓸 이름 — 보통 태스크 이름과 동일') },
	},
	async ({ taskId, taskName }) => {
		const guard = requireControl()
		if (guard) return guard
		const folder = await apiPost('/api/folders', { name: taskName })
		if (!folder || folder.ok === false) return ok({ ok: false, error: 'folder 생성 실패', detail: folder })
		const moved = await apiPatch(`/api/tasks/${taskId}`, { folderId: folder.id })
		if (moved && moved.ok === false) return ok(moved)
		const started = await apiPost(`/api/folders/${folder.id}/orchestrate/start`)
		return ok({ ok: true, folderId: folder.id, orchestration: started })
	},
)

// "하이브마인드 전체 운영 모드... 전체 태스크 그래프를 그리고 태스크 업무 방향성 확인과 지시" — 지금까지
// 하이브마인드는 태스크를 만들고 일정을 바꿀 순 있어도, 이미 돌고 있는 지휘자(태스크 매니저) 세션에
// 직접 말을 걸 수단이 없었다(그건 각 폴더 지휘자 자신의 도구였다). orchestrator.cjs의 conductorTell —
// 사람이 지휘자에게 직접 말 거는 것과 같은 경로(§ conductorSay/notifyConductor와 대칭인 세 번째 다리)를
// 그대로 재사용한다.
server.registerTool(
	'dispatch_to_task',
	{
		title: '태스크 지휘자에게 지시',
		description:
			'이미 시작된(폴더로 승격된) 태스크의 지휘자(태스크 매니저) 세션에 직접 지시를 전달한다. 운영 모드에서 방향 수정·재촉·막힘 해소 지시에 쓴다. 아직 시작 안 된 태스크(일감함)엔 지휘자가 없어 쓸 수 없다 — 먼저 start_task로 착수시켜라.',
		inputSchema: { taskId: z.string(), text: z.string().describe('지휘자에게 전달할 지시 내용') },
	},
	async ({ taskId, text }) => {
		const guard = requireControl()
		if (guard) return guard
		const board = await apiGet('/api/sessions/board')
		const folder = (board.folders || []).find((f) => (f.tasks || []).some((t) => t.id === taskId))
		if (!folder) {
			return { content: [{ type: 'text', text: '이 태스크의 지휘자를 찾을 수 없습니다 — 아직 시작(start_task) 전이거나 존재하지 않는 태스크입니다.' }], isError: true }
		}
		return ok(await apiPost(`/api/folders/${folder.id}/conductor/tell`, { text }))
	},
)

server.registerTool('list_cron_jobs', { title: '크론잡 목록', description: '등록된 자동화(크론잡) 전체를 조회한다.', inputSchema: {} }, async () => {
	const guard = requireControl()
	if (guard) return guard
	return ok(await apiGet('/api/cron-jobs'))
})

server.registerTool(
	'create_cron_job',
	{
		title: '크론잡 생성',
		description:
			'새 자동화를 만든다. scheduleType: interval(분 단위)/daily/weekly. actionType: "create_task"(정해진 태스크를 그대로 생성 — actionJson: {"name":"9시 배포","desc":"","repoId":null})' +
			' 또는 "run_instruction"(사람이 미리 써둔 자연어 지시를 그 시각에 그대로 실행 — actionJson: {"instruction":"이번 주 완료 안 된 서브태스크를 다음 주로 재스케줄해줘"}, 매번 이 문장 그대로 실행되고' +
			' AI가 즉흥적으로 범위를 넓히지 않는다). scheduleJson/actionJson은 각각 그 형식에 맞는 JSON 문자열 — 이 함수 안에서 파싱해 서버로 보낸다.',
		inputSchema: {
			name: z.string(),
			scheduleType: z.enum(['interval', 'daily', 'weekly']),
			scheduleJson: z.string().describe('예: {"hour":9,"minute":0} 또는 {"minutes":30}'),
			actionType: z.enum(['create_task', 'run_instruction']).optional().describe('미지정 시 create_task'),
			actionJson: z.string().describe('actionType에 맞는 JSON 문자열 — 위 설명 참고'),
		},
	},
	async ({ name, scheduleType, scheduleJson, actionType, actionJson }) => {
		const guard = requireControl()
		if (guard) return guard
		let schedule, action
		try {
			schedule = JSON.parse(scheduleJson)
			action = JSON.parse(actionJson)
		} catch (e) {
			return ok({ ok: false, error: 'scheduleJson/actionJson 파싱 실패: ' + (e && e.message) })
		}
		return ok(await apiPost('/api/cron-jobs', { name, scheduleType, schedule, actionType, action }))
	},
)

server.registerTool(
	'update_cron_job',
	{
		title: '크론잡 수정',
		description: '기존 크론잡을 수정하거나 켜기/끄기(enabled)한다. scheduleJson/actionJson은 JSON 문자열 — 이 함수 안에서 파싱해 서버로 보낸다(actionJson을 바꾸면 actionType도 같이 넘겨야 함).',
		inputSchema: {
			id: z.string(),
			name: z.string().optional(),
			enabled: z.boolean().optional(),
			scheduleType: z.enum(['interval', 'daily', 'weekly']).optional(),
			scheduleJson: z.string().optional(),
			actionType: z.enum(['create_task', 'run_instruction']).optional(),
			actionJson: z.string().optional(),
		},
	},
	async ({ id, scheduleJson, actionJson, ...patch }) => {
		const guard = requireControl()
		if (guard) return guard
		try {
			if (scheduleJson !== undefined) patch.schedule = JSON.parse(scheduleJson)
			if (actionJson !== undefined) patch.action = JSON.parse(actionJson)
		} catch (e) {
			return ok({ ok: false, error: 'scheduleJson/actionJson 파싱 실패: ' + (e && e.message) })
		}
		return ok(await apiPatch(`/api/cron-jobs/${id}`, patch))
	},
)

server.registerTool('delete_cron_job', { title: '크론잡 삭제', description: '크론잡을 삭제한다.', inputSchema: { id: z.string() } }, async ({ id }) => {
	const guard = requireControl()
	if (guard) return guard
	return ok(await apiDelete(`/api/cron-jobs/${id}`))
})

server.registerTool('run_cron_job_now', { title: '크론잡 즉시 실행', description: '스케줄을 기다리지 않고 지금 바로 한 번 실행한다.', inputSchema: { id: z.string() } }, async ({ id }) => {
	const guard = requireControl()
	if (guard) return guard
	return ok(await apiPost(`/api/cron-jobs/${id}/run-now`))
})

server.registerTool(
	'read_settings',
	{ title: '설정 조회', description: '현재 운영 설정(경로/앱/배포 등)과 등록된 비밀값의 키 이름(값 자체는 아님)을 조회한다.', inputSchema: {} },
	async () => {
		const guard = requireControl()
		if (guard) return guard
		return ok(await apiGet('/api/setup/status'))
	},
)

server.registerTool(
	'update_setting',
	{
		title: '설정 변경',
		description: `운영 설정을 바꾼다. connectorId는 다음 중 하나만 허용: ${[...SAFE_CONNECTORS].join(', ')}. GitHub 토큰/DB 연결문자열처럼 비밀값이 걸린 커넥터(github/db/slackSign)는 여기서 못 건드린다 — 안전장치.`,
		inputSchema: { connectorId: z.string(), fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) },
	},
	async ({ connectorId, fields }) => {
		const guard = requireControl()
		if (guard) return guard
		if (!SAFE_CONNECTORS.has(connectorId)) {
			return { content: [{ type: 'text', text: `connectorId "${connectorId}"는 허용되지 않습니다(비밀값 보호). 허용: ${[...SAFE_CONNECTORS].join(', ')}` }], isError: true }
		}
		return ok(await apiPost(`/api/setup/connectors/${connectorId}`, { fields }))
	},
)

const transport = new StdioServerTransport()
server.connect(transport).catch((e) => {
	console.error('[opentask-control] MCP 서버 시작 실패:', (e && e.stack) || e)
	process.exit(1)
})
