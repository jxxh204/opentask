'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function listByTask(taskId) {
	return db.prepare('SELECT * FROM branches WHERE task_id = ? ORDER BY order_idx ASC').all(taskId)
}

function get(id) {
	return db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
}

function create({ taskId, name, repo, forked }) {
	const id = randomUUID()
	const maxOrder = db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM branches WHERE task_id = ?').get(taskId).m
	db.prepare('INSERT INTO branches (id, task_id, order_idx, name, repo, forked) VALUES (?, ?, ?, ?, ?, ?)').run(id, taskId, maxOrder + 1, name, repo || null, forked ? 1 : 0)
	return get(id)
}

function update(id, patch) {
	const cur = get(id)
	if (!cur) return null
	const name = patch.name ?? cur.name
	const repo = patch.repo ?? cur.repo
	const order_idx = patch.order ?? cur.order_idx
	const forked = patch.forked === undefined ? cur.forked : patch.forked ? 1 : 0
	db.prepare('UPDATE branches SET name = ?, repo = ?, order_idx = ?, forked = ? WHERE id = ?').run(name, repo, order_idx, forked, id)
	return get(id)
}

function remove(id) {
	db.prepare('DELETE FROM branches WHERE id = ?').run(id)
	return { ok: true }
}

function links(branchId) {
	return db.prepare('SELECT * FROM branch_links WHERE branch_id = ?').all(branchId)
}

function addLink(branchId, kind, url) {
	const id = randomUUID()
	db.prepare('INSERT INTO branch_links (id, branch_id, kind, url) VALUES (?, ?, ?, ?)').run(id, branchId, kind, url)
	return { id, branch_id: branchId, kind, url } // snake_case to match SELECT * shape used everywhere else (branches.links())
}

function removeLink(linkId) {
	db.prepare('DELETE FROM branch_links WHERE id = ?').run(linkId)
	return { ok: true }
}

module.exports = { listByTask, get, create, update, remove, links, addLink, removeLink }
