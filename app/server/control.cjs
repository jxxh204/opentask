// control.cjs — "관제" 에이전트: 태스크 하나가 아니라 OpenTask 앱 전체(캘린더 일정, 크론잡, 운영
// 설정)를 대화로 조작하는 별도의 최상위 세션. orchestrator.cjs의 conductor 패턴(Term.create + seed
// + MCP 툴)을 그대로 따르되, git worktree가 아니라 이 앱 자체가 대상이라 특정 폴더에 묶이지 않는다
// (§"오케스트레이터의 기준이 어려워" — 태스크 지휘자와 이름·자리를 분리해서 혼동을 없앤다).
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const Term = require('./term.cjs')
const Settings = require('./settings.cjs')

const CLAUDE_CONFIG_PATH = process.env.OPENRM_CLAUDE_CONFIG || path.join(os.homedir(), '.claude.json')
const CONTROL_CWD = path.join(__dirname, '..') // OpenTask 앱 자신의 루트 — 특정 타깃 레포에 묶이지 않음

let state = null // { session, model, modelLabel, startedAt, cwd } | null — 폴더별 Map이 필요 없다(전역 하나)

function isLive(live, name) {
	return live.some((x) => x.name === name || Term.baseName(x.name) === Term.baseName(name))
}

// mcpDispatch.cjs(지휘자 전용)와 같은 신뢰-다이얼로그-우회 + MCP 등록 패턴(term.cjs trustFolder
// 참고)이지만 대상 MCP 서버가 다르다(mcpControl.cjs, 폴더 스코프 없음). Term.create가 내부에서 다시
// 부르는 trustFolder(cwd, undefined)는 "이미 신뢰됨 + mcpFolderId 없음" 조합이면 아무것도 안 건드리고
// 즉시 리턴하므로(term.cjs 참고), 여기서 먼저 등록해두면 그 뒤 Term.create 호출에도 안전하게 남는다.
function registerControlMcp(cwd) {
	try {
		const cfg = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf8'))
		cfg.projects = cfg.projects || {}
		const existing = cfg.projects[cwd] || {}
		const mcpServers = { ...(existing.mcpServers || {}) }
		mcpServers['opentask-control'] = {
			command: process.execPath,
			args: [path.join(__dirname, 'mcpControl.cjs')],
			env: { OPENTASK_CONTROL: '1', OPENTASK_PORT: String(process.env.OPENRM_PORT || 8770) },
		}
		cfg.projects[cwd] = {
			allowedTools: [],
			mcpContextUris: [],
			enabledMcpjsonServers: [],
			disabledMcpjsonServers: [],
			...existing,
			mcpServers,
			hasTrustDialogAccepted: true,
		}
		fs.writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(cfg, null, 2))
	} catch (_) {}
}

function controlSeed() {
	const port = process.env.OPENRM_PORT || 8770
	const operator = Settings.operatorName()
	return `[역할: OpenTask 관제 에이전트] 너는 특정 태스크가 아니라 OpenTask 앱 전체를 대화로 조작하는 관제 에이전트야. ${operator}가 너와 직접 대화한다. 바로 실행하지 말고 계획부터 보고하고 승인받아.

■ 할 수 있는 일 — MCP 툴(도구 목록에서 opentask-control로 시작하는 것들)을 우선 써라:
- list_tasks: 전체 보드(폴더/서브태스크/마감일) 조회
- create_task / update_task / delete_task: 태스크 생성·상세정보(이름/설명/진행방식/레포/마감일) 수정·삭제
- start_task: 일감함 태스크를 실제로 착수(폴더 승격 + 오케스트레이션 개시) — 사이드바 "시작" 버튼과 동일
- reschedule_task: 태스크 마감일(캘린더 날짜)만 빠르게 변경
- list_cron_jobs / create_cron_job / update_cron_job / delete_cron_job / run_cron_job_now: 크론잡(자동화) 관리
- read_settings / update_setting: 운영 설정 조회·변경 (경로/앱/배포/웹훅 등만 — GitHub 토큰, DB 연결문자열 같은 비밀값은 이 툴로 못 건드린다. 그건 설정 화면에서 사람이 직접 해야 함)

MCP 툴이 안 보이거나 호출이 실패하면 curl로 폴백: curl -s http://localhost:${port}/api/... (엔드포인트는 OpenTask 서버 코드 기준)

■ 원칙: 요청을 이해하고, 뭘 할지 먼저 ${operator}에게 확인받은 뒤 실행해. 완료하면 뭘 했는지 요약해서 보고해.`
}

async function getState() {
	if (!state) return { running: false, session: null, cwd: CONTROL_CWD, modelLabel: null }
	const live = await Term.list().catch(() => [])
	if (!isLive(live, state.session)) {
		state = null
		return { running: false, session: null, cwd: CONTROL_CWD, modelLabel: null }
	}
	return { running: true, ...state }
}

async function start() {
	const live = await Term.list().catch(() => [])
	if (state && isLive(live, state.session)) return { ok: true, already: true, ...state }
	registerControlMcp(CONTROL_CWD)
	const model = Settings.modelFor('control')
	const t = await Term.create({ cwd: CONTROL_CWD, command: 'claude', label: 'control', seed: controlSeed(), model })
	if (!t.ok) return { ok: false, error: t.error }
	const modelLabel = Settings.modelLabelFor('control')
	state = { session: t.name, model, modelLabel, startedAt: Date.now(), cwd: CONTROL_CWD }
	return { ok: true, ...state }
}

async function stop() {
	if (!state) return { ok: true }
	await Term.kill(state.session).catch(() => {})
	state = null
	return { ok: true }
}

module.exports = { getState, start, stop }
