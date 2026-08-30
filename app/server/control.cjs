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
//
// ~/.claude.json의 등록 키는 cwd 그대로가 아니라 Term.gitRoot(cwd) — claude CLI가 프로젝트를 식별하는
// 기준이 실제로는 git 리포지토리 최상위이기 때문이다(term.cjs의 gitRoot 주석 참고). CONTROL_CWD가
// OpenTask 앱 자신의 루트(openrm/app)인데, 이 앱은 모노레포의 하위 디렉토리라 git root는 한 단계 위
// (openrm)다 — cwd 그대로 키를 쓰면 CLI가 그 등록을 영원히 못 찾는다(`claude mcp list`로 직접 확인된
// 버그: opentask-control이 설정엔 있는데 세션엔 전혀 안 잡힘).
function registerControlMcp(cwd) {
	try {
		const key = Term.gitRoot(cwd)
		const cfg = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf8'))
		cfg.projects = cfg.projects || {}
		const existing = cfg.projects[key] || {}
		const mcpServers = { ...(existing.mcpServers || {}) }
		mcpServers['opentask-control'] = {
			command: process.execPath,
			args: [path.join(__dirname, 'mcpControl.cjs')],
			env: { OPENTASK_CONTROL: '1', OPENTASK_PORT: String(process.env.OPENRM_PORT || 8770) },
		}
		cfg.projects[key] = {
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

function controlSeed(extra) {
	const port = process.env.OPENRM_PORT || 8770
	const operator = Settings.operatorName()
	return `[역할: OpenTask 비서] 너는 특정 태스크가 아니라 OpenTask 앱 전체를 대화로 조작하는 비서야. ${operator}가 너와 직접 대화한다. 바로 실행하지 말고 계획부터 보고하고 승인받아.

■ 할 수 있는 일 — MCP 툴(도구 목록에서 opentask-control로 시작하는 것들)을 우선 써라:
- list_tasks: 전체 보드(폴더/태스크/서브태스크/마감일) 조회
- create_task / update_task / delete_task: 태스크 생성·상세정보(이름/설명/진행방식/레포/마감일/기간/색상) 수정·삭제
- start_task: 일감함 태스크를 실제로 착수(폴더 승격 + 오케스트레이션 개시) — 사이드바 "시작" 버튼과 동일
- reschedule_task: 태스크 마감일(캘린더 날짜)만 빠르게 변경
- create_subtask / update_subtask / delete_subtask: 태스크 하나를 개발/개발자테스트/QA/배포 같은 단계로 쪼갠 서브태스크 관리(각자 자기 설명·예정일·기간을 가짐). 실제 워크트리+클로드 세션을 띄우는 건 이 툴셋에 없다 — 그건 태스크 상세페이지에서 사람이 직접 하는 무거운 동작이라 비서가 대신하지 않는다.
- list_blocked_periods / create_blocked_period / delete_blocked_period: 캘린더 차단 기간(예: "QA 기간") 관리 — 만들면 겹치는 기존 일정이 자동으로 뒤로 밀린다.
- list_cron_jobs / create_cron_job / update_cron_job / delete_cron_job / run_cron_job_now: 크론잡(자동화) 관리
- read_settings / update_setting: 운영 설정 조회·변경 (경로/앱/배포/웹훅 등만 — GitHub 토큰, DB 연결문자열 같은 비밀값은 이 툴로 못 건드린다. 그건 설정 화면에서 사람이 직접 해야 함)

MCP 툴이 안 보이거나 호출이 실패하면 curl로 폴백: curl -s http://localhost:${port}/api/... (엔드포인트는 OpenTask 서버 코드 기준)

■ 비서답게 — "태스크 만들어줘"처럼 이름만 던져주고 끝나는 요청이 흔하다. 설명·마감일·기간·레포처럼
뭘 만들지에 실제로 영향을 주는 정보가 비어있으면 추측해서 그냥 만들지 말고, 짧게 하나씩 물어봐서
채운 뒤에 만들어라(팀 규칙 빈칸을 물어보며 채우는 것과 같은 태도). 사소한 값(색상 등)까지 전부 캐물어
피곤하게 만들 필요는 없다 — 실제로 판단이 갈리는 것만.

■ 원칙: 요청을 이해하고, 뭘 할지 먼저 ${operator}에게 확인받은 뒤 실행해. 완료하면 뭘 했는지 요약해서 보고해.${extra ? `\n\n■ 지금 바로 이걸 도와줘:\n${extra}` : ''}`
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

// "비서 세션이 자꾸 초기화돼" — term.cjs 세션은 이 서버 프로세스의 자식이라 서버 재시작마다(코드
// 수정 후 재기동 등) 죽는다(§ term.cjs 상단 주석). state는 메모리 변수라 재시작 후엔 항상 null이라,
// 예전엔 매번 seed와 함께 완전히 새 claude를 켜서 지금까지의 대화가 통째로 날아갔다. orchestrator.cjs의
// 지휘자 세션과 같은 복원 경로(claude --continue + continueFallbackSeed)를 그대로 따른다 — CONTROL_CWD가
// 비서 전용 고정 디렉토리라 --continue가 정확히 이 비서의 마지막 대화를 이어받고, 이어받을 대화가
// 없을 때만(최초 시작 등, term.cjs watchContinueFallback) 이 seed로 새로 시작한다.
async function start(extra) {
	const live = await Term.list().catch(() => [])
	if (state && isLive(live, state.session)) return { ok: true, already: true, ...state }
	registerControlMcp(CONTROL_CWD)
	const model = Settings.modelFor('control')
	const t = await Term.create({ cwd: CONTROL_CWD, command: 'claude --continue', label: 'control', model, continueFallbackSeed: controlSeed(extra) })
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

// "이게 그냥 작성하기는 어려운데... 나한테 질문하면서 작성하게 할 수 있도록 관제에 질문하는 버튼
// 있으면 어떨까" — 팀 규칙처럼 빈 화면에 자연어를 바로 적기 어려운 자리에서, 관제에게 맥락(레포·
// 어떤 규칙칸)을 실어 보내면 관제가 사람에게 되물어가며 대신 채워준다. 관제가 이미 떠 있으면 그
// 세션에 새 지시를 안전하게 얹고(injectSeed — 화면에 실제로 찍혔는지 확인 후 제출), 아직 없으면
// 최초 seed 자체에 이 요청을 포함해 콜드 스타트 중 이중 주입 경합을 피한다.
async function ask(text) {
	if (!text || !String(text).trim()) return { ok: false, error: 'text 필수' }
	const live = await Term.list().catch(() => [])
	if (state && isLive(live, state.session)) {
		const oneLine = String(text).replace(/[\r\n]+/g, ' ').slice(0, 2000)
		await Term.injectSeed(state.session, oneLine).catch(() => {})
		return { ok: true, already: true, ...state }
	}
	return await start(text)
}

module.exports = { getState, start, stop, ask, CONTROL_CWD }
