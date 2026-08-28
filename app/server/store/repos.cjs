// store/repos.cjs — 멀티레포 프로젝트용 "연결된 레포" 레지스트리.
// 0~1개만 등록돼 있으면(기존/단일-레포 세팅) 오케스트레이션은 지금처럼 AppConfig.rootPath를 그대로 쓴다 —
// 이 테이블은 2개 이상의 레포를 오갈 때만 의미가 생기는 선택 기능.
'use strict'
const { randomUUID } = require('crypto')
const { execFileSync } = require('child_process')
const { db } = require('../db.cjs')

// origin 리모트에서 GitHub 계정(owner)을 뽑아 그 계정의 실제 GitHub 아바타를 "레포 아이콘"으로 쓴다 —
// GitHub는 레포 단위 아이콘이 따로 없어서, 소유자 아바타가 사용자가 실제로 아는 "그 레포의 얼굴"에 가장 가깝다.
// git@host-alias:owner/repo.git 형태(멀티 계정 SSH config alias)도 owner만 뽑아내면 되므로 host는 무시한다.
function deriveOwnerAvatar(repoPath) {
	try {
		const url = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim()
		const m = url.match(/^(?:git@[^:]+:|https?:\/\/[^/]+\/)([^/]+)\//)
		if (!m) return null
		return `https://github.com/${m[1]}.png?size=64`
	} catch (_) {
		return null
	}
}

function list() {
	return db.prepare('SELECT * FROM repos ORDER BY order_idx ASC, created_at ASC').all()
}

function get(id) {
	if (!id) return null
	return db.prepare('SELECT * FROM repos WHERE id = ?').get(id)
}

function create({ name, path: repoPath, base, description }) {
	if (!name || !repoPath) return { ok: false, error: '이름과 경로는 필수입니다.' }
	const id = randomUUID()
	const maxOrder = db.prepare('SELECT COALESCE(MAX(order_idx), -1) AS m FROM repos').get().m
	db.prepare('INSERT INTO repos (id, name, path, base, description, order_idx, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
		id,
		String(name).trim(),
		String(repoPath).trim(),
		(base && String(base).trim()) || null,
		String(description || '').trim(),
		maxOrder + 1,
		Date.now(),
	)
	return get(id)
}

function update(id, patch) {
	const cur = get(id)
	if (!cur) return null
	const name = patch.name ?? cur.name
	const repoPath = patch.path ?? cur.path
	const base = 'base' in patch ? patch.base || null : cur.base
	const description = patch.description ?? cur.description
	const color = 'color' in patch ? patch.color || null : cur.color
	// "팀 규칙" — 레포당 자유 텍스트 4칸(§ db.cjs v22). 빈 문자열도 null로 접어 "규칙 없음" 상태를
	// 하나로 통일한다(빈 문자열 vs null을 따로 구분할 이유가 없다).
	const ruleGeneral = 'ruleGeneral' in patch ? patch.ruleGeneral?.trim() || null : cur.rule_general
	const ruleTaskWriting = 'ruleTaskWriting' in patch ? patch.ruleTaskWriting?.trim() || null : cur.rule_task_writing
	const ruleBranch = 'ruleBranch' in patch ? patch.ruleBranch?.trim() || null : cur.rule_branch
	const rulePredev = 'rulePredev' in patch ? patch.rulePredev?.trim() || null : cur.rule_predev
	db.prepare('UPDATE repos SET name = ?, path = ?, base = ?, description = ?, color = ?, rule_general = ?, rule_task_writing = ?, rule_branch = ?, rule_predev = ? WHERE id = ?').run(
		name,
		repoPath,
		base,
		description,
		color,
		ruleGeneral,
		ruleTaskWriting,
		ruleBranch,
		rulePredev,
		id,
	)
	return get(id)
}

function remove(id) {
	db.prepare('DELETE FROM repos WHERE id = ?').run(id)
	return { ok: true }
}

module.exports = { list, get, create, update, remove, deriveOwnerAvatar }
