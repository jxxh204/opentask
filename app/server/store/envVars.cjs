// store/envVars.cjs — Setup 페이지의 자유 형식 ".env 테이블" 영속화.
// store/secrets.cjs(이름이 정해진 시크릿)와 달리, 여기는 사용자가 임의로 추가하는
// KEY=VALUE 행(앱이 런타임에 주입)을 저장한다. secret=1이면 UI에서 마스킹 표시용.
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function list() {
	return db.prepare('SELECT * FROM env_vars ORDER BY order_idx ASC, created_at ASC').all()
}

function get(id) {
	return db.prepare('SELECT * FROM env_vars WHERE id = ?').get(id)
}

function create({ key, value, secret }) {
	const id = randomUUID()
	const maxOrder = db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM env_vars').get().m
	db.prepare('INSERT INTO env_vars (id, key, value, secret, order_idx, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
		id,
		String(key ?? ''),
		String(value ?? ''),
		secret ? 1 : 0,
		maxOrder + 1,
		Date.now(),
	)
	return get(id)
}

function update(id, patch) {
	const cur = get(id)
	if (!cur) return null
	const key = patch.key ?? cur.key
	const value = patch.value ?? cur.value
	const secret = patch.secret === undefined ? cur.secret : patch.secret ? 1 : 0
	const order_idx = patch.order ?? cur.order_idx
	db.prepare('UPDATE env_vars SET key = ?, value = ?, secret = ?, order_idx = ? WHERE id = ?').run(String(key), String(value), secret, order_idx, id)
	return get(id)
}

function remove(id) {
	db.prepare('DELETE FROM env_vars WHERE id = ?').run(id)
	return { ok: true }
}

module.exports = { list, get, create, update, remove }
