'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function listByTask(taskId) {
	return db.prepare('SELECT * FROM branches WHERE task_id = ? ORDER BY order_idx ASC').all(taskId)
}

// "코드작업은 무조건 서브태스크를 만들고 그 서브태스크에 워크트리를 만들어서" — 서브태스크 단위로
// 생긴 브랜치를 찾을 때 쓴다(§ db.cjs v18 branches.subtask_id).
function listBySubtask(subtaskId) {
	return db.prepare('SELECT * FROM branches WHERE subtask_id = ? ORDER BY order_idx ASC').all(subtaskId)
}

function get(id) {
	return db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
}

function create({ taskId, subtaskId, name, repo, forked }) {
	const id = randomUUID()
	const maxOrder = db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM branches WHERE task_id = ?').get(taskId).m
	db.prepare('INSERT INTO branches (id, task_id, subtask_id, order_idx, name, repo, forked) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, taskId, subtaskId || null, maxOrder + 1, name, repo || null, forked ? 1 : 0)
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

// 태스크 레벨로 "연결"(입양)된 기존 브랜치를, 그 태스크의 첫 서브태스크가 그대로 이어받을 때 쓴다 —
// 서브태스크 체이닝이 새 워크트리를 또 만들지 않고 이미 연결된 워크트리를 그대로 쓰게 한다.
function linkToSubtask(id, subtaskId) {
	db.prepare('UPDATE branches SET subtask_id = ? WHERE id = ?').run(subtaskId, id)
	return get(id)
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

module.exports = { listByTask, listBySubtask, get, create, update, remove, links, addLink, removeLink, linkToSubtask }
