// sentry.cjs — Sentry를 '직접' 조회 (스레드/Slack 경유 X). 운영 서버 에러를 API로 상시 감시.
// 토큰은 .openrm-settings.json(gitignore) 또는 env(SENTRY_AUTH_TOKEN·SENTRY_ORG). org 기본값 없음(설정 필요).
'use strict'
const https = require('https')
const Settings = require('./settings.cjs')

const HOST = 'sentry.io'
const DEFAULT_ORG = ''

function cfg() {
	const s = Settings.load()
	return {
		token: process.env.SENTRY_AUTH_TOKEN || s.sentryToken || '',
		org: process.env.SENTRY_ORG || s.sentryOrg || DEFAULT_ORG,
		project: process.env.SENTRY_PROJECT || s.sentryProject || '', // 프로젝트 slug (한 곳만 볼 때)
		query: process.env.SENTRY_QUERY || s.sentryQuery || 'is:unresolved',
		identifier: s.sentryIdentifier || '', // 사용자가 준 식별자(PROD-CRM-WEB-SERVER-25N)
		kind: s.sentryKind || '', // probe 결과: project | server_name | issue
	}
}
const configured = () => !!cfg().token
const tokenMasked = () => { const t = cfg().token; return t ? t.slice(0, 6) + '…' + t.slice(-4) : '' }

// Sentry REST API GET (Bearer). 실패 시 status 포함 에러.
function api(pathQ) {
	const { token } = cfg()
	return new Promise((resolve, reject) => {
		if (!token) return reject(new Error('Sentry 토큰 미설정 (설정에서 Auth Token 입력)'))
		const req = https.request(
			{ host: HOST, path: '/api/0' + pathQ, method: 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } },
			(res) => {
				let body = ''
				res.on('data', (c) => (body += c))
				res.on('end', () => {
					if (res.statusCode >= 200 && res.statusCode < 300) {
						try { resolve(JSON.parse(body)) } catch (_) { resolve(body) }
					} else reject(Object.assign(new Error(`Sentry ${res.statusCode}: ${String(body).slice(0, 240)}`), { status: res.statusCode }))
				})
			},
		)
		req.on('error', reject)
		req.setTimeout(12000, () => req.destroy(new Error('Sentry 타임아웃')))
		req.end()
	})
}

async function listProjects() {
	const { org } = cfg()
	const rows = await api(`/organizations/${org}/projects/`)
	return (Array.isArray(rows) ? rows : []).map((p) => ({ id: p.id, slug: p.slug, name: p.name, platform: p.platform }))
}

const mapIssue = (i) => ({
	shortId: i.shortId,
	title: i.title || i.metadata?.value || i.culprit,
	culprit: i.culprit,
	level: i.level,
	count: Number(i.count) || 0,
	userCount: i.userCount || 0,
	firstSeen: i.firstSeen,
	lastSeen: i.lastSeen,
	status: i.status,
	url: i.permalink,
	project: i.project && i.project.slug,
})

// ── 식별자(PROD-CRM-WEB-SERVER-25N)가 Sentry에서 뭔지 자동 조사 ──
async function probe(identifierArg) {
	const { org } = cfg()
	const id = String(identifierArg || cfg().identifier || '').trim()
	const out = { ok: true, identifier: id, org, kind: 'unknown', detail: null, projects: [] }
	if (!id) return { ok: false, error: '식별자를 입력하세요.' }
	try { out.projects = await listProjects() } catch (e) { return { ok: false, error: String(e.message || e), status: e.status || 0 } }
	// 1) 이슈 Short ID?
	try {
		const r = await api(`/organizations/${org}/shortids/${encodeURIComponent(id)}/`)
		if (r && r.group) {
			out.kind = 'issue'
			out.detail = { shortId: r.shortId, title: r.group.title, project: r.group.project && r.group.project.slug, url: r.group.permalink, status: r.group.status, count: Number(r.group.count) || 0, lastSeen: r.group.lastSeen }
			return out
		}
	} catch (_) {}
	// 2) 프로젝트 slug/name?
	const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
	const proj = out.projects.find((p) => norm(p.slug) === norm(id) || norm(p.name) === norm(id))
	if (proj) { out.kind = 'project'; out.detail = proj; return out }
	// 3) server_name 태그로 org 전역 검색
	try {
		const issues = await api(`/organizations/${org}/issues/?query=${encodeURIComponent('server_name:' + id)}&statsPeriod=14d&project=-1&limit=5`)
		if (Array.isArray(issues) && issues.length) {
			out.kind = 'server_name'
			out.detail = { matches: issues.length, sample: issues.slice(0, 3).map(mapIssue) }
			return out
		}
	} catch (_) {}
	return out
}

// ── 상시 감시용: 조건에 맞는 최근 미해결 이슈 ──
// kind=project → 그 프로젝트 / kind=server_name → server_name 필터 / kind=issue → 그 이슈만
async function recentIssues({ statsPeriod = '1h', limit = 25 } = {}) {
	const c = cfg()
	if (c.kind === 'issue' && c.identifier) {
		try {
			const r = await api(`/organizations/${c.org}/shortids/${encodeURIComponent(c.identifier)}/`)
			return r && r.group ? [mapIssue({ ...r.group, shortId: r.shortId })] : []
		} catch (_) { return [] }
	}
	let path
	if (c.kind === 'server_name' && c.identifier) {
		path = `/organizations/${c.org}/issues/?query=${encodeURIComponent(c.query + ' server_name:' + c.identifier)}&statsPeriod=${statsPeriod}&project=-1&limit=${limit}&sort=date`
	} else if (c.project) {
		path = `/projects/${c.org}/${c.project}/issues/?query=${encodeURIComponent(c.query)}&statsPeriod=${statsPeriod}&limit=${limit}&sort=date`
	} else {
		path = `/organizations/${c.org}/issues/?query=${encodeURIComponent(c.query)}&statsPeriod=${statsPeriod}&project=-1&limit=${limit}&sort=date`
	}
	const rows = await api(path)
	return (Array.isArray(rows) ? rows : []).map(mapIssue)
}

// 설정 저장 (토큰/식별자/프로젝트/쿼리) — probe 결과의 kind도 저장
function setConfig(patch) {
	const allow = {}
	for (const k of ['sentryToken', 'sentryOrg', 'sentryProject', 'sentryQuery', 'sentryIdentifier', 'sentryKind'])
		if (patch && patch[k] !== undefined) allow[k] = patch[k]
	return Settings.save(allow)
}

module.exports = { cfg, configured, tokenMasked, listProjects, probe, recentIssues, setConfig, api }
