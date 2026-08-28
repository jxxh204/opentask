// store/subtaskSessions.cjs — 서브태스크 단위 워크트리+클로드 세션 이력. orchestrator.cjs의 폴더/
// 지휘자 세션(인메모리 Map, 서버 재시작 시 소실)과 달리 SQLite에 영구 저장한다("클로드 세션이나
// 태스크나 켜놓은 창은 컴퓨터가 꺼져도 지워지면안돼") — 실제 tmux 프로세스는 컴퓨터가 꺼지면 같이
// 죽지만, "이 서브태스크가 어느 워크트리/브랜치까지 진행됐는지" 기록은 남아 다시 이어갈 수 있다.
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function listBySubtask(subtaskId) {
	return db.prepare('SELECT * FROM subtask_sessions WHERE subtask_id = ? ORDER BY started_at ASC').all(subtaskId)
}

function listByTask(taskId) {
	return db.prepare('SELECT * FROM subtask_sessions WHERE task_id = ? ORDER BY started_at ASC').all(taskId)
}

// 가장 최근 세션(끝났든 아니든) — 다음 서브태스크가 이어 만들 base 브랜치를 찾을 때 씀.
function latestForSubtask(subtaskId) {
	const rows = listBySubtask(subtaskId)
	return rows.length ? rows[rows.length - 1] : null
}

// "끝났다고 기록 안 된" 세션 — 실제로 tmux에 살아있는지는 호출부가 Term.list()로 따로 확인해야 한다
// (컴퓨터가 꺼졌다 켜지면 이 행은 ended_at이 null인 채로 남아있지만 진짜 tmux 세션은 죽어 있다).
function getActiveForSubtask(subtaskId) {
	return db.prepare('SELECT * FROM subtask_sessions WHERE subtask_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(subtaskId) || null
}

function create({ subtaskId, taskId, tmuxSession, worktreePath, branch, model, modelLabel }) {
	const id = randomUUID()
	db.prepare(
		'INSERT INTO subtask_sessions (id, subtask_id, task_id, tmux_session, worktree_path, branch, model, model_label, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
	).run(id, subtaskId, taskId, tmuxSession, worktreePath, branch || null, model || null, modelLabel || null, Date.now())
	return db.prepare('SELECT * FROM subtask_sessions WHERE id = ?').get(id)
}

function markEnded(id) {
	db.prepare('UPDATE subtask_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), id)
	return { ok: true }
}

module.exports = { listBySubtask, listByTask, latestForSubtask, getActiveForSubtask, create, markEnded }
