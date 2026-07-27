// store/secrets.cjs — GitHub token, DB connection string, Sentry token, etc.
// Stored as plaintext protected only by file permissions (openrm.db is chmod
// 0600, see db.cjs) — consistent with this app's existing local-only threat
// model. `list()` intentionally never returns values, only key names, so
// callers building a UI (e.g. Setup page's masked display) can't accidentally
// leak a value into a log/response that wasn't explicitly asked for.
'use strict'
const { db } = require('../db.cjs')

function get(key) {
	const row = db.prepare('SELECT value FROM secrets WHERE key = ?').get(key)
	return row ? row.value : null
}

function has(key) {
	return !!db.prepare('SELECT 1 FROM secrets WHERE key = ?').get(key)
}

function set(key, value) {
	db.prepare('INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
	return { ok: true }
}

function remove(key) {
	db.prepare('DELETE FROM secrets WHERE key = ?').run(key)
	return { ok: true }
}

function listKeys() {
	return db
		.prepare('SELECT key FROM secrets')
		.all()
		.map((r) => r.key)
}

module.exports = { get, has, set, remove, listKeys }
