// 그룹 오케스트레이터 — 각 작업 그룹에 지휘자(claude, fable) 1명. 서브에이전트를 OpenRM API 경유로 조율.
// 지휘자↔서브 메시지를 활동 피드에 기록 → "유기적 대화" UI 렌더. 세션: orm-orch-<slug>.
'use strict'
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const C = require('./collector.cjs')
const Term = require('./term.cjs')
const Tasks = require('./tasks.cjs')
const Settings = require('./settings.cjs')

const REG_FILE = process.env.OPENRM_ORCH_FILE || path.join(__dirname, '..', '.openrm-orch.json')
const slug = (g) =>
	'orch-' +
	String(g || '')
		.trim()
		.replace(/[\s/.]+/g, '-')
		.slice(0, 40)
const feeds = {} // group → [{ts, from, to, text, kind}]  (in-memory, cap 120)
const loadReg = () => {
	try {
		return JSON.parse(fs.readFileSync(REG_FILE, 'utf8'))
	} catch {
		return {}
	}
}
const saveReg = (r) => {
	try {
		fs.writeFileSync(REG_FILE, JSON.stringify(r))
	} catch (_) {}
}
const tmux = (args, t = 5000) => new Promise((r) => execFile('tmux', args, { timeout: t, maxBuffer: 4 << 20, env: process.env }, (e, o, er) => r({ ok: !e, out: String(o || ''), err: String(er || '') })))

function pushEvent({ group, from, to, text, kind }) {
	if (!group) return { ok: false, error: 'group 필수' }
	const f = feeds[group] || (feeds[group] = [])
	f.push({ ts: Date.now(), from: from || 'orch', to: to || 'orch', text: String(text || '').slice(0, 500), kind: kind || 'msg' })
	if (f.length > 120) f.splice(0, f.length - 120)
	return { ok: true }
}
function feed(group) {
	return { ok: true, feed: (group ? feeds[group] : []) || [] }
}

// 그룹 멤버 티켓 → 살아있는 서브 세션(dev/qa 등) 찾기
async function sessionForTicket(ticket) {
	if (!ticket) return null
	const list = await Term.list()
	// orch 제외, 티켓 포함하는 live 세션 (dev 우선, 그다음 qa)
	const cands = list.filter((s) => !/^orm-orch-/.test(s.name) && (s.name.includes(ticket) || (s.label || '').includes(ticket)))
	const dev = cands.find((s) => !/qa-/.test(s.name))
	return (dev || cands[0] || null)?.name || null
}

// 지휘자→서브 지시 (OpenRM 경유 → 피드 기록 + tmux 전달)
async function say({ group, to, text }) {
	if (!group || !to || !text) return { ok: false, error: 'group·to·text 필수' }
	const session = await sessionForTicket(to)
	if (!session) {
		pushEvent({ group, from: 'orch', to, text: `(전달 실패: ${to} 세션 없음) ` + text, kind: 'error' })
		return { ok: false, error: `${to}의 서브에이전트 세션이 없습니다(먼저 투입 필요).` }
	}
	const oneLine = String(text).replace(/[\r\n]+/g, ' ').slice(0, 1800)
	await tmux(['send-keys', '-t', session, '-l', oneLine])
	await tmux(['send-keys', '-t', session, 'Enter'])
	pushEvent({ group, from: 'orch', to, text, kind: 'dispatch' })
	return { ok: true, session }
}

// 지휘자에게 직접 메시지 (운영자/시스템 → 오케스트레이터 세션). 피드에 운영자 발화로 기록.
async function tell({ group, text }) {
	if (!group || !text) return { ok: false, error: 'group·text 필수' }
	const reg = loadReg()
	const session = reg[group] && reg[group].session
	const live = session && (await Term.list()).some((s) => s.name === session)
	if (!live) return { ok: false, error: `'${group}' 지휘자가 없습니다(먼저 투입).` }
	const oneLine = String(text).replace(/[\r\n]+/g, ' ').slice(0, 1800)
	await tmux(['send-keys', '-t', session, '-l', oneLine])
	await tmux(['send-keys', '-t', session, 'Enter'])
	pushEvent({ group, from: Settings.operatorName(), to: 'orch', text, kind: 'msg' })
	return { ok: true, session }
}

function orchSeed(group, members) {
	const list = members
		.map((m) => `- ${m.ticket || m.key}: ${m.title || ''} ${(m.links && [...(m.links.figma || []), ...(m.links.notion || [])].join(' ')) || ''}`)
		.join('\n')
	return `[역할: '${group}' 그룹 오케스트레이터] 너는 OpenRM에서 이 작업 그룹을 지휘하는 지휘자야. ${Settings.operatorName()}가 너와 직접 대화한다. 바로 실행 말고 계획부터 보고하고 승인받아.

■ 이 그룹 멤버(티켓):
${list}

■ 서브에이전트 조율은 반드시 OpenRM API 경유(관측·피드 기록용). tmux로 직접 하지 마.
- 지시: curl -s -X POST http://localhost:8770/api/orch/say -H 'Content-Type: application/json' -d '{"group":"${group}","to":"<티켓>","text":"<지시>"}'  → OpenRM이 해당 서브에 전달 + 활동 피드에 기록.
- 서브 결과/진행을 받으면 기록: curl -s -X POST http://localhost:8770/api/orch/event -H 'Content-Type: application/json' -d '{"group":"${group}","from":"<티켓>","to":"orch","text":"<요약>","kind":"result"}'.
- 서브가 없으면 새로 투입: curl -s -X POST http://localhost:8770/api/dev/qa (QA) 또는 /api/dev/start-task (개발) 에 {"ticket":"<티켓>","desc":"<제목>","seed":"<지시>"}.
- 큰 결정/계획은 curl .../api/orch/event 로 {"from":"orch","to":"${Settings.operatorName()}","text":"...","kind":"plan"} 남겨서 ${Settings.operatorName()}가 피드로 보게 해.

■ 원칙: 그룹 목표를 이해하고, 멤버별 작업을 나눠 서브에 맡기고, 결과를 검증·종합해서 ${Settings.operatorName()}에게 보고. 중복/드리프트 막고 티켓당 산출물 1개. 지금 그룹 상황을 파악해 계획을 ${Settings.operatorName()}에게 보고해.`
}

async function start({ group }) {
	if (!group) return { ok: false, error: 'group 필수' }
	const reg = loadReg()
	// 이미 살아있으면 그걸 반환
	const list = await Term.list()
	if (reg[group] && list.some((s) => s.name === reg[group].session)) return { ok: true, already: true, ...reg[group] }
	const built = await Tasks.build().catch(() => ({ tasks: [] }))
	const members = (built.tasks || []).filter((t) => t.group === group)
	if (!members.length) return { ok: false, error: `그룹 '${group}'에 업무가 없습니다.` }
	const model = Settings.modelFor('orchestrator')
	const t = await Term.create({ cwd: C.REPO, command: 'claude', label: slug(group), seed: orchSeed(group, members), model })
	if (!t.ok) return { ok: false, error: t.error }
	reg[group] = { group, session: t.name, model, startedAt: Date.now() }
	saveReg(reg)
	feeds[group] = feeds[group] || []
	pushEvent({ group, from: 'orch', to: Settings.operatorName(), text: `'${group}' 지휘자 투입 (${Settings.modelLabel(model)}) — 멤버 ${members.length}건. 계획 수립 중…`, kind: 'plan' })
	return { ok: true, session: t.name, model, members: members.length }
}

async function status(group) {
	const reg = loadReg()
	const list = await Term.list()
	const alive = (name) => list.some((s) => s.name === name || Term.baseName(s.name) === Term.baseName(name))
	if (!group) {
		// 전체: 그룹→오케스트레이터 유무
		const out = {}
		for (const [g, r] of Object.entries(reg)) out[g] = { active: alive(r.session), session: r.session, model: r.model }
		return { ok: true, orchestrators: out }
	}
	const r = reg[group]
	if (!r || !alive(r.session)) return { ok: true, active: false }
	const sess = list.find((s) => s.name === r.session || Term.baseName(s.name) === Term.baseName(r.session))
	return { ok: true, active: true, session: sess ? sess.name : r.session, model: (sess && sess.model) || r.model, status: sess && sess.status }
}

async function stop({ group }) {
	if (!group) return { ok: false, error: 'group 필수' }
	const reg = loadReg()
	if (reg[group]) {
		await Term.kill(reg[group].session).catch(() => {})
		delete reg[group]
		saveReg(reg)
	}
	pushEvent({ group, from: 'orch', to: Settings.operatorName(), text: '지휘자 종료', kind: 'msg' })
	return { ok: true }
}

module.exports = { start, status, stop, feed, event: pushEvent, say, tell }
