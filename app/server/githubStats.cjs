// githubStats.cjs — GitHub 페이지용 집계 (Phase 5.1). 읽기 전용.
// prs.cjs의 sh/gh 패턴 재사용. 레포 목록은 AppCfg.prRepos()(Setup 페이지 githubRepo)를 매번 새로 읽음.
// 커밋: 로컬 클론이 있으면 git log(빠름·rate-limit 없음), 없으면 gh api commits로 폴백.
//   ⚠️ gh api 폴백은 per_page=100 '한 페이지'로 캡한다(대형 레포에서 --paginate는 느리고 rate-limit 위험).
//      즉 gh-api 소스 레포의 커밋 통계는 '최근 최대 100커밋' 근사임(소스 표시로 명시).
'use strict'
const { execFile } = require('child_process')
const C = require('./collector.cjs')
const AppCfg = require('./store/settings.cjs')
const { ghEnv } = require('./ghEnv.cjs')

function sh(cmd, args, timeout = 20000) {
	return new Promise((resolve) => execFile(cmd, args, { cwd: C.REPO, timeout, maxBuffer: 16 << 20, env: cmd === 'gh' ? ghEnv() : process.env }, (e, out) => resolve(e ? '' : String(out || ''))))
}
const gh = (args, t) => sh('gh', args, t)
const git = (args, repo, t) => sh('git', ['-C', repo, ...args], t)

function repos() {
	return AppCfg.prRepos().map((r) => ({ name: r.name, slug: r.slug }))
}

// C.REPO(로컬 메인 클론)의 origin이 slug와 일치하면 그걸 로컬 클론으로 사용, 아니면 null → gh api 폴백.
async function localCloneFor(slug) {
	const url = (await git(['remote', 'get-url', 'origin'], C.REPO, 5000)).trim().toLowerCase()
	return url && url.includes(slug.toLowerCase()) ? C.REPO : null
}

function parseRows(out) {
	return out.split('\n').filter(Boolean).map((l) => {
		const i = l.indexOf('\t')
		return i < 0 ? { at: l, subject: '' } : { at: l.slice(0, i), subject: l.slice(i + 1) }
	})
}
// 커밋 목록 {at(ISO), subject} — 로컬 git log 우선, 없으면 gh api(≤100).
async function commitRows(repo, sinceISO) {
	const local = await localCloneFor(repo.slug)
	if (local) {
		const out = await git(['log', '--since=' + sinceISO, '--no-merges', '--format=%cI%x09%s'], local, 15000)
		return { source: 'local-git', rows: parseRows(out) }
	}
	const raw = await gh(['api', `repos/${repo.slug}/commits?since=${encodeURIComponent(sinceISO)}&per_page=100`, '-q', '.[] | .commit.committer.date + "\t" + (.commit.message | split("\n")[0])'], 25000)
	return { source: 'gh-api(≤100)', rows: parseRows(raw) }
}

async function buildStats(days) {
	const sinceMs = Date.now() - days * 86400000
	const sinceISO = new Date(sinceMs).toISOString()
	const sinceDate = sinceISO.slice(0, 10)
	const errors = []
	const REPOS = AppCfg.prRepos()

	const per = await Promise.all(
		REPOS.map(async (repo) => {
			let commits = { source: 'none', rows: [] }
			let prs = []
			try {
				commits = await commitRows(repo, sinceISO)
			} catch (_) {
				errors.push(repo.name + ' (commits)')
			}
			try {
				prs = JSON.parse((await gh(['pr', 'list', '-R', repo.slug, '--state', 'all', '--json', 'number,state,isDraft,additions,deletions,createdAt,mergedAt,title,url', '-L', '200'], 25000)) || '[]')
			} catch (_) {
				errors.push(repo.name + ' (prs)')
			}
			return { repo, commits, prs }
		}),
	)

	// 집계 컨테이너
	const heatmap = {} // 'YYYY-MM-DD' → commit count (전 레포 합산)
	const weeks = Math.max(1, Math.ceil(days / 7))
	const weekly = Array.from({ length: weeks }, (_, i) => ({ weekStart: new Date(sinceMs + i * 7 * 86400000).toISOString().slice(0, 10), commits: 0 }))
	const funnel = { merged: 0, open: 0, draft: 0, closed: 0 }
	const perRepo = []
	const activity = []
	let totalCommits = 0
	let nightCommits = 0
	let additions = 0
	let deletions = 0
	let leadSumMs = 0
	let leadCount = 0

	for (const { repo, commits, prs } of per) {
		let repoAdds = 0
		let repoDels = 0
		// commits
		for (const c of commits.rows) {
			totalCommits++
			const day = String(c.at).slice(0, 10)
			heatmap[day] = (heatmap[day] || 0) + 1
			const atMs = Date.parse(c.at)
			if (!Number.isNaN(atMs)) {
				const wi = Math.floor((atMs - sinceMs) / (7 * 86400000))
				if (wi >= 0 && wi < weekly.length) weekly[wi].commits++
				const hr = new Date(atMs).getHours()
				if (hr >= 22 || hr < 6) nightCommits++ // 야간(22:00–06:00 local)
				if (c.subject) activity.push({ kind: 'commit', text: c.subject.slice(0, 100), repo: repo.name, at: atMs })
			}
		}
		// PRs
		for (const p of prs) {
			const st = String(p.state || '').toUpperCase()
			if (p.isDraft) funnel.draft++
			else if (st === 'MERGED') funnel.merged++
			else if (st === 'OPEN') funnel.open++
			else if (st === 'CLOSED') funnel.closed++
			if (st === 'MERGED' && p.mergedAt && Date.parse(p.mergedAt) >= sinceMs) {
				repoAdds += p.additions || 0
				repoDels += p.deletions || 0
				const lead = Date.parse(p.mergedAt) - Date.parse(p.createdAt)
				if (lead > 0) {
					leadSumMs += lead
					leadCount++
				}
				activity.push({ kind: 'pr', text: `#${p.number} ${p.title || ''}`.slice(0, 100), repo: repo.name, at: Date.parse(p.mergedAt) })
			}
		}
		additions += repoAdds
		deletions += repoDels
		perRepo.push({ name: repo.name, slug: repo.slug, commits: commits.rows.length, additions: repoAdds, deletions: repoDels, source: commits.source })
	}

	activity.sort((a, b) => b.at - a.at)

	return {
		ok: true,
		rangeDays: days,
		since: sinceDate,
		builtAt: new Date().toISOString(),
		repos: repos(),
		totals: {
			commits: totalCommits,
			prsMerged: funnel.merged,
			prsOpen: funnel.open,
			prsDraft: funnel.draft,
			prsClosed: funnel.closed,
			additions,
			deletions,
			avgLeadTimeHours: leadCount ? Math.round((leadSumMs / leadCount / 3600000) * 10) / 10 : null,
			nightWorkRatio: totalCommits ? Math.round((nightCommits / totalCommits) * 100) / 100 : 0,
		},
		heatmap, // contribution heatmap: {날짜: 커밋수}
		weekly, // 주간 커밋 막대: [{weekStart, commits}]
		funnel, // PR 퍼널: {merged, open, draft, closed}
		perRepo, // 레포별 diff 막대: [{name, slug, commits, additions, deletions, source}]
		activity: activity.slice(0, 20), // 최근 활동: [{kind:'pr'|'commit', text, repo, at(ms)}]
		errors: errors.length ? errors : undefined,
	}
}

// stale-while-revalidate 캐시 (range별, ~60s) — cockpit.cjs 패턴.
const FRESH = 60000
const caches = new Map() // days → { at, data, building }
async function getStats({ rangeDays = 30 } = {}) {
	const days = [30, 90, 365].includes(Number(rangeDays)) ? Number(rangeDays) : 30
	const c = caches.get(days) || { at: 0, data: null, building: false }
	caches.set(days, c)
	const age = Date.now() - c.at
	if (c.data) {
		if (age >= FRESH && !c.building) {
			c.building = true
			buildStats(days).then((d) => { c.at = Date.now(); c.data = d; c.building = false }).catch(() => { c.building = false })
		}
		return c.data // stale 즉시 반환
	}
	const d = await buildStats(days)
	c.at = Date.now()
	c.data = d
	return d
}

module.exports = { getStats, repos }
