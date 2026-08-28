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
		meta: row.meta_json ? JSON.parse(row.meta_json) : null,
		done: !!row.done,
	}
}

function create({ kind, cwd, claudeSessionId, refType, refId, input, label }) {
	const id = randomUUID()
	db.prepare('INSERT INTO agent_jobs (id, kind, cwd, claude_session_id, ref_type, ref_id, input_json, percent, label, done, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)').run(id, kind, cwd || null, claudeSessionId || null, refType || null, refId || null, input ? JSON.stringify(input) : null, label || null, Date.now())
	return get(id)
}

// meta — done=0인 동안에도 실시간으로 바뀌는 부가 상태(예: durationEstimate.cjs의 누적 토큰/비용).
// percent/label처럼 생략하면 이전 값을 그대로 유지한다.
function updateProgress(id, { percent, label, meta }) {
	const cur = get(id)
	if (!cur) return null
	db.prepare('UPDATE agent_jobs SET percent = ?, label = ?, meta_json = ? WHERE id = ?').run(
		percent ?? cur.percent,
		label ?? cur.label,
		meta !== undefined ? JSON.stringify(meta) : cur.meta_json,
		id,
	)
	return get(id)
}

function markDone(id, result) {
	db.prepare('UPDATE agent_jobs SET done = 1, done_at = ?, percent = 100, result_json = ? WHERE id = ?').run(Date.now(), JSON.stringify(result || {}), id)
	return get(id)
}

function listByRef(refType, refId) {
	return db.prepare('SELECT * FROM agent_jobs WHERE ref_type = ? AND ref_id = ? ORDER BY started_at DESC').all(refType, refId).map(deserialize)
}

// "검토한 일감은... 사라지면안돼. 항상 불러와야해" — taskId로 가장 최근 완료된 잡을 찾아 새로고침/
// 서버 재시작 뒤에도 다시 불러올 수 있게 한다(§ store/tasks.cjs composeTask).
function latestDone(kind, refType, refId) {
	const row = db.prepare('SELECT * FROM agent_jobs WHERE kind = ? AND ref_type = ? AND ref_id = ? AND done = 1 ORDER BY done_at DESC LIMIT 1').get(kind, refType, refId)
	return row ? deserialize(row) : null
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

module.exports = { get, create, updateProgress, markDone, listByRef, latestDone, listActive, listFailures }
