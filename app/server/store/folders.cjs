'use strict'
const { randomUUID } = require('crypto')
const { db } = require('../db.cjs')

function list() {
	return db.prepare('SELECT * FROM folders WHERE archived = 0 ORDER BY order_idx ASC, created_at ASC').all()
}

function listArchived() {
	return db.prepare('SELECT * FROM folders WHERE archived = 1 ORDER BY archived_at DESC').all()
}

function get(id) {
	return db.prepare('SELECT * FROM folders WHERE id = ?').get(id)
}

function create({ name, base, autoMerge, retryLimit, repoId }) {
	const id = randomUUID()
	const now = Date.now()
	const maxOrder = db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM folders').get().m
	db.prepare('INSERT INTO folders (id, name, base, order_idx, auto_merge, retry_limit, repo_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
		id,
		name || '새 폴더',
		base || null,
		maxOrder + 1,
		autoMerge ? 1 : 0,
		Math.max(1, Number(retryLimit) || 3),
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
	const base = patch.base ?? cur.base
	const order_idx = patch.order ?? cur.order_idx
	// Merge-ready(기본)/Auto-merge(opt-in) 게이트(§12) — 기본 꺼짐, mainTask 단위로 명시적으로만 켠다.
	const autoMerge = 'autoMerge' in patch ? (patch.autoMerge ? 1 : 0) : cur.auto_merge
	// 재시도 횟수(N) — mainTask 생성 확인 단계(§12)의 AI 기본값+사람 오버라이드 필드. 재요청 에스컬레이션
	// 사다리(prReview.cjs)가 "몇 회차부터 새 세션+모델 상향"인지 여기 값을 기준으로 판단한다.
	const retryLimit = 'retryLimit' in patch ? Math.max(1, Number(patch.retryLimit) || 3) : cur.retry_limit
	// 레포는 이제 폴더 단위로 하나만 — 'repoId' in patch로 명시적 null(선택 해제)도 받는다.
	const repoId = 'repoId' in patch ? patch.repoId || null : cur.repo_id
	// "이건 태스크의 유니크한 규칙이야" — 레포 전체(§ repos.rule_*)가 아니라 이 메인 태스크(폴더) 하나만의
	// 예외 규칙(§ db.cjs v23). 빈 문자열은 null로 접어 "규칙 없음"을 하나로 통일한다.
	const ruleTask = 'ruleTask' in patch ? patch.ruleTask?.trim() || null : cur.rule_task
	// "세션이 바뀌면 안 돼" — 지휘자 세션의 진짜 이름(§ db.cjs v24). 폴더 이름이 나중에 바뀌어도 이
	// 값은 그대로라, 복원할 때 이름을 다시 지어낼 필요 없이 정확히 그 세션을 다시 찾는다.
	const conductorSession = 'conductorSession' in patch ? patch.conductorSession || null : cur.conductor_session
	db.prepare('UPDATE folders SET name = ?, base = ?, order_idx = ?, auto_merge = ?, retry_limit = ?, repo_id = ?, rule_task = ?, conductor_session = ?, updated_at = ? WHERE id = ?').run(
		name,
		base,
		order_idx,
		autoMerge,
		retryLimit,
		repoId,
		ruleTask,
		conductorSession,
		Date.now(),
		id,
	)
	// "레포 조정 코드가 하나로 통합되어있지 않고 흩어져있는거야?" — tasks.repo_id는 폴더로 승격되는
	// 순간 한 번 복사된 뒤로 다시는 folders.repo_id를 따라가지 않아, 폴더에서 레포를 바꾸면 그 값만
	// 어긋난 채 영영 옛 값으로 남았다(실제 오케스트레이션은 항상 folders.repo_id를 우선하니 동작은
	// 맞았지만, DB를 직접 보거나 나중에 이 필드를 참조할 코드 입장에선 헷갈리는 stale 데이터였다).
	// tasks.repo_id를 그 사본 취급하지 말고, 폴더 레포가 바뀔 때마다 이 폴더의 태스크 전부를 같이 맞춘다.
	// (subtasks.repo_id는 건드리지 않는다 — 그건 사람이 명시적으로 준 서브태스크별 오버라이드다.)
	if ('repoId' in patch) {
		db.prepare('UPDATE tasks SET repo_id = ? WHERE folder_id = ?').run(repoId, id)
	}
	return get(id)
}

function remove(id) {
	// tasks in this folder fall back to inbox (folder_id NULL) via ON DELETE SET NULL — not deleted
	db.prepare('DELETE FROM folders WHERE id = ?').run(id)
	return { ok: true }
}

function archive(id) {
	const cur = get(id)
	if (!cur) return null
	db.prepare('UPDATE folders SET archived = 1, archived_at = ? WHERE id = ?').run(Date.now(), id)
	return get(id)
}

function restore(id) {
	const cur = get(id)
	if (!cur) return null
	db.prepare('UPDATE folders SET archived = 0, archived_at = NULL WHERE id = ?').run(id)
	return get(id)
}

module.exports = { list, listArchived, get, create, update, remove, archive, restore }
