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

const transport = new StdioServerTransport()
server.connect(transport).catch((e) => {
	console.error('[opentask-dispatch] MCP 서버 시작 실패:', (e && e.stack) || e)
	process.exit(1)
})
