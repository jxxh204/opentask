// tasks.cjs — '업무' 집계기. 작업 스트림(워크트리)만 보면 뭔지 모르니, 티켓(업무) 단위로 묶고
// 스레드(슬랙)·노션·피그마 링크를 함께 단다. 링크는 PR 본문에서 자동 추출 + 수동 레지스트리로 보강.
//   업무(티켓) > { 스레드[], 노션[], 피그마[], 작업 스트림[] }
'use strict'
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const C = require('./collector.cjs')
const Cockpit = require('./cockpit.cjs')
const Worktrees = require('./worktrees.cjs')
const Term = require('./term.cjs')
const Settings = require('./settings.cjs')
const Prompts = require('./prompts.cjs')
const NT = require('./notiontitles.cjs')
const Ticket = require('./ticket.cjs')

const REG_FILE = process.env.OPENRM_TASKS_FILE || path.join(__dirname, '..', '.openrm-tasks.json')
const REPOS = (process.env.OPENRM_PR_REPOS
	? process.env.OPENRM_PR_REPOS.split(',').map((s) => s.trim()).filter(Boolean)
	: []
).map((slug) => ({ slug, name: slug.split('/').pop() }))

const gh = (args) => new Promise((r) => execFile('gh', args, { timeout: 20000, maxBuffer: 8 << 20 }, (e, o) => r(e ? '' : String(o || ''))))
// 에러까지 회수하는 실행기 (삭제 등 쓰기 작업용)
const ghX = (args) => new Promise((r) => execFile('gh', args, { timeout: 30000, maxBuffer: 8 << 20 }, (e, o, er) => r({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') })))
const gitX = (args) => new Promise((r) => execFile('git', ['-C', C.REPO, ...args], { timeout: 30000, maxBuffer: 4 << 20 }, (e, o, er) => r({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') })))
const ticketOf = Ticket.ticketOf
// PR 표면(surface) — 한 업무가 jsp(백엔드 템플릿)·web(PC)·webview(모바일) 여러 PR로 나뉠 수 있어 구분 표기.
// 백엔드 레포 = jsp, 그 외는 브랜치/제목 키워드로 webview·web 추론(불명이면 null → 배지 없음).
const prSurface = (repoName, branch, title) => {
	if (/backend|jsp/i.test(repoName || '')) return 'jsp'
	const s = ((branch || '') + ' ' + (title || '')).toLowerCase()
	if (/webview|web-view|웹뷰|\bwv\b/.test(s)) return 'webview'
	if (/\bjsp\b/.test(s)) return 'jsp'
	if (/\bweb\b|\bpc\b|데스크|웹\b/.test(s)) return 'web'
	return null
}
// 현재 GitHub 사용자(=나). PR 자동 클로즈를 "내 PR"로만 제한하는 안전장치.
let _me = null
async function ghMe() {
	if (_me !== null) return _me
	const r = await ghX(['api', 'user', '--jq', '.login'])
	_me = r.ok ? r.out.trim() : ''
	return _me
}
function ciSummary(rollup) {
	if (!Array.isArray(rollup) || !rollup.length) return 'none'
	let fail = 0,
		pend = 0
	for (const c of rollup) {
		const s = String(c.conclusion || c.state || '').toUpperCase()
		if (/FAIL|ERROR|CANCELL|TIMED|ACTION_REQUIRED/.test(s)) fail++
		else if (!/SUCCESS|NEUTRAL|SKIPPED|COMPLETED/.test(s)) pend++
	}
	return fail ? 'fail' : pend ? 'pending' : 'pass'
}
const KINDS = ['slack', 'notion', 'figma']
const META_KEY = '__meta' // 레지스트리 내 그룹 목록 등 메타 (티켓 키와 충돌 안 함)

function linkKind(url) {
	if (/notion\.(so|com)|notion\.site/i.test(url)) return 'notion'
	if (/figma\.com/i.test(url)) return 'figma'
	if (/slack\.com/i.test(url)) return 'slack'
	return 'etc'
}
function extractLinks(text) {
	const urls = String(text || '').match(/https?:\/\/[^\s)\]\}"'<>]+/g) || []
	const out = { slack: [], notion: [], figma: [] }
	for (const u0 of urls) {
		const u = u0.replace(/[.,]+$/, '')
		const k = linkKind(u)
		if (out[k] && !out[k].includes(u)) out[k].push(u)
	}
	return out
}

function loadReg() {
	try {
		return JSON.parse(fs.readFileSync(REG_FILE, 'utf8'))
	} catch (_) {
		return {}
	}
}
function saveReg(r) {
	try {
		fs.writeFileSync(REG_FILE, JSON.stringify(r, null, 2))
		return true
	} catch (_) {
		return false
	}
}

// 서버 재시작 시, 이전 서버가 남긴 '진행 중' 플래그를 정리 — 재시작으로 잡(claude)이 죽으면 finalize가 못 돌아
// reviewing/applying/improving/questioning/opsRunning 이 영구히 남아 카드가 '리뷰중'에 걸린다. 부팅 시 한 번 리셋.
function clearStaleJobFlags() {
	try {
		const reg = loadReg()
		let changed = false
		for (const e of Object.values(reg)) {
			if (!e || typeof e !== 'object') continue
			if (e.opsRunning) { delete e.opsRunning; changed = true }
			if (e.prReviews) {
				for (const rv of Object.values(e.prReviews)) {
					for (const f of ['reviewing', 'improving', 'applying', 'questioning']) {
						if (rv && rv[f]) { rv[f] = false; changed = true }
					}
				}
			}
		}
		if (changed) saveReg(reg)
	} catch (_) {}
}
clearStaleJobFlags() // require 시(=서버 부팅 시) 1회 실행

// PR(open) 본문 → 티켓별 링크 + PR 목록 (60초 캐시)
let prCache = { at: 0, byTicket: {} }
async function prBodies() {
	if (Date.now() - prCache.at < 60000 && prCache.at) return prCache.byTicket
	const byTicket = {}
	for (const repo of REPOS) {
		// ⚠️ 안전: 내 PR만 (--author @me). 남의 PR이 업무에 붙어 실수로 닫히는 것을 원천 차단.
		// --state all: 열린 PR + 최근 머지/클로즈된 내 PR까지(정리 대상 판단용). 최근순 80개.
		const raw = await gh(['pr', 'list', '-R', repo.slug, '--author', '@me', '--state', 'all', '-L', '80', '--json', 'number,title,headRefName,baseRefName,body,url,state,isDraft,statusCheckRollup,reviewDecision'])
		let prs = []
		try {
			prs = JSON.parse(raw || '[]')
		} catch {
			continue
		}
		for (const p of prs) {
			const t = ticketOf(p.headRefName) || ticketOf(p.title)
			if (!t) continue
			const links = extractLinks((p.title || '') + '\n' + (p.body || ''))
			const e = byTicket[t] || (byTicket[t] = { slack: [], notion: [], figma: [], prs: [] })
			e.prs.push({ number: p.number, repo: repo.name, branch: p.headRefName || null, base: p.baseRefName || null, surface: prSurface(repo.name, p.headRefName, p.title), url: p.url, title: p.title, state: p.state, draft: !!p.isDraft, ci: ciSummary(p.statusCheckRollup), reviewDecision: p.reviewDecision || null, mine: true })
			for (const k of KINDS) for (const u of links[k]) if (!e[k].includes(u)) e[k].push(u)
		}
	}
	// 최신 PR 우선 + 같은 티켓 PR 정렬(OPEN 먼저)
	const stOrder = { OPEN: 0, CLOSED: 1, MERGED: 2 }
	for (const t of Object.keys(byTicket)) byTicket[t].prs.sort((a, b) => (stOrder[a.state] ?? 3) - (stOrder[b.state] ?? 3) || b.number - a.number)
	prCache = { at: Date.now(), byTicket }
	return byTicket
}

const streamScore = (s) => (s.dev && s.dev.length ? 4 : 0) + (s.dirty ? 2 : 0) + (s.pr ? 1 : 0) + (s.ahead ? 1 : 0)

// 빌드 캐시 (stale-while-revalidate) — 무거운 gh 호출이 있어 로딩이 길다.
// 캐시가 있으면 즉시 반환하고, 오래됐으면 백그라운드로만 갱신해 다음 호출을 빠르게.
let buildCache = { at: 0, data: null, building: false }
const BUILD_FRESH = 20000 // 20초 내면 그대로
function rebuild() {
	buildCache.building = true
	return buildInner()
		.then((data) => {
			buildCache = { at: Date.now(), data, building: false }
			return data
		})
		.catch((e) => {
			buildCache.building = false
			throw e
		})
}
async function build({ force } = {}) {
	const age = Date.now() - buildCache.at
	if (buildCache.data && !force) {
		if (age < BUILD_FRESH) return buildCache.data // 신선 → 즉시
		if (!buildCache.building) rebuild().catch(() => {}) // 오래됨 → 백그라운드 갱신, 일단 stale 반환
		return buildCache.data
	}
	return rebuild() // 캐시 없음(첫 로딩) 또는 강제 → 기다림
}
const bustBuild = () => {
	buildCache.at = 0
}
// 캐시된 결과를 제자리에서 수정 (그룹핑처럼 gh 재조회가 필요 없는 변경 → 즉시 반영, 리빌드 없음)
function patchCache(fn) {
	if (buildCache.data) {
		try {
			fn(buildCache.data)
		} catch (_) {}
	}
}

// 업무 보드: active 워크트리를 티켓(업무)으로 묶고 링크 부착
async function buildInner() {
	const [ck, pb] = await Promise.all([Cockpit.cockpit().catch(() => ({ active: [] })), prBodies().catch(() => ({}))])
	const reg = loadReg()
	const streams = ck.active || []
	const tasks = {}
	for (const s of streams) {
		if (s.isMain) continue // main 레포는 업무 아님
		const key = s.ticket || s.name
		const t = tasks[key] || (tasks[key] = { key, ticket: s.ticket || null, title: null, streams: [], links: { slack: [], notion: [], figma: [] }, prs: [] })
		t.streams.push(s)
	}
	for (const key of Object.keys(tasks)) {
		const t = tasks[key]
		const pbt = t.ticket ? pb[t.ticket] : null
		if (pbt) {
			for (const k of KINDS) for (const u of pbt[k]) if (!t.links[k].includes(u)) t.links[k].push(u)
			t.prs = pbt.prs
		}
		const rg = reg[key] || (t.ticket && reg[t.ticket]) || {}
		if (rg.links) for (const k of KINDS) for (const u of rg.links[k] || []) if (!t.links[k].includes(u)) t.links[k].push(u)
		t.title = rg.title || (t.prs[0] && t.prs[0].title) || (t.streams[0] && (t.streams[0].lastSubject || t.streams[0].branch)) || t.key
		t.summary = rg.summary || null
		t.group = rg.group || null
		t.manual = !!rg.manual
		for (const p of rg.manualPrs || []) if (!t.prs.some((x) => x.repo === p.repo && x.number === p.number)) t.prs.push(p)
	}
	// 레지스트리 전용(스트림 없는) 업무 — 내가 링크로 만든 업무. 아직 워크트리가 없어도 보드에 뜬다.
	for (const key of Object.keys(reg)) {
		if (key === META_KEY || tasks[key]) continue
		const rg = reg[key]
		const ticket = ticketOf(key)
		if (ticket && tasks[ticket]) continue // 이미 티켓 업무에 병합됨
		const t = { key, ticket, title: null, streams: [], links: { slack: [], notion: [], figma: [] }, prs: [], manual: true }
		const pbt = ticket ? pb[ticket] : null
		if (pbt) {
			for (const k of KINDS) for (const u of pbt[k]) t.links[k].push(u)
			t.prs = pbt.prs
		}
		if (rg.links) for (const k of KINDS) for (const u of rg.links[k] || []) if (!t.links[k].includes(u)) t.links[k].push(u)
		for (const p of rg.manualPrs || []) if (!t.prs.some((x) => x.repo === p.repo && x.number === p.number)) t.prs.push(p)
		t.title = rg.title || (t.prs[0] && t.prs[0].title) || ticket || '(제목 미정 — 클릭해 수정)'
		t.summary = rg.summary || null
		t.group = rg.group || null
		tasks[key] = t
	}
	// PR은 있는데 워크트리가 없는 업무 — 열린 PR만(머지/클로즈 잔재는 제외). 정리 대상 가시화.
	for (const tk of Object.keys(pb)) {
		if (tasks[tk]) continue
		const pbt = pb[tk]
		if (!pbt.prs.some((p) => p.state === 'OPEN')) continue
		const rg = reg[tk] || {}
		const t = { key: tk, ticket: tk, title: null, summary: rg.summary || null, group: rg.group || null, streams: [], links: { slack: [], notion: [], figma: [] }, prs: pbt.prs, manual: false, noWorktree: true }
		for (const k of KINDS) for (const u of pbt[k]) t.links[k].push(u)
		if (rg.links) for (const k of KINDS) for (const u of rg.links[k] || []) if (!t.links[k].includes(u)) t.links[k].push(u)
		t.title = rg.title || (t.prs[0] && t.prs[0].title) || tk
		tasks[tk] = t
	}
	for (const key of Object.keys(tasks)) {
		const t = tasks[key]
		const rgd = reg[key] || (t.ticket && reg[t.ticket]) || {}
		t.devServer = rgd.devServer || null // 운영자가 카드에서 지정한 배포 dev 서버(dev1~6)
		t.memo = rgd.memo || null // 운영자가 카드에 적은 메모
		t.tc = rgd.tc || null // 이 업무의 TC(Notion DB) URL — QA 완료 시 등록, E2E 버튼 활성 판단
		t.devModel = rgd.devModel || null // ▶진행 시 쓸 모델 override (간단한 작업은 sonnet/haiku)
		t.order = typeof rgd.order === 'number' ? rgd.order : null // 그룹 내 수동 순서 (드래그 재정렬)
		t.taskClass = rgd.class || null // 코드/비개발 판정: dev | ops | unsure | null(미판정)
		t.classReason = rgd.classReason || null
		t.classConfidence = typeof rgd.classConfidence === 'number' ? rgd.classConfidence : null
		t.classPlan = rgd.classPlan || null // ops일 때 워크트리 없이 처리하는 방법
		t.classManual = !!rgd.classManual // 운영자가 모달로 확정했는지
		t.opsResult = rgd.opsResult || null // 비개발 처리 결과 {summary, artifacts, needsHuman, ask, at}
		t.opsRunning = !!rgd.opsRunning // 비개발 처리 진행 중
		t.prReviews = rgd.prReviews || null // { 'repo#num': {reviewing, review, reviewedAt, improving, improved} }
		const closedPr = t.prs.some((p) => p.state === 'CLOSED') // 닫힌 PR = 정리 후보 → 위로
		if (!t.streams.length && t.prs.length) t.noWorktree = true
		t.score = (t.manual ? 8 : 0) + (closedPr ? 6 : 0) + (t.streams.length ? Math.max(0, ...t.streams.map(streamScore)) : 0)
		t.linkCount = t.links.slack.length + t.links.notion.length + t.links.figma.length
	}
	const list = Object.values(tasks).sort((a, b) => b.score - a.score || b.linkCount - a.linkCount)
	const groups = Array.isArray(reg[META_KEY] && reg[META_KEY].groups) ? reg[META_KEY].groups : []
	const groupBases = (reg[META_KEY] && reg[META_KEY].groupBase) || {} // { 그룹명: base 브랜치 }
	const chainedGroups = (reg[META_KEY] && reg[META_KEY].chain) || {} // { 그룹명: true } — 체인 모드
	return { ok: true, tasks: list, groups, groupBases, chainedGroups, count: list.length, builtAt: new Date().toISOString() }
}

// GitHub PR/이슈 URL → 그 PR로 업무 생성 (워크트리·머지여부 무관하게 PR만 있어도 추가).
async function addPrFromUrl({ owner, repoName, kind, number, title }) {
	const slug = `${owner}/${repoName}`
	const repoShort = repoName.replace(new RegExp('^' + (process.env.OPENRM_REPO_PREFIX || '') + '(?=.)'), '')
	let pr = null
	if (kind === 'pull') {
		const r = await ghX(['pr', 'view', String(number), '-R', slug, '--json', 'number,title,headRefName,url,state,isDraft,statusCheckRollup,author'])
		if (!r.ok) return { ok: false, error: 'PR 조회 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 120)) }
		try {
			pr = JSON.parse(r.out)
		} catch (_) {
			return { ok: false, error: 'PR 응답 파싱 실패' }
		}
	} else {
		const r = await ghX(['issue', 'view', String(number), '-R', slug, '--json', 'number,title,url,state,author'])
		if (!r.ok) return { ok: false, error: '이슈 조회 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 120)) }
		try {
			pr = JSON.parse(r.out)
		} catch (_) {
			return { ok: false, error: '이슈 응답 파싱 실패' }
		}
	}
	const tkt = ticketOf((pr.headRefName || '') + ' ' + (pr.title || ''))
	const key = tkt || `pr-${repoShort}-${number}`
	const me = await ghMe()
	const author = (pr.author && pr.author.login) || null
	const prObj = { number: pr.number, repo: repoShort, branch: pr.headRefName || null, surface: prSurface(repoShort, pr.headRefName, pr.title), url: pr.url, title: pr.title, state: pr.state || 'OPEN', draft: !!pr.isDraft, ci: ciSummary(pr.statusCheckRollup), author, mine: !!me && author === me }
	const reg = loadReg()
	const e = reg[key] || (reg[key] = { manual: true })
	e.manual = true
	if (title && title.trim()) e.title = title.trim()
	else if (!e.title) e.title = pr.title
	const mp = e.manualPrs || (e.manualPrs = [])
	if (!mp.some((p) => p.repo === prObj.repo && p.number === prObj.number)) mp.push(prObj)
	if (!saveReg(reg)) return { ok: false, error: '레지스트리 저장 실패' }
	prCache.at = 0
	bustBuild()
	return { ok: true, key, ticket: tkt, kind: 'pr', pr: prObj }
}

// 내가 링크(스레드/노션/PR)를 주면 그걸로 업무 생성. 텍스트에서 티켓 자동추출 →
// 있으면 그 티켓 업무에 바인딩, 없으면 독립 업무. 종류는 URL로 자동판별.
async function createFromLink({ url, text, ticket, title }) {
	const raw = String(url || text || '').trim()
	if (!raw) return { ok: false, error: '링크나 내용을 입력해 주세요.' }
	const m = raw.match(/https?:\/\/[^\s)\]\}"'<>]+/)
	const link = m ? m[0].replace(/[.,]+$/, '') : ''
	// GitHub PR/이슈 링크면 그 PR로 업무 생성
	const ghm = link && link.match(/github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/)
	if (ghm) return addPrFromUrl({ owner: ghm[1], repoName: ghm[2], kind: ghm[3], number: Number(ghm[4]), title })
	const kind = link ? linkKind(link) : null
	const known = kind && KINDS.includes(kind)
	const tkt = (ticket && String(ticket).trim()) || ticketOf(raw) || null
	// 티켓 없으면 유니크 키 (동시/연속 생성 시 충돌 방지)
	const key = tkt || 'task-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e5).toString(36)
	const reg = loadReg()
	const e = reg[key] || (reg[key] = { manual: true })
	e.manual = true
	// 제목: 명시 title > 기존 > (링크 없거나 미인식이면) 입력 텍스트에서 링크 제거한 내용
	if (title && title.trim()) e.title = title.trim().slice(0, 120)
	else if (!e.title && (!known || !link)) {
		const t = raw.replace(/https?:\/\/[^\s)\]\}"'<>]+/g, '').replace(/\s+/g, ' ').trim()
		if (t) e.title = t.slice(0, 120)
	}
	if (known) {
		const links = e.links || (e.links = {})
		const arr = links[kind] || (links[kind] = [])
		if (!arr.includes(link)) arr.push(link)
	}
	if (!saveReg(reg)) return { ok: false, error: '레지스트리 저장 실패' }
	prCache.at = 0
	bustBuild()
	// 등록 직후 백그라운드 자동 분류(코드/비개발) — 아직 판정 없을 때만. 결과는 상단 진행바 + 카드 배지로.
	if (!e.class) try { startClassify({ key }) } catch (_) {}
	return { ok: true, key, ticket: tkt, kind: known ? kind : 'text' }
}

// 🧵 스레드 읽어서 일감 만들기 — headless claude(-p)가 Slack MCP로 스레드+링크된 Notion/Figma를
// 읽고 {제목·티켓·요약·notion·figma} JSON을 뽑아 업무 레지스트리에 채운다. (느림: 보통 30~120초)
const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'

// 제목(한글) → 짧은 영어 브랜치 슬러그. 영어 위주면 그대로, 아니면 claude로 번역(실패 시 영어 단어 추출 폴백).
async function translateToEnglishSlug(text) {
	const t = String(text || '').trim()
	if (!t) return ''
	const base = t.replace(/^(fix|chore|feat|test|refactor|docs|style|perf)\s*(\([^)]*\))?\s*:?\s*/i, '').replace(Ticket.re('gi'), '')
	const enWords = (base.match(/[a-zA-Z][a-zA-Z0-9]*/g) || []).map((w) => w.toLowerCase())
	const fb = enWords.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
	const koCount = (base.match(/[가-힣]/g) || []).length
	if (koCount === 0 && fb) return fb // 이미 영어
	try {
		const r = await new Promise((res) => {
			const child = execFile(
				CLAUDE_BIN,
				['-p', `Translate this Korean software task title into a concise English git branch slug: 2-4 words, all lowercase, hyphen-separated, no ticket numbers, no quotes/backticks. Output ONLY the slug.\n\n${t}`, '--output-format', 'json', '--model', Settings.modelFor('translate')],
				{ cwd: C.REPO, timeout: 45000, maxBuffer: 4 << 20, env: process.env },
				(e, o) => res({ ok: !e, out: String(o || '') }),
			)
			try {
				child.stdin.end()
			} catch (_) {}
		})
		let out = r.out
		try {
			out = JSON.parse(r.out).result || out
		} catch (_) {}
		const slug = String(out).trim().toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
		if (slug) return slug
	} catch (_) {}
	return fb
}

// 링크 종류(slack/notion/figma)에 맞는 MCP로 읽어 일감으로 정리하는 프롬프트
const ENRICH_PROMPT = (link) => {
	const k = linkKind(link)
	const label = k === 'notion' ? 'Notion 페이지' : k === 'figma' ? 'Figma 디자인' : k === 'slack' ? 'Slack 스레드' : '링크'
	const how =
		k === 'notion'
			? 'Notion MCP(notion-fetch)로 페이지 본문·하위 블록을 읽고'
			: k === 'figma'
			? 'Figma MCP(get_design_context·get_metadata·get_screenshot)로 화면 구성·프레임 이름·핵심 UI를 파악하고 (MCP 접근 불가면 링크·이름만으로 최선 추정)'
			: 'Slack MCP로 스레드 본문·댓글을 읽고'
	return [
		`아래 ${label} 를 ${how}, 거기서 참조하는 Slack·Notion·Figma 링크와 핵심 내용을 개발 일감으로 정리해줘.`,
		'설명·코드블록 없이 아래 JSON 객체 "하나만" 출력해:',
		`{"title":"업무 한 줄 제목","ticket":"${Ticket.PREFIX}-숫자 또는 null","summary":"2~3문장 한국어 요약","slack":["url",...],"notion":["url",...],"figma":["url",...]}`,
		`${label}: ${link}`,
	].join('\n')
}

// 응답 텍스트 → 일감 레지스트리 기록 (스트리밍/일반 경로 공용)
function finalizeEnrich(link, text) {
	let data = null
	const jm = String(text || '').match(/\{[\s\S]*\}/)
	if (jm) {
		try {
			data = JSON.parse(jm[0])
		} catch (_) {}
	}
	if (!data) return { ok: false, error: 'AI 응답에서 일감 정보를 추출하지 못했어요.' }
	const ticket = data.ticket && Ticket.re().test(String(data.ticket)) ? String(data.ticket).match(Ticket.re())[0] : ticketOf((data.title || '') + ' ' + (data.summary || ''))
	const key = ticket || 'task-' + Date.now().toString(36)
	const reg = loadReg()
	const e = reg[key] || (reg[key] = { manual: true })
	e.manual = true
	if (data.title) e.title = String(data.title).slice(0, 120)
	if (data.summary) e.summary = String(data.summary).slice(0, 400)
	const links = e.links || (e.links = {})
	const add = (k, arr) => {
		const cur = links[k] || (links[k] = [])
		for (const u of [].concat(arr || [])) if (typeof u === 'string' && /^https?:/.test(u) && !cur.includes(u)) cur.push(u)
	}
	// 원본 링크는 그 종류(slack/notion/figma)로, AI가 찾은 관련 링크도 종류별로 부착
	add(KINDS.includes(linkKind(link)) ? linkKind(link) : 'slack', link)
	add('slack', data.slack)
	add('notion', data.notion)
	add('figma', data.figma)
	if (!saveReg(reg)) return { ok: false, error: '레지스트리 저장 실패' }
	prCache.at = 0
	bustBuild()
	if (!e.class) try { startClassify({ key }) } catch (_) {}
	return { ok: true, key, ticket, title: e.title || null, summary: e.summary || null, counts: { notion: (links.notion || []).length, figma: (links.figma || []).length } }
}

// 동기 경로(알림 → 업무 전환 등): 한 번에 실행 후 결과 반환
async function enrichThread({ url }) {
	const m = String(url || '').match(/https?:\/\/[^\s)\]\}"'<>]+/)
	const link = m ? m[0].replace(/[.,]+$/, '') : ''
	if (!link) return { ok: false, error: '링크를 넣어주세요 (스레드·노션·피그마).' }
	const r = await new Promise((resolve) => {
		const child = execFile(CLAUDE_BIN, ['-p', ENRICH_PROMPT(link), '--output-format', 'json', '--model', Settings.modelFor('enrich')], { cwd: C.REPO, timeout: 170000, maxBuffer: 16 << 20, env: process.env }, (e, out, err) =>
			resolve({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') }),
		)
		try {
			child.stdin.end()
		} catch (_) {}
	})
	if (!r.ok) return { ok: false, error: '링크 읽기 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 160) || 'claude 실행 실패') }
	let text = r.out
	try {
		const j = JSON.parse(r.out)
		text = j.result || j.text || r.out
	} catch (_) {}
	return finalizeEnrich(link, text)
}

// 진행률 잡: stream-json 이벤트(도구 호출)를 단계·퍼센트로 바꿔 프론트가 폴링해 프로그레스바 표시
const enrichJobs = {}
function enrichStageFor(tool) {
	const n = String(tool || '')
	if (/permalink/i.test(n)) return { p: 48, l: '스레드 링크 확인 중…' }
	if (/slack/i.test(n)) return { p: 38, l: 'Slack 스레드 읽는 중…' }
	if (/notion/i.test(n)) return { p: 64, l: 'Notion 문서 확인 중…' }
	if (/figma/i.test(n)) return { p: 74, l: 'Figma 디자인 확인 중…' }
	return { p: 56, l: (n.split('__').pop() || '도구') + ' 실행 중…' }
}
function bumpJob(job, p, l) {
	if (p > job.percent) job.percent = p
	if (l) job.label = l
}
// 공용 스트리밍 잡 러너: claude -p stream-json → onEvent로 진행률, 종료 시 finalize(resultText)→job.result
// cwd 미지정이면 메인 레포(C.REPO). PR 개선처럼 특정 워크트리에서 편집·커밋해야 할 때 cwd 전달.
function runClaudeJob(jobId, prompt, onEvent, finalize, model, timeoutMs, cwd) {
	const job = enrichJobs[jobId]
	const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose']
	if (model) args.push('--model', model)
	const child = spawn(CLAUDE_BIN, args, { cwd: cwd || C.REPO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
	let buf = ''
	let resultText = ''
	const killer = setTimeout(() => {
		try {
			child.kill('SIGTERM')
		} catch (_) {}
	}, timeoutMs || 175000)
	child.stdout.on('data', (d) => {
		buf += d.toString()
		let i
		while ((i = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, i)
			buf = buf.slice(i + 1)
			if (!line.trim()) continue
			let ev = null
			try {
				ev = JSON.parse(line)
			} catch (_) {
				continue
			}
			if (ev.type === 'result') {
				resultText = ev.result || resultText
				bumpJob(job, 95, '마무리 중…')
			} else {
				try {
					onEvent(ev, job)
				} catch (_) {}
			}
		}
	})
	child.on('error', (e) => {
		clearTimeout(killer)
		job.result = { ok: false, error: 'claude 실행 실패: ' + e.message }
		job.done = true
		job.doneAt = Date.now()
		job.percent = 100
		job.label = '실패'
		recordFailure(jobId, job) // 입력 보존된 잡(enrich/backlog)만 실패목록에 기록
	})
	child.on('close', async () => {
		clearTimeout(killer)
		let fin
		try {
			fin = await finalize(resultText)
		} catch (e) {
			fin = { ok: false, error: String((e && e.message) || e) }
		}
		job.result = fin
		job.done = true
		job.doneAt = Date.now()
		job.percent = 100
		job.label = fin.ok ? '완료' : fin.error || '실패'
		if (!fin.ok) recordFailure(jobId, job)
	})
}
function newJob(prefix, kind) {
	for (const id of Object.keys(enrichJobs)) if (Date.now() - enrichJobs[id].startedAt > 600000) delete enrichJobs[id]
	const jobId = prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 10000)
	enrichJobs[jobId] = { percent: 5, label: '준비 중…', done: false, kind: kind || 'job', startedAt: Date.now() }
	return jobId
}
// 전역 진행바용: 활성 잡 + 최근 완료(30초) 잡
function listJobs() {
	const now = Date.now()
	const active = []
	const recent = []
	for (const [id, j] of Object.entries(enrichJobs)) {
		if (!j.done) active.push({ jobId: id, kind: j.kind, percent: j.percent, label: j.label })
		else if (j.doneAt && now - j.doneAt < 30000) recent.push({ jobId: id, kind: j.kind, result: j.result || { ok: false }, doneAt: j.doneAt })
	}
	recent.sort((a, b) => b.doneAt - a.doneAt)
	return { active, recent }
}

// ── 실패한 추출/백로그 잡 — 입력 보존 + 재시도 (다시 입력 안 해도 되게) ──
// 30초 recent 창을 지나면 사라지므로 별도 파일에 영속(재시작에도 유지).
const FAILS_FILE = process.env.OPENRM_JOBFAILS_FILE || path.join(__dirname, '..', '.openrm-jobfails.json')
function loadFails() {
	try {
		return JSON.parse(fs.readFileSync(FAILS_FILE, 'utf8'))
	} catch {
		return {}
	}
}
function saveFails(o) {
	try {
		fs.writeFileSync(FAILS_FILE, JSON.stringify(o, null, 2))
	} catch (_) {}
}
function failTitle(input) {
	if (!input) return '(입력 없음)'
	if (input.url) return input.url
	if (input.opts) return input.opts.title || input.opts.summary || '(백로그)'
	return input.kind || '작업'
}
// 입력(input)이 보존된 잡만 기록 = enrich/backlog. (classify/ops/review는 카드에서 재실행 가능하므로 제외)
function recordFailure(jobId, job) {
	if (!job || !job.input) return
	const f = loadFails()
	f[jobId] = {
		id: jobId,
		kind: job.kind,
		input: job.input,
		title: failTitle(job.input),
		error: String((job.result && job.result.error) || job.label || '실패').slice(0, 240),
		at: Date.now(),
	}
	saveFails(f)
}
function listFailures() {
	return { ok: true, failures: Object.values(loadFails()).sort((a, b) => b.at - a.at).slice(0, 40) }
}
function dismissFailure({ id }) {
	const f = loadFails()
	if (f[id]) {
		delete f[id]
		saveFails(f)
	}
	return { ok: true }
}
// 재시도 — 보존된 입력으로 같은 종류의 잡을 다시 시작. 성공하든 실패하든 옛 실패 항목은 제거(재실패 시 새로 기록됨).
function retryFailure({ id }) {
	const f = loadFails()
	const rec = f[id]
	if (!rec) return { ok: false, error: '실패 항목을 찾을 수 없습니다.' }
	delete f[id]
	saveFails(f)
	const inp = rec.input || {}
	if (rec.kind === 'enrich') return startEnrich({ url: inp.url })
	if (rec.kind === 'backlog') return startBacklog(inp.opts || {})
	return { ok: false, error: '재시도할 수 없는 종류: ' + rec.kind }
}
function runEnrich(jobId, link) {
	runClaudeJob(
		jobId,
		ENRICH_PROMPT(link),
		(ev, job) => {
			if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 12, '준비 완료 — 읽기 시작')
			else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
				for (const c of ev.message.content) {
					if (c.type === 'tool_use') {
						const s = enrichStageFor(c.name)
						bumpJob(job, s.p, s.l)
					} else if (c.type === 'text' && c.text && c.text.trim()) bumpJob(job, 88, '일감으로 정리 중…')
				}
			} else if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
				if (job.percent < 52) bumpJob(job, 52, '내용 분석 중…')
			}
		},
		(text) => finalizeEnrich(link, text),
		Settings.modelFor('enrich'),
	)
}
function startEnrich({ url }) {
	const m = String(url || '').match(/https?:\/\/[^\s)\]\}"'<>]+/)
	const link = m ? m[0].replace(/[.,]+$/, '') : ''
	if (!link) return { ok: false, error: '링크를 넣어주세요 (스레드·노션·피그마).' }
	const jobId = newJob('ej', 'enrich')
	enrichJobs[jobId].input = { kind: 'enrich', url: link } // 실패 시 재시도용 입력 보존
	try {
		runEnrich(jobId, link)
	} catch (e) {
		enrichJobs[jobId].result = { ok: false, error: String((e && e.message) || e) }
		enrichJobs[jobId].done = true
		recordFailure(jobId, enrichJobs[jobId])
	}
	return { ok: true, jobId }
}

// ─── 업무 분류: 코드 변경(dev) vs 코드 변경 아님(ops) ─────────────────────────
// 운영자 요청: 업무 등록 시 코드/비개발을 판단해 라우팅하고, 애매하면(unsure) UI에서 모달로 물어본다.
const CLASS_VALUES = ['dev', 'ops', 'unsure']
const CLASSIFY_PROMPT = ({ title, summary, linkKinds }) =>
	Prompts.render('task.classify', { title: title || '(없음)', summary: summary || '(없음)', linkKinds: linkKinds || '없음' })

// 분류 결과 텍스트 → 레지스트리 기록 + 캐시 즉시 패치
function finalizeClassify(key, text) {
	let data = null
	const jm = String(text || '').match(/\{[\s\S]*\}/)
	if (jm) {
		try {
			data = JSON.parse(jm[0])
		} catch (_) {}
	}
	if (!data) return { ok: false, error: 'AI 응답에서 분류 결과를 추출하지 못했어요.' }
	const cls = CLASS_VALUES.includes(String(data.class)) ? String(data.class) : 'unsure'
	// 모델이 0~1 또는 0~100(예: 95)로 줄 수 있어 정규화
	let conf = typeof data.confidence === 'number' ? data.confidence : null
	if (conf != null) conf = Math.max(0, Math.min(1, conf > 1 ? conf / 100 : conf))
	const reason = data.reason ? String(data.reason).slice(0, 200) : null
	const plan = data.plan ? String(data.plan).slice(0, 300) : null
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	e.class = cls
	e.classConfidence = conf
	e.classReason = reason
	e.classPlan = cls === 'ops' ? plan : null
	e.classedAt = Date.now()
	e.classManual = false
	if (!saveReg(reg)) return { ok: false, error: '레지스트리 저장 실패' }
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key || x.ticket === key)
		if (t) {
			t.taskClass = cls
			t.classConfidence = conf
			t.classReason = reason
			t.classPlan = e.classPlan
			t.classManual = false
		}
	})
	// A안: 확신 높은 비개발(ops)은 바로 처리 에이전트 자동 투입. 애매하면(unsure·저확신) UI 모달로.
	if (cls === 'ops' && conf != null && conf >= OPS_AUTO_CONF && !e.opsResult && !e.opsRunning) {
		try { startOps({ key }) } catch (_) {}
	}
	return { ok: true, key, class: cls, confidence: conf, reason, plan: e.classPlan }
}

function runClassify(jobId, key, promptData) {
	runClaudeJob(
		jobId,
		CLASSIFY_PROMPT(promptData),
		(ev, job) => {
			if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 30, '업무 성격 판정 중…')
			else if (ev.type === 'assistant') bumpJob(job, 80, '판정 정리 중…')
		},
		(text) => finalizeClassify(key, text),
		Settings.modelFor('classify'),
	)
}

// 업무 1건 분류 잡 시작 (등록 직후 자동 호출 or UI '재판정'). key 필수.
function startClassify({ key }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	const links = e.links || {}
	const linkKinds = KINDS.filter((k) => (links[k] || []).length)
		.map((k) => `${k}(${links[k].length})`)
		.join(', ')
	const promptData = { title: e.title || key, summary: e.summary || '', linkKinds }
	const jobId = newJob('cj', 'classify')
	try {
		runClassify(jobId, key, promptData)
	} catch (err) {
		enrichJobs[jobId].result = { ok: false, error: String((err && err.message) || err) }
		enrichJobs[jobId].done = true
	}
	return { ok: true, jobId }
}

// 운영자가 모달에서 직접 지정(개발/비개발 확정). 자동 판정 override.
function setTaskClass({ key, class: cls, plan }) {
	if (!key) return { ok: false, error: 'key 필수' }
	if (!['dev', 'ops'].includes(String(cls))) return { ok: false, error: 'dev/ops 만 지정 가능' }
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	e.class = String(cls)
	e.classConfidence = 1
	e.classReason = Settings.operatorName() + ' 지정'
	e.classPlan = cls === 'ops' ? (plan ? String(plan).slice(0, 300) : e.classPlan || null) : null
	e.classedAt = Date.now()
	e.classManual = true
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key || x.ticket === key)
		if (t) {
			t.taskClass = e.class
			t.classConfidence = 1
			t.classReason = e.classReason
			t.classPlan = e.classPlan
			t.classManual = true
		}
	})
	return { ok: true, class: e.class, plan: e.classPlan }
}

// ─── 비개발(ops) 업무 자동수행: 워크트리·PR 없이 MCP로 실제 노션 정리·문서·리서치 ─────────────
const OPS_AUTO_CONF = 0.85 // 이 확신 이상의 ops만 자동 실행(애매하면 모달/수동)
const OPS_PROMPT = ({ title, summary, plan, links }) =>
	Prompts.render('task.ops', {
		title: title || '(없음)',
		summary: summary || '(없음)',
		planLine: plan ? `분류기 제안: ${plan}` : '',
		linksBlock: links && links.length ? `첨부 링크:\n${links.map((u) => '- ' + u).join('\n')}` : '첨부 링크: 없음',
	})
		.split('\n')
		.filter((l) => l !== '') // planLine 빈 값이면 그 줄 제거(원래 .filter(Boolean) 동작 유지)
		.join('\n')

function finalizeOps(key, text) {
	let data = null
	const jm = String(text || '').match(/\{[\s\S]*\}/)
	if (jm) {
		try {
			data = JSON.parse(jm[0])
		} catch (_) {}
	}
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	const result = {
		summary: data && data.summary ? String(data.summary).slice(0, 600) : text ? String(text).slice(0, 600) : '(결과 없음)',
		artifacts: data && Array.isArray(data.artifacts) ? data.artifacts.filter((u) => typeof u === 'string' && /^https?:/.test(u)).slice(0, 12) : [],
		needsHuman: !!(data && data.needsHuman),
		ask: data && data.ask ? String(data.ask).slice(0, 300) : null,
		at: Date.now(),
	}
	e.opsResult = result
	delete e.opsRunning
	if (!saveReg(reg)) return { ok: false, error: '레지스트리 저장 실패' }
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key || x.ticket === key)
		if (t) {
			t.opsResult = result
			t.opsRunning = false
		}
	})
	return { ok: true, key, ...result }
}

function runOps(jobId, key, data) {
	runClaudeJob(
		jobId,
		OPS_PROMPT(data),
		(ev, job) => {
			if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 10, '비개발 업무 파악 중…')
			else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
				for (const c of ev.message.content) {
					if (c.type === 'tool_use') {
						const s = enrichStageFor(c.name)
						bumpJob(job, s.p, s.l)
					} else if (c.type === 'text' && c.text && c.text.trim()) bumpJob(job, 90, '결과 정리 중…')
				}
			}
		},
		(text) => finalizeOps(key, text),
		Settings.modelFor('ops'),
		300000, // 노션 쓰기 포함 — 5분
	)
}

// 비개발 업무 처리 시작 (고확신 자동 or UI '▶ 처리'). key 필수.
function startOps({ key }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	const links = []
	for (const k of KINDS) for (const u of (e.links && e.links[k]) || []) if (!links.includes(u)) links.push(u)
	const data = { title: e.title || key, summary: e.summary || '', plan: e.classPlan || '', links }
	e.opsRunning = true
	e.opsStartedAt = Date.now()
	saveReg(reg)
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key || x.ticket === key)
		if (t) t.opsRunning = true
	})
	const jobId = newJob('op', 'ops')
	try {
		runOps(jobId, key, data)
	} catch (err) {
		enrichJobs[jobId].result = { ok: false, error: String((err && err.message) || err) }
		enrichJobs[jobId].done = true
		const r2 = loadReg()
		if (r2[key]) { delete r2[key].opsRunning; saveReg(r2) }
	}
	return { ok: true, jobId }
}

// 배포 DB 카드의 '백로그' relation에 선택한 작업 그룹의 노션 백로그들을 연결 (claude + Notion MCP 경유)
async function linkBacklogs({ group, deployNotionUrl }) {
	if (!deployNotionUrl) return { ok: false, error: '배포 노션 카드가 없습니다(배포 위젯에 노션 카드 등록 필요).' }
	if (!group) return { ok: false, error: '작업 그룹을 선택하세요.' }
	const built = await build().catch(() => ({ tasks: [] }))
	const members = (built.tasks || []).filter((t) => t.group === group)
	const pages = []
	for (const t of members) for (const u of (t.links && t.links.notion) || []) if (!pages.includes(u)) pages.push(u)
	if (!pages.length) return { ok: false, error: `그룹 '${group}'에 노션 백로그가 연결된 업무가 없습니다.` }
	const jobId = newJob('lb', 'linkbacklog')
	const prompt = `배포 노션 카드의 '백로그' relation 속성에 아래 노션 페이지들을 추가해줘(기존은 유지, 신규만 합집합으로 추가). 배포 카드: ${deployNotionUrl}\n추가할 백로그(${pages.length}개):\n${pages.map((u) => '- ' + u).join('\n')}\n\n절차: ① notion-fetch로 배포 카드의 현재 '백로그' relation URL 목록을 읽고 ② 기존 ∪ 위 신규(중복 제외) 전체 URL 배열을 만들어 ③ notion-update-page(command=update_properties, page_id=배포카드, properties={"백로그": <전체 URL JSON 배열 문자열>})로 갱신. '백로그' 외 다른 속성은 절대 건드리지 마. ④ 끝나면 "총 N개(신규 M개 추가): 티켓..." 한 줄로 보고.`
	try {
		runClaudeJob(
			jobId,
			prompt,
			(ev, job) => {
				if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 25, 'Notion 연결 준비…')
				else if (ev.type === 'assistant') bumpJob(job, 65, '백로그 relation 갱신 중…')
			},
			(text) => ({ ok: true, group, candidates: pages.length, report: String(text || '').slice(0, 300) }),
			Settings.modelFor('link'),
		)
	} catch (e) {
		enrichJobs[jobId].result = { ok: false, error: String((e && e.message) || e) }
		enrichJobs[jobId].done = true
	}
	return { ok: true, jobId, candidates: pages.length }
}
function enrichStatus(jobId) {
	const j = enrichJobs[jobId]
	if (!j) return { ok: false, notFound: true, error: 'job 없음(만료됐을 수 있음)' }
	return { ok: true, percent: j.percent, label: j.label, done: j.done, result: j.done ? j.result || { ok: false, error: '결과 없음' } : null }
}

// ── 📋 백로그 자동 생성 (티켓 없는 업무 → Notion 일감 카드 생성 → 티켓 회수) ──
// 고정 데이터(운영자 지정): DB·작업자·상태·서비스·플랫폼·아이콘·본문 템플릿. env로 override 가능.
const BACKLOG = {
	db: process.env.OPENRM_BACKLOG_DB || '',
	assignee: process.env.OPENRM_BACKLOG_ASSIGNEE || '',
	status: process.env.OPENRM_BACKLOG_STATUS || '할일',
	service: process.env.OPENRM_BACKLOG_SERVICE || '',
	platform: process.env.OPENRM_BACKLOG_PLATFORM || '',
}
const BACKLOG_TEMPLATE = ['## 작업내용', '', '### 내용', '{내용}', '', '### 참고', '{참고}', '', '---', '', '### Todo', '- [ ] ', '', '### Test Case', ''].join('\n')
function backlogPrompt({ title, summary, links, priority, estimate }) {
	const extra = []
	if (priority) extra.push(`- 우선순위 = ${priority}`)
	if (estimate) extra.push(`- 추정/예상 = ${estimate}`)
	return [
		`Notion MCP로 백로그 데이터베이스(id: ${BACKLOG.db})에 새 일감 카드 1개를 생성해줘.`,
		`먼저 그 데이터베이스의 data source 속성(properties) 스키마를 조회해서 정확한 속성명·옵션값(select 등)에 맞춰 채워.`,
		`고정 필드: 작업자(담당자)=${BACKLOG.assignee}, 상태=${BACKLOG.status}, 서비스=${BACKLOG.service}, 플랫폼=${BACKLOG.platform}`,
		...extra,
		`카드 제목: ${title || '(제목 미정)'}`,
		`아이콘: 파란색 사각형 이모지(🟦)로 지정.`,
		`본문(page content)은 아래 템플릿 구조 그대로 만들고, "{내용}" 자리에 아래 요약을, "{참고}" 자리에 아래 링크들을 채워.`,
		`요약: ${summary || '(요약 없음 — 제목 기준 작성)'}`,
		`참고 링크: ${(links || []).filter(Boolean).join(' , ') || '(없음)'}`,
		`템플릿:\n${BACKLOG_TEMPLATE}`,
		`생성 후 그 카드의 고유 ID 속성값(${Ticket.PREFIX}-숫자 형태 등 unique id)과 카드 URL을 확인해.`,
		`설명·코드블록 없이 JSON 하나만 출력: {"ok":true,"ticket":"<카드 고유ID(${Ticket.PREFIX}-숫자 등)>","url":"<카드 URL>"}`,
	].join('\n')
}
function backlogStageFor(tool) {
	const n = String(tool || '')
	if (/create.*page|create-pages|create_page/i.test(n)) return { p: 72, l: '백로그 카드 생성 중…' }
	if (/data_source|database|query|fetch|retrieve|get_/i.test(n)) return { p: 40, l: '백로그 DB 스키마 확인 중…' }
	if (/notion/i.test(n)) return { p: 56, l: 'Notion 작업 중…' }
	return { p: 50, l: (n.split('__').pop() || '도구') + ' 실행 중…' }
}
// 리뷰어(운영자) 설득 + DX 지시 — 코드만 던지지 말고 리뷰가 쉬운 브리핑으로 마무리하게. (프론트 REVIEW_DIRECTIVE와 동기화)
const REVIEW_DIRECTIVE = `[리뷰 방식] ${Settings.operatorName()}가 이 변경을 직접 리뷰해. 코드만 넘기지 말고 리뷰어를 '설득'하는 브리핑으로 마무리해줘 — 특히 DX(리뷰 경험)를 최우선으로: ① 무엇을·왜(각 결정의 근거를 먼저 밝혀 의도를 역추적 안 하게) ② 고려했다 기각한 대안과 이유 ③ 먼저 봐야 할 파일:라인을 우선순위/읽는 순서까지 콕 집기 ④ 리스크·사이드이펙트·엣지케이스·하위호환 우려를 먼저 자백 ⑤ 실제로 한 검증(빌드/타입/테스트/수동)만, 안 한 건 안 했다고. 변경은 작고 목적이 분명한 단위로, 확신 없으면 단정 말고 근거와 함께.`

function backlogSeed(ticket, title, links) {
	const refs = [...(links.slack || []).map((u) => 'Slack ' + u), ...(links.notion || []).map((u) => 'Notion ' + u), ...(links.figma || []).map((u) => 'Figma ' + u)]
	return [
		`이 업무를 진행해줘. 티켓: ${ticket}.`,
		title ? `제목: ${title}.` : '',
		refs.length ? `참고 — ${refs.join(' / ')} (Slack/Notion/Figma MCP로 먼저 확인).` : '',
		`먼저 맥락·관련 코드를 파악해 계획부터 알려줘.`,
		Settings.get('reviewMode') ? REVIEW_DIRECTIVE : '',
	]
		.filter(Boolean)
		.join(' ')
}
async function finalizeBacklog(text, opts) {
	let data = null
	const jm = String(text || '').match(/\{[\s\S]*\}/)
	if (jm) {
		try {
			data = JSON.parse(jm[0])
		} catch (_) {}
	}
	if (!data || !data.ticket) return { ok: false, error: '백로그 생성/티켓 확인 실패', raw: String(text || '').slice(0, 200) }
	const ticket = (String(data.ticket).match(Ticket.re()) || [])[0] || String(data.ticket).trim()
	const reg = loadReg()
	const e = reg[ticket] || (reg[ticket] = { manual: true })
	e.manual = true
	if (opts.title) e.title = String(opts.title).slice(0, 120)
	if (opts.summary) e.summary = String(opts.summary).slice(0, 400)
	const links = e.links || (e.links = {})
	const add = (k, u) => {
		if (typeof u !== 'string' || !/^https?:/.test(u)) return
		const cur = links[k] || (links[k] = [])
		if (!cur.includes(u)) cur.push(u)
	}
	// 원본 업무(fromKey)의 링크·그룹을 이 티켓으로 이관 후 원본 제거 (= 같은 업무가 티켓을 얻음)
	if (opts.fromKey && opts.fromKey !== ticket && reg[opts.fromKey]) {
		const o = reg[opts.fromKey]
		if (o.group && !e.group) e.group = o.group
		for (const k of KINDS) for (const u of (o.links && o.links[k]) || []) add(k, u)
		delete reg[opts.fromKey]
	}
	if (data.url) {
		add('notion', data.url)
		// 새 백로그 카드 → 제목·백로그 플래그를 노션 제목 캐시에 자동 등록 (라벨에 "📋 백로그" 표시)
		try {
			const id = NT.pageId(data.url)
			if (id && e.title) NT.setTitle(id, e.title, true)
		} catch (_) {}
	}
	saveReg(reg)
	prCache.at = 0
	bustBuild()
	// 다음 작업: 워크트리 생성 + claude 에이전트 자동 투입 (개발 시작)
	let started = null
	if (opts.autoStart) {
		try {
			const engDesc = await translateToEnglishSlug(e.title).catch(() => e.title)
			const wt = await Worktrees.create({ ticket, desc: engDesc })
			if (wt.ok) {
				const tm = await Term.create({ cwd: wt.path, command: 'claude', label: wt.branch, seed: backlogSeed(ticket, e.title, links), model: Settings.modelFor('dev') })
				started = tm.ok ? tm.name : null
				bustBuild()
			}
		} catch (_) {}
	}
	return { ok: true, ticket, url: data.url || null, started }
}
function runBacklog(jobId, opts) {
	runClaudeJob(
		jobId,
		backlogPrompt(opts),
		(ev, job) => {
			if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 12, '준비 완료')
			else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
				for (const c of ev.message.content) {
					if (c.type === 'tool_use') {
						const s = backlogStageFor(c.name)
						bumpJob(job, s.p, s.l)
					} else if (c.type === 'text' && c.text && c.text.trim()) bumpJob(job, 90, '티켓 확인 중…')
				}
			} else if (ev.type === 'user') {
				if (job.percent < 50) bumpJob(job, 50, '생성 중…')
			}
		},
		(text) => finalizeBacklog(text, opts),
		Settings.modelFor('backlog'),
	)
}
function startBacklog(opts) {
	const o = opts || {}
	if (!o.title && !o.summary) return { ok: false, error: '제목/요약이 필요해요.' }
	const jobId = newJob('bj', 'backlog')
	enrichJobs[jobId].input = { kind: 'backlog', opts: o } // 실패 시 재시도용 입력 보존
	try {
		runBacklog(jobId, o)
	} catch (e) {
		enrichJobs[jobId].result = { ok: false, error: String((e && e.message) || e) }
		enrichJobs[jobId].done = true
		recordFailure(jobId, enrichJobs[jobId])
	}
	return { ok: true, jobId }
}

// ── 그룹핑 (관련 업무를 묶어 보기) — 멤버십은 reg[key].group, 그룹 목록은 reg.__meta.groups ──
function ensureMeta(reg) {
	const m = reg[META_KEY] || (reg[META_KEY] = {})
	if (!Array.isArray(m.groups)) m.groups = []
	if (!m.groupBase || typeof m.groupBase !== 'object') m.groupBase = {} // { 그룹명: 'release/7.14' } — 배포 타깃 base
	if (!m.chain || typeof m.chain !== 'object') m.chain = {} // { 그룹명: true } — 체인 모드(카드 순서대로 PR base 사슬)
	if (!Array.isArray(m.archived)) m.archived = [] // 📦 보관함 — 해결한 작업 스냅샷(날짜별 이력). 삭제와 달리 기록 보존.
	return m
}
// 그룹의 base 브랜치 지정/해제 — 이 그룹에 넣는 작업의 PR을 이 브랜치로 타깃(L1). 빈 값이면 해제(정리용 그룹).
function setGroupBase({ group, baseBranch }) {
	const g = String(group || '').trim()
	if (!g) return { ok: false, error: '그룹 필수' }
	const reg = loadReg()
	const m = ensureMeta(reg)
	const b = String(baseBranch || '').trim().replace(/^origin\//, '') // 로컬 브랜치명으로 정규화
	if (b) m.groupBase[g] = b
	else delete m.groupBase[g]
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		d.groupBases = { ...(d.groupBases || {}), [g]: b || undefined }
		if (!b) delete d.groupBases[g]
	})
	return { ok: true, group: g, baseBranch: b || null }
}
// 한 작업(key)의 열린 내 PR들의 base(머지 타깃)를 지정 브랜치로 변경. 히스토리 안 건드림 = 안전.
// ⚠️ gh pr edit 대신 REST PATCH 사용 — gh pr edit는 내부적으로 projectCards(Projects classic·deprecated) GraphQL을 호출해 실패함.
async function retargetTaskPRs(key, base) {
	if (!base) return { done: [], failed: [], skipped: ['base 없음'] }
	const data = buildCache.data
	const t = data && Array.isArray(data.tasks) ? data.tasks.find((x) => x.key === key) : null
	if (!t) return { done: [], failed: [], skipped: ['작업 정보 없음(빌드 전)'] }
	// ⚠️ 안전: mine(=--author @me)이고 OPEN인 PR만. 남의 PR·머지/클로즈된 PR은 절대 안 건드림.
	const openMine = (t.prs || []).filter((p) => p.state === 'OPEN' && p.mine && p.number)
	const done = [],
		failed = []
	for (const p of openMine) {
		const repo = REPOS.find((r) => r.name === p.repo)
		if (!repo) continue
		if (p.base === base) { done.push({ repo: p.repo, number: p.number, base, already: true }); continue }
		// REST: PATCH /repos/{owner}/{repo}/pulls/{number} { base } — base 브랜치만 변경 (projectCards GraphQL 회피)
		const r = await ghX(['api', '-X', 'PATCH', `repos/${repo.slug}/pulls/${p.number}`, '-f', `base=${base}`])
		if (r.ok) done.push({ repo: p.repo, number: p.number, base })
		else failed.push({ repo: p.repo, number: p.number, error: (r.err || '').split('\n').filter(Boolean).slice(-1)[0] || 'PR base 변경 실패' })
	}
	if (done.length || failed.length) bustBuild() // PR base 바뀌었으니 다음 빌드에서 갱신
	return { done, failed, skipped: openMine.length ? [] : ['열린 내 PR 없음'] }
}

// ── 그룹 체인 — 카드 순서대로 각 PR base를 "앞 카드 브랜치"로 사슬 연결(stacked PR). 첫 카드는 그룹 base(없으면 develop).
const CHAIN_ROOT_DEFAULT = process.env.OPENRM_NEW_TASK_BASE || 'develop'
// 이 작업의 head 브랜치(다음 카드의 base가 됨) — 열린 PR 브랜치 우선, 없으면 워크트리 브랜치
function taskHeadBranch(t) {
	const pr = (t.prs || []).find((p) => p.state === 'OPEN' && p.branch)
	if (pr) return pr.branch
	const s = (t.streams || []).find((x) => !x.isMain && x.branch)
	return s ? s.branch : null
}
async function applyChain(group) {
	const g = String(group || '').trim()
	if (!g) return { ok: false, error: '그룹 필수' }
	const built = await build().catch(() => null)
	const members = ((built && built.tasks) || [])
		.filter((t) => (t.group || null) === g)
		.sort((a, b) => (a.order == null ? 9999 : a.order) - (b.order == null ? 9999 : b.order) || b.score - a.score)
	const reg = loadReg()
	const root = (reg[META_KEY] && reg[META_KEY].groupBase && reg[META_KEY].groupBase[g]) || CHAIN_ROOT_DEFAULT
	const results = []
	let prevBranch = root
	for (const t of members) {
		const r = await retargetTaskPRs(t.key, prevBranch) // 이 카드 PR base = 앞 카드 브랜치
		results.push({ key: t.key, ticket: t.ticket || null, base: prevBranch, done: r.done, failed: r.failed })
		const b = taskHeadBranch(t) // 다음 카드의 base
		if (b) prevBranch = b // 미시작(브랜치 없음)이면 이전 base 유지 → 그 다음 시작된 카드가 이어받음
	}
	return { ok: true, group: g, root, chainedCount: results.length, results }
}
// 그룹 통합 개발서버 — 그룹 멤버들의(카드 순서대로) 브랜치를 전용 워크트리에 병합해 "그룹 브랜치"를 만들고 그 위에서 dev 서버를 켠다.
// 이미 그 워크트리에서 도는 dev 서버가 있으면 재사용(포트 그대로, 병합만 새로 반영 — 파일 변경은 dev 서버가 HMR로 픽업).
async function startGroupDevServer({ group }) {
	const g = String(group || '').trim()
	if (!g) return { ok: false, error: '그룹 필수' }
	const built = await build().catch(() => null)
	const members = ((built && built.tasks) || [])
		.filter((t) => (t.group || null) === g)
		.sort((a, b) => (a.order == null ? 9999 : a.order) - (b.order == null ? 9999 : b.order) || b.score - a.score)
	if (!members.length) return { ok: false, error: `그룹 '${g}'에 업무가 없습니다.` }
	const branches = members.map((t) => ({ key: t.key, ticket: t.ticket || null, branch: taskHeadBranch(t) })).filter((b) => b.branch)
	if (!branches.length) return { ok: false, error: '이 그룹에 시작된 브랜치가 없습니다(먼저 ▶진행으로 개발을 시작하세요).' }
	const reg = loadReg()
	const base = (reg[META_KEY] && reg[META_KEY].groupBase && reg[META_KEY].groupBase[g]) || CHAIN_ROOT_DEFAULT
	const gb = await Worktrees.buildGroupBranch({ group: g, base, branches })
	if (!gb.ok) return gb
	const nm = Worktrees.ensureNodeModules(gb.path)
	if (!nm.ok) return { ok: false, error: nm.error, ...gb }
	const running = (await Cockpit.devServers().catch(() => [])).find((s) => s.cwd === gb.path)
	if (running) return { ok: true, ...gb, port: running.port, reused: true }
	const d = await Term.startDevServer({ cwd: gb.path, label: 'group-' + g })
	if (!d.ok) return { ok: false, error: d.error, ...gb }
	return { ok: true, ...gb, ...d }
}

// 그룹 체인 on/off — on이면 즉시 순서대로 재타깃. 순서 바꾸면 프론트가 다시 호출.
async function setChain({ group, on }) {
	const g = String(group || '').trim()
	if (!g) return { ok: false, error: '그룹 필수' }
	const reg = loadReg()
	const m = ensureMeta(reg)
	if (on) m.chain[g] = true
	else delete m.chain[g]
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		d.chainedGroups = { ...(d.chainedGroups || {}) }
		if (on) d.chainedGroups[g] = true
		else delete d.chainedGroups[g]
	})
	if (!on) return { ok: true, group: g, on: false }
	const applied = await applyChain(g)
	return { ok: true, group: g, on: true, ...applied }
}
function createGroup({ name }) {
	const n = String(name || '').trim()
	if (!n) return { ok: false, error: '그룹 이름을 입력하세요.' }
	const reg = loadReg()
	const m = ensureMeta(reg)
	if (!m.groups.includes(n)) m.groups.push(n)
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		if (!d.groups.includes(n)) d.groups.push(n)
	})
	return { ok: true, groups: m.groups }
}
function removeGroup({ name }) {
	const n = String(name || '').trim()
	const reg = loadReg()
	const m = ensureMeta(reg)
	m.groups = m.groups.filter((g) => g !== n)
	delete m.groupBase[n]
	for (const k of Object.keys(reg)) {
		if (k === META_KEY) continue
		if (reg[k] && reg[k].group === n) delete reg[k].group
	}
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		d.groups = d.groups.filter((g) => g !== n)
		for (const t of d.tasks) if (t.group === n) t.group = null
	})
	return { ok: true, groups: m.groups }
}
function renameGroup({ from, to }) {
	const a = String(from || '').trim()
	const b = String(to || '').trim()
	if (!a || !b) return { ok: false, error: 'from·to 필수' }
	const reg = loadReg()
	const m = ensureMeta(reg)
	m.groups = m.groups.map((g) => (g === a ? b : g))
	if (!m.groups.includes(b)) m.groups.push(b)
	if (m.groupBase[a]) { m.groupBase[b] = m.groupBase[a]; delete m.groupBase[a] } // base도 이름 따라 이동
	for (const k of Object.keys(reg)) {
		if (k === META_KEY) continue
		if (reg[k] && reg[k].group === a) reg[k].group = b
	}
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		d.groups = d.groups.map((g) => (g === a ? b : g))
		for (const t of d.tasks) if (t.group === a) t.group = b
	})
	return { ok: true, groups: m.groups }
}
// 업무를 그룹에 배정 (group이 비면 그룹 해제). 캐시 즉시 패치 + 그룹 base 있으면 열린 PR을 그 base로 재타깃(L1).
async function setGroup({ key, group }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const reg = loadReg()
	const m = ensureMeta(reg)
	const g = group ? String(group).trim() : ''
	const e = reg[key] || (reg[key] = {})
	if (g) {
		e.group = g
		if (!m.groups.includes(g)) m.groups.push(g)
	} else delete e.group
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key)
		if (t) t.group = g || null
		if (g && !d.groups.includes(g)) d.groups.push(g)
	})
	// L1: 이동한 그룹에 base 브랜치가 설정돼 있으면 그 작업의 열린 내 PR을 그 base로 재타깃 (되돌리기 가능·히스토리 안 건드림)
	const base = g ? (m.groupBase || {})[g] : null
	let retarget = null
	if (base) retarget = await retargetTaskPRs(key, base).catch((err) => ({ done: [], failed: [{ error: String(err.message || err) }] }))
	return { ok: true, group: g || null, base: base || null, retarget }
}
// 그룹 내 순서 재정렬 — 드래그로 바뀐 키 순서를 받아 각 키에 order 인덱스 저장. group도 함께 배정(다른 그룹에서 끌어온 경우).
function reorderGroup({ group, keys }) {
	if (!Array.isArray(keys)) return { ok: false, error: 'keys 배열 필요' }
	const reg = loadReg()
	const m = ensureMeta(reg)
	const g = group ? String(group).trim() : ''
	keys.forEach((k, i) => {
		if (!k) return
		const e = reg[k] || (reg[k] = {})
		e.order = i
		if (g) {
			e.group = g
			if (!m.groups.includes(g)) m.groups.push(g)
		} else delete e.group
	})
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		const idx = {}
		keys.forEach((k, i) => (idx[k] = i))
		for (const t of d.tasks)
			if (idx[t.key] != null) {
				t.order = idx[t.key]
				t.group = g || null
			}
	})
	return { ok: true }
}
// 업무에 메모 — 운영자가 카드에 자유 메모. 비우면 삭제. 캐시만 패치(즉시).
function setMemo({ key, memo }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const v = memo != null ? String(memo).slice(0, 2000) : ''
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	if (v.trim()) e.memo = v
	else delete e.memo
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key)
		if (t) t.memo = v.trim() ? v : null
	})
	return { ok: true, memo: v.trim() ? v : null }
}
// 업무에 TC(Notion DB) URL 등록 — QA 에이전트가 TC 완성 시 호출(ticket 또는 key). E2E 버튼 활성화 근거.
function setTc({ key, ticket, url }) {
	const k = key || ticket
	if (!k) return { ok: false, error: 'key/ticket 필수' }
	const reg = loadReg()
	// ticket으로 왔으면 ticket 키로 저장(build에서 reg[t.ticket]도 참조)
	const e = reg[k] || (reg[k] = {})
	if (url && String(url).trim()) e.tc = String(url).trim()
	else delete e.tc
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === k || x.ticket === k)
		if (t) t.tc = e.tc || null
	})
	return { ok: true, tc: e.tc || null }
}
// 업무에 ▶진행 모델 override — 간단한 작업은 opus 대신 sonnet/haiku. 비우면 정책 기본.
function setTaskModel({ key, model }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	if (model && String(model).trim()) e.devModel = String(model).trim()
	else delete e.devModel
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key)
		if (t) t.devModel = e.devModel || null
	})
	return { ok: true, devModel: e.devModel || null }
}
// 업무에 배포 dev 서버(dev1~6) 지정 — 운영자가 카드 셀렉트로 직접 입력. 비우면 해제. 캐시만 패치(즉시).
function setDevServer({ key, devServer }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const v = devServer ? String(devServer).trim() : ''
	if (v && !/^dev[1-6]$/.test(v)) return { ok: false, error: 'dev1~dev6 만 가능' }
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	if (v) e.devServer = v
	else delete e.devServer
	if (!saveReg(reg)) return { ok: false, error: '저장 실패' }
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key)
		if (t) t.devServer = v || null
	})
	return { ok: true, devServer: v || null }
}

// 업무 삭제. deleteWork=true면 워크트리 제거 + 로컬 브랜치 삭제 + 열린 PR 닫기까지(되돌리기 어려움).
async function removeTask({ key, deleteWork }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const done = { worktrees: [], branches: [], prsClosed: [], prsSkipped: [], errors: [] }
	if (deleteWork) {
		let t = buildCache.data && buildCache.data.tasks.find((x) => x.key === key)
		if (!t) {
			const b = await build().catch(() => null)
			t = b && b.tasks.find((x) => x.key === key)
		}
		if (t) {
			const me = await ghMe()
			// 1) ⚠️ 내가 작성한 열린 PR만 닫는다. 남의 PR/작성자 불명/머지·이미 닫힘은 절대 안 건드림.
			for (const pr of t.prs || []) {
				if (pr.state !== 'OPEN') continue
				const mine = pr.mine === true || (me && pr.author && pr.author === me)
				if (!mine) {
					done.prsSkipped.push(`${pr.repo}#${pr.number}${pr.author ? '(@' + pr.author + ')' : ''}`)
					continue
				}
				const slug = (REPOS.find((r) => r.name === pr.repo) || {}).slug || pr.repo
				const r = await ghX(['pr', 'close', String(pr.number), '-R', slug])
				if (r.ok) done.prsClosed.push(`${pr.repo}#${pr.number}`)
				else done.errors.push(`PR ${pr.number} 닫기 실패: ${(r.err.split('\n').find((l) => l.trim()) || '').slice(0, 100)}`)
			}
			// 2) 워크트리 제거 + 로컬 브랜치 삭제 (미커밋 변경은 --force로 폐기)
			for (const s of t.streams || []) {
				if (s.isMain) continue
				const rm = await gitX(['worktree', 'remove', '--force', s.path])
				if (!rm.ok) {
					done.errors.push(`워크트리 ${s.name} 제거 실패: ${(rm.err.split('\n').find((l) => l.trim()) || '').slice(0, 100)}`)
					continue
				}
				done.worktrees.push(s.name || s.path)
				if (s.branch && s.branch !== '?' && !/^\(/.test(s.branch)) {
					const bd = await gitX(['branch', '-D', s.branch])
					if (bd.ok) done.branches.push(s.branch)
				}
			}
		}
	}
	const reg = loadReg()
	if (reg[key]) {
		delete reg[key]
		saveReg(reg)
	}
	prCache.at = 0
	patchCache((d) => {
		d.tasks = d.tasks.filter((t) => t.key !== key)
		d.count = d.tasks.length
	})
	bustBuild()
	return { ok: true, ...done }
}

// 완료(=PR이 전부 머지됨) 작업 일괄 정리 — 빌드 1회로 대상 확정 후 워크트리+브랜치+등록을 인라인 제거(빠름).
// PR은 이미 머지됐으니 닫을 것 없음. 실행 중(dev 서버/에이전트)인 작업은 스킵(사용 중일 수 있음).
async function cleanupDone({ group } = {}) {
	const data = await build().catch(() => null) // 20초 캐시 재사용 → 빠름
	if (!data || !Array.isArray(data.tasks)) return { ok: false, error: '빌드 실패' }
	const isDone = (t) => Array.isArray(t.prs) && t.prs.length > 0 && t.prs.every((p) => p.state === 'MERGED')
	// group 지정 시 그 그룹의 완료만 정리 (null=미분류 그룹). 미지정이면 전체.
	const targets = data.tasks.filter((t) => isDone(t) && (group === undefined || (t.group || null) === (group || null)))
	const removed = [],
		skipped = [],
		errors = []
	const reg = loadReg()
	for (const t of targets) {
		const busy = (t.streams || []).some((s) => (s.dev && s.dev.length) || s.agentAlive) // 실행 중이면 보존
		if (busy) { skipped.push((t.ticket || t.key) + ' (실행 중)'); continue }
		for (const s of t.streams || []) {
			if (s.isMain) continue
			const rm = await gitX(['worktree', 'remove', '--force', s.path])
			if (!rm.ok) { errors.push(`${s.name || s.path}: ${(rm.err || '').split('\n').filter(Boolean)[0]?.slice(0, 80) || '제거 실패'}`); continue }
			if (s.branch && s.branch !== '?' && !/^\(/.test(s.branch)) await gitX(['branch', '-D', s.branch])
		}
		if (reg[t.key]) delete reg[t.key]
		removed.push(t.ticket || t.title || t.key)
	}
	saveReg(reg)
	prCache.at = 0
	bustBuild()
	return { ok: true, count: removed.length, removed, skipped, errors }
}

// ── 🔎 PR 리뷰 → 🔧 개선 (1클릭 리뷰, 2클릭 리뷰대로 개선) ──
// 리뷰: gh pr diff로 변경 diff를 읽어 헤드리스 claude가 이슈를 JSON으로 도출(읽기전용, 메인 레포).
// 개선: 그 리뷰를 PR 브랜치 워크트리에서 실제 코드에 반영 + 커밋 + 푸시(내 PR만).
const prKeyOf = (repo, number) => `${repo}#${number}`
const slugForRepo = (repo) => (REPOS.find((r) => r.name === repo) || {}).slug || repo

function REVIEW_PR_PROMPT(slug, number) {
	return Prompts.render('review.pr', { slug, number })
}
function IMPROVE_PROMPT(review, number) {
	return Prompts.render('review.improve', { number, review: JSON.stringify(review) })
}
function QUESTION_PROMPT(slug, number, review, question) {
	return Prompts.render('review.question', { slug, number, review: JSON.stringify(review), question })
}

function setPrReview(key, prKey, patch) {
	const reg = loadReg()
	const e = reg[key] || (reg[key] = {})
	const map = e.prReviews || (e.prReviews = {})
	map[prKey] = { ...(map[prKey] || {}), ...patch }
	saveReg(reg)
	patchCache((d) => {
		const t = d.tasks.find((x) => x.key === key || x.ticket === key)
		if (t) t.prReviews = { ...(t.prReviews || {}), [prKey]: map[prKey] }
	})
	return map[prKey]
}

function finalizePrReview(key, prKey, text) {
	let review = null
	const m = String(text || '').match(/\{[\s\S]*\}/)
	if (m) {
		try {
			review = JSON.parse(m[0])
		} catch (_) {}
	}
	if (!review) review = { summary: String(text || '(리뷰 파싱 실패)').slice(0, 400), verdict: 'comment', issues: [] }
	// 정리·클램프
	review.summary = String(review.summary || '').slice(0, 500)
	review.issues = Array.isArray(review.issues)
		? review.issues.slice(0, 30).map((i) => ({
				severity: /P1|P2|P3/.test(i && i.severity) ? i.severity : 'P3',
				file: i && i.file ? String(i.file).slice(0, 200) : null,
				line: i && typeof i.line === 'number' ? i.line : null,
				title: i && i.title ? String(i.title).slice(0, 160) : '(제목 없음)',
				detail: i && i.detail ? String(i.detail).slice(0, 500) : '',
				fix: i && i.fix ? String(i.fix).slice(0, 400) : '',
		  }))
		: []
	setPrReview(key, prKey, { review, reviewedAt: Date.now(), reviewing: false })
	return { ok: true, key, prKey, issues: review.issues.length, verdict: review.verdict }
}

function startPrReview({ key, repo, number }) {
	if (!key || !repo || !number) return { ok: false, error: 'key·repo·number 필수' }
	const prKey = prKeyOf(repo, number)
	const slug = slugForRepo(repo)
	setPrReview(key, prKey, { reviewing: true })
	const jobId = newJob('rev', 'review')
	try {
		runClaudeJob(
			jobId,
			REVIEW_PR_PROMPT(slug, number),
			(ev, job) => {
				if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 12, `PR #${number} diff 확인 중…`)
				else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
					for (const c of ev.message.content) {
						if (c.type === 'tool_use') bumpJob(job, 55, '변경 파일 읽는 중…')
						else if (c.type === 'text' && c.text && c.text.trim()) bumpJob(job, 90, '리뷰 정리 중…')
					}
				}
			},
			(text) => finalizePrReview(key, prKey, text),
			Settings.modelFor('review'),
			200000,
		)
	} catch (err) {
		setPrReview(key, prKey, { reviewing: false })
		enrichJobs[jobId].result = { ok: false, error: String((err && err.message) || err) }
		enrichJobs[jobId].done = true
		return { ok: false, error: String((err && err.message) || err) }
	}
	return { ok: true, jobId, prKey }
}

function finalizePrImprove(key, prKey, text) {
	let data = null
	const m = String(text || '').match(/\{[\s\S]*\}/)
	if (m) {
		try {
			data = JSON.parse(m[0])
		} catch (_) {}
	}
	const improved = {
		summary: data && data.summary ? String(data.summary).slice(0, 500) : String(text || '(개선 결과 없음)').slice(0, 500),
		fixed: data && Array.isArray(data.fixed) ? data.fixed.map((s) => String(s).slice(0, 200)).slice(0, 20) : [],
		pushed: !!(data && data.pushed),
		at: Date.now(),
	}
	setPrReview(key, prKey, { improved, improving: false })
	return { ok: true, key, prKey, pushed: improved.pushed }
}

async function startPrImprove({ key, repo, number }) {
	if (!key || !repo || !number) return { ok: false, error: 'key·repo·number 필수' }
	const prKey = prKeyOf(repo, number)
	// 1) 리뷰 선행 필수
	const reg = loadReg()
	const existing = reg[key] && reg[key].prReviews && reg[key].prReviews[prKey]
	if (!existing || !existing.review) return { ok: false, error: '먼저 리뷰를 실행하세요.' }
	// 2) 내 PR만 (남의 PR에 푸시 금지) — build에서 PR 정보 확인
	let t = buildCache.data && buildCache.data.tasks.find((x) => x.key === key)
	if (!t) {
		const b = await build().catch(() => null)
		t = b && b.tasks.find((x) => x.key === key)
	}
	const pr = t && (t.prs || []).find((p) => p.repo === repo && p.number === number)
	if (!pr) return { ok: false, error: 'PR을 찾을 수 없습니다.' }
	if (pr.mine === false) return { ok: false, error: '내 PR이 아니라 개선(푸시)할 수 없습니다.' }
	if (pr.state && pr.state !== 'OPEN') return { ok: false, error: `${pr.state} PR은 개선할 수 없습니다(열린 PR만).` }
	// 3) 브랜치 워크트리 확보 (없으면 원격 브랜치로 생성 + node_modules)
	const branch = pr.branch
	if (!branch) return { ok: false, error: 'PR 브랜치를 알 수 없습니다.' }
	let cwd = await Worktrees.pathForBranch(branch).catch(() => null)
	if (!cwd) {
		const wt = await Worktrees.create({ branch }).catch((e) => ({ ok: false, error: String(e.message || e) }))
		if (!wt || !wt.ok) return { ok: false, error: '워크트리 생성 실패: ' + ((wt && wt.error) || '?') }
		cwd = wt.path
	}
	try {
		Worktrees.ensureNodeModules(cwd)
		Worktrees.copyEnvFiles(cwd)
	} catch (_) {}
	setPrReview(key, prKey, { improving: true })
	const jobId = newJob('imp', 'improve')
	try {
		runClaudeJob(
			jobId,
			IMPROVE_PROMPT(existing.review, number),
			(ev, job) => {
				if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 10, '개선 준비 중…')
				else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
					for (const c of ev.message.content) {
						if (c.type === 'tool_use') bumpJob(job, 60, '코드 수정·커밋 중…')
						else if (c.type === 'text' && c.text && c.text.trim()) bumpJob(job, 92, '마무리 중…')
					}
				}
			},
			(text) => finalizePrImprove(key, prKey, text),
			Settings.modelFor('improve'),
			420000, // 편집+빌드 여지 — 7분
			cwd, // ← PR 브랜치 워크트리에서 실행
		)
	} catch (err) {
		setPrReview(key, prKey, { improving: false })
		enrichJobs[jobId].result = { ok: false, error: String((err && err.message) || err) }
		enrichJobs[jobId].done = true
		return { ok: false, error: String((err && err.message) || err) }
	}
	return { ok: true, jobId, prKey, cwd }
}

// ── 📥 PR에 올라온 (남의) 리뷰 반영 → 코드 반영 + 커밋 + 푸시(내 PR만) ──
// 자체 리뷰(🔎)와 달리, 리뷰어(사람·봇)가 GitHub PR에 남긴 리뷰 본문 + 라인 코멘트를 gh api로 가져와 적용한다.
// GitHub 스레드에 답글/​resolve는 하지 않음 — 새 커밋만 올라감(운영자 선택: 반영+푸시).
// 리뷰 피드백은 3곳에 흩어진다: ①formal 리뷰(reviews) ②라인 코멘트(pulls/comments) ③대화 코멘트(issues/comments).
// gh 실패(타임아웃·rate limit·네트워크)를 '없음'으로 오판하지 않도록 ghX(에러 회수)로 조회하고 error를 구분해 돌려준다.
const NOISE_BOT = /^(notion-workspace|github-actions|dependabot|codecov|vercel|netlify|coderabbitai)(\[bot\])?$/i
async function fetchExternalReview(slug, number) {
	const [rev, cmt, iss] = await Promise.all([
		ghX(['api', `repos/${slug}/pulls/${number}/reviews`, '--paginate']),
		ghX(['api', `repos/${slug}/pulls/${number}/comments`, '--paginate']),
		ghX(['api', `repos/${slug}/issues/${number}/comments`, '--paginate']),
	])
	// 셋 다 실패 → GitHub 응답 실패로 취급('없음' 아님)
	if (!rev.ok && !cmt.ok && !iss.ok)
		return { text: '', count: 0, error: String(rev.err || cmt.err || iss.err || 'GitHub 응답 실패').split('\n')[0].slice(0, 200) }
	let reviews = [],
		comments = [],
		issues = []
	try { reviews = JSON.parse(rev.out || '[]') } catch (_) {}
	try { comments = JSON.parse(cmt.out || '[]') } catch (_) {}
	try { issues = JSON.parse(iss.out || '[]') } catch (_) {}
	const me = await ghMe().catch(() => '') // 내(PR 작성자) 코멘트는 제외 — '남이 올린 리뷰'만 반영
	const keep = (login) => login && login !== me && !NOISE_BOT.test(login)
	const parts = []
	const reviewers = new Set() // @멘션·답변 대상 리뷰어
	let count = 0
	for (const r of reviews) {
		const login = (r.user && r.user.login) || ''
		if (!keep(login)) continue
		if ((r.state === 'APPROVED' || r.state === 'COMMENTED') && !String(r.body || '').trim()) continue // 본문 없는 승인/코멘트 래퍼(라인은 아래에서)
		parts.push(`[리뷰 by ${login} · ${r.state}]\n${String(r.body || '(본문 없음)').slice(0, 2000)}`)
		reviewers.add(login)
		count++
	}
	for (const c of comments) {
		const login = (c.user && c.user.login) || ''
		if (!keep(login)) continue
		parts.push(`[라인 코멘트 by ${login} · ${c.path || '?'}:${c.line || c.original_line || '?'}]\n${String(c.body || '').slice(0, 2000)}`)
		reviewers.add(login)
		count++
	}
	for (const c of issues) {
		const login = (c.user && c.user.login) || ''
		if (!keep(login)) continue
		parts.push(`[대화 코멘트 by ${login}]\n${String(c.body || '').slice(0, 2000)}`)
		reviewers.add(login)
		count++
	}
	return { text: parts.join('\n\n').slice(0, 14000), count, reviewers: [...reviewers] }
}

// 코드리뷰에 대한 '답변'으로 게시할 본문 — 리뷰어의 각 지적에 대한 응답(reply)이 핵심.
function buildApplyComment(a, reviewers) {
	const mention = (reviewers || []).length ? (reviewers || []).map((u) => '@' + u).join(' ') + '\n\n' : ''
	// reply(리뷰어에게 보내는 항목별 답변)가 있으면 그걸 본문으로. 없으면 반영/건너뜀 목록으로 대체 구성.
	let body = String(a.reply || '').trim()
	if (!body) {
		const l = ['리뷰 감사합니다. 아래와 같이 처리했습니다.']
		if (a.applied.length) l.push('', '**반영**', ...a.applied.map((s) => `- ${s}`))
		if (a.skipped.length) l.push('', '**미반영(사유)**', ...a.skipped.map((s) => `- ${s}`))
		body = l.join('\n')
	}
	const foot = a.pushed ? '변경을 커밋·푸시했습니다.' : '코드 변경은 없었습니다.'
	return (mention + body + `\n\n---\n<sub>🤖 OpenRM 리뷰 반영 (자동) · ${foot}</sub>`).slice(0, 6000)
}
// PR에 답변 코멘트 게시 (무조건) — 대화 코멘트라 리뷰가 어디 달렸든 항상 게시됨
async function postApplyComment(slug, number, applied, reviewers) {
	const r = await ghX(['api', `repos/${slug}/issues/${number}/comments`, '-f', `body=${buildApplyComment(applied, reviewers)}`]).catch((e) => ({ ok: false, err: String(e.message || e) }))
	return !!r.ok
}
async function finalizePrApplyReview(key, prKey, text, reviewers) {
	let data = null
	const m = String(text || '').match(/\{[\s\S]*\}/)
	if (m) {
		try { data = JSON.parse(m[0]) } catch (_) {}
	}
	const applied = {
		summary: data && data.summary ? String(data.summary).slice(0, 500) : String(text || '(반영 결과 없음)').slice(0, 500),
		reply: data && data.reply ? String(data.reply).slice(0, 4000) : '',
		applied: data && Array.isArray(data.applied) ? data.applied.map((s) => String(s).slice(0, 200)).slice(0, 30) : [],
		skipped: data && Array.isArray(data.skipped) ? data.skipped.map((s) => String(s).slice(0, 200)).slice(0, 30) : [],
		pushed: !!(data && data.pushed),
		at: Date.now(),
		commented: false,
	}
	// GitHub PR에 코드리뷰 답변 코멘트를 무조건 게시
	const cm = String(prKey).match(/^(.+)#(\d+)$/)
	if (cm) applied.commented = await postApplyComment(slugForRepo(cm[1]), Number(cm[2]), applied, reviewers)
	setPrReview(key, prKey, { applied, applying: false })
	return { ok: true, key, prKey, pushed: applied.pushed, applied: applied.applied.length, commented: applied.commented }
}

async function startPrApplyReview({ key, repo, number }) {
	if (!key || !repo || !number) return { ok: false, error: 'key·repo·number 필수' }
	const prKey = prKeyOf(repo, number)
	const slug = slugForRepo(repo)
	// 1) 내 PR·열린 PR만 (남의 PR에 푸시 금지)
	let t = buildCache.data && buildCache.data.tasks.find((x) => x.key === key)
	if (!t) {
		const b = await build().catch(() => null)
		t = b && b.tasks.find((x) => x.key === key)
	}
	const pr = t && (t.prs || []).find((p) => p.repo === repo && p.number === number)
	if (!pr) return { ok: false, error: 'PR을 찾을 수 없습니다.' }
	if (pr.mine === false) return { ok: false, error: '내 PR이 아니라 반영(푸시)할 수 없습니다.' }
	if (pr.state && pr.state !== 'OPEN') return { ok: false, error: `${pr.state} PR은 반영할 수 없습니다(열린 PR만).` }
	// 2) PR에 올라온 외부 리뷰 수집 — 실패(GitHub 응답 실패)와 진짜 없음을 구분
	const rev = await fetchExternalReview(slug, number).catch((e) => ({ text: '', count: 0, error: String(e.message || e) }))
	if (rev.error) return { ok: false, error: `리뷰를 불러오지 못했어요 — ${rev.error}. 잠시 후 다시 시도해주세요.` }
	if (!rev.count) return { ok: false, error: 'PR에 반영할 리뷰가 없어요(내 코멘트·notion 봇 등 자동봇 제외). 리뷰/라인/대화 코멘트를 모두 확인했어요.' }
	// 3) 브랜치 워크트리 확보 (없으면 원격 브랜치로 생성 + node_modules)
	const branch = pr.branch
	if (!branch) return { ok: false, error: 'PR 브랜치를 알 수 없습니다.' }
	let cwd = await Worktrees.pathForBranch(branch).catch(() => null)
	if (!cwd) {
		const wt = await Worktrees.create({ branch }).catch((e) => ({ ok: false, error: String(e.message || e) }))
		if (!wt || !wt.ok) return { ok: false, error: '워크트리 생성 실패: ' + ((wt && wt.error) || '?') }
		cwd = wt.path
	}
	try {
		Worktrees.ensureNodeModules(cwd)
		Worktrees.copyEnvFiles(cwd)
	} catch (_) {}
	setPrReview(key, prKey, { applying: true })
	const jobId = newJob('apr', 'apply-review')
	try {
		runClaudeJob(
			jobId,
			Prompts.render('review.apply', { number, reviewText: rev.text }),
			(ev, job) => {
				if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 10, `리뷰 ${rev.count}건 반영 준비 중…`)
				else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
					for (const c of ev.message.content) {
						if (c.type === 'tool_use') bumpJob(job, 60, '코드 반영·커밋 중…')
						else if (c.type === 'text' && c.text && c.text.trim()) bumpJob(job, 92, '마무리 중…')
					}
				}
			},
			(text) => finalizePrApplyReview(key, prKey, text, rev.reviewers),
			Settings.modelFor('improve'),
			420000, // 편집+빌드 여지 — 7분
			cwd, // ← PR 브랜치 워크트리에서 실행
		)
	} catch (err) {
		setPrReview(key, prKey, { applying: false })
		enrichJobs[jobId].result = { ok: false, error: String((err && err.message) || err) }
		enrichJobs[jobId].done = true
		return { ok: false, error: String((err && err.message) || err) }
	}
	return { ok: true, jobId, prKey, cwd, count: rev.count }
}

// 🗣️ 리뷰 항의/질문: 리뷰 판정에 이의가 있으면 사람이 텍스트로 반박·질문 → 헤드리스 claude가 근거를 다시 확인해 답변.
// 동의만 하지 않도록 프롬프트에서 강제(review.question). 이의가 타당하면 issues 배열도 갱신(무비판적 수용 금지).
function finalizePrQuestion(key, prKey, question, text) {
	let data = null
	const m = String(text || '').match(/\{[\s\S]*\}/)
	if (m) {
		try {
			data = JSON.parse(m[0])
		} catch (_) {}
	}
	const questionResult = {
		question: String(question || '').slice(0, 1000),
		answer: data && data.answer ? String(data.answer).slice(0, 1000) : String(text || '(답변 파싱 실패)').slice(0, 1000),
		verdictChanged: !!(data && data.verdictChanged),
		at: Date.now(),
	}
	const patch = { questioning: false, question: questionResult }
	if (data && data.verdictChanged && Array.isArray(data.updatedIssues)) {
		const reg = loadReg()
		const existing = reg[key] && reg[key].prReviews && reg[key].prReviews[prKey]
		if (existing && existing.review) {
			patch.review = {
				...existing.review,
				issues: data.updatedIssues.slice(0, 30).map((i) => ({
					severity: /P1|P2|P3/.test(i && i.severity) ? i.severity : 'P3',
					file: i && i.file ? String(i.file).slice(0, 200) : null,
					line: i && typeof i.line === 'number' ? i.line : null,
					title: i && i.title ? String(i.title).slice(0, 160) : '(제목 없음)',
					detail: i && i.detail ? String(i.detail).slice(0, 500) : '',
					fix: i && i.fix ? String(i.fix).slice(0, 400) : '',
				})),
			}
		}
	}
	setPrReview(key, prKey, patch)
	return { ok: true, key, prKey, verdictChanged: questionResult.verdictChanged }
}

function startPrQuestion({ key, repo, number, question }) {
	if (!key || !repo || !number) return { ok: false, error: 'key·repo·number 필수' }
	if (!question || !String(question).trim()) return { ok: false, error: '질문 내용을 입력하세요.' }
	const prKey = prKeyOf(repo, number)
	const slug = slugForRepo(repo)
	const reg = loadReg()
	const existing = reg[key] && reg[key].prReviews && reg[key].prReviews[prKey]
	if (!existing || !existing.review) return { ok: false, error: '먼저 리뷰를 실행하세요.' }
	setPrReview(key, prKey, { questioning: true })
	const jobId = newJob('rvq', 'question')
	try {
		runClaudeJob(
			jobId,
			QUESTION_PROMPT(slug, number, existing.review, String(question).trim()),
			(ev, job) => {
				if (ev.type === 'system' && ev.subtype === 'init') bumpJob(job, 12, '리뷰 재확인 중…')
				else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
					for (const c of ev.message.content) {
						if (c.type === 'tool_use') bumpJob(job, 55, '코드 재확인 중…')
						else if (c.type === 'text' && c.text && c.text.trim()) bumpJob(job, 90, '답변 정리 중…')
					}
				}
			},
			(text) => finalizePrQuestion(key, prKey, question, text),
			Settings.modelFor('review'),
			200000,
		)
	} catch (err) {
		setPrReview(key, prKey, { questioning: false })
		enrichJobs[jobId].result = { ok: false, error: String((err && err.message) || err) }
		enrichJobs[jobId].done = true
		return { ok: false, error: String((err && err.message) || err) }
	}
	return { ok: true, jobId, prKey }
}

// ── 📦 작업 보관함 (해결한 작업을 날짜별 이력으로 보존 — 삭제와 별개) ──
// 삭제는 흔적을 지우지만, 보관은 스냅샷(티켓·제목·PR·그룹·보관일)을 남기고 워크트리만 정리한다.
async function archiveTask({ key }) {
	if (!key) return { ok: false, error: 'key 필수' }
	let t = buildCache.data && buildCache.data.tasks.find((x) => x.key === key)
	if (!t) {
		const b = await build().catch(() => null)
		t = b && b.tasks.find((x) => x.key === key)
	}
	if (!t) return { ok: false, error: '작업을 찾을 수 없습니다.' }
	const done = { worktrees: [], branches: [], errors: [] }
	// 워크트리·로컬 브랜치 정리 (미커밋 변경은 --force로 폐기). PR은 건드리지 않음(머지됐거나 그대로 둠).
	for (const s of t.streams || []) {
		if (s.isMain) continue
		const rm = await gitX(['worktree', 'remove', '--force', s.path])
		if (!rm.ok) { done.errors.push(`워크트리 ${s.name || s.path} 제거 실패: ${(rm.err.split('\n').find((l) => l.trim()) || '').slice(0, 100)}`); continue }
		done.worktrees.push(s.name || s.path)
		if (s.branch && s.branch !== '?' && !/^\(/.test(s.branch)) {
			const bd = await gitX(['branch', '-D', s.branch])
			if (bd.ok) done.branches.push(s.branch)
		}
	}
	const reg = loadReg()
	const m = ensureMeta(reg)
	const snap = {
		key: t.key,
		ticket: t.ticket || null,
		title: t.title || null,
		group: t.group || null,
		prs: (t.prs || []).map((p) => ({ number: p.number, repo: p.repo, url: p.url, title: p.title || null, state: p.state || null })),
		links: t.links || null,
		archivedAt: Date.now(),
	}
	m.archived = (m.archived || []).filter((a) => a.key !== t.key) // 중복 방지(재보관 시 갱신)
	m.archived.push(snap)
	if (reg[key]) delete reg[key] // 등록 제거 → 활성 보드에서 빠짐
	saveReg(reg)
	prCache.at = 0
	patchCache((d) => { d.tasks = d.tasks.filter((x) => x.key !== key); d.count = d.tasks.length })
	bustBuild()
	return { ok: true, archivedAt: snap.archivedAt, ...done }
}
// 보관 해제 → 수동 등록으로 복원(보드에 다시 표시). 워크트리는 이미 정리됐으니 링크·PR·그룹만 되살린다.
function unarchiveTask({ key }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const reg = loadReg()
	const m = ensureMeta(reg)
	const snap = (m.archived || []).find((a) => a.key === key)
	if (!snap) return { ok: false, error: '보관 항목을 찾을 수 없습니다.' }
	m.archived = m.archived.filter((a) => a.key !== key)
	const e = reg[key] || (reg[key] = {})
	e.manual = true
	if (snap.title) e.title = snap.title
	if (snap.group) e.group = snap.group
	if (snap.links) e.links = snap.links
	if (Array.isArray(snap.prs) && snap.prs.length) e.manualPrs = snap.prs.map((p) => ({ number: p.number, repo: p.repo, url: p.url, title: p.title || null, state: p.state || null }))
	saveReg(reg)
	prCache.at = 0
	bustBuild()
	return { ok: true }
}
// 보관 항목 영구 삭제 (이력에서 제거 — 워크트리는 이미 없으니 등록만 정리)
function deleteArchived({ key }) {
	if (!key) return { ok: false, error: 'key 필수' }
	const reg = loadReg()
	const m = ensureMeta(reg)
	const before = (m.archived || []).length
	m.archived = (m.archived || []).filter((a) => a.key !== key)
	if (m.archived.length === before) return { ok: false, error: '보관 항목 없음' }
	saveReg(reg)
	return { ok: true }
}
// 보관함 조회 — 보관일(YYYY-MM-DD, 로컬) 기준으로 그룹핑, 최신 날짜·최신 항목 순.
function listArchived() {
	const reg = loadReg()
	const m = ensureMeta(reg)
	const arr = (m.archived || []).slice().sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0))
	const dayKey = (ms) => {
		const d = new Date(ms || Date.now())
		const p = (n) => String(n).padStart(2, '0')
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
	}
	const byDay = {}
	for (const a of arr) (byDay[dayKey(a.archivedAt)] || (byDay[dayKey(a.archivedAt)] = [])).push(a)
	const archived = Object.keys(byDay).sort((a, b) => b.localeCompare(a)).map((date) => ({ date, items: byDay[date] }))
	return { ok: true, total: arr.length, archived }
}

// 수동 링크 추가/삭제 (피그마 등 PR에 없는 것 보강). url로 종류 자동 판별.
function mutateLink({ ticket, url, kind, action }) {
	if (!ticket || !url) return { ok: false, error: 'ticket·url 필수' }
	const k = KINDS.includes(kind) ? kind : linkKind(url)
	if (!KINDS.includes(k)) return { ok: false, error: 'slack/notion/figma 링크만 추가할 수 있어요.' }
	const reg = loadReg()
	const e = reg[ticket] || (reg[ticket] = {})
	const links = e.links || (e.links = {})
	const arr = links[k] || (links[k] = [])
	if (action === 'remove') links[k] = arr.filter((u) => u !== url)
	else if (!arr.includes(url)) arr.push(url)
	if (!saveReg(reg)) return { ok: false, error: '레지스트리 저장 실패' }
	prCache.at = 0
	bustBuild()
	return { ok: true, kind: k }
}

function setTitle({ ticket, title }) {
	if (!ticket) return { ok: false, error: 'ticket 필수' }
	const reg = loadReg()
	const e = reg[ticket] || (reg[ticket] = {})
	if (title && title.trim()) e.title = title.trim()
	else delete e.title
	if (!saveReg(reg)) return { ok: false, error: '레지스트리 저장 실패' }
	bustBuild()
	return { ok: true }
}

module.exports = { build, createFromLink, enrichThread, startEnrich, enrichStatus, startBacklog, listJobs, removeTask, mutateLink, setTitle, setGroup, setGroupBase, setDevServer, setMemo, setTc, setTaskModel, startClassify, setTaskClass, startOps, reorderGroup, setChain, applyChain, startGroupDevServer, createGroup, removeGroup, renameGroup, cleanupDone, archiveTask, unarchiveTask, deleteArchived, listArchived, startPrReview, startPrImprove, startPrApplyReview, startPrQuestion, listFailures, retryFailure, dismissFailure, translateToEnglishSlug, linkBacklogs, REVIEW_DIRECTIVE, extractLinks, linkKind }
