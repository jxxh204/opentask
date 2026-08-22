// decisions.cjs — AI 판단 감사 로그(왜 이 레포로/왜 이 kind로/왜 이 리뷰가 통과됐는지). conductor.feed와
// 달리 SQLite에 영속화되어 서버 재시작과 무관하게 남는다(§07 "오케스트레이션 상태는 인메모리" 문제와
// 별개 트랙 — 판정 근거만큼은 휘발되면 안 된다는 "기획: 이상적 워크플로우" 재점검에서 나온 설계).
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function record({ folderId, taskId, kind, reason, meta }) {
	const id = randomUUID()
	db.prepare('INSERT INTO decisions (id, folder_id, task_id, kind, reason, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
		id,
		folderId || null,
		taskId || null,
		kind,
		String(reason || ''),
		meta ? JSON.stringify(meta) : null,
		Date.now(),
	)
	return get(id)
}

function get(id) {
	const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id)
	return row ? { ...row, meta: row.meta_json ? JSON.parse(row.meta_json) : null } : null
}

function listByFolder(folderId, limit = 100) {
	return db
		.prepare('SELECT * FROM decisions WHERE folder_id = ? ORDER BY created_at DESC LIMIT ?')
		.all(folderId, limit)
		.map((row) => ({ ...row, meta: row.meta_json ? JSON.parse(row.meta_json) : null }))
}

function listByTask(taskId, limit = 50) {
	return db
		.prepare('SELECT * FROM decisions WHERE task_id = ? ORDER BY created_at DESC LIMIT ?')
		.all(taskId, limit)
		.map((row) => ({ ...row, meta: row.meta_json ? JSON.parse(row.meta_json) : null }))
}

module.exports = { record, get, listByFolder, listByTask }
