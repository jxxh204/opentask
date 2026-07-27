// orchestrator.cjs — 개발실(Sessions) 폴더 단위 "🎼 오케스트레이션" (Phase 3.2).
//
// orch.cjs(구 그룹-지휘자)와는 다른 개념이라 재사용하지 않고 새로 쓴다. 여기서는 한 폴더의
// 태스크들을 order_idx 순서(= 단순 순차 웨이브, 한 번에 하나 active)로 돌리며, 태스크별로
//   ① 실제 git 워크트리(Worktrees.ensure, 멱등)  ② 실제 tmux+claude 세션(Term.create, seed 주입)
// 을 생성하고 그 매핑을 in-memory 로 기록한다.
//
// ⚠️ 상태는 프로세스 in-memory Map — 서버 재시작 시 소실된다(v1 허용). 실제 "이전 웨이브 완료" 감지와
//    PR baseRef 의존성 그래프 기반 웨이브는 이번 패스 범위 밖(후속 단계). advance는 사람이 누르는 수동 진행.
'use strict'
const Term = require('./term.cjs')
const Worktrees = require('./worktrees.cjs')
const Actuator = require('./actuator.cjs')
const StoreFolders = require('./store/folders.cjs')
const StoreTasks = require('./store/tasks.cjs')

// folderId → { running, currentWaveIndex, sessions:[{taskId,tmuxSession,worktreePath}], log:[{t,dot,at}] }
const states = new Map()
// folderId currently inside start() — guards a concurrent double-start (e.g. double-click) from
// racing on the same task's Worktrees.ensure()/create() (git worktree add is not safe to run twice
// in parallel for the same path/branch). Frontend also disables the button, this is belt-and-suspenders.
const starting = new Set()

function blank() {
	return { running: false, currentWaveIndex: 0, sessions: [], log: [] }
}
function getState(folderId) {
	return states.get(folderId) || blank()
}
// 태스크 하나가 속한 (어느 폴더인지 몰라도) 현재 활성 세션 — PR 리뷰 "적용"이 지시를 보낼 대상 찾기용.
function findSessionForTask(taskId) {
	for (const s of states.values()) {
		const hit = s.sessions.find((x) => x.taskId === taskId)
		if (hit) return hit
	}
	return null
}
function ensureState(folderId) {
	let s = states.get(folderId)
	if (!s) {
		s = blank()
		states.set(folderId, s)
	}
	return s
}
function pushLog(s, t, dot) {
	s.log.push({ t, dot: dot || 'violet', at: Date.now() })
	if (s.log.length > 200) s.log.splice(0, s.log.length - 200) // 로그 캡
}
// 기록된 세션이 (리네임 포함) 아직 살아있는지 — cmux/claude가 세션명을 바꾸므로 baseName으로도 매칭.
function isLive(live, name) {
	return live.some((x) => x.name === name || Term.baseName(x.name) === Term.baseName(name))
}

async function start(folderId) {
	if (starting.has(folderId)) return { ok: false, error: '이미 시작 중입니다 — 잠시 후 다시 시도하세요.' }
	starting.add(folderId)
	try {
		const folder = StoreFolders.get(folderId)
		if (!folder) return { ok: false, error: 'folder not found' }
		const tasks = StoreTasks.listByFolder(folderId) // order_idx ASC = 웨이브 순서
		if (!tasks.length) return { ok: false, error: '폴더에 태스크가 없습니다.' }
		const s = ensureState(folderId)
		const live = await Term.list().catch(() => [])
		for (const task of tasks) {
			// 이전 start에서 만든 세션이 아직 살아있으면 재사용(중복 생성 금지)
			const existing = s.sessions.find((x) => x.taskId === task.id)
			if (existing && isLive(live, existing.tmuxSession)) {
				pushLog(s, `재사용: "${task.name}" → ${existing.tmuxSession}`, 'blue')
				continue
			}
			// 워크트리 확보 (멱등 — 있으면 재사용, 없으면 base에서 생성). ticket 없으면 name을 raw로 → deriveNames가 슬러그화.
			const raw = (task.ticket && String(task.ticket).trim()) || task.name
			const wt = await Worktrees.ensure({ ticket: raw, base: folder.base, desc: task.name })
			if (!wt.ok) {
				pushLog(s, `워크트리 실패: "${task.name}" — ${wt.error}`, 'amber')
				continue
			}
			// tmux + interactive claude 세션 (Term.create가 --model 주입/6초 후 seed 주입까지 처리)
			const seed = `이 태스크를 진행해줘: "${task.name}". ${task.desc || ''}`.trim()
			const t = await Term.create({ cwd: wt.path, command: 'claude', label: raw, seed })
			if (!t.ok) {
				pushLog(s, `세션 시작 실패: "${task.name}" — ${t.error}`, 'amber')
				continue
			}
			const rec = { taskId: task.id, tmuxSession: t.name, worktreePath: wt.path }
			const idx = s.sessions.findIndex((x) => x.taskId === task.id)
			if (idx >= 0) s.sessions[idx] = rec
			else s.sessions.push(rec)
			pushLog(s, `투입: "${task.name}" → ${t.name} (${wt.dir}${wt.existed ? ', 재사용 워크트리' : ''})`, 'green')
		}
		// 실제로 세션이 하나라도 떴을 때만 running(정직한 상태 — advance가 헛돌지 않게). 스펙의 "running=true"는 정상경로.
		s.running = s.sessions.length > 0
		s.currentWaveIndex = 0
		pushLog(s, `오케스트레이션 시작 — ${s.sessions.length}개 세션 (총 ${tasks.length}개 태스크)`, 'violet')
		return { ok: true, ...getState(folderId) }
	} finally {
		starting.delete(folderId)
	}
}

async function advance(folderId) {
	const s = states.get(folderId)
	if (!s || !s.running) return { ok: false, error: '오케스트레이션이 실행 중이 아닙니다. 먼저 start 하세요.' }
	if (!s.sessions.length) return { ok: false, error: '진행할 세션이 없습니다.' }
	// 현재 웨이브 태스크 세션에 "계속 진행" nudge — Actuator.dispatch 재사용(raw send-keys 직접 안 함).
	// 리네임 대비: 라이브 목록에서 baseName 매칭으로 실제 세션명을 다시 찾는다.
	const cur = s.sessions[Math.min(s.currentWaveIndex, s.sessions.length - 1)]
	let dispatched = false
	if (cur) {
		const live = await Term.list().catch(() => [])
		const match = live.find((x) => x.name === cur.tmuxSession || Term.baseName(x.name) === Term.baseName(cur.tmuxSession))
		const target = match ? match.name : cur.tmuxSession
		const d = await Actuator.dispatch({ session: target, message: '계속 진행해줘.', dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
		dispatched = !!d.ok
		pushLog(s, dispatched ? `▶ 진행 지시 → ${target}` : `진행 지시 실패 → ${target}: ${d.error || ''}`, dispatched ? 'blue' : 'amber')
	}
	// 다음 웨이브로 (수동 진행 — 완료 자동감지는 범위 밖)
	if (s.currentWaveIndex < s.sessions.length - 1) s.currentWaveIndex += 1
	pushLog(s, `웨이브 인덱스 → ${s.currentWaveIndex}`, 'violet')
	return { ok: true, dispatched, ...getState(folderId) }
}

async function stop(folderId) {
	const s = states.get(folderId)
	if (!s) return { ok: true, ...blank() }
	for (const sess of s.sessions) {
		await Term.kill(sess.tmuxSession).catch(() => {})
		pushLog(s, `세션 종료: ${sess.tmuxSession}`, 'amber')
	}
	s.running = false
	s.sessions = [] // 죽은 세션 참조 정리 (log는 히스토리로 보존)
	s.currentWaveIndex = 0
	pushLog(s, '오케스트레이션 정지', 'violet')
	return { ok: true, ...getState(folderId) }
}

module.exports = { start, advance, stop, getState, findSessionForTask }
