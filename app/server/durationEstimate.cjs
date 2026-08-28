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
// "검토한 일감은... 사라지면안돼. 항상 불러와야해" — 잡 상태를 서버 메모리 Map에만 들고 있던 걸
// agent_jobs 테이블(이미 monitor.cjs가 같은 용도로 씀)로 옮겼다. percent/label/meta(토큰·비용)는
// 진행 중에도 실시간으로 DB에 반영되고, 완료되면 result_json 하나에 최종 판단+토큰+1단계 원문+
// AS-IS 파일 스냅샷까지 통째로("envelope") 저장 — 새로고침·서버 재시작에도 살아남고,
// store/tasks.cjs의 composeTask가 taskId로 가장 최근 완료 잡을 다시 찾아 board 응답에 실어준다.
'use strict'
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const C = require('./collector.cjs')
const StoreTasks = require('./store/tasks.cjs')
const AgentJobs = require('./store/agentJobs.cjs')
const Prompts = require('./prompts.cjs')
const Settings = require('./settings.cjs')

const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'
const JOB_KIND = 'estimate-duration'
const MAX_AS_IS_FILES = 5
const MAX_AS_IS_LINES = 120

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
	// "기간은 최소 0.1일부터 시작해줘. 이거 너무 길게 잡혔어" — Math.round로 정수 단위로만 반올림하니
	// 실제론 반나절짜리 항목도 어쩔 수 없이 1일로 부풀려졌다. 0.1일 단위까지만 허용(소수점 1자리
	// 반올림)해서 작은 작업은 작은 숫자 그대로 나오게 한다.
	const round1 = (n) => Math.round(n * 10) / 10
	// "실제로 클로드로 개발들어간다면... 너가 작업한다고 가정했을때를 개발기한으로, 개발자 테스트
	// 기한은 그걸 내가 확인하는 작업으로" — 항목당 하나로 뭉친 days 대신 devDays(Claude 구현)와
	// testDays(사람 검증)를 따로 받는다. days는 하위호환 겸 캘린더 스케줄링용으로 둘의 합을 서버가 직접 계산.
	const breakdown = rawBreakdown.map((b) => {
		const devDays = b && Number.isFinite(Number(b.devDays)) ? Math.max(0, round1(Number(b.devDays))) : 0
		const testDays = b && Number.isFinite(Number(b.testDays)) ? Math.max(0, round1(Number(b.testDays))) : 0
		return {
			item: String((b && b.item) || '').slice(0, 20) || '항목',
			devDays,
			testDays,
			days: round1(devDays + testDays),
			note: String((b && b.note) || '').slice(0, 60),
		}
	})
	const devDays = round1(breakdown.reduce((sum, b) => sum + b.devDays, 0))
	const testDays = round1(breakdown.reduce((sum, b) => sum + b.testDays, 0))
	const days = Math.max(0.1, round1(devDays + testDays))
	const detail = String((data && data.detail) || '').slice(0, 2000)
	// "만약 길게잡힌게 맞다면... 강조를 해줬으면해" — 총합이 1일을 넘길 때만 채워지는 짧은 한 문장
	// 핵심 이유(judge 프롬프트가 생성). 좁은 카드에 바로 노출되는 용도라 detail(3~6문장)과 별개로 둔다.
	const whyLong = String((data && data.whyLong) || '').slice(0, 120)
	// plan — "조사 결과로 개발 계획까지" 요청. 그대로 task.start_prompt에 적용 가능하도록 순서 있는
	// 짧은 문장 배열로 받는다(사람이 "계획 적용" 눌러야 실제 반영 — 자동 저장 아님, 다른 필드와 동일 원칙).
	const plan = Array.isArray(data && data.plan) ? data.plan.map((s) => String(s).slice(0, 200)).slice(0, 10) : []
	// workUnits — "개발이라는 추상적인 단어보다 설계서의 업무를 순차적으로 서브태스크로 만들면
	// 좋겠어... 결제 API 연동 이런 하나의 작은 업무 단위로" 요청. 오케스트레이터가 이 순서대로 서브
	// 태스크를 자동 생성해 하나씩 체이닝으로 워크트리를 만든다(§ orchestrator.cjs ensureWorkUnitSubtasks).
	const workUnits = Array.isArray(data && data.workUnits)
		? data.workUnits
				.map((w) => ({ name: String((w && w.name) || '').slice(0, 40), summary: String((w && w.summary) || '').slice(0, 300) }))
				.filter((w) => w.name)
				.slice(0, 8)
		: []
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
	return { ok: true, days, devDays, testDays, breakdown, detail, whyLong, plan, changes, betterDesc }
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
		// "일감 검토 오래걸려도 중지 안됐으면좋겠어" — timeoutMs를 안 넘기면(runJob이 이제 안 넘김)
		// 타임아웃 타이머 자체를 안 걸어서 아무리 오래 걸려도 강제 종료하지 않는다.
		let killedByTimeout = false
		const killer = timeoutMs
			? setTimeout(() => {
					killedByTimeout = true
					try {
						child.kill('SIGTERM')
					} catch (_) {}
				}, timeoutMs)
			: null
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
			if (killer) clearTimeout(killer)
			resolve({ ok: false, error: 'claude 실행 실패: ' + e.message })
		})
		child.on('close', () => {
			if (killer) clearTimeout(killer)
			if (killedByTimeout && !resultText) {
				resolve({ ok: false, error: '시간이 너무 오래 걸려 중단했습니다 — 다시 시도해 주세요.' })
				return
			}
			resolve({ ok: true, text: resultText, tokens: finalTokens || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd })
		})
	})
}

async function runJob(jobId, task) {
	// state — 이 함수 실행 중에만 쓰는 로컬 누적치. percent/label/meta(토큰·비용)는 bump()가 호출될
	// 때마다 곧장 agent_jobs로도 써서(AgentJobs.updateProgress) 폴링 중 새로고침해도 최신값을 이어볼 수
	// 있게 한다 — 다만 이 claude 자식 프로세스 자체는 서버가 죽으면 같이 죽으므로, 진행 중이던 잡이
	// 서버 재시작 자체를 버텨내진 못한다(완료된 결과가 사라지지 않는 것과는 별개 문제).
	const state = { percent: 5, label: '준비 중…', tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0 }
	function bump(p, l) {
		if (p > state.percent) state.percent = p
		if (l) state.label = l
		AgentJobs.updateProgress(jobId, { percent: state.percent, label: state.label, meta: { tokens: state.tokens, costUsd: state.costUsd || null } })
	}
	function pushTokens(u, base) {
		state.tokens = addTokens(base, u)
		AgentJobs.updateProgress(jobId, { meta: { tokens: state.tokens, costUsd: state.costUsd || null } })
	}

	let base = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }

	// 1단계 — 가벼운 모델(estimateExplore)로 사실만 수집. 전체 진행률의 8~55% 구간.
	const explore = await runPhase({
		prompt: Prompts.render('task.estimateDuration.explore', { title: task.name, desc: task.desc }),
		model: Settings.modelFor('estimateExplore'),
		onSystemInit: () => bump(8, '레포 확인 중…'),
		onToolUse: (name, count) => bump(Math.min(55, 10 + count * 7), stageFor(name)),
		onUsageDelta: (u) => pushTokens(u, base),
	})
	if (!explore.ok) {
		AgentJobs.markDone(jobId, { taskName: task.name, result: { ok: false, error: explore.error }, tokens: state.tokens, costUsd: state.costUsd || null, exploreText: '', files: [] })
		return
	}
	base = addTokens(base, explore.tokens)
	state.tokens = base
	state.costUsd += explore.costUsd || 0
	// 1단계는 이제 {findings, files} JSON을 낸다 — findings는 기존과 같은 평문 요약, files는 실제로
	// 열어본 파일 목록(경로만, 코드는 안 들어있음). 파싱 실패 시(구형 평문 응답 등) 원문을 findings로 폴백.
	const exploreData = parseFinalJson(explore.text)
	const findingsText = (exploreData && exploreData.findings) || explore.text
	const filesListed = exploreData && Array.isArray(exploreData.files) ? exploreData.files : []
	// "코드를 직접 볼 수 있으면" — 지목된 파일을 서버가 디스크에서 직접 읽는다(모델 인용 아님, 실제 코드).
	const files = readAsIsFiles(C.REPO, filesListed)
	bump(58, '조사 결과 정리 중…')

	// 2단계 — 무거운 모델(estimateJudge)로 1단계 결과 + 실제 AS-IS 코드만 근거로 판단. 58~95% 구간.
	const judge = await runPhase({
		prompt: Prompts.render('task.estimateDuration.judge', { title: task.name, desc: task.desc, findings: findingsText, codeContext: buildCodeContext(files) }),
		model: Settings.modelFor('estimateJudge'),
		onToolUse: (name, count) => bump(Math.min(92, 60 + count * 8), stageFor(name)), // 지시했지만 혹시 또 탐색해도 대비
		onUsageDelta: (u) => pushTokens(u, base),
	})
	if (!judge.ok) {
		AgentJobs.markDone(jobId, { taskName: task.name, result: { ok: false, error: judge.error }, tokens: state.tokens, costUsd: state.costUsd || null, exploreText: findingsText, files })
		return
	}
	state.tokens = addTokens(base, judge.tokens)
	state.costUsd += judge.costUsd || 0
	const data = parseFinalJson(judge.text)
	const result = buildResult(data)
	AgentJobs.markDone(jobId, { taskName: task.name, result, tokens: state.tokens, costUsd: state.costUsd || null, exploreText: findingsText, files })
}

function startEstimate(taskId) {
	const task = StoreTasks.get(taskId)
	if (!task) return { ok: false, error: 'task not found' }
	if (!task.desc || !task.desc.trim()) return { ok: false, error: '설명이 비어 있어 추정할 근거가 없습니다' }
	const job = AgentJobs.create({ kind: JOB_KIND, refType: 'task', refId: taskId, input: { taskName: task.name }, label: '준비 중…' })
	runJob(job.id, task).catch((e) => {
		AgentJobs.markDone(job.id, { taskName: task.name, result: { ok: false, error: String((e && e.message) || e) }, tokens: null, costUsd: null, exploreText: '', files: [] })
	})
	return { ok: true, jobId: job.id }
}

function getStatus(jobId) {
	const j = AgentJobs.get(jobId)
	if (!j || j.kind !== JOB_KIND) return { ok: false, notFound: true, error: 'job 없음(만료됐을 수 있음)' }
	const envelope = j.done ? j.result || {} : null
	const liveMeta = j.meta || {}
	return {
		ok: true,
		percent: j.percent,
		label: j.label,
		done: j.done,
		tokens: j.done ? envelope.tokens || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } : liveMeta.tokens || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
		costUsd: j.done ? (envelope.costUsd ?? null) : (liveMeta.costUsd ?? null),
		elapsedMs: (j.done_at || Date.now()) - j.started_at,
		result: j.done ? envelope.result || { ok: false, error: '결과 없음' } : null,
	}
}

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
// "파일 다운로드 기능도 줘" — 리포트 파일명으로 쓸 수 있게 태스크명을 안전한 슬러그로.
function slugify(s) {
	return (
		String(s || 'task')
			.replace(/[/\\?%*:|"<>]/g, '')
			.trim()
			.replace(/\s+/g, '-')
			.slice(0, 60) || 'task'
	)
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
// AS-IS/TO-BE + 참고 파일 링크 + 1단계 조사 원문 + 토큰/비용/소요시간)를 한 페이지로. agent_jobs에
// 영구 저장되므로(§ 상단 주석) 완료된 잡이면 서버 재시작 뒤에도 계속 유효한 링크다.
function getReportHtml(jobId) {
	const j = AgentJobs.get(jobId)
	if (!j || j.kind !== JOB_KIND || !j.done) return null
	const envelope = j.result || {}
	const taskName = envelope.taskName || (j.input && j.input.taskName) || '작업'
	const r = envelope.result || {}
	const files = envelope.files || []
	const tokens = envelope.tokens || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
	const costUsd = envelope.costUsd
	const exploreText = envelope.exploreText || ''
	const rows = (r.breakdown || [])
		.map((b) => `<tr><td>${esc(b.item)}</td><td class="days">${esc(b.devDays)}일</td><td class="days">${esc(b.testDays)}일</td><td>${esc(b.note)}</td></tr>`)
		.join('')
	const filesByPath = {}
	for (const f of files) filesByPath[f.path] = f
	const planHtml =
		r.ok && r.plan && r.plan.length
			? `<h3>개발 계획</h3><ol class="planList">${r.plan.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
			: ''
	const changesHtml =
		r.ok && r.changes && r.changes.length
			? `<h3>변경 예상 파일(AS-IS → TO-BE)</h3>${r.changes.map((c) => renderChangeBlock(c, filesByPath)).join('')}`
			: ''
	const filesHtml = files.length
		? `<h3>1단계가 실제로 열어본 파일 전체</h3><ul class="fileList">${files
				.map((f) => {
					const link = f.absPath ? editorLink(f.absPath, f.lines) : null
					return `<li><span class="filePath">${esc(f.path)}</span>${f.lines ? ` <span class="fileLines">(${esc(f.lines)})</span>` : ''}${f.why ? ` — ${esc(f.why)}` : ''}${
						link ? ` <a class="editorLink" href="${esc(link)}">열기</a>` : ''
					}${f.error ? ` <span class="fileErr">${esc(f.error)}</span>` : ''}${f.absPath ? `<div class="absPath">${esc(f.absPath)}</div>` : ''}</li>`
				})
				.join('')}</ul>`
		: ''
	const totalTokens = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation
	const fmt = (n) => n.toLocaleString('ko-KR')
	const genAt = new Date(j.done_at || Date.now()).toLocaleString('ko-KR')
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>AI 기간 추정 리포트 — ${esc(taskName)}</title>
<style>
:root{color-scheme:light dark;--ink:#1a1d21;--t2:#565d66;--t3:#8a919b;--card:#fff;--card2:#f4f5f6;--codebg:#f7f7f8;--tobebg:rgba(91,100,114,0.08);--line:#e6e8eb;--violet:#5b6472}
@media (prefers-color-scheme:dark){:root{--ink:#eef0f2;--t2:#b7bcc3;--t3:#7d848d;--card:#16181b;--card2:#1e2124;--codebg:#0f1113;--tobebg:rgba(155,164,179,0.1);--line:#2a2d31;--violet:#9ba4b3}}
*{box-sizing:border-box}html,body{overflow-x:hidden}body{margin:0;padding:40px 20px;background:var(--card2);color:var(--ink);font:14px/1.65 -apple-system,BlinkMacSystemFont,'Pretendard',sans-serif}
.wrap{max-width:860px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px 32px;min-width:0}
h1{font-size:16px;margin:0 0 2px;color:var(--t3);font-weight:700}
h2{font-size:22px;margin:0 0 20px}
h3{font-size:12px;color:var(--t3);font-weight:700;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.03em}
h3:first-of-type{margin-top:0}
h4{font-size:10.5px;color:var(--t3);font-weight:700;margin:0 0 4px}
.total{font-size:15px;font-weight:800;color:var(--violet);margin:0 0 4px}
.totalSplit{font-size:12px;color:var(--t3);margin:0 0 14px}
.whyLong{background:var(--tobebg);border-radius:10px;padding:10px 14px;font-size:12.5px;color:var(--ink);font-weight:600;margin:0 0 14px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th{padding:0 6px 6px;text-align:left;font-size:10.5px;color:var(--t3);font-weight:700}
td{padding:8px 6px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
td:first-child{font-weight:700;width:70px}
td.days{width:52px;font-weight:700}
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
.changeBlock{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px;min-width:0}
.changeHead{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap}
.changePath{font-weight:700;font-size:13px;word-break:break-all}
.newBadge{font-size:10px;font-weight:700;color:var(--violet);background:var(--tobebg);padding:1px 6px;border-radius:999px}
.changeSummary{font-size:12.5px;color:var(--t2);margin-bottom:10px}
/* "html 넘어간다... 줄바꿈처리 적절히" — 2단 그리드에서 긴 타입 선언 한 줄이 카드 밖으로 새어나갔다.
   나란히 두지 않고 위아래로 쌓아 각 블록이 전체 폭을 다 쓰게 하고, 그래도 넘치는 줄은 折 wrap한다. */
.codeCols{display:flex;flex-direction:column;gap:10px;min-width:0}
.codeCol{min-width:0}
.code{margin:0;padding:12px 14px;border-radius:8px;font:12px/1.65 ui-monospace,'SF Mono',Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;border-left:3px solid transparent}
.code.asIs{background:var(--codebg);border-left-color:var(--line)}
.code.toBe{background:var(--tobebg)}
.codeEmpty{padding:10px 12px;border-radius:8px;background:var(--codebg);font-size:11.5px;color:var(--t3)}
.meta{font-size:12px;color:var(--t3);display:flex;gap:16px;flex-wrap:wrap;margin-top:8px}
.topBar{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:20px}
.downloadLink{flex:none;display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--card2);color:var(--ink);font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap}
.downloadLink:hover{background:var(--tobebg)}
</style></head><body><div class="wrap">
<div class="topBar">
<div><h1>AI 기간 추정 리포트</h1><h2>${esc(taskName)}</h2></div>
<a class="downloadLink" href="?jobId=${esc(jobId)}" download="${esc(slugify(taskName))}-review.html">⬇ 다운로드</a>
</div>
${
	r.ok
		? `<div class="total">총 ${esc(r.days)}영업일</div><div class="totalSplit">개발(Claude) ${esc(r.devDays)}일 + 테스트(개발자 확인) ${esc(r.testDays)}일</div>${r.whyLong ? `<div class="whyLong">⏱ 왜 이만큼 걸리나요 — ${esc(r.whyLong)}</div>` : ''}<table><thead><tr><th></th><th>개발</th><th>테스트</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
		: r.tooVague
			? `<div class="detail">설명이 너무 막연해서 추정을 중단했습니다: ${esc(r.error || '')}</div>`
			: `<div class="detail">추정 실패: ${esc(r.error || '알 수 없는 오류')}</div>`
}
${planHtml}
${changesHtml}
${r.ok && r.betterDesc ? `<h3>보강된 설명(드로어의 "설명 적용"으로 반영 가능)</h3><div class="detail">${esc(r.betterDesc)}</div>` : ''}
${r.ok ? `<h3>판단 근거</h3><div class="detail">${esc(r.detail || '(상세 설명 없음)')}</div>` : ''}
${filesHtml}
${exploreText ? `<h3>1단계 조사 원문(가벼운 모델)</h3><div class="detail">${esc(exploreText)}</div>` : ''}
<div class="meta">
<span>토큰 합계 ${fmt(totalTokens)} (입력 ${fmt(tokens.input)} · 출력 ${fmt(tokens.output)} · 캐시읽기 ${fmt(tokens.cacheRead)} · 캐시생성 ${fmt(tokens.cacheCreation)})</span>
${costUsd != null ? `<span>비용 약 $${costUsd.toFixed(4)}</span>` : ''}
<span>소요시간 ${Math.round(((j.done_at || Date.now()) - j.started_at) / 1000)}초</span>
<span>${esc(genAt)} 생성</span>
</div>
</div></body></html>`
}

module.exports = { startEstimate, getStatus, getReportHtml }
