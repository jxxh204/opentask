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

// AI가 낸 이슈는 upsertFromExternal(사람 리뷰 전용으로 만들어진 API)로 저장한 뒤 이걸로 표시한다 —
// "사람이 남긴 리뷰와 AI가 남긴 리뷰를 같은 파이프로 흘려보내되 누가 썼는지는 구분"(§12).
function setSource(id, source) {
	db.prepare('UPDATE reviews SET source = ? WHERE id = ?').run(source, id)
	return get(id)
}

// 재요청 사다리(§12) — 같은 리뷰에 몇 번째 적용 시도인지. 3회째부터(=mainTask의 재시도 횟수 N까지)는
// 같은 세션이 아니라 새 세션+모델 상향으로 처리하자는 게 설계였음 — attempts만 셈, 사다리 로직은 호출부.
function bumpAttempts(id) {
	db.prepare("UPDATE reviews SET attempts = attempts + 1, state = 'open' WHERE id = ?").run(id)
	return get(id)
}

function dispute(id, replyText) {
	db.prepare("UPDATE reviews SET state = 'disputed', reply = ? WHERE id = ?").run(replyText, id)
	return get(id)
}

module.exports = { listByBranch, get, upsertFromExternal, apply, dispute, setSource, bumpAttempts }
