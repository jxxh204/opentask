// monitor.cjs — OpenRM이 직접 돌리는 PR·이슈 모니터 (cmux "10분 모니터링" 세션 대체).
// 단순 이벤트 로그가 아니라 "특이사항(findings) 추적기": 미해결 항목을 상태로 관리하고
// 같은 티켓의 PR을 링크하며, 해결됐다 재발하면 경보한다. 변화는 SSE로 토스트 푸시.
//   finding 출처: GitHub 이슈(involves:@me) · PR CI 실패 · PR 변경요청(CHANGES_REQUESTED)
//   상태: open(미해결) / resolved(해결-사라짐) / regression(재발)   + 링크된 PR(티켓 매칭)
'use strict'
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const Prs = require('./prs.cjs')
const C = require('./collector.cjs')
const Sentry = require('./sentry.cjs')
const Prompts = require('./prompts.cjs')
const Ticket = require('./ticket.cjs')
const AgentJobs = require('./store/agentJobs.cjs')
const AppCfg = require('./store/settings.cjs')
const StoreTasks = require('./store/tasks.cjs')
const { ghEnv } = require('./ghEnv.cjs')
// Setup 페이지의 githubRepo 설정을 매번 새로 읽음 — poll() 안에서 호출(모듈 로드 시 얼리지 않음).

const gh = (args) => new Promise((r) => execFile('gh', args, { timeout: 20000, maxBuffer: 8 << 20, env: ghEnv() }, (e, o) => r(e ? '' : String(o || ''))))
const ticketOf = Ticket.ticketOf
// 이슈 검색 필터 (기본: 내가 연루된 것. 전체 팀 이슈는 'state:open', 내가 만든 것은 'author:@me')
const ISSUE_SEARCH = process.env.OPENRM_MONITOR_ISSUE_SEARCH || 'involves:@me'

let intervalMs = Number(process.env.OPENRM_MONITOR_MS) || 180000 // 기본 3분
let timer = null
let running = false
let lastPoll = 0
let lastError = null
let polling = false
const findings = {} // key → finding (resolved는 tombstone으로 유지 → 재발 감지)
const events = [] // 최신순 토스트/로그 [{ id, ts, kind, level, title, detail, url, repo }]
let evId = 0
const listeners = new Set()
const PRUNE_MS = 3 * 24 * 3600 * 1000 // resolved tombstone 보존

function emit(ev) {
	ev.id = ++evId
	ev.ts = Date.now()
	events.unshift(ev)
	if (events.length > 150) events.length = 150
	for (const cb of listeners) {
		try {
			cb(ev)
		} catch (_) {}
	}
}

// 현재 폴에서 발견된 finding 1건 반영 (신규/재발/지속 판정 + PR 링크)
function upsert(now, key, base, prByTicket) {
	const pr = base.ticket ? prByTicket[base.ticket] || null : null
	const prev = findings[key]
	if (!prev) {
		findings[key] = { ...base, key, status: 'open', firstSeen: now, lastSeen: now, resolvedAt: null, recurred: false, pr }
		emit({ kind: base.kind + '-new', level: base.level, title: `${base.icon} ${base.title}`, detail: base.detail, url: base.url, repo: base.repo })
	} else if (prev.status === 'resolved') {
		// 해결됐던 게 다시 발견 → 재발
		Object.assign(prev, base, { status: 'regression', lastSeen: now, recurred: true, resolvedAt: null, pr })
		emit({ kind: 'regression', level: 'bad', title: `🔁 재발 ${base.title}`, detail: base.detail, url: base.url, repo: base.repo })
	} else {
		Object.assign(prev, base, { lastSeen: now, pr })
	}
}

async function poll(first = false) {
	if (polling) return
	polling = true
	const now = Date.now()
	const REPOS = AppCfg.prRepos()
	try {
		// PR(open+merged) → 티켓→PR 인덱스 (이슈 finding에 PR 링크용) + CI/리뷰 finding 출처
		const [open, merged] = await Promise.all([Prs.list('open'), Prs.list('merged').catch(() => ({ prs: [] }))])
		if (open.error) lastError = open.error
		const prByTicket = {}
		for (const p of [...(open.prs || []), ...(merged.prs || [])]) {
			const t = p.ticket
			if (!t) continue
			if (!prByTicket[t] || (prByTicket[t].state !== 'OPEN' && p.state === 'OPEN')) prByTicket[t] = { number: p.number, repo: p.repo, state: p.state, url: p.url, draft: p.draft }
		}

		const live = new Set()

		// 1) CI 실패 PR
		for (const p of open.prs || []) {
			if (p.ci !== 'fail') continue
			const key = `ci:${p.repo}#${p.number}`
			live.add(key)
			upsert(now, key, { kind: 'ci', icon: '❌', level: 'bad', title: `CI 실패 ${p.repo}#${p.number}`, detail: p.title, url: p.url, repo: p.repo, ticket: p.ticket, number: p.number }, prByTicket)
		}
		// 2) 변경요청 PR
		for (const p of open.prs || []) {
			if (p.review !== 'CHANGES_REQUESTED') continue
			const key = `review:${p.repo}#${p.number}`
			live.add(key)
			upsert(now, key, { kind: 'review', icon: '🔴', level: 'warn', title: `변경요청 ${p.repo}#${p.number}`, detail: p.title, url: p.url, repo: p.repo, ticket: p.ticket, number: p.number }, prByTicket)
		}
		// 3) 내가 연루된 열린 이슈
		for (const repo of REPOS) {
			const raw = await gh(['issue', 'list', '-R', repo.slug, '--search', ISSUE_SEARCH, '--state', 'open', '-L', '40', '--json', 'number,title,url,updatedAt'])
			let issues = []
			try {
				issues = JSON.parse(raw || '[]')
			} catch {
				continue
			}
			for (const it of issues) {
				const key = `issue:${repo.name}#${it.number}`
				live.add(key)
				upsert(now, key, { kind: 'issue', icon: '🐛', level: 'warn', title: `이슈 ${repo.name}#${it.number}`, detail: it.title, url: it.url, repo: repo.name, ticket: ticketOf(it.title) }, prByTicket)
			}
		}

		// 4) Sentry 미해결 에러 (직접 조회 — 스레드/Slack 경유 X). 설정됐을 때만.
		if (Sentry.configured()) {
			try {
				const issues = await Sentry.recentIssues({ statsPeriod: '24h', limit: 25 })
				for (const it of issues) {
					if (it.status && it.status !== 'unresolved') continue
					const key = `sentry:${it.shortId}`
					live.add(key)
					const level = it.level === 'fatal' || it.level === 'error' ? 'bad' : 'warn'
					upsert(now, key, { kind: 'sentry', icon: '🚨', level, title: `Sentry ${it.shortId}`, detail: `${it.title}${it.count ? ` · ${it.count}회` : ''}${it.userCount ? ` · ${it.userCount}명` : ''}`, url: it.url, repo: it.project }, prByTicket)
				}
			} catch (e) {
				lastError = 'Sentry: ' + String((e && e.message) || e)
			}
		}

		// 사라진 finding = 해결됨 (CI 통과 / 리뷰 통과 / 이슈 닫힘 / Sentry resolve)
		if (!first)
			for (const key of Object.keys(findings)) {
				const f = findings[key]
				if (live.has(key)) continue
				if (f.status === 'open' || f.status === 'regression') {
					f.status = 'resolved'
					f.resolvedAt = now
					emit({ kind: 'resolved', level: 'good', title: `✅ 해결됨 ${f.title}`, detail: f.detail, url: f.url, repo: f.repo })
				}
			}
		// 오래된 resolved tombstone 정리
		for (const key of Object.keys(findings)) {
			const f = findings[key]
			if (f.status === 'resolved' && f.resolvedAt && now - f.resolvedAt > PRUNE_MS) delete findings[key]
		}
		lastError = null
	} catch (e) {
		lastError = String((e && e.message) || e)
	} finally {
		lastPoll = Date.now()
		polling = false
	}
}

function start() {
	if (running) return
	running = true
	poll(true).catch(() => {}) // 베이스라인 (기존 미해결은 'open'으로 등록, 이벤트 없음)
	timer = setInterval(() => poll(false).catch(() => {}), intervalMs)
}
function stop() {
	running = false
	if (timer) clearInterval(timer)
	timer = null
}
function setIntervalMs(ms) {
	intervalMs = Math.max(30000, Number(ms) || intervalMs)
	if (running) {
		stop()
		start()
	}
	return intervalMs
}

function getState() {
	const list = Object.values(findings)
	const order = { regression: 0, open: 1, resolved: 2 }
	list.sort((a, b) => (order[a.status] - order[b.status]) || b.lastSeen - a.lastSeen)
	return {
		running,
		intervalMs,
		lastPoll,
		lastError,
		counts: {
			unresolved: list.filter((f) => f.status === 'open' || f.status === 'regression').length,
			regression: list.filter((f) => f.status === 'regression').length,
			withPr: list.filter((f) => (f.status === 'open' || f.status === 'regression') && f.pr).length,
			resolved: list.filter((f) => f.status === 'resolved').length,
		},
		findings: list,
		events: events.slice(0, 60),
	}
}
function subscribe(cb) {
	listeners.add(cb)
	return () => listeners.delete(cb)
}

// 토스트/SSE 배선 점검용 테스트 이벤트
function testEvent() {
	emit({ kind: 'test', level: 'info', title: '🔔 모니터 테스트 — 토스트 정상', detail: '특이사항 감지 시 이렇게 알립니다', url: null, repo: 'test' })
	return { ok: true }
}

// ── 🚨 장애 이슈 인박스 (모니터링 채널 → 저장 → 확인 → 업무 전환) ──
// OpenRM(Node)은 Slack을 못 읽으므로, headless claude(-p)가 alertChannel()(Slack 채널 ID)을 읽어
// 미해결 알림 목록을 JSON으로 회수 → 트래커에 저장. 새 미해결 알림은 토스트로 알린다. 미설정이면 비활성.
// Setup 페이지의 slackAlertChannel 설정을 매번 새로 읽음(과거엔 OPENRM_ALERT_CHANNEL 환경변수로 부팅 시
// 한 번만 얼려서, Setup에서 채널을 바꿔도 재시작 전까진 반영이 안 됐다 — REPO/PR_REPOS와 같은 종류의 버그).
function alertChannel() {
	return AppCfg.getAppConfig().slackAlertChannel || process.env.OPENRM_ALERT_CHANNEL || ''
}
const ALERTS_FILE = process.env.OPENRM_ALERTS_FILE || path.join(__dirname, '..', '.openrm-alerts.json')
const ALERT_CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'
let alerts = {}
let alertsFetchedAt = 0
let alertsFetching = false
let alertsTimer = null
let alertsIntervalMs = Number(process.env.OPENRM_ALERTS_MS) || 0 // 0=수동, >0=자동
try {
	alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'))
} catch (_) {
	alerts = {}
}
const saveAlerts = () => {
	try {
		fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2))
	} catch (_) {}
}

// 안정 알림 키 — claude id가 메시지 ts(매번 바뀜)면 못 믿으므로 Sentry Short ID/제목 정규화로 대체.
// 같은 이슈의 재발이 동일 키로 누적되도록.
function stableAlertKey(a) {
	const t = String(a.title || '') + ' ' + String(a.summary || '')
	// 1) CloudWatch 알람 이름 = 재fire마다 동일한 가장 안정적인 식별자 (웹훅 raw 텍스트엔 알람 이름이 들어옴).
	//    "...-4xx-count-alert" / "...-5xx-...-alert" 등. 먼저 잡아 임계값 숫자(100/60s)를 Sentry로 오인하는 걸 방지.
	const alarm = t.match(/\b([a-z0-9]+(?:-[a-z0-9]+)*-alert)\b/i)
	if (alarm) return 'alarm-' + alarm[1].toLowerCase()
	// 2) Sentry Short ID (전체 CRM-…-XXX 우선, 그 다음 "Sentry XXX", 마지막으로 글자 포함 bare short id만 — "100"·"150" 같은 순수 숫자 임계값은 제외)
	const sentry = t.match(/CRM-[A-Z]+-[A-Z]+-([0-9A-Z]{2,4})\b/) || t.match(/\bSentry\s+([0-9A-Z]{2,4})\b/) || t.match(/\b(1[0-9]{0,2}[A-Z][0-9A-Z]*)\b/)
	if (sentry) return 'sentry-' + sentry[1].toUpperCase()
	const id = String(a.id || '')
	if (id && !/^\d{5,}(\.\d+)?$/.test(id)) return id // ts가 아니면 claude id 사용
	// 폴백: 제목에서 숫자·시각 제거한 정규화 키
	return 'k-' + String(a.title || '').toLowerCase().replace(/[0-9:.]+/g, '').replace(/[^a-z가-힣]/g, '').slice(0, 40)
}
// 알림 1건을 트래커에 upsert (신규 등록 / 재발 감지) → 새 미해결이면 emit. 반환: 새로 알린 건수(0|1).
// fetchAlerts(claude -p 경유)와 ingestSlackEvent(웹훅 직접 수신)가 공유.
function upsertAlert(a, now) {
	now = now || Date.now()
	if (!a || (!a.id && !a.title)) return 0
	// 안정 키: id가 메시지 ts(긴 숫자)면 못 믿으니 Sentry Short ID나 제목 정규화로 대체 → 재발이 같은 항목으로 누적
	const id = stableAlertKey(a)
	const prev = alerts[id]
	const count = Math.max(1, Number(a.count) || 1)
	// resolved는 true라도 "배포/수정/정상화/mute 처리" 같은 명시적 해결 근거가 있을 때만 인정
	const isResolved = !!a.resolved && /배포|수정|정상화|해결|deployed|fixed|mute\s*(처리|함|완료)|롤백/i.test(String(a.summary || '') + ' ' + String(a.title || ''))
	// 구조화 요약 필드 (가독성) — 짧게 자름
	const clip = (v, n) => String(v || '').trim().slice(0, n) || null
	const struct = { symptom: clip(a.symptom, 200), impact: clip(a.impact, 80), source: clip(a.source, 40), status: clip(a.status, 40) }
	let added = 0
	if (!prev) {
		alerts[id] = { id, title: String(a.title || '알림').slice(0, 160), ts: a.ts || '', threadUrl: a.threadUrl || null, resolved: isResolved, count, summary: String(a.summary || '').slice(0, 400), ...struct, acked: false, converted: false, firstSeen: now, lastSeen: now }
		if (!alerts[id].resolved) {
			added++
			emit({ kind: 'alert-new', level: 'warn', title: `🚨 장애 이슈: ${alerts[id].title}${count > 1 ? ` (${count}회 반복)` : ''}`, detail: alerts[id].summary, url: alerts[id].threadUrl, repo: 'monitor' })
		}
	} else {
		// 재발 감지: 이전에 resolved/acked였는데 지금 active로 다시 잡힘 → 다시 알림
		const reappeared = (prev.resolved || prev.acked) && !isResolved
		prev.lastSeen = now
		prev.resolved = isResolved
		prev.count = Math.max(prev.count || 1, count)
		if (a.summary) prev.summary = String(a.summary).slice(0, 400)
		if (struct.symptom) prev.symptom = struct.symptom // 최신 구조화 요약으로 갱신
		if (struct.impact) prev.impact = struct.impact
		if (struct.source) prev.source = struct.source
		if (struct.status) prev.status = struct.status
		if (a.threadUrl && !prev.threadUrl) prev.threadUrl = a.threadUrl
		if (reappeared) {
			prev.acked = false // 재발했으니 다시 미확인으로
			prev.converted = false
			added++
			emit({ kind: 'alert-new', level: 'warn', title: `🔁 재발한 장애 이슈: ${prev.title}${prev.count > 1 ? ` (${prev.count}회)` : ''}`, detail: prev.summary, url: prev.threadUrl, repo: 'monitor' })
		}
	}
	// 같은 장애가 임계치(AppConfig.alertAutoConvertThreshold, 기본 3) 이상 반복되면 사람이 매번 "전환"을
	// 누르지 않아도 자동으로 개발실 미분류 업무를 만든다. 이미 전환됐거나 해결됐으면 건드리지 않음(중복 생성 방지).
	const rec = alerts[id]
	const threshold = Number(AppCfg.getAppConfig().alertAutoConvertThreshold) || 3
	if (!rec.resolved && !rec.converted && rec.count >= threshold) {
		try {
			const task = StoreTasks.create({ folderId: null, name: `[반복 ${rec.count}회] ${rec.title}`, desc: rec.summary || rec.symptom || '' })
			rec.converted = true
			rec.autoConvertedTaskId = task.id
			emit({ kind: 'alert-auto-convert', level: 'info', title: `📋 자동 업무 전환: ${rec.title} (${rec.count}회 반복)`, detail: '개발실 미분류에 추가됨', url: rec.threadUrl, repo: 'monitor' })
		} catch (_) {}
	}
	return added
}
async function fetchAlerts() {
	if (alertsFetching) return { ok: false, error: '이미 읽는 중입니다.' }
	alertsFetching = true
	const prompt = Prompts.render('monitor.alerts', { channelId: alertChannel() })
	const r = await new Promise((res) => {
		const child = execFile(ALERT_CLAUDE_BIN, ['-p', prompt, '--output-format', 'json'], { cwd: C.REPO, timeout: 150000, maxBuffer: 16 << 20, env: process.env }, (e, o, er) =>
			res({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') }),
		)
		try {
			child.stdin.end() // stdin 즉시 닫아 EOF — claude가 stdin 대기(3s 경고)하지 않게
		} catch (_) {}
	})
	alertsFetching = false
	alertsFetchedAt = Date.now()
	if (!r.ok) return { ok: false, error: '채널 읽기 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 140) || 'claude 실행 실패') }
	let text = r.out
	try {
		const j = JSON.parse(r.out)
		text = j.result || j.text || r.out
	} catch (_) {}
	let arr = null
	const m = String(text).match(/\[[\s\S]*\]/)
	if (m) {
		try {
			arr = JSON.parse(m[0])
		} catch (_) {}
	}
	if (!Array.isArray(arr)) return { ok: false, error: 'AI 응답 파싱 실패', raw: String(text).slice(0, 200) }
	const now = Date.now()
	let added = 0
	for (const a of arr) added += upsertAlert(a, now)
	saveAlerts()
	return { ok: true, total: arr.length, new: added }
}
// 🗣️ 실제 GitHub PR 리뷰(변경요청 등)에 이의/질문 — 리뷰 본문+라인 코멘트를 gh api로 가져와
// 헤드리스 claude가 코드를 재확인해 답변한다. mrm 대시보드 안에서만 표시(GitHub에 게시 X).
function slugForRepoName(name) {
	return (AppCfg.prRepos().find((r) => r.name === name) || {}).slug || name
}
async function fetchReviewText(slug, number) {
	const [reviewsRaw, commentsRaw] = await Promise.all([gh(['api', `repos/${slug}/pulls/${number}/reviews`]), gh(['api', `repos/${slug}/pulls/${number}/comments`])])
	let reviewArr = [],
		commentArr = []
	try {
		reviewArr = JSON.parse(reviewsRaw || '[]')
	} catch (_) {}
	try {
		commentArr = JSON.parse(commentsRaw || '[]')
	} catch (_) {}
	const parts = []
	for (const r of reviewArr) {
		if (!r.body && r.state === 'COMMENTED') continue
		parts.push(`[리뷰 by ${(r.user && r.user.login) || '?'} · ${r.state}]\n${r.body || '(본문 없음)'}`)
	}
	for (const c of commentArr) {
		parts.push(`[라인 코멘트 by ${(c.user && c.user.login) || '?'} · ${c.path}:${c.line || c.original_line || '?'}]\n${c.body}`)
	}
	return parts.join('\n\n').slice(0, 8000) || '(리뷰 본문을 찾지 못함 — CHANGES_REQUESTED 상태만 확인됨)'
}
async function askReviewFinding({ key, question }) {
	if (!question || !String(question).trim()) return { ok: false, error: '질문 내용을 입력하세요.' }
	const f = findings[key]
	if (!f) return { ok: false, error: '해당 항목을 찾을 수 없습니다(새로고침 후 재시도).' }
	if (!f.pr || !f.number) return { ok: false, error: 'PR 번호를 확인할 수 없습니다.' }
	const slug = slugForRepoName(f.repo)
	f.questioning = true
	try {
		const reviewText = await fetchReviewText(slug, f.number)
		const prompt = Prompts.render('review.question.external', { slug, number: f.number, reviewText, question: String(question).trim() })
		const r = await new Promise((res) => {
			const child = execFile(ALERT_CLAUDE_BIN, ['-p', prompt, '--output-format', 'json'], { cwd: C.REPO, timeout: 150000, maxBuffer: 16 << 20, env: process.env }, (e, o, er) =>
				res({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') }),
			)
			try {
				child.stdin.end()
			} catch (_) {}
		})
		if (!r.ok) {
			f.questioning = false
			return { ok: false, error: '답변 생성 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 140) || 'claude 실행 실패') }
		}
		let text = r.out
		try {
			const j = JSON.parse(r.out)
			text = j.result || j.text || r.out
		} catch (_) {}
		let data = null
		const m = String(text).match(/\{[\s\S]*\}/)
		if (m) {
			try {
				data = JSON.parse(m[0])
			} catch (_) {}
		}
		f.questioning = false
		f.question = {
			question: String(question).trim().slice(0, 1000),
			answer: data && data.answer ? String(data.answer).slice(0, 1500) : String(text || '(답변 파싱 실패)').slice(0, 1500),
			agreesWithObjection: !!(data && data.agreesWithObjection),
			at: Date.now(),
		}
		return { ok: true, key, question: f.question }
	} catch (err) {
		f.questioning = false
		return { ok: false, error: String((err && err.message) || err) }
	}
}
// 모니터 알림 → 액션: 임의 finding(Sentry/Vitals 등, PR 없어도 됨)을 사람 지시와 함께 headless claude로
// "조사"시킨다 — askReviewFinding과 달리 실제 코드 수정은 하지 않고 원인·제안만 회수(반영은 사람이 별도 진행).
async function dispatchAction({ key, instruction }) {
	if (!instruction || !String(instruction).trim()) return { ok: false, error: '지시 내용을 입력하세요.' }
	const f = findings[key]
	if (!f) return { ok: false, error: '해당 항목을 찾을 수 없습니다(새로고침 후 재시도).' }
	const job = AgentJobs.create({ kind: 'monitor-dispatch', cwd: C.REPO, refType: 'finding', refId: key, input: { instruction }, label: f.title })
	const prompt = Prompts.render('monitor.dispatch', { kind: f.kind, title: f.title, repo: f.repo || '', detail: f.detail || '', url: f.url || '', instruction: String(instruction).trim() })
	try {
		const r = await new Promise((res) => {
			const child = execFile(ALERT_CLAUDE_BIN, ['-p', prompt, '--output-format', 'json'], { cwd: C.REPO, timeout: 150000, maxBuffer: 16 << 20, env: process.env }, (e, o, er) =>
				res({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') }),
			)
			try {
				child.stdin.end()
			} catch (_) {}
		})
		if (!r.ok) {
			const result = { ok: false, error: '조사 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 140) || 'claude 실행 실패') }
			AgentJobs.markDone(job.id, result)
			return result
		}
		let text = r.out
		try {
			const j = JSON.parse(r.out)
			text = j.result || j.text || r.out
		} catch (_) {}
		let data = null
		const m = String(text).match(/\{[\s\S]*\}/)
		if (m) {
			try {
				data = JSON.parse(m[0])
			} catch (_) {}
		}
		const result = {
			ok: true,
			summary: (data && data.summary) || String(text || '').slice(0, 1500),
			rootCause: (data && data.rootCause) || null,
			suggestion: (data && data.suggestion) || null,
			confidence: (data && data.confidence) || null,
		}
		AgentJobs.markDone(job.id, result)
		return { ok: true, key, jobId: job.id, result }
	} catch (err) {
		const result = { ok: false, error: String((err && err.message) || err) }
		AgentJobs.markDone(job.id, result)
		return result
	}
}
function ackAlert({ id }) {
	if (alerts[id]) {
		alerts[id].acked = true
		saveAlerts()
	}
	return { ok: true }
}
function markAlertConverted({ id, taskKey }) {
	if (alerts[id]) {
		alerts[id].converted = true
		alerts[id].acked = true
		alerts[id].taskKey = taskKey || null
		saveAlerts()
	}
	return { ok: true }
}
function removeAlert({ id }) {
	if (alerts[id]) {
		delete alerts[id]
		saveAlerts()
	}
	return { ok: true }
}
function alertsState() {
	const list = Object.values(alerts)
	list.sort((a, b) => (a.resolved ? 1 : 0) - (b.resolved ? 1 : 0) || (a.acked ? 1 : 0) - (b.acked ? 1 : 0) || b.firstSeen - a.firstSeen)
	return {
		fetchedAt: alertsFetchedAt,
		fetching: alertsFetching,
		intervalMs: alertsIntervalMs,
		counts: { unresolved: list.filter((a) => !a.resolved && !a.acked).length, total: list.length },
		alerts: list.slice(0, 80),
	}
}
function setAlertsInterval(ms) {
	alertsIntervalMs = Math.max(0, Number(ms) || 0)
	if (alertsTimer) clearInterval(alertsTimer)
	alertsTimer = null
	if (alertsIntervalMs >= 60000) alertsTimer = setInterval(() => fetchAlerts().catch(() => {}), alertsIntervalMs)
	return alertsIntervalMs
}

// ── 🔗 Slack Events API 직접 수신 (claude -p 없이 인바운드) ──
// 채널 메시지 이벤트 1건을 알림 트래커에 반영. CloudWatch/Sentry 알림은 보통 bot_message
// (text + attachments/blocks)로 오므로 그 텍스트를 합쳐 파싱한다. index.cjs /api/slack/events 가 호출.
function slackEventText(ev) {
	let t = String(ev.text || '')
	for (const at of Array.isArray(ev.attachments) ? ev.attachments : []) {
		if (at.fallback) t += '\n' + at.fallback
		else {
			if (at.title) t += '\n' + at.title
			if (at.text) t += '\n' + at.text
		}
		for (const f of Array.isArray(at.fields) ? at.fields : []) if (f && f.value) t += '\n' + (f.title ? f.title + ': ' : '') + f.value
	}
	for (const b of Array.isArray(ev.blocks) ? ev.blocks : []) {
		if (b && b.text && b.text.text) t += '\n' + b.text.text
		for (const f of Array.isArray(b && b.fields) ? b.fields : []) if (f && f.text) t += '\n' + f.text
	}
	// Slack 링크 문법 정리: <url|label> → label, <url> → url
	return t.replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1').replace(/\r/g, '').trim()
}
function tsToHHMM(ts) {
	const sec = Number(String(ts).split('.')[0])
	if (!sec) return ''
	try {
		return new Date(sec * 1000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
	} catch (_) {
		return ''
	}
}
function ingestSlackEvent(ev) {
	if (!ev || ev.type !== 'message') return { ok: false, ignored: 'not-message' }
	// 다른 채널이면 무시 (모니터링 채널만)
	if (ev.channel && ev.channel !== alertChannel()) return { ok: false, ignored: 'other-channel' }
	// 편집/삭제/조인 등 서브타입은 무시 — 일반 메시지 + 봇 알림 + 스레드-브로드캐스트만
	if (ev.subtype && !['bot_message', 'thread_broadcast'].includes(ev.subtype)) return { ok: false, ignored: 'subtype:' + ev.subtype }
	const text = slackEventText(ev)
	if (!text) return { ok: false, ignored: 'empty' }
	const firstLine = (text.split('\n').find((l) => l.trim()) || text).trim()
	const a = {
		id: ev.ts || '', // 안정키는 stableAlertKey가 text에서 Sentry Short ID 추출로 대체 (ts는 dedup에 부적합)
		title: firstLine.slice(0, 160),
		summary: text.slice(0, 400),
		ts: tsToHHMM(ev.ts),
		threadUrl: null,
		source: 'slack',
		count: 1,
	}
	const added = upsertAlert(a)
	saveAlerts()
	alertsFetchedAt = Date.now()
	return { ok: true, id: stableAlertKey(a), new: added }
}

// ── Claude 모니터링 루프 (진짜 트리아지는 Claude가 — 코드는 띄우고 상태만 본다) ──
// 대상 레포에서 claude를 띄우고 `/loop <N>m <skill>` 전송. tmux라 OpenRM 재시작에도 생존.
// 루프 2종: ops(운영 장애 모니터링) · pr(PR 점검 모니터링) — 각각 독립 tmux 세션.
const LOOPS = {
	ops: { session: 'orm-monitor', label: '운영', skill: process.env.OPENRM_MONITOR_SKILL || '/crm-ops-monitoring', defaultMin: 10 },
	pr: { session: 'orm-pr-monitor', label: 'PR', skill: process.env.OPENRM_PR_MONITOR_SKILL || '/crm-ops-monitoring --pr-only', defaultMin: 15 },
}
// 루프 간격은 "초" 단위로 관리 (PR 루프는 최소 30초까지). /loop 명령엔 30s / 15m 형태로.
const loopSec = { ops: LOOPS.ops.defaultMin * 60, pr: 30 } // PR 루프 기본 30초
const loopCfg = (kind) => LOOPS[kind] || LOOPS.ops
const loopKind = (kind) => (LOOPS[kind] ? kind : 'ops')
function fmtDur(sec) {
	sec = Math.max(30, Math.round(Number(sec) || 60))
	return sec % 60 === 0 ? sec / 60 + 'm' : sec + 's' // 60의 배수면 분, 아니면 초
}
function fmtLabel(sec) {
	sec = Math.max(30, Math.round(Number(sec) || 60))
	return sec % 60 === 0 ? sec / 60 + '분' : sec + '초'
}

function tmux(args, t = 5000) {
	return new Promise((r) => execFile('tmux', args, { timeout: t, maxBuffer: 4 << 20, env: process.env }, (e, o) => r({ ok: !e, out: String(o || '') })))
}

async function claudeStatus(kind = 'ops') {
	kind = loopKind(kind)
	const cfg = loopCfg(kind)
	const has = await tmux(['has-session', '-t', cfg.session])
	if (!has.ok) return { running: false, kind, session: cfg.session, loopSec: loopSec[kind], loopLabel: fmtLabel(loopSec[kind]), label: cfg.label, skill: cfg.skill }
	const scr = await tmux(['capture-pane', '-t', cfg.session, '-p'])
	const text = scr.out
	const working = /esc to interrupt/.test(text) // claude가 작업 중
	const needsAuth = /MFA|ExpiredToken|재인증|인증.*만료|AccessDenied|권한.*요청/i.test(text)
	const waiting = !working && /❯|to manage|for agents|Do you want|계속할까|진행할까/.test(text)
	const tail = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' · ').slice(0, 200)
	return { running: true, kind, session: cfg.session, loopSec: loopSec[kind], loopLabel: fmtLabel(loopSec[kind]), label: cfg.label, skill: cfg.skill, working, needsAuth, waiting, tail }
}

async function startClaude(intervalSec, kind = 'ops') {
	kind = loopKind(kind)
	const cfg = loopCfg(kind)
	if (intervalSec) loopSec[kind] = Math.max(30, Math.round(Number(intervalSec)) || loopSec[kind]) // 최소 30초
	const has = await tmux(['has-session', '-t', cfg.session])
	if (has.ok) return { ok: true, already: true, kind, session: cfg.session }
	const made = await tmux(['new-session', '-d', '-s', cfg.session, '-c', C.REPO, '-x', '220', '-y', '50', '-e', 'LANG=en_US.UTF-8'])
	if (!made.ok) return { ok: false, error: 'tmux 세션 생성 실패 (tmux 설치/권한 확인)' }
	await tmux(['send-keys', '-t', cfg.session, `claude --model ${require('./settings.cjs').modelFor('monitor')}`, 'Enter'])
	// claude TUI가 뜰 시간 후 루프 명령 주입 (30s / 15m 형태)
	setTimeout(() => {
		tmux(['send-keys', '-t', cfg.session, `/loop ${fmtDur(loopSec[kind])} ${cfg.skill}`, 'Enter']).catch(() => {})
	}, 6000)
	emit({ kind: 'claude-loop', level: 'info', title: `🤖 ${cfg.label} 모니터링 루프 시작`, detail: `${fmtLabel(loopSec[kind])} 루프 · ${cfg.skill}`, repo: 'monitor' })
	return { ok: true, started: true, kind, session: cfg.session, loopSec: loopSec[kind] }
}

async function stopClaude(kind = 'ops') {
	kind = loopKind(kind)
	const cfg = loopCfg(kind)
	const has = await tmux(['has-session', '-t', cfg.session])
	if (!has.ok) return { ok: true, already: true }
	await tmux(['kill-session', '-t', cfg.session])
	emit({ kind: 'claude-loop', level: 'info', title: `🤖 ${cfg.label} 모니터링 루프 정지`, repo: 'monitor' })
	return { ok: true }
}

module.exports = { start, stop, poll, setIntervalMs, getState, subscribe, testEvent, claudeStatus, startClaude, stopClaude, fetchAlerts, ackAlert, markAlertConverted, removeAlert, alertsState, setAlertsInterval, ingestSlackEvent, askReviewFinding, dispatchAction }
