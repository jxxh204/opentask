// store/tasks.cjs — task CRUD + the composed "board" read used by GET /api/sessions/board.
// Not to be confused with the old server/tasks.cjs god-object (being split apart in
// Phase 3 into agentJobs.cjs/prReview.cjs) — this is the new persistence layer.
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')
const Branches = require('./branches.cjs')
const Reviews = require('./reviews.cjs')

function get(id) {
	return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
}

function listByFolder(folderId) {
	if (folderId === null || folderId === undefined) {
		return db.prepare('SELECT * FROM tasks WHERE folder_id IS NULL ORDER BY order_idx ASC').all()
	}
	return db.prepare('SELECT * FROM tasks WHERE folder_id = ? ORDER BY order_idx ASC').all(folderId)
}

function create({ folderId, name, desc, kind, ticket, startPrompt, repoId }) {
	const id = randomUUID()
	const now = Date.now()
	const fid = folderId || null
	const maxOrder = fid
		? db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM tasks WHERE folder_id = ?').get(fid).m
		: db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM tasks WHERE folder_id IS NULL').get().m
	db.prepare('INSERT INTO tasks (id, folder_id, order_idx, name, desc, kind, ticket, start_prompt, repo_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		id,
		fid,
		maxOrder + 1,
		name,
		desc || '',
		kind || 'single',
		ticket || null,
		startPrompt || null,
		repoId || null,
		now,
		now,
	)
	return get(id)
}

function update(id, patch) {
	const cur = get(id)
	if (!cur) return null
	const name = patch.name ?? cur.name
	const desc = patch.desc ?? cur.desc
	const kind = patch.kind ?? cur.kind
	const startPrompt = 'startPrompt' in patch ? patch.startPrompt || null : cur.start_prompt
	const repoId = 'repoId' in patch ? patch.repoId || null : cur.repo_id
	// repoId를 사람이 직접 지정/변경하면 자동배정 표시(repo_auto)는 해제 — AI 추천이 아니라 확정값이 됨.
	const repoAuto = 'repoAuto' in patch ? (patch.repoAuto ? 1 : 0) : 'repoId' in patch ? 0 : cur.repo_auto
	db.prepare('UPDATE tasks SET name = ?, desc = ?, kind = ?, start_prompt = ?, repo_id = ?, repo_auto = ?, updated_at = ? WHERE id = ?').run(
		name,
		desc,
		kind,
		startPrompt,
		repoId,
		repoAuto,
		Date.now(),
		id,
	)
	return get(id)
}

// move a task to a folder (or inbox, folderId=null), optionally before another task —
// mirrors the prototype's drag-drop semantics (insert-before, else append).
function move(id, folderId, beforeTaskId) {
	const cur = get(id)
	if (!cur) return null
	const fid = folderId || null
	const siblings = fid === null ? listByFolder(null) : listByFolder(fid)
	const filtered = siblings.filter((t) => t.id !== id)
	let insertAt = filtered.length
	if (beforeTaskId) {
		const idx = filtered.findIndex((t) => t.id === beforeTaskId)
		if (idx >= 0) insertAt = idx
	}
	filtered.splice(insertAt, 0, cur)
	const now = Date.now()
	const reorder = db.transaction(() => {
		db.prepare('UPDATE tasks SET folder_id = ?, updated_at = ? WHERE id = ?').run(fid, now, id)
		filtered.forEach((t, i) => {
			db.prepare('UPDATE tasks SET order_idx = ? WHERE id = ?').run(i, t.id)
		})
	})
	reorder()
	return get(id)
}

function remove(id) {
	db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
	return { ok: true }
}

function composeTask(row) {
	const branches = Branches.listByTask(row.id).map((b) => ({
		...b,
		links: Branches.links(b.id),
	}))
	const reviews = branches.flatMap((b) => Reviews.listByBranch(b.id))
	return { ...row, branches, reviews }
}

// GET /api/sessions/board payload — folders with nested tasks, plus the inbox.
// `pr`/`ci`/`worktreePath`/`status`/`rel` are NOT stored here; the route layer
// live-joins those from git/gh on top of this composed shape (see plan §"핵심 원칙").
function board(foldersList) {
	const inbox = listByFolder(null).map(composeTask)
	const folders = foldersList.map((f) => ({ ...f, tasks: listByFolder(f.id).map(composeTask) }))
	return { folders, inbox }
}

module.exports = { get, listByFolder, create, update, move, remove, composeTask, board }
