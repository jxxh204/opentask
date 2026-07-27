// notify.cjs — 에이전트(개발·QA·E2E·지휘자) 상태 전이 감시 → 맥 데스크톱 알림.
// 각 작업이 끝나거나(작업완료) 질문 대기(입력 필요)/인증 필요로 바뀌면, 작업명·그룹을 담아 알림.
'use strict'
const { execFile } = require('child_process')
const Term = require('./term.cjs')
const Tasks = require('./tasks.cjs')
const Settings = require('./settings.cjs')
const Ticket = require('./ticket.cjs')

let prev = {} // sessionName → 직전 상태('work'|'wait'|'idle'|'auth')

function notifyMac(title, body) {
	execFile('osascript', ['-e', `display notification ${JSON.stringify(body || '')} with title ${JSON.stringify(title)} sound name "Glass"`], { timeout: 8000 }, () => {})
}
function stateOf(s) {
	const st = s.status || {}
	if (st.needsAuth) return 'auth'
	if (st.working) return 'work'
	if (st.waiting) return 'wait'
	return 'idle'
}
function ticketOf(name) {
	return Ticket.ticketOf(name)
}
// 세션명 → 사람이 읽을 제목/부제 (종류·티켓·작업명·그룹)
function friendly(name, byTicket) {
	const n = String(name || '').replace(/^orm-/, '')
	if (/^orch-/.test(n)) {
		const grp = n.replace(/^orch-/, '').replace(/-qa$/, '')
		return { title: `🎼 ${grp} 지휘자`, sub: '오케스트레이터' }
	}
	const kind = /^qa-/.test(n) ? 'QA' : /^e2e-/.test(n) ? 'E2E' : /^dbg-/.test(n) ? '디버그' : '개발'
	const tk = ticketOf(name)
	const meta = (tk && byTicket[tk]) || null
	const grp = meta && meta.group ? ` · ${meta.group}` : ''
	const sub = ((meta && meta.title) || '').slice(0, 56) + grp
	return { title: `${kind} ${tk || n}`, sub: sub.trim() || null }
}

async function tick() {
	if (Settings.get('agentNotify') === false) {
		// 꺼져 있어도 상태는 계속 추적(다시 켰을 때 오래된 전이로 폭탄 알림 방지)
		try {
			const sessions = await Term.list()
			const now = {}
			for (const s of sessions) now[s.name] = stateOf(s)
			prev = now
		} catch (_) {}
		return
	}
	let sessions, built
	try {
		;[sessions, built] = await Promise.all([Term.list(), Tasks.build().catch(() => ({ tasks: [] }))])
	} catch (_) {
		return
	}
	const byTicket = {}
	for (const t of (built && built.tasks) || []) if (t.ticket) byTicket[t.ticket] = { group: t.group, title: t.title }
	const now = {}
	for (const s of sessions) {
		const st = stateOf(s)
		now[s.name] = st
		const was = prev[s.name]
		if (was === undefined || st === was) continue // 첫 관측/변화 없음 → 알림 안 함
		const f = friendly(s.name, byTicket)
		if (st === 'wait' && was === 'work') notifyMac(`💬 ${f.title} — 질문 대기`, f.sub ? f.sub + ' (입력 필요)' : '입력이 필요합니다')
		else if (st === 'auth') notifyMac(`⚠️ ${f.title} — 인증 필요`, f.sub || 'AWS/권한 확인')
		else if (st === 'idle' && was === 'work') notifyMac(`✅ ${f.title} — 완료`, f.sub || '작업이 끝났습니다')
	}
	prev = now
}

function start() {
	tick()
	return setInterval(tick, 10000) // 10초마다 상태 전이 확인
}

module.exports = { start }
