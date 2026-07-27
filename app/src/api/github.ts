import { api } from './client'

interface GithubStatsRaw {
	ok: boolean
	rangeDays: number
	since: string
	builtAt: string
	repos: { name: string; slug: string }[]
	totals: {
		commits: number
		prsMerged: number
		prsOpen: number
		prsDraft: number
		prsClosed: number
		additions: number
		deletions: number
		avgLeadTimeHours: number | null
		nightWorkRatio: number
	}
	heatmap: Record<string, number>
	weekly: { weekStart: string; commits: number }[]
	funnel: { merged: number; open: number; draft: number; closed: number }
	perRepo: { name: string; slug: string; commits: number; additions: number; deletions: number; source: string }[]
	activity: { kind: 'commit' | 'pr'; text: string; repo: string; at: number }[]
	errors?: string[]
}

export interface GithubStats {
	rangeDays: number
	commits: number
	prsMerged: number
	activeDays: number
	avgLeadTimeDays: number
	nightRatio: number
	heatmap: { date: string; count: number }[]
	weeklyCommits: { week: string; count: number }[]
	prFunnel: { merged: number; open: number; draft: number; closed: number }
	perRepoDiff: { repo: string; add: number; del: number }[]
	recentActivity: { fg: string; text: string; repo: string; ago: string }[]
	errors?: string[]
}

function ago(ts: number): string {
	const diff = Date.now() - ts
	const min = Math.floor(diff / 60000)
	if (min < 60) return `${min}분 전`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}시간 전`
	return `${Math.floor(hr / 24)}일 전`
}

function toViewModel(raw: GithubStatsRaw): GithubStats {
	const sinceMs = Date.parse(raw.since)
	const heatmap: { date: string; count: number }[] = []
	for (let i = 0; i < raw.rangeDays; i++) {
		const date = new Date(sinceMs + i * 86400000).toISOString().slice(0, 10)
		heatmap.push({ date, count: raw.heatmap[date] || 0 })
	}
	return {
		rangeDays: raw.rangeDays,
		commits: raw.totals.commits,
		prsMerged: raw.totals.prsMerged,
		activeDays: Object.keys(raw.heatmap).length,
		avgLeadTimeDays: raw.totals.avgLeadTimeHours != null ? raw.totals.avgLeadTimeHours / 24 : 0,
		nightRatio: raw.totals.nightWorkRatio,
		heatmap,
		weeklyCommits: raw.weekly.map((w) => ({ week: w.weekStart.slice(5), count: w.commits })),
		prFunnel: raw.funnel,
		perRepoDiff: raw.perRepo.map((r) => ({ repo: r.name, add: r.additions, del: r.deletions })),
		recentActivity: raw.activity.map((a) => ({ fg: a.kind === 'pr' ? 'var(--violet)' : 'var(--green)', text: a.text, repo: a.repo, ago: ago(a.at) })),
		errors: raw.errors,
	}
}

export function getGithubStats(range: 30 | 90 | 365 = 90) {
	return api.get<GithubStatsRaw>(`/api/github/stats?range=${range}`).then(toViewModel)
}
export function getGithubRepos() {
	return api.get<{ ok: boolean; repos: { name: string; slug: string }[] }>('/api/github/repos').then((r) => r.repos)
}
