// store/tasks.cjs — task CRUD + the composed "board" read used by GET /api/sessions/board.
// Not to be confused with the old server/tasks.cjs god-object (being split apart in
// Phase 3 into agentJobs.cjs/prReview.cjs) — this is the new persistence layer.
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')
const Branches = require('./branches.cjs')
const Reviews = require('./reviews.cjs')
const AgentJobs = require('./agentJobs.cjs')
const Subtasks = require('./subtasks.cjs')

function get(id) {
	return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
}

function listByFolder(folderId) {
	if (folderId === null || folderId === undefined) {
		return db.prepare('SELECT * FROM tasks WHERE folder_id IS NULL ORDER BY order_idx ASC').all()
	}
	return db.prepare('SELECT * FROM tasks WHERE folder_id = ? ORDER BY order_idx ASC').all(folderId)
}

function create({ folderId, name, desc, kind, ticket, startPrompt, repoId, dueDate }) {
	const id = randomUUID()
	const now = Date.now()
	const fid = folderId || null
	const maxOrder = fid
		? db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM tasks WHERE folder_id = ?').get(fid).m
		: db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM tasks WHERE folder_id IS NULL').get().m
	// 레포는 이제 폴더 단위로 하나만 정한다 — 이미 폴더에 속한(=레포가 정해진) 서브태스크를 새로
	// 만드는 거면 명시적 repoId가 없는 한 그 폴더의 repo_id를 그대로 물려받는다(다시 안 물어봄).
	// inbox 단계(폴더 없음)는 여전히 repoId 없이 만들어지고 repoClassify.cjs가 나중에 채운다.
	let rid = repoId || null
	if (fid && !rid) {
		const folder = db.prepare('SELECT repo_id FROM folders WHERE id = ?').get(fid)
		if (folder && folder.repo_id) rid = folder.repo_id
	}
	db.prepare('INSERT INTO tasks (id, folder_id, order_idx, name, desc, kind, ticket, start_prompt, repo_id, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		id,
		fid,
		maxOrder + 1,
		name,
		desc || '',
		kind || 'single',
		ticket || null,
		startPrompt || null,
		rid,
		dueDate || null,
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
	const dueDate = 'dueDate' in patch ? patch.dueDate || null : cur.due_date
	const durationDays = 'durationDays' in patch ? patch.durationDays || null : cur.duration_days
	const completedAt = 'completedAt' in patch ? patch.completedAt || null : cur.completed_at
	// "레포 색상은... 텍스트색상이든 뭔가 다른걸로 표시해야할것같아" — 배경은 이 커스텀 색이 쓰고
	// 레포색은 다른 채널(텍스트)로 옮긴다(§ CalendarPane.renderChip). null이면 레포색/기본 배경 그대로.
	const color = 'color' in patch ? patch.color || null : cur.color
	db.prepare('UPDATE tasks SET name = ?, desc = ?, kind = ?, start_prompt = ?, repo_id = ?, repo_auto = ?, due_date = ?, duration_days = ?, completed_at = ?, color = ?, updated_at = ? WHERE id = ?').run(
		name,
		desc,
		kind,
		startPrompt,
		repoId,
		repoAuto,
		dueDate,
		durationDays,
		completedAt,
		color,
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

// "메인 태스크를 고르는 기능도 필요해. 서브태스크로 사용하려고 고른것일 수 있자나?" — 아직 착수 전인
// 독립 태스크(대개 일감함)를 다른 태스크의 서브태스크로 편입한다. 이름·설명·예정일·기간을 그대로
// 옮기고 원래 태스크 레코드는 지운다.
function attachAsSubtask(taskId, mainTaskId) {
	const task = get(taskId)
	const main = get(mainTaskId)
	if (!task) return { ok: false, error: 'task not found' }
	if (!main) return { ok: false, error: 'main task not found' }
	if (taskId === mainTaskId) return { ok: false, error: '자기 자신을 메인 태스크로 고를 수 없습니다' }
	// "서브태스크 추가 기능있는건 무슨 태스크야?" — 2단 중첩 서브태스크가 없어서, 이미 자기 서브태스크가
	// 있는 태스크를 편입하면 그 서브태스크들이 CASCADE로 삭제된다. UI에서도 막지만 여기서도 한 번 더 막는다.
	if (Subtasks.listByTask(taskId).length > 0) return { ok: false, error: '이미 서브태스크를 가진 태스크는 편입할 수 없습니다(그 서브태스크들이 함께 삭제됩니다).' }
	const subtask = Subtasks.create({ taskId: mainTaskId, name: task.name, desc: task.desc, dueDate: task.due_date, durationDays: task.duration_days })
	remove(taskId)
	recomputeFromSubtasks(mainTaskId)
	return { ok: true, subtask, mainTaskId }
}

function addBusinessDays(startMs, durationDays) {
	if (!durationDays || durationDays <= 1) return startMs
	const d = new Date(startMs)
	let remaining = durationDays - 1
	while (remaining > 0) {
		d.setDate(d.getDate() + 1)
		if (d.getDay() !== 0 && d.getDay() !== 6) remaining--
	}
	return d.getTime()
}
function businessDaysBetween(startMs, endMs) {
	if (endMs <= startMs) return 1
	let count = 1
	const d = new Date(startMs)
	while (d.getTime() < endMs) {
		d.setDate(d.getDate() + 1)
		if (d.getDay() !== 0 && d.getDay() !== 6) count++
	}
	return count
}
// "메인 태스크의 기간은 전체 일정의 기간산정으로... 모든 일정을 더하기해서 자동으로 적용되게 해줘" —
// 태스크 자신의 마감일/기간은 이제 사람이 직접 정하는 값이 아니라, 서브태스크 일정 전체를 아우르는
// 범위(가장 이른 시작 ~ 가장 늦은 종료)로 매번 다시 계산해 저장한다. 캘린더는 이 값을 쓰지 않는다
// (§ CalendarPane.flattenCalendarItems — 서브태스크에 날짜가 있으면 태스크 자신은 캘린더에 안 그림) —
// 순수하게 "이 태스크 전체가 대략 언제부터 언제까지인지"를 보여주는 내부 산정값이다.
function recomputeFromSubtasks(taskId) {
	const subs = Subtasks.listByTask(taskId).filter((s) => !!s.due_date)
	if (!subs.length) return
	let minStart = Infinity
	let maxEnd = -Infinity
	for (const s of subs) {
		const start = s.due_date
		const end = addBusinessDays(start, s.duration_days || 1)
		if (start < minStart) minStart = start
		if (end > maxEnd) maxEnd = end
	}
	update(taskId, { dueDate: minStart, durationDays: businessDaysBetween(minStart, maxEnd) })
}

// "검토한 일감은... 사라지면안돼. 항상 불러와야해" — durationEstimate.cjs가 agent_jobs에 영구
// 저장한 완료 검토 결과를 taskId로 다시 찾아 board 응답에 그대로 실어준다. durationEstimate.cjs를
// 여기서 직접 require하면 순환 참조(그쪽이 StoreTasks.get을 씀)라 agentJobs를 바로 쓴다 — kind
// 문자열('estimate-duration')은 durationEstimate.cjs의 JOB_KIND와 반드시 같아야 한다.
function latestReview(taskId) {
	const j = AgentJobs.latestDone('estimate-duration', 'task', taskId)
	if (!j) return null
	const envelope = j.result || {}
	return { jobId: j.id, result: envelope.result || null, doneAt: j.done_at }
}

function composeTask(row) {
	const branches = Branches.listByTask(row.id).map((b) => ({
		...b,
		links: Branches.links(b.id),
	}))
	const reviews = branches.flatMap((b) => Reviews.listByBranch(b.id))
	const review = latestReview(row.id)
	// "태스크 하나에 개발, 개발자테스트, QA, 배포 이런식으로 나뉠 수 있거든" — 서브태스크는 태스크
	// 설명과 별개의 자기 설명 + 독립적인 예정일/기간을 갖는다(§ store/subtasks.cjs).
	const subtasks = Subtasks.listByTask(row.id)
	return { ...row, branches, reviews, review, subtasks }
}

// GET /api/sessions/board payload — folders with nested tasks, plus the inbox.
// `pr`/`ci`/`worktreePath`/`status`/`rel` are NOT stored here; the route layer
// live-joins those from git/gh on top of this composed shape (see plan §"핵심 원칙").
// notes = 메인 태스크 없는 서브태스크(§ store/subtasks.cjs listOrphans) — "메모정도로 사용하게"
// 사이드바에서 inbox 태스크와 같은 높이의 별도 목록으로 보여준다.
function board(foldersList) {
	const inbox = listByFolder(null).map(composeTask)
	const folders = foldersList.map((f) => ({ ...f, tasks: listByFolder(f.id).map(composeTask) }))
	const notes = Subtasks.listOrphans()
	return { folders, inbox, notes }
}

module.exports = { get, listByFolder, create, update, move, remove, attachAsSubtask, recomputeFromSubtasks, composeTask, board, latestReview }
