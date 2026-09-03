// store/codeBriefs.cjs — 서브태스크마다 "관련 코드" 요약(API 결정 로직 file:line + 설명, 스토리북
// 딥링크)을 stage(pre=착수 전 참고 / post=완료 후 변경점)별로 캐싱한다(§ db.cjs v28, codeBrief.cjs가
// 실제 생성).
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function deserialize(row) {
	if (!row) return null
	return { ...row, data: row.data_json ? JSON.parse(row.data_json) : null }
}

function get(subtaskId, stage) {
	return deserialize(db.prepare('SELECT * FROM code_briefs WHERE subtask_id = ? AND stage = ?').get(subtaskId, stage))
}

function listBySubtask(subtaskId) {
	return db.prepare('SELECT * FROM code_briefs WHERE subtask_id = ?').all(subtaskId).map(deserialize)
}

function upsertPending(subtaskId, stage, jobId) {
	const existing = get(subtaskId, stage)
	const now = Date.now()
	if (existing) {
		db.prepare('UPDATE code_briefs SET status = ?, job_id = ?, error = NULL, updated_at = ? WHERE id = ?').run('pending', jobId, now, existing.id)
	} else {
		db.prepare('INSERT INTO code_briefs (id, subtask_id, stage, status, job_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), subtaskId, stage, 'pending', jobId, now)
	}
	return get(subtaskId, stage)
}

function markOk(subtaskId, stage, data) {
	const now = Date.now()
	db.prepare('UPDATE code_briefs SET status = ?, data_json = ?, error = NULL, generated_at = ?, updated_at = ? WHERE subtask_id = ? AND stage = ?').run('ok', JSON.stringify(data), now, now, subtaskId, stage)
}

function markError(subtaskId, stage, error) {
	const now = Date.now()
	db.prepare('UPDATE code_briefs SET status = ?, error = ?, updated_at = ? WHERE subtask_id = ? AND stage = ?').run('error', String(error || '').slice(0, 300), now, subtaskId, stage)
}

module.exports = { get, listBySubtask, upsertPending, markOk, markError }
