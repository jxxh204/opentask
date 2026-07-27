// store/agentJobs.cjs — generalized job-runner persistence, replacing the old
// server/tasks.cjs's runClaudeJob/.openrm-jobfails.json pattern. Orchestration,
// PR-review-apply, and Debug's command bar all create rows here; the actual
// `claude -p` process spawning lives in a separate not-yet-built agentJobs.cjs
// runner module (Phase 3) — this file is just the persistence layer.
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function get(id) {
	const row = db.prepare('SELECT * FROM agent_jobs WHERE id = ?').get(id)
	return row ? deserialize(row) : null
}

function deserialize(row) {
	return {
		...row,
		input: row.input_json ? JSON.parse(row.input_json) : null,
		result: row.result_json ? JSON.parse(row.result_json) : null,
		done: !!row.done,
	}
}

function create({ kind, cwd, claudeSessionId, refType, refId, input, label }) {
	const id = randomUUID()
	db.prepare('INSERT INTO agent_jobs (id, kind, cwd, claude_session_id, ref_type, ref_id, input_json, percent, label, done, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)').run(id, kind, cwd || null, claudeSessionId || null, refType || null, refId || null, input ? JSON.stringify(input) : null, label || null, Date.now())
	return get(id)
}

function updateProgress(id, { percent, label }) {
	const cur = get(id)
	if (!cur) return null
	db.prepare('UPDATE agent_jobs SET percent = ?, label = ? WHERE id = ?').run(percent ?? cur.percent, label ?? cur.label, id)
	return get(id)
}

function markDone(id, result) {
	db.prepare('UPDATE agent_jobs SET done = 1, done_at = ?, percent = 100, result_json = ? WHERE id = ?').run(Date.now(), JSON.stringify(result || {}), id)
	return get(id)
}

function listByRef(refType, refId) {
	return db.prepare('SELECT * FROM agent_jobs WHERE ref_type = ? AND ref_id = ? ORDER BY started_at DESC').all(refType, refId).map(deserialize)
}

function listActive() {
	return db.prepare('SELECT * FROM agent_jobs WHERE done = 0 ORDER BY started_at DESC').all().map(deserialize)
}

function listFailures() {
	return db
		.prepare("SELECT * FROM agent_jobs WHERE done = 1 AND result_json IS NOT NULL ORDER BY done_at DESC LIMIT 50")
		.all()
		.map(deserialize)
		.filter((j) => j.result && j.result.ok === false)
}

module.exports = { get, create, updateProgress, markDone, listByRef, listActive, listFailures }
