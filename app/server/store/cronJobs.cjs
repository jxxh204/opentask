// store/cronJobs.cjs — Automations(§07 "크론잡 생성") CRUD + next_run_at 계산.
// schedule_json 3가지 형태:
//   interval  { minutes: N }              — N분마다
//   daily     { hour: H, minute: M }       — 매일 H:M
//   weekly    { dow: 0-6, hour: H, minute: M } — 매주 그 요일 H:M (dow: 0=일요일)
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function row(r) {
	if (!r) return null
	return { ...r, schedule: JSON.parse(r.schedule_json), action: JSON.parse(r.action_json) }
}

function list() {
	return db.prepare('SELECT * FROM cron_jobs ORDER BY created_at ASC').all().map(row)
}

function get(id) {
	return row(db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id))
}

// 다음 실행 시각 계산 — from(기본 지금) 이후 가장 가까운 미래 시각.
function computeNextRun(scheduleType, schedule, from = Date.now()) {
	const d = new Date(from)
	if (scheduleType === 'interval') {
		const ms = Math.max(1, Number(schedule.minutes) || 60) * 60000
		return from + ms
	}
	if (scheduleType === 'daily') {
		const next = new Date(d)
		next.setHours(schedule.hour || 0, schedule.minute || 0, 0, 0)
		if (next.getTime() <= from) next.setDate(next.getDate() + 1)
		return next.getTime()
	}
	if (scheduleType === 'weekly') {
		const next = new Date(d)
		next.setHours(schedule.hour || 0, schedule.minute || 0, 0, 0)
		const targetDow = schedule.dow ?? 0
		let diff = (targetDow - next.getDay() + 7) % 7
		if (diff === 0 && next.getTime() <= from) diff = 7
		next.setDate(next.getDate() + diff)
		return next.getTime()
	}
	return from + 3600000
}

function create({ name, scheduleType, schedule, actionType, action, enabled }) {
	if (!name || !scheduleType || !schedule || !action) return { ok: false, error: 'name/scheduleType/schedule/action 필수' }
	const id = randomUUID()
	const now = Date.now()
	const nextRun = enabled === false ? null : computeNextRun(scheduleType, schedule, now)
	db.prepare(
		'INSERT INTO cron_jobs (id, name, schedule_type, schedule_json, action_type, action_json, enabled, last_run_at, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
	).run(id, String(name).trim(), scheduleType, JSON.stringify(schedule), actionType || 'create_task', JSON.stringify(action), enabled === false ? 0 : 1, null, nextRun, now, now)
	return get(id)
}

function update(id, patch) {
	const cur = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id)
	if (!cur) return null
	const name = patch.name ?? cur.name
	const scheduleType = patch.scheduleType ?? cur.schedule_type
	const schedule = patch.schedule ? JSON.stringify(patch.schedule) : cur.schedule_json
	const action = patch.action ? JSON.stringify(patch.action) : cur.action_json
	const enabled = 'enabled' in patch ? (patch.enabled ? 1 : 0) : cur.enabled
	// 스케줄이나 on/off가 바뀌면 다음 실행 시각을 다시 계산 — 꺼졌으면 null(스케줄러가 건너뜀).
	const scheduleChanged = 'schedule' in patch || 'scheduleType' in patch
	const enabledChanged = 'enabled' in patch
	let nextRun = cur.next_run_at
	if (!enabled) nextRun = null
	else if (scheduleChanged || (enabledChanged && !cur.enabled)) nextRun = computeNextRun(scheduleType, JSON.parse(schedule), Date.now())
	db.prepare('UPDATE cron_jobs SET name=?, schedule_type=?, schedule_json=?, action_json=?, enabled=?, next_run_at=?, updated_at=? WHERE id=?').run(
		name,
		scheduleType,
		schedule,
		action,
		enabled,
		nextRun,
		Date.now(),
		id,
	)
	return get(id)
}

function remove(id) {
	db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
	return { ok: true }
}

// 실행 직후 스케줄러가 호출 — last_run_at 갱신 + 다음 실행 시각 재계산.
function markRan(id) {
	const cur = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id)
	if (!cur) return null
	const now = Date.now()
	const next = computeNextRun(cur.schedule_type, JSON.parse(cur.schedule_json), now)
	db.prepare('UPDATE cron_jobs SET last_run_at=?, next_run_at=?, updated_at=? WHERE id=?').run(now, next, now, id)
	return get(id)
}

function dueJobs(now = Date.now()) {
	return db.prepare('SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?').all(now).map(row)
}

module.exports = { list, get, create, update, remove, markRan, dueJobs, computeNextRun }
