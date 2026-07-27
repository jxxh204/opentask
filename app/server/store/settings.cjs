// store/settings.cjs — generic key/value settings store + the AppConfig shape
// that replaces collector.cjs's env-var/state.json-derived config resolution.
// Non-secret only: tokens/connection strings live in store/secrets.cjs instead.
'use strict'
const { db } = require('../db.cjs')

function get(key, fallback) {
	const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key)
	if (!row) return fallback
	try {
		return JSON.parse(row.value_json)
	} catch {
		return fallback
	}
}

function set(key, value) {
	db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify(value))
	return value
}

const APP_CONFIG_KEY = 'appConfig'
const APP_CONFIG_DEFAULTS = {
	rootPath: null,
	wtPath: null,
	branchPrefix: null,
	operatorName: '', // replaces the old hardcoded "마티" — see ADAPT.md / plan's naming-cleanup section
	githubRepo: null,
	githubRepos: [],
	devServerUrl: null,
	webviewPort: null,
	dbSchema: 'public',
	apiRoot: null,
	apiBaseUrl: null,
	nextRoot: null,
	nextPort: null,
	nextRouterMode: 'app',
	sentryOrg: null,
	sentryProject: null,
	awsDeployWebhookUrl: null,
	vitalsEndpoint: null,
}

function getAppConfig() {
	return { ...APP_CONFIG_DEFAULTS, ...get(APP_CONFIG_KEY, {}) }
}

function updateAppConfig(patch) {
	const next = { ...getAppConfig(), ...patch }
	set(APP_CONFIG_KEY, next)
	return next
}

// PR/이슈 모니터(monitor.cjs)·GitHub 통계(githubStats.cjs)·내 PR 목록(prs.cjs)이 대상으로 삼는 레포 목록.
// 하나의 소스로 통일 — Setup 페이지의 githubRepo 필드가 "owner/repo" 또는 콤마로 여러 개("owner/repo1,owner/repo2")
// 담당. 과거 OPENRM_PR_REPOS 환경변수는 AppConfig가 비어있을 때만 폴백(하위호환, 미설정 배포 지원).
// ⚠️ 호출부는 이 함수를 매번 새로 불러야 함(모듈 로드 시 한 번만 얼려두면 UI에서 설정해도 재시작 전까진 반영 안 됨).
function prRepos() {
	const cfg = getAppConfig()
	const raw = (cfg.githubRepo && String(cfg.githubRepo).trim()) || (Array.isArray(cfg.githubRepos) && cfg.githubRepos.length ? cfg.githubRepos.join(',') : '') || process.env.OPENRM_PR_REPOS || ''
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((slug) => ({ slug, name: slug.split('/').pop() }))
}

module.exports = { get, set, getAppConfig, updateAppConfig, prRepos }
