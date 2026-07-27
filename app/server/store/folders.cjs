'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function list() {
	return db.prepare('SELECT * FROM folders ORDER BY order_idx ASC, created_at ASC').all()
}

function get(id) {
	return db.prepare('SELECT * FROM folders WHERE id = ?').get(id)
}

function create({ name, base }) {
	const id = randomUUID()
	const now = Date.now()
	const maxOrder = db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM folders').get().m
	db.prepare('INSERT INTO folders (id, name, base, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name || '새 폴더', base || null, maxOrder + 1, now, now)
	return get(id)
}

function update(id, patch) {
	const cur = get(id)
	if (!cur) return null
	const name = patch.name ?? cur.name
	const base = patch.base ?? cur.base
	const order_idx = patch.order ?? cur.order_idx
	db.prepare('UPDATE folders SET name = ?, base = ?, order_idx = ?, updated_at = ? WHERE id = ?').run(name, base, order_idx, Date.now(), id)
	return get(id)
}

function remove(id) {
	// tasks in this folder fall back to inbox (folder_id NULL) via ON DELETE SET NULL — not deleted
	db.prepare('DELETE FROM folders WHERE id = ?').run(id)
	return { ok: true }
}

module.exports = { list, get, create, update, remove }
