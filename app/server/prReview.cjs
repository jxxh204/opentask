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
const Settings = require('./settings.cjs')
const Prompts = require('./prompts.cjs')
const Reviews = require('./store/reviews.cjs')
const StoreBranches = require('./store/branches.cjs')
const StoreDecisions = require('./store/decisions.cjs')
const StoreTasks = require('./store/tasks.cjs')
const StoreFolders = require('./store/folders.cjs')
const Actuator = require('./actuator.cjs')
const Orchestrator = require('./orchestrator.cjs')
const Notify = require('./notify.cjs')
const { ghEnv } = require('./ghEnv.cjs')

const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'

// prs.cjs의 sh() 패턴 재사용 — read-only는 stdout만(에러 시 ''), 쓰기는 ghX로 에러까지 회수.
function gh(args, timeout = 15000) {
	return new Promise((resolve) =>
		execFile('gh', args, { cwd: C.REPO, timeout, maxBuffer: 8 << 20, env: ghEnv() }, (e, out) => resolve(e ? '' : String(out || ''))),
	)
}
function ghX(args, timeout = 20000) {
	return new Promise((resolve) =>
		execFile('gh', args, { cwd: C.REPO, timeout, maxBuffer: 8 << 20, env: ghEnv() }, (e, out, err) =>
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

// ⑧ AI 자동 리뷰 — diff를 스스로 읽고 P1/P2/P3 이슈를 낸다. "완전히 새로 만들어야 하는 모듈"이라고
// 봤다가(§12), tasks.cjs의 startPrReview()가 이미 똑같은 패턴(REVIEW_PR_PROMPT + 헤드리스 claude)으로
// 동작 중인 걸 발견해 그 프롬프트 템플릿(review.pr, 이미 검증된 문구)만 그대로 재사용한다 — 새로 쓴 건
// 파싱·저장을 새 SQLite 모델(reviews 테이블)에 잇는 부분뿐. 사람이 눌러야 도는 수동 트리거로 시작한다
// (기존 "동기화" 버튼과 같은 상호작용 모델 — 백그라운드에서 조용히 자동으로 도는 루프는 아직 없음).
async function startAiReview(branchId) {
	const branch = StoreBranches.get(branchId)
	if (!branch) return { ok: false, error: 'branch not found' }
	if (!branch.repo || !branch.name) return { ok: false, error: 'branch에 repo/name이 없어 PR을 특정할 수 없습니다.' }
	const pr = await prNumberForBranch({ repo: branch.repo, branch: branch.name })
	if (!pr) return { ok: false, error: `PR을 찾을 수 없음: ${branch.repo} (head=${branch.name})` }

	const prompt = Prompts.render('review.pr', { slug: branch.repo, number: pr.prNumber })
	const r = await new Promise((resolve) => {
		const child = execFile(
			CLAUDE_BIN,
			['-p', prompt, '--output-format', 'json', '--model', Settings.modelFor('review')],
			{ cwd: C.REPO, timeout: 200000, maxBuffer: 16 << 20, env: process.env },
			(e, o, er) => resolve({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') }),
		)
		try {
			child.stdin.end()
		} catch (_) {}
	})
	if (!r.ok) return { ok: false, error: 'AI 리뷰 실행 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 200) || 'claude 실행 실패') }

	let text = r.out
	try {
		const j = JSON.parse(r.out)
		text = j.result || j.text || r.out
	} catch (_) {}
	const m = String(text).match(/\{[\s\S]*\}/)
	let review = null
	if (m) {
		try {
			review = JSON.parse(m[0])
		} catch (_) {}
	}
	if (!review) return { ok: false, error: 'AI 응답 파싱 실패', raw: String(text).slice(0, 300) }

	const issues = Array.isArray(review.issues) ? review.issues.slice(0, 30) : []
	const now = Date.now()
	const saved = issues.map((iss, idx) =>
		Reviews.upsertFromExternal({
			branchId,
			externalId: `ai-${branchId}-${now}-${idx}`,
			who: `AI(${Settings.modelLabel(Settings.modelFor('review'))})`,
			at: now,
			sev: /P1|P2|P3/.test(iss && iss.severity) ? iss.severity : 'P2',
			file: (iss && iss.file) || null,
			body: `${(iss && iss.title) || '(제목 없음)'} — ${(iss && iss.detail) || ''}${iss && iss.fix ? `\n제안: ${iss.fix}` : ''}`,
		}),
	)
	// review 테이블은 'human'을 기본값으로 깔아두므로(§ v6 마이그레이션) AI가 쓴 건 여기서 명시적으로 표시.
	for (const s of saved) Reviews.setSource(s.id, 'ai')

	const task = StoreTasks.get(branch.task_id)
	const folder = task && task.folder_id ? StoreFolders.get(task.folder_id) : null
	const verdict = review.verdict || 'comment'
	StoreDecisions.record({
		folderId: folder ? folder.id : null,
		taskId: branch.task_id,
		kind: 'review_verdict',
		reason: String(review.summary || '').slice(0, 500) || '(요약 없음)',
		meta: { verdict, issueCount: issues.length, prNumber: pr.prNumber },
	})

	// merge 게이트(§12) — "완전 자동화"는 승인까지만 100% 자동, 실제 merge는 opt-in(GitHub Auto-merge와
	// 같은 관습). 클린 판정이면 항상 approve는 남기고, folder.auto_merge를 명시적으로 켠 경우에만 실제 merge.
	let mergeResult = null
	if (verdict === 'approve' && issues.length === 0) {
		await ghX(['pr', 'review', String(pr.prNumber), '-R', branch.repo, '--approve', '--body', 'AI 자동 리뷰 — 이슈 없음'])
		if (folder && folder.auto_merge) {
			const m = await ghX(['pr', 'merge', String(pr.prNumber), '-R', branch.repo, '--squash'])
			mergeResult = m.ok ? { merged: true } : { merged: false, error: m.err.split('\n').find((l) => l.trim()) || 'merge 실패' }
			StoreDecisions.record({
				folderId: folder.id,
				taskId: branch.task_id,
				kind: 'review_verdict',
				reason: mergeResult.merged ? 'Auto-merge(opt-in) — 클린 판정으로 자동 merge' : `Auto-merge 시도 실패: ${mergeResult.error}`,
				meta: { prNumber: pr.prNumber, autoMerge: true },
			})
		}
	}
	return { ok: true, prNumber: pr.prNumber, verdict, summary: review.summary || '', merge: mergeResult, issues: Reviews.listByBranch(branchId).filter((x) => saved.some((s) => s.id === x.id)) }
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

// 재요청 에스컬레이션 사다리(§12) — 3회째부터는 같은 세션에 갇힌 컨텍스트에서 벗어나야 한다는 설계.
// 모델 티어를 한 단계만 올린다(이미 최상위 fable이면 유지 — 더 올릴 데가 없음).
const ESCALATE_MODEL = { 'claude-haiku-4-5': 'claude-sonnet-4-6', 'claude-sonnet-4-6': 'claude-opus-4-8', 'claude-opus-4-8': 'claude-fable-5' }

// apply — 리뷰 → 브랜치 → 태스크의 라이브 워크트리 세션에 "리뷰 반영" 지시를 디스패치(orchestrator와 동일
// Actuator 경로). 이미 'applied'였던 리뷰를 다시 요청하면 재요청으로 보고 attempts를 올린다 — 1~2회차는
// 같은 세션(2회차부터는 이전 시도가 왜 반려됐는지 명시), 3회차부터는 세션을 새로 열고 모델을 한 단계 올린다.
async function applyReview(reviewId) {
	let review = Reviews.get(reviewId)
	if (!review) return { ok: false, error: 'review not found' }
	const branch = StoreBranches.get(review.branch_id)
	if (!branch) return { ok: false, error: 'branch not found' }
	const rec = Orchestrator.findSessionForTask(branch.task_id)
	if (!rec) return { ok: false, error: '이 태스크의 오케스트레이션 세션 기록이 없습니다 (먼저 오케스트레이션 start).' }

	const task = StoreTasks.get(branch.task_id)
	const folder = task && task.folder_id ? StoreFolders.get(task.folder_id) : null
	const retryLimit = (folder && folder.retry_limit) || 3 // mainTask 생성 확인 단계(§12)의 N — 기본 3

	const isReRequest = review.state === 'applied'
	if (isReRequest) review = Reviews.bumpAttempts(reviewId) // attempts+1, state를 'open'으로 되돌림
	const attempts = review.attempts // 0=최초, 1=2회차, 2+=3회차 이상

	// N(재시도 횟수) 소진 — 사다리를 더 타지 않고 사람에게 완전히 넘긴다. 자동으로 뭔가 더 시도하지 않는다.
	if (attempts >= retryLimit) {
		Notify.notifyEscalation(`${branch.name} — 재시도 ${retryLimit}회 소진`, `AI가 ${retryLimit}번 시도해도 못 풀었습니다. 직접 확인이 필요합니다.`)
		StoreDecisions.record({
			folderId: folder ? folder.id : null,
			taskId: branch.task_id,
			kind: 'review_verdict',
			reason: `재시도 ${retryLimit}회 소진 — 사람 개입 필요 (더 이상 자동 재시도 안 함)`,
			meta: { reviewId, attempts, retryLimit },
		})
		return { ok: false, error: `이 mainTask의 재시도 횟수(${retryLimit}회)를 이미 다 썼습니다 — 직접 확인해주세요.`, escalated: true }
	}

	const basePrompt = `PR 리뷰 반영 요청 — 대상 파일 ${review.file || '(파일 미상)'}\n리뷰(${review.sev || ''}${review.who ? ' by ' + review.who : ''}): ${review.body || ''}\n이 리뷰를 반영해 코드를 수정하고, 무엇을 왜 바꿨는지 한 줄로 요약해줘.`

	let session
	if (attempts >= 2) {
		// 3회차부터 N회까지 — 세션 종료 후 같은 워크트리에 새 세션, 모델 한 단계 상향 + 데스크톱 알림(§12
		// "에스컬레이션도 대화 로그뿐이면 놓치기 쉽다"에서 지적된 갭). N이 3보다 작으면 이 티어 없이 위에서 바로 소진 처리됨.
		const nextModel = ESCALATE_MODEL[rec.model] || rec.model
		Notify.notifyEscalation(`${branch.name} — 리뷰 반복 실패`, `같은 이슈를 ${attempts}번 시도해도 안 풀려 새 세션(${nextModel})으로 넘어갑니다.`)
		await Term.kill(rec.tmuxSession).catch(() => {})
		const seed = `${basePrompt}\n\n(참고: 같은 이슈를 이전에 ${attempts}번 시도했는데도 해결되지 않아 새 세션으로 다시 시작합니다 — 이전과 다른 접근을 시도해주세요.)`
		const t = await Term.create({ cwd: rec.worktreePath, command: 'claude', label: rec.tmuxSession, seed, model: nextModel })
		if (!t.ok) return { ok: false, error: '새 세션 시작 실패: ' + t.error }
		session = t.name
	} else {
		const live = await Term.list().catch(() => [])
		const match = live.find((x) => x.name === rec.tmuxSession || Term.baseName(x.name) === Term.baseName(rec.tmuxSession))
		if (!match) return { ok: false, error: `세션이 살아있지 않습니다: ${rec.tmuxSession} (먼저 오케스트레이션 start).` }
		session = match.name
		const prompt = attempts === 1 ? `${basePrompt}\n\n(참고: 이전 시도가 반려되어 다시 요청합니다 — 이전과 다른 방식으로 접근해보세요.)` : basePrompt
		const d = await Actuator.dispatch({ session, message: prompt, dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
		if (!d.ok) return { ok: false, error: 'dispatch 실패: ' + (d.error || '') }
	}
	Reviews.apply(reviewId, null) // jobId는 이번 패스에서 추적 안 함(null)
	if (isReRequest) {
		StoreDecisions.record({
			folderId: folder ? folder.id : null,
			taskId: branch.task_id,
			kind: 'review_verdict',
			reason: `재요청 ${attempts + 1}회차(N=${retryLimit}) — ${attempts >= 2 ? `새 세션+모델 상향(${ESCALATE_MODEL[rec.model] || rec.model})` : '같은 세션'}`,
			meta: { reviewId, attempts, retryLimit },
		})
	}
	return { ok: true, dispatchedTo: session, attempts, review: Reviews.get(reviewId) }
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

module.exports = { fetchReviewComments, syncReviewsForBranch, postDisputeReply, applyReview, disputeReview, prNumberForBranch, deriveSev, disputeArgs, startAiReview }
