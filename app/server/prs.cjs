// prs.cjs — 내 PR 나열 + PR↔코드↔화면 대조. gh CLI로 PR, active.cjs로 코드 verdict, 티켓→figmaNodes로 화면.
'use strict'
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const C = require('./collector.cjs')
const Active = require('./active.cjs')
const Ticket = require('./ticket.cjs')
const AppCfg = require('./store/settings.cjs')
const { ghEnv } = require('./ghEnv.cjs')

// PR의 실제 변경 파일만 verdict (gh files + 워크트리 내용). develop 기준 diff(에픽 전체)와 달리 정확.
function verdictForFiles(files, repo) {
	const items = []
	for (const f of files) {
		const p = f.path
		if (!Active.isVerifiable(p)) continue
		let content = ''
		try {
			content = fs.readFileSync(path.join(repo, p), 'utf8')
		} catch {
			continue // 삭제/이동 등
		}
		items.push(Active.evaluateFile(p, content, 'M', repo))
	}
	const rank = { bad: 0, warn: 1, ok: 2 }
	items.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.file.localeCompare(b.file))
	return {
		counts: {
			files: items.length,
			bad: items.filter((i) => i.verdict === 'bad').length,
			warn: items.filter((i) => i.verdict === 'warn').length,
			ok: items.filter((i) => i.verdict === 'ok').length,
			missingTest: items.filter((i) => i.test === 'none').length,
		},
		items,
	}
}

function sh(cmd, args, timeout = 15000) {
	return new Promise((resolve) =>
		execFile(cmd, args, { cwd: C.REPO, timeout, maxBuffer: 8 << 20, env: cmd === 'gh' ? ghEnv() : process.env }, (e, out) => resolve(e ? '' : String(out || ''))),
	)
}
const gh = (args) => sh('gh', args)
const ticketOf = Ticket.ticketOf

// statusCheckRollup → pass/fail/pending/none
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

// 브랜치 → 워크트리 경로 (git worktree list 1회 파싱, per-worktree git 호출 없음)
async function worktreeByBranch() {
	const raw = await sh('git', ['-C', C.REPO, 'worktree', 'list', '--porcelain'])
	const map = {}
	let p = null
	for (const line of raw.split('\n')) {
		if (line.startsWith('worktree ')) p = line.slice(9).trim()
		else if (line.startsWith('branch ')) map[line.slice(7).trim().replace('refs/heads/', '')] = p
	}
	return map
}

const PR_FIELDS =
	'number,title,headRefName,baseRefName,state,isDraft,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,url,updatedAt'

// 내 PR을 모을 레포 — Setup 페이지의 githubRepo(콤마로 여러 개 가능) 설정을 매번 새로 읽음(AppCfg.prRepos()).

function mapPr(p, repoName, wtMap) {
	return {
		number: p.number,
		repo: repoName,
		title: p.title,
		branch: p.headRefName,
		base: p.baseRefName,
		// gh CLI는 state를 대문자(OPEN/CLOSED/MERGED)로 준다 — 프론트(GitStatusEntry.pr.state,
		// TaskRow의 PR_LABEL/isDone 비교)는 전부 소문자를 기대해서 여기서 한 번만 맞춘다.
		state: String(p.state || '').toLowerCase(),
		draft: !!p.isDraft,
		review: p.reviewDecision || null,
		ci: ciSummary(p.statusCheckRollup),
		additions: p.additions,
		deletions: p.deletions,
		files: p.changedFiles,
		url: p.url,
		updatedAt: p.updatedAt,
		ticket: ticketOf(p.headRefName),
		worktree: wtMap[p.headRefName] || null, // 코드 검증 가능 여부(web 워크트리 기준)
	}
}

async function list(state = 'open') {
	const st = ['open', 'merged', 'closed'].includes(state) ? state : 'open'
	const REPOS = AppCfg.prRepos()
	const wtMap = await worktreeByBranch() // C.REPO(web) 워크트리 — web PR만 코드검증 매칭
	const perRepo = await Promise.all(
		REPOS.map(async (repo) => {
			const raw = await gh(['pr', 'list', '-R', repo.slug, '--author', '@me', '--state', st, '-L', '50', '--json', PR_FIELDS])
			let prs = []
			try {
				prs = JSON.parse(raw || '[]')
			} catch {
				return { name: repo.name, error: true, prs: [] }
			}
			return { name: repo.name, prs: prs.map((p) => mapPr(p, repo.name, wtMap)) }
		}),
	)
	const all = perRepo.flatMap((r) => r.prs)
	all.sort((a, b) => a.repo.localeCompare(b.repo) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
	const failed = perRepo.filter((r) => r.error).map((r) => r.name)
	return {
		state: st,
		repos: REPOS.map((r) => r.name),
		byRepo: Object.fromEntries(perRepo.map((r) => [r.name, r.prs.length])),
		counts: {
			total: all.length,
			draft: all.filter((p) => p.draft).length,
			ciFail: all.filter((p) => p.ci === 'fail').length,
			verifiable: all.filter((p) => p.worktree).length,
		},
		prs: all,
		error: failed.length ? `레포 조회 실패: ${failed.join(', ')} (gh 인증 확인)` : undefined,
		builtAt: new Date().toISOString(),
	}
}

async function detail(num, repoName) {
	const REPOS = AppCfg.prRepos()
	const repo = REPOS.find((r) => r.name === repoName) || REPOS[0]
	const raw = await gh([
		'pr',
		'view',
		String(num),
		'-R',
		repo.slug,
		'--json',
		'number,title,headRefName,baseRefName,state,isDraft,reviewDecision,statusCheckRollup,url,files,additions,deletions',
	])
	let m = {}
	try {
		m = JSON.parse(raw || '{}')
	} catch {
		return { error: 'gh pr view 실패' }
	}
	const ticket = ticketOf(m.headRefName)
	const wt = (await worktreeByBranch())[m.headRefName] || null

	// 코드: 워크트리 있으면 PR 변경 파일만 verdict (정확). 없으면 파일 목록만(verdict 없음).
	let code = null
	if (wt && Array.isArray(m.files)) {
		try {
			code = verdictForFiles(m.files, wt)
		} catch {
			/* skip */
		}
	}

	// 화면: 티켓 → 백로그 figmaNodes (state.json)
	let figmaNodes = []
	try {
		const model = C.readModel()
		for (const lane of Object.values(model.backlogs || {}))
			for (const b of lane) if (b.id === ticket && b.figmaNodes) figmaNodes = b.figmaNodes
	} catch {
		/* skip */
	}

	return {
		number: m.number,
		repo: repo.name,
		title: m.title,
		branch: m.headRefName,
		base: m.baseRefName,
		state: m.state,
		draft: !!m.isDraft,
		review: m.reviewDecision || null,
		ci: ciSummary(m.statusCheckRollup),
		url: m.url,
		ticket,
		worktree: wt,
		prFiles: (m.files || []).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
		code, // { branch, counts, items } | null
		figmaNodes,
		builtAt: new Date().toISOString(),
	}
}

module.exports = { list, detail }
