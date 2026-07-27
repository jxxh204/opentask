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

module.exports = { get, set, getAppConfig, updateAppConfig }
