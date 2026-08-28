// store/blockedPeriods.cjs — "일정 막기" 기간(예: QA 기간) CRUD. 태스크가 아니라 캘린더 자체의
// 제약이라 tasks/folders와 독립된 얕은 테이블.
'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')
const StoreTasks = require('./tasks.cjs')

const DAY_MS = 86400000

// utils/businessDays.ts와 같은 규칙(주말 제외) — 여러 날짜짜리 태스크가 실제로 며칠까지 점유하는지
// 계산해서, 차단 기간과 "겹치는지"를 정확히 판정하는 데만 쓴다(프론트와 중복이지만 이 파일은 서버
// 전용 CommonJS라 공유 모듈로 묶지 않음).
function isWeekend(ms) {
	const day = new Date(ms).getDay()
	return day === 0 || day === 6
}
function addBusinessDaysMs(startMs, durationDays) {
	if (!durationDays || durationDays <= 1) return startMs
	let ms = startMs
	let remaining = durationDays - 1
	while (remaining > 0) {
		ms += DAY_MS
		if (!isWeekend(ms)) remaining--
	}
	return ms
}

// "다른 일정은 막은 만큼 밀려야해" — 이 차단 기간과 겹치는(하루짜리는 due_date가 범위 안, 여러
// 날짜짜리는 실제 점유 구간이 범위와 겹치는) 미완료 태스크를 전부 차단 기간의 캘린더 일수만큼
// due_date를 뒤로 민다. 완료된 태스크는 이미 끝난 일이라 건드리지 않는다.
function pushOverlappingTasks(startDate, endDate) {
	const blockSpanDays = Math.round((endDate - startDate) / DAY_MS) + 1
	const shiftMs = blockSpanDays * DAY_MS
	const rows = db.prepare('SELECT id, due_date, duration_days FROM tasks WHERE due_date IS NOT NULL AND completed_at IS NULL').all()
	for (const t of rows) {
		const occupiedEnd = t.duration_days && t.duration_days > 1 ? addBusinessDaysMs(t.due_date, t.duration_days) : t.due_date
		const overlaps = t.due_date <= endDate && occupiedEnd >= startDate
		if (overlaps) StoreTasks.update(t.id, { dueDate: t.due_date + shiftMs })
	}
}

function list() {
	return db.prepare('SELECT * FROM blocked_periods ORDER BY start_date ASC').all()
}

function create({ name, startDate, endDate }) {
	const trimmed = String(name || '').trim()
	if (!trimmed) return { ok: false, error: '이유는 필수입니다.' }
	if (!Number.isFinite(startDate) || !Number.isFinite(endDate)) return { ok: false, error: '기간은 필수입니다.' }
	if (endDate < startDate) return { ok: false, error: '종료일이 시작일보다 빠릅니다.' }
	const id = randomUUID()
	db.prepare('INSERT INTO blocked_periods (id, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)').run(id, trimmed, startDate, endDate, Date.now())
	pushOverlappingTasks(startDate, endDate)
	return db.prepare('SELECT * FROM blocked_periods WHERE id = ?').get(id)
}

function remove(id) {
	db.prepare('DELETE FROM blocked_periods WHERE id = ?').run(id)
	return { ok: true }
}

module.exports = { list, create, remove }
