// store/subtasks.cjs — 태스크 하나를 개발/개발자테스트/QA/배포 같은 단계로 쪼갠 서브태스크.
// 태스크 설명과 별개로 자기만의 설명을 갖고, 캘린더에서 태스크처럼 독립적으로 예정일/기간을
// 옮길 수 있다(§ db.cjs v17). 색은 없다 — 캘린더가 부모 태스크 색으로 통일해서 그린다.
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function get(id) {
	return db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id)
}

function listByTask(taskId) {
	return db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY order_idx ASC, created_at ASC').all(taskId)
}

// "메인태스크 없는 서브태스크도 만들 수 있으면 좋겠어. 메모정도로 사용하게" — task_id가 없는(§ db.cjs
// v20) 독립 서브태스크들. tasks.listByFolder(null)의 "미분류" 태스크와 같은 패턴.
function listOrphans() {
	return db.prepare('SELECT * FROM subtasks WHERE task_id IS NULL ORDER BY order_idx ASC, created_at ASC').all()
}

function create({ taskId, name, desc, dueDate, durationDays }) {
	const id = randomUUID()
	const now = Date.now()
	const tid = taskId || null
	const maxOrder = tid
		? db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM subtasks WHERE task_id = ?').get(tid).m
		: db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM subtasks WHERE task_id IS NULL').get().m
	db.prepare('INSERT INTO subtasks (id, task_id, name, desc, due_date, duration_days, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		id,
		tid,
		String(name || '').trim() || (tid ? '서브태스크' : '메모'),
		desc || '',
		dueDate || null,
		durationDays || null,
		maxOrder + 1,
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
	const dueDate = 'dueDate' in patch ? patch.dueDate || null : cur.due_date
	const durationDays = 'durationDays' in patch ? patch.durationDays || null : cur.duration_days
	// "서브태스크도 레포를 별도로 줄 수 있어야하지만. 기본적으로는 메인태스크와 동일하게" — null(기본값)
	// 이면 launchSubtask가 폴더/태스크 레포를 그대로 물려받는다.
	const repoId = 'repoId' in patch ? patch.repoId || null : cur.repo_id
	// "서브태스크 완료 버튼 필요"(§ db.cjs v21) — tasks.completed_at과 같은 패턴, 레코드는 지우지 않는다.
	const completedAt = 'completedAt' in patch ? patch.completedAt || null : cur.completed_at
	db.prepare('UPDATE subtasks SET name = ?, desc = ?, due_date = ?, duration_days = ?, repo_id = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(name, desc, dueDate, durationDays, repoId, completedAt, Date.now(), id)
	return get(id)
}

function remove(id) {
	db.prepare('DELETE FROM subtasks WHERE id = ?').run(id)
	return { ok: true }
}

// "순서 변경도 내가 할 수 있게 해줘" — 사이드바에서 드래그로 다시 정렬한 순서를 그대로 order_idx에
// 반영한다(배열 인덱스 = 새 order_idx). ids에 없는 서브태스크(동시에 삭제된 등)는 건드리지 않는다.
// taskId가 null이면 메모(listOrphans) 목록을 재정렬 — "task_id = NULL"은 항상 거짓이라 IS NULL로 분기.
function reorder(taskId, ids) {
	const now = Date.now()
	const tid = taskId || null
	const run = db.transaction(() => {
		ids.forEach((id, i) => {
			if (tid) db.prepare('UPDATE subtasks SET order_idx = ?, updated_at = ? WHERE id = ? AND task_id = ?').run(i, now, id, tid)
			else db.prepare('UPDATE subtasks SET order_idx = ?, updated_at = ? WHERE id = ? AND task_id IS NULL').run(i, now, id)
		})
	})
	run()
	return tid ? listByTask(tid) : listOrphans()
}

module.exports = { get, listByTask, listOrphans, create, update, remove, reorder }
