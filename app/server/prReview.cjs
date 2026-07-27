// prReview.cjs — GitHub PR 리뷰 코멘트 fetch/apply/dispute (Phase 3.3).
//
// 신규 SQLite 스키마(store/reviews.cjs)용 클린 재작성. tasks.cjs의 옛 PR-리뷰 코드는 건드리지 않는다.
// - fetch/sync : read-only (gh api GET). 안전.
// - apply      : 로컬 — 태스크 워크트리 세션(claude)에 "리뷰 반영" 지시를 Actuator로 디스패치.
// - dispute    : ⚠️ 실제 GitHub 쓰기 — 해당 리뷰 코멘트 스레드에 '공개적으로 보이는' 답글을 POST한다.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { randomUUID } = require('crypto')
const { execFile } = require('child_process')
const C = require('./collector.cjs')
const Term = require('./term.cjs')
const Reviews = require('./store/reviews.cjs')
const StoreBranches = require('./store/branches.cjs')
const Actuator = require('./actuator.cjs')
const Orchestrator = require('./orchestrator.cjs')

// prs.cjs의 sh() 패턴 재사용 — read-only는 stdout만(에러 시 ''), 쓰기는 ghX로 에러까지 회수.
function gh(args, timeout = 15000) {
	return new Promise((resolve) =>
		execFile('gh', args, { cwd: C.REPO, timeout, maxBuffer: 8 << 20 }, (e, out) => resolve(e ? '' : String(out || ''))),
	)
}
function ghX(args, timeout = 20000) {
	return new Promise((resolve) =>
		execFile('gh', args, { cwd: C.REPO, timeout, maxBuffer: 8 << 20 }, (e, out, err) =>
			resolve({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') }),
		),
	)
}

// ⚠️ 휴리스틱 심각도 — GitHub 리뷰 코멘트엔 심각도 필드가 없어 본문 키워드로 '추정'한다(권위 없음, UI 표시용).
// 주의: \b(단어경계)는 한글에 안 먹으므로(한글은 \w가 아님) 영문 키워드만 \b로 감싸고, 한글 키워드는 경계 없이 매칭.
function deriveSev(body) {
	const b = String(body || '')
	if (/\b(bug|critical|security|crash)\b/i.test(b) || /(보안|크래시|치명)/.test(b)) return 'P1'
	if (/\b(nit|style)\b/i.test(b) || /사소/.test(b)) return 'P3'
	return 'P2'
}

// 브랜치명 → PR 번호/URL (prs.cjs가 headRefName으로 브랜치↔PR을 잇는 것과 동일한 조인).
async function prNumberForBranch({ repo, branch }) {
	if (!repo || !branch) return null
	const raw = await gh(['pr', 'list', '-R', repo, '--head', branch, '--state', 'all', '--json', 'number,url', '-L', '1'])
	try {
		const arr = JSON.parse(raw || '[]')
		return arr[0] ? { prNumber: arr[0].number, url: arr[0].url } : null
	} catch {
		return null
	}
}

// read-only — PR의 라인별 리뷰 코멘트를 store/reviews.cjs upsertFromExternal 형태로 매핑.
async function fetchReviewComments({ repo, prNumber }) {
	if (!repo || !prNumber) return []
	const raw = await gh(['api', `repos/${repo}/pulls/${prNumber}/comments?per_page=100`])
	let arr = []
	try {
		arr = JSON.parse(raw || '[]')
	} catch {
		arr = []
	}
	if (!Array.isArray(arr)) return []
	return arr.map((c) => ({
		externalId: String(c.id),
		who: (c.user && c.user.login) || null,
		at: c.created_at ? new Date(c.created_at).getTime() : null,
		sev: deriveSev(c.body), // 휴리스틱(위 참고)
		file: (c.path || '') + ':' + (c.line != null ? c.line : c.original_line != null ? c.original_line : ''),
		body: c.body || '',
	}))
}

// branchId → PR 조회 → 코멘트 fetch → upsert → 그 브랜치의 리뷰 목록 반환.
async function syncReviewsForBranch(branchId) {
	const branch = StoreBranches.get(branchId)
	if (!branch) return { ok: false, error: 'branch not found' }
	if (!branch.repo || !branch.name) return { ok: false, error: 'branch에 repo/name이 없어 PR을 특정할 수 없습니다.' }
	const pr = await prNumberForBranch({ repo: branch.repo, branch: branch.name })
	if (!pr) return { ok: false, error: `PR을 찾을 수 없음: ${branch.repo} (head=${branch.name})` }
	const comments = await fetchReviewComments({ repo: branch.repo, prNumber: pr.prNumber })
	for (const c of comments) Reviews.upsertFromExternal({ branchId, ...c })
	return { ok: true, prNumber: pr.prNumber, fetched: comments.length, reviews: Reviews.listByBranch(branchId) }
}

// ⚠️ 실제 GitHub 쓰기 — PR 리뷰 코멘트 스레드에 공개 답글 POST.
// body는 임시 JSON 파일(--input)로 전달 → 임의 사용자 텍스트의 셸/인자 이스케이프 이슈를 원천 차단.
function disputeArgs({ repo, prNumber, commentId, inputFile }) {
	return ['api', '-X', 'POST', `repos/${repo}/pulls/${prNumber}/comments/${commentId}/replies`, '--input', inputFile]
}
async function postDisputeReply({ repo, prNumber, commentId, body }) {
	if (!repo || !prNumber || !commentId) return { ok: false, error: 'repo/prNumber/commentId 필수' }
	const tmpf = path.join(os.tmpdir(), `openrm-dispute-${randomUUID()}.json`)
	try {
		fs.writeFileSync(tmpf, JSON.stringify({ body: String(body == null ? '' : body) }))
		const r = await ghX(disputeArgs({ repo, prNumber, commentId, inputFile: tmpf }))
		if (!r.ok) return { ok: false, error: (r.err.split('\n').find((l) => l.trim()) || 'gh api 실패').slice(0, 240) }
		let commentUrl = null
		try {
			commentUrl = JSON.parse(r.out).html_url || null
		} catch (_) {}
		return { ok: true, commentUrl }
	} finally {
		try {
			fs.unlinkSync(tmpf)
		} catch (_) {}
	}
}

// apply — 리뷰 → 브랜치 → 태스크의 라이브 워크트리 세션에 "리뷰 반영" 지시를 디스패치(orchestrator와 동일 Actuator 경로).
async function applyReview(reviewId) {
	const review = Reviews.get(reviewId)
	if (!review) return { ok: false, error: 'review not found' }
	const branch = StoreBranches.get(review.branch_id)
	if (!branch) return { ok: false, error: 'branch not found' }
	const rec = Orchestrator.findSessionForTask(branch.task_id)
	if (!rec) return { ok: false, error: '이 태스크의 오케스트레이션 세션 기록이 없습니다 (먼저 오케스트레이션 start).' }
	// 리네임 대비 라이브 세션명 재확인 (advance와 동일 패턴) — 죽었으면 dispatch 안 함.
	const live = await Term.list().catch(() => [])
	const match = live.find((x) => x.name === rec.tmuxSession || Term.baseName(x.name) === Term.baseName(rec.tmuxSession))
	if (!match) return { ok: false, error: `세션이 살아있지 않습니다: ${rec.tmuxSession} (먼저 오케스트레이션 start).` }
	const session = match.name
	const prompt = `PR 리뷰 반영 요청 — 대상 파일 ${review.file || '(파일 미상)'}\n리뷰(${review.sev || ''}${review.who ? ' by ' + review.who : ''}): ${review.body || ''}\n이 리뷰를 반영해 코드를 수정하고, 무엇을 왜 바꿨는지 한 줄로 요약해줘.`
	const d = await Actuator.dispatch({ session, message: prompt, dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
	if (!d.ok) return { ok: false, error: 'dispatch 실패: ' + (d.error || '') }
	Reviews.apply(reviewId, null) // jobId는 이번 패스에서 추적 안 함(null)
	return { ok: true, dispatchedTo: session, review: Reviews.get(reviewId) }
}

// dispute — 실제 GitHub 답글 성공 시에만 disputed로 표시(실패하면 표시 안 함).
async function disputeReview(reviewId, text) {
	const review = Reviews.get(reviewId)
	if (!review) return { ok: false, error: 'review not found' }
	if (!review.external_id) return { ok: false, error: '이 리뷰에 GitHub comment id(external_id)가 없어 답글을 달 수 없습니다.' }
	const branch = StoreBranches.get(review.branch_id)
	if (!branch || !branch.repo || !branch.name) return { ok: false, error: 'branch repo/name 없음 — PR을 특정할 수 없습니다.' }
	const pr = await prNumberForBranch({ repo: branch.repo, branch: branch.name })
	if (!pr) return { ok: false, error: `PR을 찾을 수 없음: ${branch.repo} (head=${branch.name})` }
	const posted = await postDisputeReply({ repo: branch.repo, prNumber: pr.prNumber, commentId: review.external_id, body: text })
	if (!posted.ok) return { ok: false, error: posted.error } // 실제 GitHub 실패 → disputed 표시 안 함
	Reviews.dispute(reviewId, String(text == null ? '' : text))
	return { ok: true, commentUrl: posted.commentUrl, review: Reviews.get(reviewId) }
}

module.exports = { fetchReviewComments, syncReviewsForBranch, postDisputeReply, applyReview, disputeReview, prNumberForBranch, deriveSev, disputeArgs }
