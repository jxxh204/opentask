// notify.cjs — 에이전트(개발·QA·E2E·지휘자) 상태 전이 감시 → 맥 데스크톱 알림.
// 각 작업이 끝나거나(작업완료) 질문 대기(입력 필요)/인증 필요로 바뀌면, 작업명·그룹을 담아 알림.
'use strict'
const { execFile } = require('child_process')
const Term = require('./term.cjs')
const Tasks = require('./tasks.cjs')
const Settings = require('./settings.cjs')
const Ticket = require('./ticket.cjs')

let prev = {} // sessionName → 직전 상태('work'|'wait'|'idle'|'auth')

// "푸시알림 누르면 접속이 안됨" — osascript의 display notification은 클릭 액션 자체가 없다(배너를
// 눌러도 그냥 사라질 뿐, 앱을 포커스하거나 특정 화면으로 보내는 기능이 없음). Electron의 Notification
// API(클릭 핸들러 지원)로 대신 띄우고 싶은데, 이 파일은 Electron이 아니라 별도 Node 서버 프로세스라
// 직접 호출할 수 없다 — 그래서 여기선 큐에 쌓아두고, Electron 메인 프로세스(electron/main.cjs)가
// 살아있는 동안 주기적으로 폴링(POST heartbeat + GET pending)해서 대신 띄우게 한다. Electron이
// 폴링을 멈추면(완전 종료 후에도 백엔드만 계속 사는 경우 등) heartbeat가 끊겨 예전처럼 osascript로
// 폴백한다 — 클릭은 안 되지만 최소한 알림 자체는 today와 동일하게 유지.
const pending = []
let lastElectronHeartbeat = 0

function heartbeat() {
	lastElectronHeartbeat = Date.now()
}
function electronAlive() {
	return Date.now() - lastElectronHeartbeat < 8000 // Electron 쪽 폴링 주기(5초)의 여유를 둔 판정
}
function enqueue(title, body) {
	pending.push({ title, body })
	if (pending.length > 20) pending.shift() // Electron이 한동안 안 뜨면 무한정 쌓이지 않게 캡
}
function drainPending() {
	return pending.splice(0, pending.length)
}
function notifyMac(title, body) {
	execFile('osascript', ['-e', `display notification ${JSON.stringify(body || '')} with title ${JSON.stringify(title)} sound name "Glass"`], { timeout: 8000 }, () => {})
}
function fire(title, body) {
	if (electronAlive()) enqueue(title, body)
	else notifyMac(title, body)
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
			const sessions = await Term.listLive()
			const now = {}
			for (const s of sessions) now[s.name] = stateOf(s)
			prev = now
		} catch (_) {}
		return
	}
	let sessions, built
	try {
		// "notify.cjs가 완전히 죽어있음" — Term.list()는 status 필드를 아예 안 채운다(status는
		// Term.listLive()에서만 계산됨). 그래서 stateOf()가 매번 'idle'만 리턴해 상태 전이가 절대
		// 감지 안 됐다 — 알림이 한 번도 안 울린 근본 원인.
		;[sessions, built] = await Promise.all([Term.listLive(), Tasks.build().catch(() => ({ tasks: [] }))])
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
		if (st === 'wait' && was === 'work') fire(`💬 ${f.title} — 질문 대기`, f.sub ? f.sub + ' (입력 필요)' : '입력이 필요합니다')
		else if (st === 'auth') fire(`⚠️ ${f.title} — 인증 필요`, f.sub || 'AWS/권한 확인')
		else if (st === 'idle' && was === 'work') fire(`✅ ${f.title} — 완료`, f.sub || '작업이 끝났습니다')
	}
	prev = now
}

function start() {
	tick()
	return setInterval(tick, 10000) // 10초마다 상태 전이 확인
}

// 에스컬레이션(§12) — 세션 상태 전이가 아니라 리뷰 재요청 횟수처럼 이 모듈의 tick()이 보지 못하는
// 이벤트용. "N회 초과 실패 → 대화 로그로만 에스컬레이션"은 질문대기/인증필요와 같은 문제(안 보면 놓침)라
// 지적됐던 부분 — 같은 알림 파이프에 태운다. tick()과 달리 호출한 쪽이 판단해 직접 부른다.
function notifyEscalation(title, body) {
	if (Settings.get('agentNotify') === false) return
	fire(`🚨 ${title}`, body || '')
}

module.exports = { start, notifyEscalation, heartbeat, drainPending }
