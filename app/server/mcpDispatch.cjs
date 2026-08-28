#!/usr/bin/env node
// mcpDispatch.cjs — 지휘자(conductor) 전용 로컬 MCP 서버 (§12 "지휘 방식 개선 — curl-in-prompt → 로컬
// MCP 툴"). server/figma.cjs가 이미 쓰는 로컬 MCP 패턴(Figma Dev Mode MCP, 포트 3845)과 같은 발상 —
// 다만 여기는 HTTP가 아니라 Claude Code가 세션마다 직접 spawn하는 stdio 서버다(공식 SDK 사용, 프로토콜
// 핸드셰이크를 직접 구현하지 않음). 지휘자의 conductorSeed() 프롬프트가 이 툴이 있으면 우선 쓰고,
// 없거나 실패하면 기존 curl 경로로 자동 폴백한다(figma.cjs의 3단계 폴백과 같은 원칙).
//
// 등록: term.cjs의 trustFolder()가 지휘자 세션을 띄우기 직전 ~/.claude.json의
// projects[cwd].mcpServers에 이 파일을 command로 등록하고, OPENTASK_FOLDER_ID/OPENTASK_PORT를
// env로 넘긴다 — 사람이 손댈 일 없이 자동.
'use strict'
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')

const PORT = process.env.OPENTASK_PORT || process.env.OPENRM_PORT || 8770
const FOLDER_ID = process.env.OPENTASK_FOLDER_ID || ''

async function apiPost(path, body) {
	const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body || {}),
	})
	return res.json()
}
async function apiGet(path) {
	const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
	return res.json()
}

function requireFolder() {
	if (FOLDER_ID) return null
	return { content: [{ type: 'text', text: 'OPENTASK_FOLDER_ID가 설정되지 않았습니다 — 이 MCP 서버는 지휘자 세션 전용입니다.' }], isError: true }
}

const server = new McpServer({ name: 'opentask-dispatch', version: '1.0.0' })

server.registerTool(
	'dispatch_subtask',
	{
		title: '서브태스크에 지시',
		description: '이 mainTask 산하 "기존" subTask 세션에 지시를 전달한다. 새 subTask를 만드는 권한은 없다 — 목록에 있는 taskId에만 지시할 수 있다.',
		inputSchema: { taskId: z.string().describe('지시를 받을 subTask의 id'), text: z.string().describe('전달할 지시 내용') },
	},
	async ({ taskId, text }) => {
		const guard = requireFolder()
		if (guard) return guard
		const r = await apiPost(`/api/folders/${FOLDER_ID}/conductor/say`, { taskId, text })
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

server.registerTool(
	'log_event',
	{
		title: '대화 로그 기록',
		description: '지휘자 대화 로그에 이벤트를 기록한다(결과 보고 / 계획 공유용 — 실제 전송은 없음, 기록만).',
		inputSchema: {
			from: z.string(),
			to: z.string(),
			text: z.string(),
			kind: z.enum(['msg', 'plan', 'dispatch', 'result', 'error']).optional(),
		},
	},
	async ({ from, to, text, kind }) => {
		const guard = requireFolder()
		if (guard) return guard
		const r = await apiPost(`/api/folders/${FOLDER_ID}/conductor/event`, { from, to, text, kind })
		return { content: [{ type: 'text', text: JSON.stringify(r) }] }
	},
)

server.registerTool(
	'set_subtask_kind',
	{
		title: 'subTask kind 판단',
		description:
			'⑤ subTask의 진행 방식(kind)을 판단·수정한다. single(기본, 독립 실행) / chain(이전 subTask 산출물 위에 이어서) / parallel(서로 독립적이라 동시에 여러 버전 시도). reason은 필수 — 사람이 나중에 훑어볼 근거로 감사 로그(decisions 테이블)에 영속 저장된다.',
		inputSchema: {
			taskId: z.string(),
			kind: z.enum(['single', 'chain', 'parallel']),
			reason: z.string().describe('왜 이 kind로 판단했는지 한 줄'),
		},
	},
	async ({ taskId, kind, reason }) => {
		const guard = requireFolder()
		if (guard) return guard
		const r = await apiPost(`/api/folders/${FOLDER_ID}/conductor/set-kind`, { taskId, kind, reason })
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

// ── 서브태스크 체이닝 컨트롤 ("메인태스크는 오케스트레이션만... 태스크매니저가 자동으로 컨트롤") ──
// 위 dispatch_subtask/set_subtask_kind는 "폴더 산하 태스크들"(구 모델)을 대상으로 하지만, 실제 코드
// 작업은 이제 항상 태스크 하나의 서브태스크 체인 안에서 일어난다(orchestrator.cjs launchSubtask 등).
// 지휘자는 이 셋으로 그 체인을 직접 시작·확인·진행시킬 수 있다 — 폴더 스코프가 필요 없어 taskId만
// 받는다(자기 산하 태스크의 id는 conductorSeed()가 프롬프트에 이미 알려준다).
server.registerTool(
	'get_subtask_chain',
	{
		title: '서브태스크 체인 상태 확인',
		description: '이 태스크의 서브태스크 체인 전체를 순서대로 보여준다 — 각 서브태스크의 시작 여부, 세션 생존 여부, 워크트리·브랜치. 다음에 뭘 해야 할지(시작할지/진행시킬지) 판단하기 전에 먼저 확인해라.',
		inputSchema: { taskId: z.string() },
	},
	async ({ taskId }) => {
		const r = await apiGet(`/api/tasks/${taskId}/subtask-work/state`)
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

server.registerTool(
	'start_subtask_work',
	{
		title: '서브태스크 체인 시작',
		description: '이 태스크의 첫 서브태스크에 실제 워크트리+클로드 세션을 만들어 개발을 시작한다. 서브태스크가 아직 하나도 없으면(AI 검토 workUnits가 있으면 그걸로, 없으면 태스크 자신으로) 자동 생성한 뒤 시작한다. 이미 진행 중인 서브태스크가 있으면 아무것도 새로 만들지 않고(already:true) 그 상태만 알려준다.',
		inputSchema: { taskId: z.string() },
	},
	async ({ taskId }) => {
		const r = await apiPost(`/api/tasks/${taskId}/subtask-work/start`, {})
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

server.registerTool(
	'advance_subtask_work',
	{
		title: '다음 서브태스크로 진행',
		description: '지금 진행 중인 서브태스크를 끝난 것으로 기록하고 다음 서브태스크의 워크트리+세션을 새로 만든다(브랜치는 직전 서브태스크 위에서 이어감 — PR 체이닝). 반드시 현재 서브태스크 세션과 직접 대화해 실제로 작업이 끝났는지 확인한 뒤에만 불러라 — 자동 완료 감지는 없다. 다음 서브태스크가 없으면 done:true만 돌아온다(태스크 전체 완료).',
		inputSchema: { taskId: z.string() },
	},
	async ({ taskId }) => {
		const r = await apiPost(`/api/tasks/${taskId}/subtask-work/advance`, {})
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

// ── 앱 내부 브라우저 — "태스크 매니저가 앱 내부 브라우저도 자유자재로 이용하면 좋겠어" ──
// 사람이 "브라우저" 탭에서 쓰는 것과 같은 Playwright 세션(server/debug/browserPool.cjs)을 지휘자도
// 직접 열고 조작한다. 이 taskId로 세션을 열면 사람이 그 폴더의 "브라우저" 탭을 여는 순간 같은 세션에
// 그대로 올라타 화면으로 지켜볼 수 있다(§useDebugStore attachIfActive) — 지휘자 전용 headless 세션이
// 아니라 사람과 공유되는 하나의 브라우저다. 지휘자는 스크린샷을 못 보니 browser_read로 텍스트를 읽는다.
let browserSessionId = null

server.registerTool(
	'browser_open',
	{
		title: '앱 내부 브라우저 열기',
		description:
			'이 태스크 전용 브라우저 세션을 새 URL로 연다. 이미 열려 있으면 그 세션을 이 URL로 이동시킨다(세션은 항상 하나만 — 새로 열기 전 자동으로 재사용). 사람이 이 폴더의 "브라우저" 탭을 열면 이 세션이 그대로 보인다.',
		inputSchema: { url: z.string() },
	},
	async ({ url }) => {
		const guard = requireFolder()
		if (guard) return guard
		// 세션 재시작(--continue) 등으로 이 프로세스의 browserSessionId가 비어도, 이 폴더로 이미 떠
		// 있는 세션이 서버 쪽엔 남아있을 수 있다 — 새 Chromium을 또 띄우기 전에 먼저 찾아 재사용한다.
		if (!browserSessionId) {
			const active = await apiGet(`/api/debug/sessions/active?taskId=${encodeURIComponent(FOLDER_ID)}`)
			if (active.ok && active.session) browserSessionId = active.session.id
		}
		if (browserSessionId) {
			const r = await apiPost(`/api/debug/sessions/${browserSessionId}/navigate`, { url })
			if (r.ok !== false) return { content: [{ type: 'text', text: JSON.stringify(r) }] }
			browserSessionId = null // 세션이 이미 죽었으면(사람이 "세션 종료") 새로 연다
		}
		const r = await apiPost('/api/debug/sessions', { url, device: 'pc', taskId: FOLDER_ID, branchId: null })
		if (r.ok) browserSessionId = r.id
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

server.registerTool(
	'browser_read',
	{ title: '브라우저 화면 텍스트 읽기', description: '지금 열려 있는 페이지의 제목·URL·본문 텍스트를 읽는다(스크린샷 대신 — 텍스트로 화면 내용을 파악할 때 쓴다).', inputSchema: {} },
	async () => {
		const guard = requireFolder()
		if (guard) return guard
		if (!browserSessionId) return { content: [{ type: 'text', text: '먼저 browser_open으로 페이지를 열어라.' }], isError: true }
		const r = await apiGet(`/api/debug/sessions/${browserSessionId}/text`)
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

server.registerTool(
	'browser_click',
	{ title: '브라우저 요소 클릭', description: 'CSS 셀렉터로 지정한 요소를 클릭한다.', inputSchema: { selector: z.string() } },
	async ({ selector }) => {
		const guard = requireFolder()
		if (guard) return guard
		if (!browserSessionId) return { content: [{ type: 'text', text: '먼저 browser_open으로 페이지를 열어라.' }], isError: true }
		const r = await apiPost(`/api/debug/sessions/${browserSessionId}/click`, { selector })
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

server.registerTool(
	'browser_type',
	{
		title: '브라우저 입력창에 타이핑',
		description: 'CSS 셀렉터로 지정한 입력창(input/textarea)에 텍스트를 채운다. submit이 true면 입력 후 Enter까지 누른다.',
		inputSchema: { selector: z.string(), text: z.string(), submit: z.boolean().optional() },
	},
	async ({ selector, text, submit }) => {
		const guard = requireFolder()
		if (guard) return guard
		if (!browserSessionId) return { content: [{ type: 'text', text: '먼저 browser_open으로 페이지를 열어라.' }], isError: true }
		const r = await apiPost(`/api/debug/sessions/${browserSessionId}/type`, { selector, text, submit })
		return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false }
	},
)

server.registerTool('browser_close', { title: '브라우저 세션 닫기', description: '더 이상 브라우저가 필요 없을 때 세션을 닫는다(Chromium 프로세스도 정리됨).', inputSchema: {} }, async () => {
	const guard = requireFolder()
	if (guard) return guard
	if (!browserSessionId) return { content: [{ type: 'text', text: JSON.stringify({ ok: true, alreadyGone: true }) }] }
	const id = browserSessionId
	browserSessionId = null
	const res = await fetch(`http://127.0.0.1:${PORT}/api/debug/sessions/${id}`, { method: 'DELETE' })
	return { content: [{ type: 'text', text: JSON.stringify(await res.json()) }] }
})

const transport = new StdioServerTransport()
server.connect(transport).catch((e) => {
	console.error('[opentask-dispatch] MCP 서버 시작 실패:', (e && e.stack) || e)
	process.exit(1)
})
