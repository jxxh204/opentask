// codeBrief.cjs — "API의 경우 변경된 API 엔드포인트, 혹은 엔드포인트별 변경점... 예약하기 버튼의
// 경우에도 실제 판별 코드(mappers.ts:135)를 이런 조건에 보여지고 API에서는 이렇게 내려온다 식으로
// 간단하면서 확실하게" — 서브태스크마다 실제 저장소를 grep/read해 결정 로직을 file:line 근거로
// 뽑는다. 착수 전(pre, § orchestrator.cjs launchSubtask)엔 관련된 기존 코드를 참고 자료로, 완료 후
// (post, § advanceSubtaskWork)엔 실제 git diff를 근거로 무엇이 바뀌었는지 정리한다(사용자 선택:
// "착수 전 참고 + 완료 후 변경점 둘 다"). "Storybook에서 어디로 들어가야 하는지 알려주지 않는다" —
// 관련 스토리 파일을 찾으면 모델이 지목한 파일:export를 서버가 직접 읽어 Storybook의 실제 id 생성
// 규칙(csf toId)으로 정확한 딥링크를 결정론적으로 만든다(모델이 URL 형식을 지어내면 틀리기 쉬움).
'use strict'
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const AgentJobs = require('./store/agentJobs.cjs')
const CodeBriefs = require('./store/codeBriefs.cjs')
const Prompts = require('./prompts.cjs')
const Settings = require('./settings.cjs')
const Cockpit = require('./cockpit.cjs')

const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'
const JOB_KIND = 'code-brief'
const MAX_REFS = 6

function safeResolve(root, relPath) {
	const resolved = path.resolve(root, relPath)
	const rootWithSep = path.resolve(root) + path.sep
	if (resolved !== path.resolve(root) && !resolved.startsWith(rootWithSep)) return null
	return resolved
}
function editorLink(absPath, lines) {
	if (!absPath) return null
	const m = String(lines || '').match(/^(\d+)/)
	return `vscode://file${absPath}${m ? ':' + m[1] : ''}`
}

function parseFinalJson(text) {
	let t = text
	try {
		const j = JSON.parse(text)
		t = j.result || j.text || text
	} catch (_) {
		/* not an envelope — use raw text */
	}
	const m = String(t).match(/\{[\s\S]*\}/)
	if (!m) return null
	try {
		return JSON.parse(m[0])
	} catch (_) {
		return null
	}
}

// err는 실제 stderr만 담는다(§ linkBrief.cjs의 같은 함수 주석 — e.message로 대체하면 프롬프트 전문이
// "오류 메시지"로 잘못 뽑힌다).
function runClaude(prompt, model, cwd) {
	return new Promise((resolve) => {
		const child = execFile(CLAUDE_BIN, ['-p', prompt, '--output-format', 'json', '--model', model], { cwd, timeout: 240000, maxBuffer: 16 << 20, env: process.env }, (e, out, err) =>
			resolve({ ok: !e, out: String(out || ''), err: String(err || ''), code: e ? e.code ?? null : null }),
		)
		try {
			child.stdin.end()
		} catch (_) {
			/* ignore */
		}
	})
}

// Storybook의 실제 story-id 규칙(@storybook/csf toId)을 재현 — 모델이 URL 포맷을 스스로 지어내면
// 자주 틀려서(대소문자·특수문자 처리) 서버가 파일을 직접 읽어 결정론적으로 만든다.
function sanitize(s) {
	return String(s || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
}
function storyLabelFromExport(exportName) {
	return String(exportName || '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.trim()
}
function resolveStorybookHint(worktreePath, hint) {
	if (!hint || !hint.path) return null
	const abs = safeResolve(worktreePath, hint.path)
	if (!abs) return null
	let text
	try {
		text = fs.readFileSync(abs, 'utf8')
	} catch (_) {
		return null
	}
	const m = text.match(/title\s*:\s*['"`]([^'"`]+)['"`]/)
	if (!m) return { path: hint.path, story: hint.story || null, storyId: null, label: hint.path }
	const title = m[1]
	let storyId = sanitize(title)
	let label = title
	if (hint.story) {
		const storyLabel = storyLabelFromExport(hint.story)
		storyId += '--' + sanitize(storyLabel)
		label += ' › ' + storyLabel
	}
	return { path: hint.path, story: hint.story || null, storyId, label }
}
async function storybookUrlFor(worktreePath, hint) {
	const resolved = resolveStorybookHint(worktreePath, hint)
	if (!resolved) return null
	if (!resolved.storyId) return resolved
	try {
		const data = await Cockpit.cockpit()
		const dev = (data && data.devServers) || []
		const server = dev.find((d) => d.cwd === worktreePath && d.kind === 'storybook')
		if (server) return { ...resolved, url: `http://localhost:${server.port}/?path=/story/${resolved.storyId}` }
	} catch (_) {
		/* Storybook 서버가 지금 안 떠 있으면 경로/스토리명만 — "코드 근거"만으로도 이전보다 낫다 */
	}
	return { ...resolved, url: null }
}

function readAsIsRef(worktreePath, ref) {
	const relPath = String((ref && ref.path) || '').trim()
	if (!relPath) return null
	const abs = safeResolve(worktreePath, relPath)
	if (!abs) return { ...ref, editorLink: null, exists: false }
	const exists = fs.existsSync(abs)
	return {
		path: relPath,
		lines: String((ref && ref.lines) || ''),
		condition: String((ref && ref.condition) || '').slice(0, 200),
		explanation: String((ref && ref.explanation) || '').slice(0, 300),
		editorLink: exists ? editorLink(abs, ref && ref.lines) : null,
		exists,
	}
}

function claudeErrorMessage(r) {
	const line = r.err.split('\n').find((l) => l.trim())
	if (line) return line.slice(0, 160)
	return r.code != null ? `claude 종료 코드 ${r.code}(자세한 오류 없음 — 다시 시도해 보세요)` : 'claude 실행 실패'
}

function buildResult(data, worktreePath) {
	const endpoints = Array.isArray(data && data.endpoints)
		? data.endpoints
				.slice(0, 8)
				.map((e) => ({ method: String((e && e.method) || '').slice(0, 10), path: String((e && e.path) || '').slice(0, 200), note: String((e && e.note) || '').slice(0, 200) }))
				.filter((e) => e.path)
		: []
	const references = Array.isArray(data && data.references)
		? data.references
				.slice(0, MAX_REFS)
				.map((r) => readAsIsRef(worktreePath, r))
				.filter(Boolean)
		: []
	const summary = String((data && data.summary) || '').slice(0, 600)
	return { summary, endpoints, references, storybookHint: data && data.storybookHint ? { path: String(data.storybookHint.path || ''), story: data.storybookHint.story ? String(data.storybookHint.story) : null } : null }
}

async function finalize(subtaskId, stage, worktreePath, data) {
	const result = buildResult(data, worktreePath)
	const storybook = result.storybookHint ? await storybookUrlFor(worktreePath, result.storybookHint) : null
	CodeBriefs.markOk(subtaskId, stage, { summary: result.summary, endpoints: result.endpoints, references: result.references, storybook })
}

async function runPreJob(subtaskId, { worktreePath, taskName, subtaskName, desc }) {
	const model = Settings.modelFor('codeBrief')
	const prompt = Prompts.render('code.brief.pre', { taskName, subtaskName, desc: desc || '', hints: '' })
	const r = await runClaude(prompt, model, worktreePath)
	if (!r.ok) throw new Error(claudeErrorMessage(r))
	const data = parseFinalJson(r.out)
	if (!data) throw new Error('AI 응답 파싱 실패')
	await finalize(subtaskId, 'pre', worktreePath, data)
}

function getDiff(worktreePath, baseBranch) {
	const tryDiff = (ref) =>
		new Promise((resolve) => {
			execFile('git', ['diff', `${ref}...HEAD`], { cwd: worktreePath, maxBuffer: 8 << 20 }, (e, out) => resolve(!e && String(out || '').trim() ? out : null))
		})
	return (async () => {
		let out = baseBranch ? await tryDiff(baseBranch) : null
		if (!out && baseBranch) out = await tryDiff(`origin/${baseBranch}`)
		if (!out) out = await new Promise((resolve) => execFile('git', ['log', '-p', '-3'], { cwd: worktreePath, maxBuffer: 8 << 20 }, (e, o) => resolve(!e ? o : '')))
		return String(out || '').slice(0, 20000)
	})()
}

async function runPostJob(subtaskId, { worktreePath, taskName, subtaskName, baseBranch }) {
	const diff = await getDiff(worktreePath, baseBranch)
	if (!diff.trim()) throw new Error('변경된 내용을 찾지 못했습니다')
	const model = Settings.modelFor('codeBrief')
	const prompt = Prompts.render('code.brief.post', { taskName, subtaskName, diff })
	const r = await runClaude(prompt, model, worktreePath)
	if (!r.ok) throw new Error(claudeErrorMessage(r))
	const data = parseFinalJson(r.out)
	if (!data) throw new Error('AI 응답 파싱 실패')
	await finalize(subtaskId, 'post', worktreePath, data)
}

function ensureStage(subtaskId, stage, runner, ctx, force) {
	if (!ctx.worktreePath) return { ok: false, error: 'worktree 없음' }
	const existing = CodeBriefs.get(subtaskId, stage)
	if (!force && existing && (existing.status === 'pending' || existing.status === 'ok')) return { ok: true, status: existing.status }
	const job = AgentJobs.create({ kind: JOB_KIND, refType: 'subtask', refId: subtaskId, input: { stage }, label: stage === 'pre' ? '관련 코드 조사 중…' : '변경점 정리 중…' })
	CodeBriefs.upsertPending(subtaskId, stage, job.id)
	runner(subtaskId, ctx)
		.then(() => AgentJobs.markDone(job.id, { ok: true }))
		.catch((e) => {
			CodeBriefs.markError(subtaskId, stage, String((e && e.message) || e))
			AgentJobs.markDone(job.id, { ok: false, error: String((e && e.message) || e) })
		})
	return { ok: true, status: 'pending', jobId: job.id }
}

function ensurePre(subtaskId, ctx, force) {
	return ensureStage(subtaskId, 'pre', runPreJob, ctx, force)
}
function ensurePost(subtaskId, ctx, force) {
	return ensureStage(subtaskId, 'post', runPostJob, ctx, force)
}
function listBySubtask(subtaskId) {
	return CodeBriefs.listBySubtask(subtaskId)
}

module.exports = { ensurePre, ensurePost, listBySubtask }
