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

// "끝난 세션은 체크 초록색 아냐?" — 서버 재시작 등으로 이 서브태스크의 세션이 여러 번 새로 만들어졌는데
// 그중 더 오래된 시도가 ended_at을 못 찍은 채 고아로 남아있으면(§ 위 주석), 정작 최신 시도는 정상
// 종료됐어도(done:true) "ended_at IS NULL AND 가장 최근"만 보는 예전 쿼리가 그 고아 행을 "활성"으로
// 잘못 골라버렸다 — checkStalledSubtasks가 그 죽은 척하는 옛 세션 이름으로 계속 상태를 확인해 이미
// 끝난 서브태스크를 "응답없음"(amber)으로 영구 오탐. "활성"은 항상 가장 최근 시도 하나만 기준으로
// 판정해야 한다 — 그 최근 시도가 안 끝났을 때만 활성, 끝났으면 그보다 오래된 고아 행이 있어도 비활성.
function getActiveForSubtask(subtaskId) {
	const row = db.prepare('SELECT * FROM subtask_sessions WHERE subtask_id = ? ORDER BY started_at DESC LIMIT 1').get(subtaskId)
	return row && row.ended_at == null ? row : null
}

function create({ subtaskId, taskId, tmuxSession, worktreePath, branch, model, modelLabel }) {
	const id = randomUUID()
	db.prepare(
		'INSERT INTO subtask_sessions (id, subtask_id, task_id, tmux_session, worktree_path, branch, model, model_label, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
	).run(id, subtaskId, taskId, tmuxSession, worktreePath, branch || null, model || null, modelLabel || null, Date.now())
	return db.prepare('SELECT * FROM subtask_sessions WHERE id = ?').get(id)
}

// reportHtml — "서브 태스크가 끝나면... 어떻게 끝났고 어떤것들을 했는지 정리해서 보여줬으면해"
// (§ db.cjs v25). 완료를 스스로 보고하는 서브태스크 세션 자신이 작성한 완성된 HTML을 같은 UPDATE로
// 같이 찍는다 — optional이라 사람이 직접 끄는 stopSubtaskSession(리포트 없음)은 그대로 동작한다.
function markEnded(id, reportHtml) {
	db.prepare('UPDATE subtask_sessions SET ended_at = ?, report_html = COALESCE(?, report_html) WHERE id = ?').run(Date.now(), reportHtml || null, id)
	return { ok: true }
}

function getById(id) {
	return db.prepare('SELECT * FROM subtask_sessions WHERE id = ?').get(id) || null
}

module.exports = { listBySubtask, listByTask, latestForSubtask, getActiveForSubtask, create, markEnded, getById }
