// debug/inspector.cjs — 디버그 세션의 엘리먼트 검사 / 네트워크·콘솔 조회 / 스레드(지시) 상태 (Phase 4b).
//
// - inspect : page.evaluate 로 in-browser 추출(원시 CDP DOM 도메인 대신 — 의도적 단순화).
// - thread  : prReview.applyReview 와 '완전히 동일한' 패턴으로 태스크의 라이브 오케스트레이션 세션에 Actuator 디스패치.
//             (별도 headless job 엔진을 만들지 않는다.) 없으면 applyReview와 같은 "먼저 오케스트레이션 시작" 에러.
// - reload  : 휴리스틱 — 디스패치 후 page load/framenavigated 를 ~15s 창 동안 관찰. 뜨면 reloading→done,
//             안 뜨면 timeout 후 done(정직한 근사 — 실제 완료감지는 Phase 6 Claude CLI contract 필요).
'use strict'
const { randomUUID } = require('crypto')
const BrowserPool = require('./browserPool.cjs')
const Term = require('../term.cjs')
const Actuator = require('../actuator.cjs')
const Orchestrator = require('../orchestrator.cjs')

const threads = new Map() // threadId → Thread(프론트 shape) + { sessionId, taskId }
const threadsBySession = new Map() // sessionId → [threadId]
const RELOAD_WINDOW_MS = 15000

// ── 엘리먼트 검사 — ElementInfoRow[] {key,label,value,accent?} (프론트 FIXTURE_ELEMENT_INFO와 동일 shape) ──
async function inspect(sessionId, x, y) {
	const rec = BrowserPool.getSession(sessionId)
	if (!rec) return { ok: false, error: 'session not found' }
	if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: 'x,y(viewport 좌표) 필수' }
	let rows
	try {
		rows = await rec.page.evaluate(([px, py]) => {
			const el = document.elementFromPoint(px, py)
			if (!el) return null
			const sel = (e) => {
				const tag = e.tagName.toLowerCase()
				const tid = e.getAttribute && e.getAttribute('data-testid')
				if (tid) return `${tag}[data-testid="${tid}"]`
				if (e.id) return `${tag}#${e.id}`
				const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => '.' + c).join('') : ''
				return tag + cls
			}
			const r = el.getBoundingClientRect()
			const cs = getComputedStyle(el)
			// React Fiber 워크(dev 빌드에서만 됨 — 없으면 그냥 빈 값, 정상). _debugSource로 파일:라인 시도.
			let component = ''
			let stateProps = ''
			try {
				const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
				if (fk) {
					let fiber = el[fk]
					let hops = 0
					while (fiber && hops < 6) {
						const t = fiber.type || fiber.elementType
						const name = typeof t === 'function' ? t.displayName || t.name : null
						if (name && /^[A-Z]/.test(name)) {
							let src = ''
							if (fiber._debugSource && fiber._debugSource.fileName) src = ' · ' + String(fiber._debugSource.fileName).split('/').pop() + ':' + fiber._debugSource.lineNumber
							component = '<' + name + '>' + src
							const props = fiber.memoizedProps || {}
							stateProps = Object.keys(props)
								.filter((k) => k !== 'children')
								.slice(0, 4)
								.map((k) => {
									let v = props[k]
									if (typeof v === 'function') v = 'fn'
									else if (v !== null && typeof v === 'object') v = '{…}'
									else v = JSON.stringify(v)
									return k + ':' + v
								})
								.join(' · ')
							break
						}
						fiber = fiber.return
						hops++
					}
				}
			} catch (_) {}
			return [
				{ key: 'selector', label: 'SELECTOR', value: sel(el), accent: true },
				{ key: 'component', label: 'COMPONENT', value: component || '(React fiber 없음 / prod 빌드)' },
				{ key: 'box', label: 'BOX', value: `${Math.round(r.width)} × ${Math.round(r.height)} · x:${Math.round(r.left)} y:${Math.round(r.top)}` },
				{ key: 'type', label: 'TYPOGRAPHY', value: `${cs.fontSize} / ${cs.fontWeight} / ${cs.lineHeight}` },
				{ key: 'computed', label: 'COMPUTED', value: `display:${cs.display} · gap:${cs.gap} · border-radius:${cs.borderRadius} · bg:${cs.backgroundColor}` },
				{ key: 'state', label: 'STATE / PROPS', value: stateProps || '(none)' },
			]
		}, [x, y])
	} catch (e) {
		return { ok: false, error: 'inspect 실패: ' + String((e && e.message) || e) }
	}
	if (!rows) return { ok: false, error: '해당 좌표에 엘리먼트 없음' }
	return { ok: true, rows }
}

// ring buffer 조회 — 최신 우선(reverse). 프론트 NetworkRow/ConsoleEntry shape 그대로.
function network(sessionId) {
	const rec = BrowserPool.getSession(sessionId)
	return rec ? rec.network.slice().reverse() : []
}
function consoleList(sessionId) {
	const rec = BrowserPool.getSession(sessionId)
	return rec ? rec.console.slice().reverse() : []
}

// ── 스레드(지시) ──
function elLabelFromAttach(attach) {
	if (!attach || typeof attach !== 'object') return ''
	return String(attach.selector || attach.ellabel || attach['el:selector'] || '').slice(0, 60)
}
function buildPrompt(cmd, attach) {
	let p = `[디버그 지시] ${cmd || '(명령 없음 · 첨부만)'}`
	if (attach && typeof attach === 'object') {
		const ctx = Object.entries(attach)
			.filter(([, v]) => v !== false && v != null && v !== '')
			.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
			.join('\n')
		if (ctx) p += `\n\n[첨부 컨텍스트]\n${ctx}`
	}
	p += `\n\n이 지시를 격리 워크트리에서 반영해 코드를 수정하고, 무엇을 왜 바꿨는지 한 줄로 요약해줘.`
	return p
}
function pubThread(t) {
	// 프론트 Thread shape만 노출(internal sessionId/taskId 제외)
	return { id: t.id, cmd: t.cmd, ellabel: t.ellabel, phase: t.phase, log: t.log, diff: t.diff, reply: t.reply, files: t.files }
}

// applyReview와 동일한 세션 해석 — findSessionForTask → Term.list 라이브 재검증(리네임 대비).
async function resolveTaskSession(taskId) {
	if (!taskId) return { error: '이 디버그 세션에 taskId가 없어 지시 대상 세션을 찾을 수 없습니다.' }
	const rec = Orchestrator.findSessionForTask(taskId)
	if (!rec) return { error: '이 태스크의 오케스트레이션 세션이 없습니다. 먼저 오케스트레이션을 시작하세요.' }
	const live = await Term.list().catch(() => [])
	const match = live.find((s) => s.name === rec.tmuxSession || Term.baseName(s.name) === Term.baseName(rec.tmuxSession))
	if (!match) return { error: '세션이 살아있지 않습니다. 먼저 오케스트레이션을 시작하세요.' }
	return { session: match.name }
}

// 휴리스틱 reload 감지 — page load/framenavigated(메인프레임)를 창 동안 관찰. (실제 HMR 프로토콜 감지 아님.)
function watchReload(sessionId, thread) {
	const rec = BrowserPool.getSession(sessionId)
	if (!rec) {
		thread.phase = 'done'
		thread.log = '완료 (세션 없음 — 근사 처리)'
		return
	}
	const page = rec.page
	let settled = false
	let timer = null
	const onLoad = () => finish(true)
	const onNav = (frame) => {
		if (frame === page.mainFrame()) finish(true)
	}
	function finish(viaReload) {
		if (settled) return
		settled = true
		try {
			page.off('load', onLoad)
			page.off('framenavigated', onNav)
		} catch (_) {}
		if (timer) clearTimeout(timer)
		if (viaReload) {
			thread.phase = 'reloading'
			thread.log = '프리뷰 갱신 감지 (load/navigate)'
			setTimeout(() => {
				thread.phase = 'done'
				thread.log = '완료 · 프리뷰 갱신됨'
			}, 800)
		} else {
			thread.phase = 'done'
			thread.log = '완료 (제한시간 내 프리뷰 갱신 이벤트 없음 — 근사 처리)'
		}
	}
	page.on('load', onLoad)
	page.on('framenavigated', onNav)
	timer = setTimeout(() => finish(false), RELOAD_WINDOW_MS)
}

async function createThread(sessionId, { cmd, attach } = {}) {
	const rec = BrowserPool.getSession(sessionId)
	if (!rec) return { ok: false, error: 'session not found' }
	const resolved = await resolveTaskSession(rec.taskId)
	if (resolved.error) return { ok: false, error: resolved.error }
	const d = await Actuator.dispatch({ session: resolved.session, message: buildPrompt(cmd, attach), dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
	if (!d.ok) return { ok: false, error: 'dispatch 실패: ' + (d.error || '') }
	const id = randomUUID()
	const thread = { id, sessionId, taskId: rec.taskId, cmd: cmd || '(첨부만 전송)', ellabel: elLabelFromAttach(attach), phase: 'working', log: '지시 전송됨 · 에이전트 반영 대기', diff: '', reply: '', files: [] }
	threads.set(id, thread)
	if (!threadsBySession.has(sessionId)) threadsBySession.set(sessionId, [])
	threadsBySession.get(sessionId).push(id)
	watchReload(sessionId, thread)
	return { ok: true, thread: pubThread(thread) }
}

function listThreads(sessionId) {
	return (threadsBySession.get(sessionId) || []).map((i) => threads.get(i)).filter(Boolean).map(pubThread)
}

async function followup(threadId, text) {
	const thread = threads.get(threadId)
	if (!thread) return { ok: false, error: 'thread not found' }
	const resolved = await resolveTaskSession(thread.taskId)
	if (resolved.error) return { ok: false, error: resolved.error }
	const d = await Actuator.dispatch({ session: resolved.session, message: `[후속 지시] ${text || ''}`, dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
	if (!d.ok) return { ok: false, error: 'dispatch 실패: ' + (d.error || '') }
	thread.phase = 'working'
	thread.log = '후속 지시 전송됨 · 반영 대기'
	watchReload(thread.sessionId, thread)
	return { ok: true, thread: pubThread(thread) }
}

module.exports = { inspect, network, consoleList, createThread, listThreads, followup }
