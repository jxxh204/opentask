'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function listByBranch(branchId) {
	return db.prepare('SELECT * FROM reviews WHERE branch_id = ? ORDER BY at DESC').all(branchId)
}

function get(id) {
	return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id)
}

// upsert by (branch_id, external_id) — called when re-fetching a PR's review threads from GitHub
function upsertFromExternal({ branchId, externalId, who, at, sev, file, body }) {
	const existing = db.prepare('SELECT * FROM reviews WHERE branch_id = ? AND external_id = ?').get(branchId, externalId)
	if (existing) return existing
	const id = randomUUID()
	db.prepare('INSERT INTO reviews (id, branch_id, external_id, who, at, sev, file, body, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, branchId, externalId, who, at, sev, file, body, 'open')
	return get(id)
}

function apply(id, jobId) {
	db.prepare("UPDATE reviews SET state = 'applied', applied_job_id = ? WHERE id = ?").run(jobId || null, id)
	return get(id)
}

function dispute(id, replyText) {
	db.prepare("UPDATE reviews SET state = 'disputed', reply = ? WHERE id = ?").run(replyText, id)
	return get(id)
}

module.exports = { listByBranch, get, upsertFromExternal, apply, dispute }
