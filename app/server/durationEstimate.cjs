// durationEstimate.cjs — 태스크 설명 + 실제 레포 코드를 헤드리스 claude로 읽혀 예상 소요 영업일을 추정.
// repoClassify.cjs와 달리 결과를 바로 저장하지 않는다 — 일정 추정은 틀렸을 때 되돌리기 번거롭고
// (마감일이 밀려 보인다), 사용자가 버튼을 눌렀을 때만 호출되는 요청이라 "제안만 하고 사람이 적용
// 여부를 정한다"(§12 "AI 제안 + 사람이 자유롭게 덮어쓰기")를 그대로 따른다.
// "오래 걸리는데 토큰/프로그레스바를 보여줘야" 피드백으로 tasks.cjs의 runClaudeJob과 같은 stream-json
// 잡 러너 패턴을 이 파일 안에 독립적으로 재구현했다(레거시 god-object 내부에 더 얹지 않기 위해) —
// 요청 즉시 jobId를 돌려주고 프론트가 폴링해 percent/label/토큰 사용량을 실시간으로 본다.
// "탐색은 단순 모델, 판단은 무거운 모델로" 피드백으로 2단계 파이프라인이 됐다 — grep/read를 반복하는
// 탐색 턴마다 무거운 모델을 태우는 게 그동안 시간·토큰 낭비의 핵심이었다(진단 결과: 캐시 토큰이 매
// 턴 재사용되는 고정 시스템 컨텍스트 때문에 압도적으로 큼). 1단계(explore, 가벼운 모델)가 사실만
// 수집하고, 2단계(judge, 무거운 모델)가 그 사실만 근거로 판단 — 무거운 모델은 이제 단 한 번만 돈다.
'use strict'
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const C = require('./collector.cjs')
const StoreTasks = require('./store/tasks.cjs')
const Prompts = require('./prompts.cjs')
const Settings = require('./settings.cjs')

const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'
const JOB_TTL_MS = 15 * 60 * 1000 // 완료 후에도 "결과 자세히 보기" 링크가 살아있어야 하니 넉넉히 15분
const MAX_AS_IS_FILES = 5
const MAX_AS_IS_LINES = 120

const jobs = {}

function newJob(taskName) {
	for (const id of Object.keys(jobs)) if (Date.now() - jobs[id].startedAt > JOB_TTL_MS) delete jobs[id]
	const jobId = 'de-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 10000)
	jobs[jobId] = {
		taskName,
		percent: 5,
		label: '준비 중…',
		done: false,
		startedAt: Date.now(),
		doneAt: null,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
		costUsd: null,
		exploreText: '',
		files: [], // 1단계가 지목한 파일의 AS-IS 스니펫(디스크에서 직접 읽음 — 100% 실제 코드)
		result: null,
	}
	return jobId
}
// "코드를 직접 볼 수 있으면 좋겠어" — 1단계가 지목한 파일을 서버가 직접 읽어 실제 코드를 리포트에
// 박아넣는다(모델의 인용을 신뢰하지 않고 우리가 디스크에서 재확인 — 이 부분만큼은 100% 정확).
// path traversal 방어: 저장소 루트 밖으로 나가는 경로는 무시.
function safeResolve(repoRoot, relPath) {
	const resolved = path.resolve(repoRoot, relPath)
	const rootWithSep = path.resolve(repoRoot) + path.sep
	if (resolved !== path.resolve(repoRoot) && !resolved.startsWith(rootWithSep)) return null
	return resolved
}
function parseLineRange(lines, totalLines) {
	const m = String(lines || '').match(/(\d+)\s*-\s*(\d+)/)
	if (m) {
		const start = Math.max(1, parseInt(m[1], 10))
		let end = Math.min(totalLines, parseInt(m[2], 10))
		if (end < start) end = start
		if (end - start + 1 > MAX_AS_IS_LINES) end = start + MAX_AS_IS_LINES - 1
		return { start, end: Math.min(end, totalLines) }
	}
	return { start: 1, end: Math.min(totalLines, MAX_AS_IS_LINES) }
}
function readAsIsFiles(repoRoot, files) {
	const out = []
	for (const f of (files || []).slice(0, MAX_AS_IS_FILES)) {
		const relPath = String((f && f.path) || '').trim()
		if (!relPath) continue
		const why = String((f && f.why) || '').slice(0, 120)
		const abs = safeResolve(repoRoot, relPath)
		if (!abs) {
			out.push({ path: relPath, lines: '', why, asIs: null, absPath: null, error: '경로가 저장소 밖을 가리켜 무시함' })
			continue
		}
		let text
		try {
			text = fs.readFileSync(abs, 'utf8')
		} catch (_) {
			out.push({ path: relPath, lines: '', why, asIs: null, absPath: abs, error: '파일을 찾을 수 없음(경로 확인 필요 — 모델이 잘못 지목했을 수 있음)' })
			continue
		}
		const allLines = text.split('\n')
		const range = parseLineRange(f && f.lines, allLines.length)
		out.push({ path: relPath, lines: `${range.start}-${range.end}`, why, asIs: allLines.slice(range.start - 1, range.end).join('\n'), absPath: abs, error: null })
	}
	return out
}
// 2단계(judge) 프롬프트에 실제 코드를 통째로 넘겨 TO-BE 스케치가 진짜 AS-IS를 근거로 삼게 한다.
function buildCodeContext(asIsFiles) {
	if (!asIsFiles.length) return '(1단계에서 특정 파일을 지목하지 않음)'
	return asIsFiles
		.map((f) => (f.asIs != null ? `### ${f.path} (${f.lines})\n${f.why ? f.why + '\n' : ''}\`\`\`\n${f.asIs}\n\`\`\`` : `### ${f.path}\n(읽기 실패: ${f.error})`))
		.join('\n\n')
}
function bump(job, p, l) {
	if (p > job.percent) job.percent = p
	if (l) job.label = l
}
function tokensFromUsage(u) {
	return {
		input: (u && u.input_tokens) || 0,
		output: (u && u.output_tokens) || 0,
		cacheRead: (u && u.cache_read_input_tokens) || 0,
		cacheCreation: (u && u.cache_creation_input_tokens) || 0,
	}
}
function addTokens(a, b) {
	return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreation: a.cacheCreation + b.cacheCreation }
}
// 도구 이름 → 사람이 읽는 단계 라벨(tasks.cjs의 enrichStageFor와 같은 발상, 이번엔 grep/read 위주).
function stageFor(tool) {
	const n = String(tool || '')
	if (/^Glob/i.test(n)) return '파일 목록 확인 중…'
	if (/^Grep/i.test(n)) return '코드 검색 중…'
	if (/^Read/i.test(n)) return '파일 읽는 중…'
	if (/^Bash/i.test(n)) return '명령 실행 중…'
	return (n.split('__').pop() || '도구') + ' 확인 중…'
}
function parseFinalJson(text) {
	let t = text
	try {
		const j = JSON.parse(text)
		t = j.result || j.text || text
	} catch (_) {}
	const m = String(t).match(/\{[\s\S]*\}/)
	if (!m) return null
	try {
		return JSON.parse(m[0])
	} catch (_) {
		return null
	}
}
// "설명이 불확실하면 취소하고 채워달라는 경고를 띄워줘" — 판단 모델이 조사 결과를 다 합쳐도 이
// 태스크가 실제로 뭘 만드는 건지 특정 못 하면(여러 해석이 동등하게 가능) 억지 숫자 대신 이 형태로만
// 응답하도록 프롬프트에서 지시해뒀다. tooVague는 breakdown 유무와 무관하게 최우선으로 확인 —
// 모델이 혹시 실수로 breakdown도 같이 채워 보내도 "적용 가능한 숫자"로 취급하면 안 된다.
function buildResult(data) {
	if (data && data.tooVague === true) {
		return { ok: false, tooVague: true, error: String(data.vagueReason || '설명이 너무 막연해서 추정할 수 없습니다 — 설명을 더 구체적으로 채워주세요.').slice(0, 200) }
	}
	const rawBreakdown = data && Array.isArray(data.breakdown) ? data.breakdown : null
	if (!rawBreakdown || !rawBreakdown.length) return { ok: false, error: 'AI 응답 파싱 실패' }
	// 항목별 일수만 신뢰하고 총합은 여기서 직접 더한다 — 모델이 항목 합계와 다른 total을 따로 내면
	// 화면에 보이는 항목별 숫자와 배지 숫자가 어긋나 보이는 문제를 원천 차단.
	const breakdown = rawBreakdown.map((b) => ({
		item: String((b && b.item) || '').slice(0, 20) || '항목',
		days: b && Number.isFinite(Number(b.days)) ? Math.max(0, Math.round(Number(b.days))) : 0,
		note: String((b && b.note) || '').slice(0, 60),
	}))
	const days = Math.max(1, breakdown.reduce((sum, b) => sum + b.days, 0))
	const detail = String((data && data.detail) || '').slice(0, 2000)
	// plan — "조사 결과로 개발 계획까지" 요청. 그대로 task.start_prompt에 적용 가능하도록 순서 있는
	// 짧은 문장 배열로 받는다(사람이 "계획 적용" 눌러야 실제 반영 — 자동 저장 아님, 다른 필드와 동일 원칙).
	const plan = Array.isArray(data && data.plan) ? data.plan.map((s) => String(s).slice(0, 200)).slice(0, 10) : []
	// changes — "AS-IS => TO-BE로 보여주는 것도 필요해" 요청. TO-BE는 무거운 모델의 가벼운 코드
	// 스케치일 뿐 실제 구현이 아니다 — AS-IS(디스크에서 직접 읽음, job.files)와 짝지어 리포트에 표시.
	const changes = Array.isArray(data && data.changes)
		? data.changes.slice(0, 5).map((c) => ({
				path: String((c && c.path) || '').slice(0, 200),
				isNew: !!(c && c.isNew),
				summary: String((c && c.summary) || '').slice(0, 120),
				toBe: String((c && c.toBe) || '').slice(0, 2000),
			}))
		: []
	// betterDesc — "일감 내용 자체를 변경해버리면 어떨까" 요청. 원래 설명이 막연해도(메모·링크뿐)
	// 조사로 알아낸 내용을 종합해 desc 필드를 통째로 대체할 만큼 구체화한 문장. "설명 적용" 눌러야 반영.
	const betterDesc = String((data && data.betterDesc) || '').slice(0, 1000)
	return { ok: true, days, breakdown, detail, plan, changes, betterDesc }
}

// 잡의 1단계(explore)/2단계(judge)에 공용으로 쓰는 단일 claude -p stream-json 실행기.
// onSystemInit/onToolUse/onUsageDelta 콜백으로 호출부(runJob)가 공유 진행률/토큰 상태를 갱신한다.
function runPhase({ prompt, model, timeoutMs, onSystemInit, onToolUse, onUsageDelta }) {
	return new Promise((resolve) => {
		const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose']
		if (model) args.push('--model', model)
		const child = spawn(CLAUDE_BIN, args, { cwd: C.REPO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
		let buf = ''
		let toolCount = 0
		let resultText = ''
		let finalTokens = null
		let costUsd = null
		let killedByTimeout = false
		const killer = setTimeout(() => {
			killedByTimeout = true
			try {
				child.kill('SIGTERM')
			} catch (_) {}
		}, timeoutMs)
		try {
			child.stdin.end() // stdin 즉시 닫아 EOF — claude가 stdin 대기하지 않게
		} catch (_) {}

		child.stdout.on('data', (d) => {
			buf += d.toString()
			let i
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i)
				buf = buf.slice(i + 1)
				if (!line.trim()) continue
				let ev
				try {
					ev = JSON.parse(line)
				} catch (_) {
					continue
				}
				if (ev.type === 'system' && ev.subtype === 'init') {
					if (onSystemInit) onSystemInit()
				} else if (ev.type === 'assistant' && ev.message) {
					if (ev.message.usage && onUsageDelta) onUsageDelta(tokensFromUsage(ev.message.usage))
					if (Array.isArray(ev.message.content)) {
						for (const c of ev.message.content) {
							if (c.type === 'tool_use') {
								toolCount++
								if (onToolUse) onToolUse(c.name, toolCount)
							}
						}
					}
				} else if (ev.type === 'result') {
					resultText = ev.result || resultText
					if (ev.usage) finalTokens = tokensFromUsage(ev.usage)
					if (typeof ev.total_cost_usd === 'number') costUsd = ev.total_cost_usd
				}
			}
		})
		child.on('error', (e) => {
			clearTimeout(killer)
			resolve({ ok: false, error: 'claude 실행 실패: ' + e.message })
		})
		child.on('close', () => {
			clearTimeout(killer)
			if (killedByTimeout && !resultText) {
				resolve({ ok: false, error: '시간이 너무 오래 걸려 중단했습니다 — 다시 시도해 주세요.' })
				return
			}
			resolve({ ok: true, text: resultText, tokens: finalTokens || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd })
		})
	})
}

async function runJob(jobId, task) {
	const job = jobs[jobId]
	let base = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
	let baseCost = 0

	// 1단계 — 가벼운 모델(estimateExplore)로 사실만 수집. 전체 진행률의 8~55% 구간.
	const explore = await runPhase({
		prompt: Prompts.render('task.estimateDuration.explore', { title: task.name, desc: task.desc }),
		model: Settings.modelFor('estimateExplore'),
		timeoutMs: 150000,
		onSystemInit: () => bump(job, 8, '레포 확인 중…'),
		onToolUse: (name, count) => bump(job, Math.min(55, 10 + count * 7), stageFor(name)),
		onUsageDelta: (u) => {
			job.tokens = addTokens(base, u)
		},
	})
	if (!explore.ok) {
		job.result = { ok: false, error: explore.error }
		job.done = true
		job.doneAt = Date.now()
		job.percent = 100
		job.label = explore.error
		return
	}
	base = addTokens(base, explore.tokens)
	baseCost += explore.costUsd || 0
	job.tokens = base
	job.costUsd = baseCost || null
	// 1단계는 이제 {findings, files} JSON을 낸다 — findings는 기존과 같은 평문 요약, files는 실제로
	// 열어본 파일 목록(경로만, 코드는 안 들어있음). 파싱 실패 시(구형 평문 응답 등) 원문을 findings로 폴백.
	const exploreData = parseFinalJson(explore.text)
	const findingsText = (exploreData && exploreData.findings) || explore.text
	const filesListed = exploreData && Array.isArray(exploreData.files) ? exploreData.files : []
	// "코드를 직접 볼 수 있으면" — 지목된 파일을 서버가 디스크에서 직접 읽는다(모델 인용 아님, 실제 코드).
	job.files = readAsIsFiles(C.REPO, filesListed)
	job.exploreText = findingsText
	bump(job, 58, '조사 결과 정리 중…')

	// 2단계 — 무거운 모델(estimateJudge)로 1단계 결과 + 실제 AS-IS 코드만 근거로 판단. 58~95% 구간.
	const judge = await runPhase({
		prompt: Prompts.render('task.estimateDuration.judge', { title: task.name, desc: task.desc, findings: findingsText, codeContext: buildCodeContext(job.files) }),
		model: Settings.modelFor('estimateJudge'),
		timeoutMs: 110000,
		onToolUse: (name, count) => bump(job, Math.min(92, 60 + count * 8), stageFor(name)), // 지시했지만 혹시 또 탐색해도 대비
		onUsageDelta: (u) => {
			job.tokens = addTokens(base, u)
		},
	})
	if (!judge.ok) {
		job.result = { ok: false, error: judge.error }
		job.done = true
		job.doneAt = Date.now()
		job.percent = 100
		job.label = judge.error
		return
	}
	job.tokens = addTokens(base, judge.tokens)
	job.costUsd = baseCost + (judge.costUsd || 0)
	const data = parseFinalJson(judge.text)
	job.result = buildResult(data)
	job.done = true
	job.doneAt = Date.now()
	job.percent = 100
	job.label = job.result.ok ? '완료' : job.result.error || '실패'
}

function startEstimate(taskId) {
	const task = StoreTasks.get(taskId)
	if (!task) return { ok: false, error: 'task not found' }
	if (!task.desc || !task.desc.trim()) return { ok: false, error: '설명이 비어 있어 추정할 근거가 없습니다' }
	const jobId = newJob(task.name)
	runJob(jobId, task).catch((e) => {
		const job = jobs[jobId]
		if (!job) return
		job.result = { ok: false, error: String((e && e.message) || e) }
		job.done = true
		job.doneAt = Date.now()
		job.percent = 100
		job.label = '실패'
	})
	return { ok: true, jobId }
}

function getStatus(jobId) {
	const j = jobs[jobId]
	if (!j) return { ok: false, notFound: true, error: 'job 없음(만료됐을 수 있음)' }
	return {
		ok: true,
		percent: j.percent,
		label: j.label,
		done: j.done,
		tokens: j.tokens,
		costUsd: j.costUsd,
		elapsedMs: (j.doneAt || Date.now()) - j.startedAt,
		result: j.done ? j.result || { ok: false, error: '결과 없음' } : null,
	}
}

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
// vscode:// URI — 로컬 앱이라 실제 절대경로를 그대로 넘겨도 이 기기 안에서만 열린다(위협 모델은
// db.cjs와 동일 — 이미 파일시스템 접근권이 있는 사람만 이 리포트도 볼 수 있음).
function editorLink(absPath, lines) {
	if (!absPath) return null
	const m = String(lines || '').match(/^(\d+)/)
	return `vscode://file${absPath}${m ? ':' + m[1] : ''}`
}
// "내가 다 찾아가서 볼 수 있게 링크를 남겨주거나 코드를 직접 볼 수 있으면" — AS-IS는 디스크에서 직접
// 읽은 실제 코드(job.files, 100% 정확), TO-BE는 판단 모델이 AS-IS를 보고 그린 가벼운 스케치일 뿐
// 실제 구현이 아니라는 걸 라벨로 항상 밝힌다.
function renderChangeBlock(c, filesByPath) {
	const asIs = !c.isNew ? filesByPath[c.path] : null
	const link = asIs && asIs.absPath ? editorLink(asIs.absPath, asIs.lines) : null
	const asIsBody =
		asIs && asIs.asIs != null
			? `<pre class="code asIs">${esc(asIs.asIs)}</pre>`
			: `<div class="codeEmpty">${c.isNew ? '신규 파일(아직 없음)' : esc((asIs && asIs.error) || '읽기 실패')}</div>`
	return `<div class="changeBlock">
<div class="changeHead"><span class="changePath">${esc(c.path)}</span>${c.isNew ? '<span class="newBadge">신규</span>' : ''}${link ? `<a class="editorLink" href="${esc(link)}">에디터로 열기</a>` : ''}</div>
${c.summary ? `<div class="changeSummary">${esc(c.summary)}</div>` : ''}
<div class="codeCols">
<div class="codeCol"><h4>AS-IS</h4>${asIsBody}</div>
<div class="codeCol"><h4>TO-BE (스케치 — 실제 구현 아님)</h4><pre class="code toBe">${esc(c.toBe || '(없음)')}</pre></div>
</div>
</div>`
}
// "결과를 html로 뽑아주고 링크로 제공" — 좁은 드로어에는 못 넣는 상세(전체 detail 서술 + 개발 계획 +
// AS-IS/TO-BE + 참고 파일 링크 + 1단계 조사 원문 + 토큰/비용/소요시간)를 한 페이지로. 잡이 메모리에
// 살아있는 동안만(JOB_TTL_MS) 유효한 링크.
function getReportHtml(jobId) {
	const j = jobs[jobId]
	if (!j) return null
	const r = j.result || {}
	const rows = (r.breakdown || [])
		.map((b) => `<tr><td>${esc(b.item)}</td><td class="days">${esc(b.days)}일</td><td>${esc(b.note)}</td></tr>`)
		.join('')
	const filesByPath = {}
	for (const f of j.files || []) filesByPath[f.path] = f
	const planHtml =
		r.ok && r.plan && r.plan.length
			? `<h3>개발 계획</h3><ol class="planList">${r.plan.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
			: ''
	const changesHtml =
		r.ok && r.changes && r.changes.length
			? `<h3>변경 예상 파일(AS-IS → TO-BE)</h3>${r.changes.map((c) => renderChangeBlock(c, filesByPath)).join('')}`
			: ''
	const filesHtml = (j.files || []).length
		? `<h3>1단계가 실제로 열어본 파일 전체</h3><ul class="fileList">${(j.files || [])
				.map((f) => {
					const link = f.absPath ? editorLink(f.absPath, f.lines) : null
					return `<li><span class="filePath">${esc(f.path)}</span>${f.lines ? ` <span class="fileLines">(${esc(f.lines)})</span>` : ''}${f.why ? ` — ${esc(f.why)}` : ''}${
						link ? ` <a class="editorLink" href="${esc(link)}">열기</a>` : ''
					}${f.error ? ` <span class="fileErr">${esc(f.error)}</span>` : ''}${f.absPath ? `<div class="absPath">${esc(f.absPath)}</div>` : ''}</li>`
				})
				.join('')}</ul>`
		: ''
	const totalTokens = j.tokens.input + j.tokens.output + j.tokens.cacheRead + j.tokens.cacheCreation
	const fmt = (n) => n.toLocaleString('ko-KR')
	const genAt = new Date(j.doneAt || Date.now()).toLocaleString('ko-KR')
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>AI 기간 추정 리포트 — ${esc(j.taskName)}</title>
<style>
:root{color-scheme:light dark;--ink:#1a1d21;--t2:#565d66;--t3:#8a919b;--card:#fff;--card2:#f4f5f6;--codebg:#f7f7f8;--tobebg:rgba(91,100,114,0.08);--line:#e6e8eb;--violet:#5b6472}
@media (prefers-color-scheme:dark){:root{--ink:#eef0f2;--t2:#b7bcc3;--t3:#7d848d;--card:#16181b;--card2:#1e2124;--codebg:#0f1113;--tobebg:rgba(155,164,179,0.1);--line:#2a2d31;--violet:#9ba4b3}}
*{box-sizing:border-box}body{margin:0;padding:40px 20px;background:var(--card2);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,'Pretendard',sans-serif}
.wrap{max-width:860px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px 32px}
h1{font-size:16px;margin:0 0 2px;color:var(--t3);font-weight:700}
h2{font-size:22px;margin:0 0 20px}
h3{font-size:12px;color:var(--t3);font-weight:700;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.03em}
h3:first-of-type{margin-top:0}
h4{font-size:10.5px;color:var(--t3);font-weight:700;margin:0 0 4px}
.total{font-size:15px;font-weight:800;color:var(--violet);margin:0 0 14px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
td{padding:8px 6px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
td:first-child{font-weight:700;width:70px}
td.days{width:40px;font-weight:700}
.detail{background:var(--card2);border-radius:10px;padding:14px 16px;font-size:13px;color:var(--t2);white-space:pre-wrap}
.planList{margin:0;padding-left:20px;font-size:13px;color:var(--t2)}
.planList li{margin-bottom:4px}
.fileList{list-style:none;margin:0;padding:0;font-size:12.5px;color:var(--t2)}
.fileList li{padding:8px 0;border-bottom:1px solid var(--line)}
.filePath{font-weight:700;color:var(--ink)}
.fileLines{color:var(--t3)}
.fileErr{color:#b9791a}
.absPath{margin-top:2px;font-size:10.5px;color:var(--t3);word-break:break-all}
.editorLink{margin-left:8px;font-size:11px;font-weight:700;color:var(--violet);text-decoration:underline;text-underline-offset:2px}
.changeBlock{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}
.changeHead{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.changePath{font-weight:700;font-size:13px;word-break:break-all}
.newBadge{font-size:10px;font-weight:700;color:var(--violet);background:var(--tobebg);padding:1px 6px;border-radius:999px}
.changeSummary{font-size:12.5px;color:var(--t2);margin-bottom:10px}
.codeCols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:640px){.codeCols{grid-template-columns:1fr}}
.code{margin:0;padding:10px 12px;border-radius:8px;font:11.5px/1.5 ui-monospace,'SF Mono',Menlo,monospace;overflow-x:auto;white-space:pre}
.code.asIs{background:var(--codebg)}
.code.toBe{background:var(--tobebg)}
.codeEmpty{padding:10px 12px;border-radius:8px;background:var(--codebg);font-size:11.5px;color:var(--t3)}
.meta{font-size:12px;color:var(--t3);display:flex;gap:16px;flex-wrap:wrap;margin-top:8px}
</style></head><body><div class="wrap">
<h1>AI 기간 추정 리포트</h1>
<h2>${esc(j.taskName)}</h2>
${
	r.ok
		? `<div class="total">총 ${esc(r.days)}영업일</div><table><tbody>${rows}</tbody></table>`
		: r.tooVague
			? `<div class="detail">설명이 너무 막연해서 추정을 중단했습니다: ${esc(r.error || '')}</div>`
			: `<div class="detail">추정 실패: ${esc(r.error || '알 수 없는 오류')}</div>`
}
${planHtml}
${changesHtml}
${r.ok && r.betterDesc ? `<h3>보강된 설명(드로어의 "설명 적용"으로 반영 가능)</h3><div class="detail">${esc(r.betterDesc)}</div>` : ''}
${r.ok ? `<h3>판단 근거</h3><div class="detail">${esc(r.detail || '(상세 설명 없음)')}</div>` : ''}
${filesHtml}
${j.exploreText ? `<h3>1단계 조사 원문(가벼운 모델)</h3><div class="detail">${esc(j.exploreText)}</div>` : ''}
<div class="meta">
<span>토큰 합계 ${fmt(totalTokens)} (입력 ${fmt(j.tokens.input)} · 출력 ${fmt(j.tokens.output)} · 캐시읽기 ${fmt(j.tokens.cacheRead)} · 캐시생성 ${fmt(j.tokens.cacheCreation)})</span>
${j.costUsd != null ? `<span>비용 약 $${j.costUsd.toFixed(4)}</span>` : ''}
<span>소요시간 ${Math.round(((j.doneAt || Date.now()) - j.startedAt) / 1000)}초</span>
<span>${esc(genAt)} 생성</span>
</div>
</div></body></html>`
}

module.exports = { startEstimate, getStatus, getReportHtml }
