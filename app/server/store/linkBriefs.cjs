// store/linkBriefs.cjs — 태스크/서브태스크 설명에 박힌 노션·피그마 링크마다 헤드리스 claude+MCP로
// 뽑아낸 핵심 요약을 owner_type+owner_id+url로 캐싱한다(§ db.cjs v28, linkBrief.cjs가 실제 생성).
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function deserialize(row) {
	if (!row) return null
	return { ...row, data: row.data_json ? JSON.parse(row.data_json) : null }
}

function get(ownerType, ownerId, url) {
	return deserialize(db.prepare('SELECT * FROM link_briefs WHERE owner_type = ? AND owner_id = ? AND url = ?').get(ownerType, ownerId, url))
}

function listByOwner(ownerType, ownerId) {
	return db.prepare('SELECT * FROM link_briefs WHERE owner_type = ? AND owner_id = ?').all(ownerType, ownerId).map(deserialize)
}

function upsertPending(ownerType, ownerId, url, kind, jobId) {
	const existing = get(ownerType, ownerId, url)
	const now = Date.now()
	if (existing) {
		db.prepare('UPDATE link_briefs SET status = ?, kind = ?, job_id = ?, error = NULL, updated_at = ? WHERE id = ?').run('pending', kind, jobId, now, existing.id)
	} else {
		db.prepare('INSERT INTO link_briefs (id, owner_type, owner_id, url, kind, status, job_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), ownerType, ownerId, url, kind, 'pending', jobId, now)
	}
	return get(ownerType, ownerId, url)
}

function markOk(ownerType, ownerId, url, data) {
	const now = Date.now()
	db.prepare('UPDATE link_briefs SET status = ?, data_json = ?, error = NULL, generated_at = ?, updated_at = ? WHERE owner_type = ? AND owner_id = ? AND url = ?').run('ok', JSON.stringify(data), now, now, ownerType, ownerId, url)
}

function markError(ownerType, ownerId, url, error) {
	const now = Date.now()
	db.prepare('UPDATE link_briefs SET status = ?, error = ?, updated_at = ? WHERE owner_type = ? AND owner_id = ? AND url = ?').run('error', String(error || '').slice(0, 300), now, ownerType, ownerId, url)
}

module.exports = { get, listByOwner, upsertPending, markOk, markError }
