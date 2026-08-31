// scheduler.cjs — Automations 실행 루프(§07 "크론잡 생성"). monitor.cjs/notify.cjs와 같은 패턴
// (setInterval 폴링, 프로세스가 켜져 있는 동안만 동작) — OS cron/launchd 연동은 안 함(로컬 전용 도구에
// 과한 인프라). action_type 2가지:
//   create_task — 정해진 태스크 하나를 그대로 생성.
//   run_instruction(§v26 "어떤 크론잡이든 만들 수 있는 자유도를 주고싶어") — 사람이 미리 써둔 자연어
//     지시를 그 시각에 opentask-control MCP 툴로 그대로 실행. "AI는 범위를 스스로 만들지 않는다"(§12)
//     원칙과 충돌 없음 — 무엇을 할지는 사람이 미리 문장으로 다 정해뒀고, 트리거 시점의 AI는 그 문장을
//     실행하는 손일 뿐이다(그 순간 비서에게 사람이 직접 타이핑하는 것과 동등, 즉흥적 판단이 아님).
'use strict'
const path = require('path')
const { execFile } = require('child_process')
const CronJobs = require('./store/cronJobs.cjs')
const StoreTasks = require('./store/tasks.cjs')

const CHECK_MS = 30000
const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'

// run_instruction 전용 — 대화형 비서(control.cjs)와 같은 opentask-control MCP 서버를 쓰되, 여기선
// ~/.claude.json 프로젝트 등록에 전혀 의존하지 않고 --mcp-config로 그 자리에서 통째로 넘긴다. 그래서
// gitRoot() 충돌로 인스턴스끼리 포트 등록을 덮어쓰던 사고(§control.cjs CONTROL_CWD 주석)가 애초에
// 발생할 수 없다. --strict-mcp-config + --allowedTools로 opentask-control 툴 딱 그만큼만 열어주고
// (Bash/Read/Write는 아예 없음), --permission-mode bypassPermissions로 사람 승인 없이 곧장 실행한다 —
// 크론 트리거는 사람이 화면 앞에 없는 게 기본이라 승인 대기 자체가 불가능하기 때문.
function runInstruction(job) {
	const instruction = job.action && job.action.instruction
	if (!instruction || !String(instruction).trim()) return Promise.resolve({ ok: false, error: '지시문이 비어 있습니다.' })
	const port = process.env.OPENRM_PORT || 8770
	const mcpConfig = JSON.stringify({
		mcpServers: {
			'opentask-control': {
				command: process.execPath,
				args: [path.join(__dirname, 'mcpControl.cjs')],
				env: { OPENTASK_CONTROL: '1', OPENTASK_PORT: String(port) },
			},
		},
	})
	const prompt =
		`[자동화 "${job.name}"가 예정된 시각에 트리거됨] 아래 지시를 지금 그대로 실행해라. 사람이 미리 정해둔 지시이니 되묻지 말고, ` +
		`새로운 판단이나 범위 확장 없이 지시된 것만 정확히 수행한다. 실행 후 무엇을 했는지 한두 문장으로 간단히 요약해라.\n\n지시: ${instruction}`
	return new Promise((resolve) => {
		const child = execFile(
			CLAUDE_BIN,
			['-p', prompt, '--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__opentask-control__*', '--permission-mode', 'bypassPermissions', '--output-format', 'json'],
			{ timeout: 180000, maxBuffer: 8 << 20, env: process.env },
			(e, o, er) => resolve({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') }),
		)
		try {
			child.stdin.end() // repoClassify.cjs와 같은 이유 — stdin 대기로 멈추지 않게.
		} catch (_) {}
	})
}

async function runJob(job) {
	let result = null
	try {
		if (job.action_type === 'create_task') {
			const a = job.action
			StoreTasks.create({ folderId: null, name: a.name || job.name, desc: a.desc || `Automations "${job.name}"에서 자동 생성`, repoId: a.repoId || null })
		} else if (job.action_type === 'run_instruction') {
			const r = await runInstruction(job)
			if (!r.ok) {
				result = '실행 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 300) || 'claude 실행 실패')
			} else {
				let text = r.out
				try {
					const j = JSON.parse(r.out)
					text = j.result || j.text || r.out
				} catch (_) {}
				result = String(text).trim().slice(0, 2000) || '(응답 없음)'
			}
		}
	} catch (e) {
		console.error(`[scheduler] job "${job.name}" 실행 실패:`, (e && e.stack) || e)
		result = '실행 실패: ' + (e && e.message)
	} finally {
		CronJobs.markRan(job.id, result)
	}
}

async function tick() {
	let due
	try {
		due = CronJobs.dueJobs()
	} catch (_) {
		return
	}
	for (const job of due) await runJob(job)
}

function start() {
	tick()
	return setInterval(tick, CHECK_MS)
}

module.exports = { start, runJob }
