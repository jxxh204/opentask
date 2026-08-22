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
const Settings = require('./settings.cjs')
const C = require('./collector.cjs')
const StoreFolders = require('./store/folders.cjs')
const StoreTasks = require('./store/tasks.cjs')
const StoreRepos = require('./store/repos.cjs')
const StoreBranches = require('./store/branches.cjs')
const StoreDecisions = require('./store/decisions.cjs')

// ② 레포 분류 검증 — repoClassify.cjs가 자동배정(repo_auto=1)한 경우에만, 워크트리를 실제로 만들기
// 전에 태스크명/설명과 레포명이 최소한의 토큰이라도 겹치는지 스크립트로 확인한다(AI 아님, 단순 매칭).
// 사람이 직접 레포를 골랐으면(repo_auto=0) 이미 확인된 값이라 건너뛴다 — "기획: 이상적 워크플로우"
// §12 참고. 한글 태스크명과 영문 레포 슬러그가 흔해 겹침이 잘 안 잡히는 게 알려진 한계라, 겹치지
// 않아도 워크트리 생성을 막지 않고 decisions에 재확인 필요만 기록한다(오탐으로 작업을 막지 않기 위함).
function tokenize(s) {
	return String(s || '')
		.toLowerCase()
		.split(/[^a-z0-9가-힣]+/)
		.filter((t) => t.length >= 2)
}
function repoAssignmentLooksRight(task, repo) {
	if (!repo) return true
	const taskTokens = new Set([...tokenize(task.name), ...tokenize(task.desc)])
	const repoTokens = tokenize(repo.name)
	return repoTokens.some((t) => taskTokens.has(t)) || taskTokens.size === 0 || repoTokens.length === 0
}

// folderId → { running, currentWaveIndex, sessions:[{taskId,tmuxSession,worktreePath}], log:[{t,dot,at}],
//              conductor:{session,model,startedAt}|null, feed:[{ts,from,to,text,kind}] }
const states = new Map()
// folderId currently inside start() — guards a concurrent double-start (e.g. double-click) from
// racing on the same task's Worktrees.ensure()/create() (git worktree add is not safe to run twice
// in parallel for the same path/branch). Frontend also disables the button, this is belt-and-suspenders.
const starting = new Set()

function blank() {
	return { running: false, currentWaveIndex: 0, sessions: [], log: [], conductor: null, feed: [] }
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
			// 태스크가 레포를 지정했으면(멀티레포 프로젝트) 그 레포에, 아니면 지금처럼 단일 rootPath에 워크트리를 만든다.
			const raw = (task.ticket && String(task.ticket).trim()) || task.name
			const repo = StoreRepos.get(task.repo_id)
			if (task.repo_auto && repo && !repoAssignmentLooksRight(task, repo)) {
				StoreDecisions.record({
					folderId,
					taskId: task.id,
					kind: 'repo_verify_hold',
					reason: `AI가 자동배정한 레포(${repo.name})와 태스크명 사이에 겹치는 키워드가 없어 재확인이 필요합니다.`,
					meta: { repoId: repo.id, repoName: repo.name },
				})
				pushLog(s, `⚠️ 레포 배정 재확인 필요: "${task.name}" → ${repo.name} (키워드 안 겹침)`, 'amber')
			}
			const wt = await Worktrees.ensure({ ticket: raw, base: folder.base, desc: task.name, repoPath: repo && repo.path, repoBase: repo && repo.base })
			if (!wt.ok) {
				pushLog(s, `워크트리 실패: "${task.name}" — ${wt.error}`, 'amber')
				continue
			}
			// 실제 워크트리는 만들어졌는데 SQLite branches 테이블엔 아무도 기록을 안 남기고 있었다 —
			// TaskRow의 ⎇ 브랜치 줄(과 PR 배지/ahead-behind)이 task.branches[0]에 의존하는데 항상
			// 비어 있었던 원인. 여기서 실제 생성된 브랜치를 태스크에 붙인다(멱등 — 이미 있으면 건너뜀).
			if (wt.branch && !StoreBranches.listByTask(task.id).some((b) => b.name === wt.branch)) {
				StoreBranches.create({ taskId: task.id, name: wt.branch, repo: repo && repo.name })
			}
			// tmux + interactive claude 세션 (Term.create가 --model 주입/시드 주입까지 처리)
			// 태스크에 직접 쓴 시작 프롬프트(start_prompt)가 있으면 그걸 그대로 쓰고, 없으면 자동 생성 문구로 폴백.
			// model을 안 넘기면 Term이 --model을 안 붙여서(claude CLI 기본값에 맡김) 어느 모델이 배정됐는지
			// 스냅샷에 아예 안 남는다 — mrm(원조 프로젝트)의 동일 지점은 Settings.modelFor('dev')를 넘겼는데
			// 여기서 빠뜨렸던 것. TaskRow의 "담당 에이전트" 표시가 계속 비어 보였던 원인.
			const seed = (task.start_prompt && String(task.start_prompt).trim()) || `이 태스크를 진행해줘: "${task.name}". ${task.desc || ''}`.trim()
			const model = Settings.modelFor('dev')
			const t = await Term.create({ cwd: wt.path, command: 'claude', label: raw, seed, model })
			if (!t.ok) {
				pushLog(s, `세션 시작 실패: "${task.name}" — ${t.error}`, 'amber')
				continue
			}
			const rec = { taskId: task.id, tmuxSession: t.name, worktreePath: wt.path, model, modelLabel: Settings.modelLabel(model) }
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

// ── 지휘자(conductor) — 오케스트레이터 자체의 클로드 세션 (Phase 3.4) ──
// orch.cjs(구 그룹-지휘자)와 같은 발상(지휘자 세션이 OpenRM API 경유로 서브를 조율, 대화를 피드에
// 기록)이지만, 여기서는 group 문자열이 아니라 실제 folderId/taskId로 정확히 찾는다(퍼지 매칭 불필요 —
// states의 sessions 배열이 이미 taskId→tmuxSession을 정확히 알고 있음). 새 서브태스크를 직접 만드는
// 권한은 주지 않는다 — 있는 서브에게 지시만 전달(dispatch)하고 결과를 기록한다.
function pushFeed(s, { from, to, text, kind }) {
	s.feed.push({ ts: Date.now(), from: from || 'orch', to: to || 'orch', text: String(text || '').slice(0, 500), kind: kind || 'msg' })
	if (s.feed.length > 120) s.feed.splice(0, s.feed.length - 120)
}

function conductorSeed(folder, tasks) {
	const port = process.env.OPENRM_PORT || 8770
	const operator = Settings.operatorName()
	const list = tasks.map((t) => `- ${t.id}: ${t.name}${t.desc ? ' — ' + t.desc : ''}`).join('\n') || '(아직 서브태스크 없음)'
	return `[역할: "${folder.name}" 태스크 오케스트레이터] 너는 OpenRM에서 이 태스크를 지휘하는 지휘자야. ${operator}가 너와 직접 대화한다. 바로 실행하지 말고 계획부터 보고하고 승인받아.

■ 이 태스크의 서브태스크(작업) 목록 (taskId: 이름):
${list}

■ 서브에이전트 조율은 반드시 OpenRM API 경유(관측·대화 로그 기록용) — tmux로 직접 하지 마. 새 서브태스크를
만드는 권한은 없다 — 위 목록의 기존 서브에게만 지시할 수 있다.

MCP 툴 dispatch_subtask/log_event/set_subtask_kind가 있으면(도구 목록 확인) 그걸 우선 써 — 구조화된
호출이라 더 안전하다. 없거나 호출이 실패하면 아래 curl로 폴백해:
- 서브에게 지시: curl -s -X POST http://localhost:${port}/api/folders/${folder.id}/conductor/say -H 'Content-Type: application/json' -d '{"taskId":"<위 목록의 taskId>","text":"<지시>"}'
- 서브의 결과/진행을 받으면 기록: curl -s -X POST http://localhost:${port}/api/folders/${folder.id}/conductor/event -H 'Content-Type: application/json' -d '{"from":"<taskId>","to":"orch","text":"<요약>","kind":"result"}'
- 큰 결정/계획을 ${operator}와 공유: curl -s -X POST http://localhost:${port}/api/folders/${folder.id}/conductor/event -H 'Content-Type: application/json' -d '{"from":"orch","to":"${operator}","text":"<계획/보고>","kind":"plan"}'
- 서브태스크의 kind(진행 방식)를 판단·수정: curl -s -X POST http://localhost:${port}/api/folders/${folder.id}/conductor/set-kind -H 'Content-Type: application/json' -d '{"taskId":"<위 목록의 taskId>","kind":"single|chain|parallel","reason":"<왜 이 kind인지 한 줄>"}' — 이전 서브태스크의 산출물 위에 이어서 작업해야 하면 chain, 서로 독립적이라 동시에 여러 버전을 시도해볼 만하면 parallel, 그 외엔 single. reason은 필수 — 나중에 사람이 훑어볼 근거가 된다.

■ 원칙: 태스크 목표를 이해하고, 서브태스크별 진행 상황을 확인하고, 결과를 검증·종합해서 ${operator}에게
보고해. 지금 상황을 파악해 계획을 ${operator}에게 보고해줘.`
}

async function startConductor(folderId) {
	const folder = StoreFolders.get(folderId)
	if (!folder) return { ok: false, error: 'folder not found' }
	const s = ensureState(folderId)
	const live = await Term.list().catch(() => [])
	if (s.conductor && isLive(live, s.conductor.session)) return { ok: true, already: true, ...s.conductor }
	const tasks = StoreTasks.listByFolder(folderId)
	const model = Settings.modelFor('orchestrator')
	const t = await Term.create({ cwd: C.REPO, command: 'claude', label: `conductor-${folder.name}`, seed: conductorSeed(folder, tasks), model, mcpFolderId: folderId })
	if (!t.ok) return { ok: false, error: t.error }
	// modelLabelFor('orchestrator')는 fableLock 때문에 fable→opus로 바뀐 경우 "(비용 잠금)"을 붙여준다
	// (§06 — 화면엔 그냥 "Opus 4.8"로만 보여서 왜 지휘자가 Fable이 아닌지 헷갈리는 문제).
	const modelLabel = Settings.modelLabelFor('orchestrator')
	s.conductor = { session: t.name, model, modelLabel, startedAt: Date.now(), cwd: C.REPO }
	pushFeed(s, { from: 'orch', to: Settings.operatorName(), text: `지휘자 세션 투입 (${modelLabel}) — 서브태스크 ${tasks.length}건. 계획 수립 중…`, kind: 'plan' })
	return { ok: true, ...s.conductor }
}

async function stopConductor(folderId) {
	const s = states.get(folderId)
	if (!s || !s.conductor) return { ok: true }
	await Term.kill(s.conductor.session).catch(() => {})
	pushFeed(s, { from: 'orch', to: Settings.operatorName(), text: '지휘자 세션 종료', kind: 'msg' })
	s.conductor = null
	return { ok: true }
}

// 지휘자(conductor 세션 자신)가 curl로 호출 — 특정 서브태스크 세션에 지시 전달.
async function conductorSay(folderId, taskId, text) {
	if (!taskId || !text) return { ok: false, error: 'taskId·text 필수' }
	const s = states.get(folderId)
	if (!s) return { ok: false, error: '오케스트레이션 상태 없음' }
	const target = s.sessions.find((x) => x.taskId === taskId)
	if (!target) {
		pushFeed(s, { from: 'orch', to: taskId, text: `(전달 실패: 세션 없음) ${text}`, kind: 'error' })
		return { ok: false, error: `taskId ${taskId}의 세션이 없습니다.` }
	}
	const d = await Actuator.dispatch({ session: target.tmuxSession, message: text, dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
	pushFeed(s, { from: 'orch', to: taskId, text, kind: d.ok ? 'dispatch' : 'error' })
	return d.ok ? { ok: true, session: target.tmuxSession } : { ok: false, error: d.error }
}

// 운영자(=사람, UI)가 지휘자 세션에 직접 말 걸기.
async function conductorTell(folderId, text) {
	if (!text) return { ok: false, error: 'text 필수' }
	const s = states.get(folderId)
	if (!s || !s.conductor) return { ok: false, error: '지휘자 세션이 없습니다(먼저 시작).' }
	const live = await Term.list().catch(() => [])
	const match = live.find((x) => x.name === s.conductor.session || Term.baseName(x.name) === Term.baseName(s.conductor.session))
	if (!match) return { ok: false, error: '지휘자 세션이 죽었습니다.' }
	const d = await Actuator.dispatch({ session: match.name, message: text, dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
	pushFeed(s, { from: Settings.operatorName(), to: 'orch', text, kind: 'msg' })
	return d.ok ? { ok: true } : { ok: false, error: d.error }
}

// 지휘자(또는 사람) → 대화 피드에 이벤트 기록만 (실제 전송 없음, 지휘자의 "결과 기록"/"계획 공유" 용도).
function conductorEvent(folderId, { from, to, text, kind }) {
	const s = ensureState(folderId)
	pushFeed(s, { from, to, text, kind })
	return { ok: true }
}

function conductorFeed(folderId) {
	const s = states.get(folderId)
	return { ok: true, feed: (s && s.feed) || [] }
}

// ⑤ kind 판단 — 지휘자(conductor 세션)가 curl로 호출. subTask 자체를 새로 만드는 게 아니라(그 권한은
// conductorSeed()가 명시적으로 금지), 이미 있는 subTask의 kind(single/chain/parallel)만 판단·수정한다
// — "AI는 범위를 스스로 만들지 않는다" 원칙과 충돌하지 않음("범위 안에서 어떻게 실행할지"만 다룸).
// 근거는 매번 강제로 남긴다(②와 같은 원칙) — feed(휘발성) + decisions(영속) 둘 다에 기록.
function conductorSetKind(folderId, taskId, kind, reason) {
	if (!taskId || !kind) return { ok: false, error: 'taskId·kind 필수' }
	if (!['single', 'chain', 'parallel'].includes(kind)) return { ok: false, error: `알 수 없는 kind: ${kind}` }
	const task = StoreTasks.get(taskId)
	if (!task) return { ok: false, error: 'task not found' }
	const prevKind = task.kind
	StoreTasks.update(taskId, { kind })
	StoreDecisions.record({ folderId, taskId, kind: 'kind_judge', reason: reason || '(근거 없음)', meta: { from: prevKind, to: kind } })
	const s = ensureState(folderId)
	pushFeed(s, { from: 'orch', to: Settings.operatorName(), text: `kind 판단: "${task.name}" ${prevKind} → ${kind} — ${reason || '(근거 없음)'}`, kind: 'plan' })
	return { ok: true, task: StoreTasks.get(taskId) }
}

module.exports = {
	start,
	advance,
	stop,
	getState,
	findSessionForTask,
	startConductor,
	stopConductor,
	conductorSay,
	conductorTell,
	conductorEvent,
	conductorFeed,
	conductorSetKind,
}
