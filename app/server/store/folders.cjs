'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function list() {
	return db.prepare('SELECT * FROM folders WHERE archived = 0 ORDER BY order_idx ASC, created_at ASC').all()
}

function listArchived() {
	return db.prepare('SELECT * FROM folders WHERE archived = 1 ORDER BY archived_at DESC').all()
}

function get(id) {
	return db.prepare('SELECT * FROM folders WHERE id = ?').get(id)
}

function create({ name, base, autoMerge, retryLimit }) {
	const id = randomUUID()
	const now = Date.now()
	const maxOrder = db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM folders').get().m
	db.prepare('INSERT INTO folders (id, name, base, order_idx, auto_merge, retry_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
		id,
		name || '새 폴더',
		base || null,
		maxOrder + 1,
		autoMerge ? 1 : 0,
		Math.max(1, Number(retryLimit) || 3),
		now,
		now,
	)
	return get(id)
}

function update(id, patch) {
	const cur = get(id)
	if (!cur) return null
	const name = patch.name ?? cur.name
	const base = patch.base ?? cur.base
	const order_idx = patch.order ?? cur.order_idx
	// Merge-ready(기본)/Auto-merge(opt-in) 게이트(§12) — 기본 꺼짐, mainTask 단위로 명시적으로만 켠다.
	const autoMerge = 'autoMerge' in patch ? (patch.autoMerge ? 1 : 0) : cur.auto_merge
	// 재시도 횟수(N) — mainTask 생성 확인 단계(§12)의 AI 기본값+사람 오버라이드 필드. 재요청 에스컬레이션
	// 사다리(prReview.cjs)가 "몇 회차부터 새 세션+모델 상향"인지 여기 값을 기준으로 판단한다.
	const retryLimit = 'retryLimit' in patch ? Math.max(1, Number(patch.retryLimit) || 3) : cur.retry_limit
	db.prepare('UPDATE folders SET name = ?, base = ?, order_idx = ?, auto_merge = ?, retry_limit = ?, updated_at = ? WHERE id = ?').run(
		name,
		base,
		order_idx,
		autoMerge,
		retryLimit,
		Date.now(),
		id,
	)
	return get(id)
}

function remove(id) {
	// tasks in this folder fall back to inbox (folder_id NULL) via ON DELETE SET NULL — not deleted
	db.prepare('DELETE FROM folders WHERE id = ?').run(id)
	return { ok: true }
}

function archive(id) {
	const cur = get(id)
	if (!cur) return null
	db.prepare('UPDATE folders SET archived = 1, archived_at = ? WHERE id = ?').run(Date.now(), id)
	return get(id)
}

function restore(id) {
	const cur = get(id)
	if (!cur) return null
	db.prepare('UPDATE folders SET archived = 0, archived_at = NULL WHERE id = ?').run(id)
	return get(id)
}

module.exports = { list, listArchived, get, create, update, remove, archive, restore }
