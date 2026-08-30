// orchestrator.cjs — 개발실(Sessions) 폴더 단위 "🎼 오케스트레이션" (Phase 3.2, subtask-chain으로 개편).
//
// orch.cjs(구 그룹-지휘자)와는 다른 개념이라 재사용하지 않고 새로 쓴다. 여기서는 한 폴더의
// 태스크들을 order_idx 순서(= 단순 순차 웨이브, 한 번에 하나 active)로 돌린다.
//
// "메인태스크에서는 업무를 터미널로 시작하지말고. 워크트리를 만들고 시작하자. 메인태스크는
// 오케스트레이션만 진행하는걸로." — 태스크 자신은 절대 자기 워크트리·터미널을 직접 갖지 않는다.
// start()는 태스크마다 실제 워크트리+세션 생성을 startSubtaskWork()/launchSubtask()에게 위임하고,
// 자신은 레포 배정 검증·로그·폴더 base 고정 같은 오케스트레이션만 한다. 실제 코드 작업은 전부
// 그 태스크의 서브태스크 체인(§ 아래 "서브태스크 체이닝") 안, 서브태스크 자신의 워크트리에서 일어난다.
//
// ⚠️ 폴더 레벨 상태(states Map)는 프로세스 in-memory — 서버 재시작 시 소실된다(v1 허용, 서브태스크
//    체인 자체는 subtask_sessions에 영속). 실제 "이전 웨이브 완료" 감지와 PR baseRef 의존성 그래프
//    기반 웨이브는 이번 패스 범위 밖(후속 단계). advance는 사람이 누르는 수동 진행.
'use strict'
const fs = require('fs')
const path = require('path')
const Term = require('./term.cjs')
const Worktrees = require('./worktrees.cjs')
const Actuator = require('./actuator.cjs')
const Settings = require('./settings.cjs')
const Notify = require('./notify.cjs')
const C = require('./collector.cjs')
const StoreFolders = require('./store/folders.cjs')
const StoreTasks = require('./store/tasks.cjs')
const StoreRepos = require('./store/repos.cjs')
const StoreBranches = require('./store/branches.cjs')
const StoreDecisions = require('./store/decisions.cjs')
const StoreSubtasks = require('./store/subtasks.cjs')
const StoreSubtaskSessions = require('./store/subtaskSessions.cjs')
const { translateToEnglishSlug } = require('./branchSlug.cjs')

// ② 레포 분류 검증 — repoClassify.cjs가 자동배정(repo_auto=1)한 경우에만, 워크트리를 실제로 만들기
// 전에 태스크명/설명과 레포명이 최소한의 토큰이라도 겹치는지 스크립트로 확인한다(AI 아님, 단순 매칭).
// 사람이 직접 레포를 골랐으면(repo_auto=0) 이미 확인된 값이라 건너뛴다 — "기획: 이상적 워크플로우"
// §12 참고. 한글 태스크명과 영문 레포 슬러그가 흔해 겹침이 잘 안 잡히는 게 알려진 한계라, 겹치지
// 않아도 워크트리 생성을 막지 않고 decisions에 재확인 필요만 기록한다(오탐으로 작업을 막지 않기 위함).
// 레포는 세 곳에 저장된다 — subtasks.repo_id(그 서브태스크만의 오버라이드) > folders.repo_id(폴더로
// 승격된 뒤로는 이게 유일한 진짜 값) > tasks.repo_id(승격 전 inbox 단계의 레거시/AI 자동배정 흔적,
// 승격 후엔 folders.repo_id로 안 동기화되고 그대로 굳어 남는다 — DB.cjs v10 마이그레이션 참고).
// 우선순위 판정 로직 자체가 launchSubtask/startOrchestration 두 곳에 따로 복붙돼 있던 걸 여기 하나로
// 모은다 — subtask/folder는 없을 수 있어 둘 다 optional.
function resolveRepoId({ subtask, folder, task }) {
	return (subtask && subtask.repo_id) || (folder && folder.repo_id) || (task && task.repo_id) || null
}

// "팀 규칙"(§ db.cjs v22) — 브랜치 네이밍·사전 문서 요구사항처럼 팀마다 다른 개발 관행을, 구조화된
// 필드가 아니라 레포당 자유 텍스트로 받아 그대로 에이전트 지시문에 얹는다. OpenTask 코드는 이 텍스트를
// 파싱/강제하지 않는다 — 지시문을 읽은 에이전트(태스크 매니저·서브태스크 세션)가 알아서 따른다(브랜치
// 리네임, 노션 문서 작성 등도 에이전트 자신이 이미 가진 shell/MCP 툴로 직접 수행). 규칙이 하나도 없으면
// 빈 문자열을 돌려줘 프롬프트에 아무 흔적도 안 남는다(§ 기본값 = 오늘과 동일 동작).
// "태스크 매니저가 무조건 팀 규칙을 보고 일하도록 개선해야 해" — 프롬프트 한가운데 지나가듯 한 번
// 언급되면 긴 지시문 속에 묻혀 흐려질 수 있다("아주 중요한 원칙" 섹션처럼 이미 검증된 강한 어조를
// 그대로 빌리고), 앞쪽(초두 효과)뿐 아니라 번호 매긴 실행 단계의 0번(할 일 목록의 일부로 만들어야
// 실제로 수행됨)과 맨 끝(최신 효과)에도 짧게 다시 못박아 3중으로 반복한다 — 본문은 앞에서 한 번만.
function teamRulesSection(pairs) {
	const filled = pairs.filter(([, text]) => text && String(text).trim())
	if (!filled.length) return ''
	const body = filled.map(([label, text]) => `[${label}]\n${String(text).trim()}`).join('\n\n')
	return `\n\n■ 아주 중요한 원칙 — 이 레포의 팀 규칙(사람이 직접 정한 것, 절대 무시하거나 생략하지 않는다):\n${body}\n`
}
// 위 teamRulesSection과 같은 pairs를 받아 "규칙이 있으면 짧게 되짚는 한 줄"만 돌려준다 — 내용을
// 또 통째로 반복하지 않고 주의만 다시 그쪽으로 돌린다(프롬프트 비대해지는 것 방지).
function teamRulesReminder(pairs, note) {
	const has = pairs.some(([, text]) => text && String(text).trim())
	return has ? `위에서 정한 팀 규칙을 ${note}` : ''
}

function tokenize(s) {
	return String(s || '')
		.toLowerCase()
		.split(/[^a-z0-9가-힣]+/)
		.filter((t) => t.length >= 2)
}
function repoAssignmentLooksRight(task, repo) {
	if (!repo) return true
	const taskTokens = new Set([...tokenize(task.name), ...tokenize(task.desc)])
	const repoTokens = tokenize(repo.name)
	return repoTokens.some((t) => taskTokens.has(t)) || taskTokens.size === 0 || repoTokens.length === 0
}

// "오케스트레이터는 일감만들때 만든 Html문서도 자동으로 보고 일을 시작해줘" — durationEstimate.cjs의
// AI 검토 결과(§ store/tasks.cjs latestReview)를 사람이 "적용"을 안 눌렀어도 시드 프롬프트에 얹는다.
// 실패/tooVague/아직 검토 안 한 태스크는 조용히 빈 문자열(기존 seed 그대로).
function buildReviewContext(review) {
	if (!review || !review.result || !review.result.ok) return ''
	const r = review.result
	const parts = [`[AI 사전 조사 — 태스크 등록 전에 미리 코드를 읽고 나온 판단이다, 착수 전 참고하되 실제 코드는 직접 다시 확인해라]`, r.detail]
	// plan 문장은 judge 프롬프트가 이미 "1. ...", "2. ..." 형태로 번호를 붙여서 내놓는다 — 여기서 또
	// 번호를 매기면 "1. 1. ..."처럼 중복된다.
	if (r.plan && r.plan.length) parts.push(`개발 계획:\n${r.plan.join('\n')}`)
	if (r.changes && r.changes.length) {
		parts.push(`변경이 예상되는 파일(경로만 참고 — 아래 요약은 스케치일 뿐 실제 코드가 아니니 그대로 베끼지 말고 파일을 직접 열어서 확인해라):\n${r.changes.map((c) => `- ${c.path}${c.isNew ? ' (신규 파일)' : ''}: ${c.summary}`).join('\n')}`)
	}
	return '\n\n' + parts.join('\n\n')
}

// ── 서브태스크 체이닝("코드작업은 무조건 서브태스크를 만들고 그 서브태스크에 워크트리를 만들어서
//    개발을 들어가야해... 순차로... pr도 체이닝으로") ──
// 태스크 단위로 워크트리 하나를 만들던 위 start()와 별개 경로 — "개발" 성격의 실제 코드 작업만
// 서브태스크 단위로 쪼개 하나씩 순서대로 자기 워크트리+브랜치를 갖고, 다음 서브태스크는 그 브랜치
// 위에서 이어 만든다(PR 체이닝). QA/배포처럼 코드 작업이 아닌 서브태스크는 이 경로를 타지 않는다
// (사람이 직접 추가한 서브태스크는 그대로 캘린더 표시 용도로만 남는다 — 이 함수들은 그런 서브태스크는
// 건드리지 않고, "아직 아무 세션도 시작 안 한" 서브태스크만 순서대로 집어 워크트리를 만든다).
// subtask_sessions에 영구 기록해 "컴퓨터가 꺼져도 지워지면안돼" 요청대로 서버/컴퓨터 재시작에도
// 어디까지 진행했는지 잊지 않는다(실제 tmux 프로세스 자체는 컴퓨터가 꺼지면 죽지만, 워크트리·브랜치·
// 기록은 남아 다시 이어갈 수 있다).
// "메인태스크는 오케스트레이션만 진행하는걸로" — 태스크 자신은 이제 절대 직접 워크트리+터미널을
// 갖지 않는다. AI 검토가 아직 없어 workUnits가 없어도(리뷰를 안 돌렸거나 tooVague였던 경우) 코드
// 작업은 "무조건" 서브태스크를 거쳐야 하므로, 그럴 땐 태스크 자신을 그대로 옮겨담은 서브태스크
// 하나를 만든다(가장 단순한 1-서브태스크 체인).
function ensureWorkUnitSubtasks(task) {
	const existing = StoreSubtasks.listByTask(task.id)
	if (existing.length > 0) return existing
	const review = StoreTasks.latestReview(task.id)
	const units = review && review.result && review.result.ok && Array.isArray(review.result.workUnits) ? review.result.workUnits : []
	if (units.length) {
		for (const u of units) StoreSubtasks.create({ taskId: task.id, name: u.name, desc: u.summary })
	} else {
		StoreSubtasks.create({ taskId: task.id, name: task.name, desc: task.desc || '' })
	}
	return StoreSubtasks.listByTask(task.id)
}

// 이 서브태스크가 이미 워크트리+세션을 시작한 적이 있는지 — 있으면 "진행 중이거나 완료된" 걸로 보고
// 건너뛴다(재시작은 advanceSubtaskWork가 명시적으로 담당).
function subtaskStarted(subtaskId) {
	return StoreSubtaskSessions.listBySubtask(subtaskId).length > 0
}

async function launchSubtask(task, subtask) {
	const folder = task.folder_id ? StoreFolders.get(task.folder_id) : null
	// "pr도 체이닝으로" — 바로 앞 서브태스크가 이미 브랜치를 만들었으면 그 브랜치 위에서 이어 만든다.
	const allSubtasks = StoreSubtasks.listByTask(task.id)
	const idx = allSubtasks.findIndex((s) => s.id === subtask.id)
	const prevSubtask = idx > 0 ? allSubtasks[idx - 1] : null
	const prevSession = prevSubtask ? StoreSubtaskSessions.latestForSubtask(prevSubtask.id) : null
	const base = (prevSession && prevSession.branch) || (folder && folder.base) || null
	// "서브태스크도 레포를 별도로 줄 수 있어야하지만. 기본적으로는 메인태스크와 동일하게" — 서브태스크
	// 자신에 repo_id가 있으면 그걸 우선, 없으면(기본값) 폴더/태스크 레포를 그대로 물려받는다.
	const repo = StoreRepos.get(resolveRepoId({ subtask, folder, task }))
	// 워크트리 목록에서 "연결"로 태스크에 이미 입양된 브랜치가 있으면(사람이 기존 워크트리를 이 태스크에
	// 붙여둔 경우) 첫 서브태스크는 새 워크트리를 또 만들지 않고 그 워크트리를 그대로 이어받는다.
	const adoptedBranch = idx === 0 ? StoreBranches.listByTask(task.id).find((b) => !b.subtask_id) : null
	const adoptedPath = adoptedBranch ? await Worktrees.pathForBranch(adoptedBranch.name, repo && repo.path) : null
	// "워크트리이름은 영어로(브랜치이름을 영어로 해야하니까), 서브태스크이름은 별도로" — Worktrees.ensure는
	// 원래 subtask.name을 그대로 슬러그화해 한글도 그대로 통과시킨다. 브랜치는 git/GitHub 툴링 때문에
	// 항상 영문이어야 하는 기술적 요구라 팀 규칙 설정 여부와 무관하게 항상 번역한다(예전엔 repo.rule_branch가
	// 채워져 있을 때만 번역했는데, 그건 "영문을 쓸지"가 아니라 "프리픽스·번호 형식이 뭔지"를 정하는 칸이라
	// 이 게이팅 자체가 잘못이었다). 이미 있는 한글→영어 번역기(branchSlug.cjs, 레거시 업무보드와 공유)로
	// 영문 슬러그를 만들어 ticket으로 넘기고, 서브태스크의 사람이 보는 이름(subtask.name)은 이후 자유롭게
	// 바뀌어도(리네임) 이미 만들어진 브랜치·워크트리·세션 이름과는 완전히 무관하다. 세부 프리픽스·번호
	// 형식까지는 코드가 못 정하니 그 부분은 아래 seed에 규칙 원문을 얹어 에이전트가 git branch -m으로
	// 마무리하게 한다.
	const ticket = (await translateToEnglishSlug(subtask.name).catch(() => null)) || subtask.name
	const wt = adoptedPath
		? { ok: true, path: adoptedPath, branch: adoptedBranch.name, base: folder && folder.base }
		: await Worktrees.ensure({ ticket, base, desc: `${task.name} — ${subtask.name}`, repoPath: repo && repo.path, repoBase: repo && repo.base })
	if (!wt.ok) return { ok: false, error: wt.error }
	if (adoptedBranch) {
		StoreBranches.linkToSubtask(adoptedBranch.id, subtask.id)
	} else if (wt.branch && !StoreBranches.listBySubtask(subtask.id).length) {
		StoreBranches.create({ taskId: task.id, subtaskId: subtask.id, name: wt.branch, repo: repo && repo.name })
	}
	// "오케스트레이터는 일감만들때 만든 Html문서도 자동으로 보고" — 태스크의 AI 검토 컨텍스트(판단
	// 근거·변경 파일)를 이 서브태스크의 자기 설명과 함께 얹는다.
	const review = StoreTasks.latestReview(task.id)
	// "팀 규칙" — 브랜치명은 Worktrees.ensure가 이미 결정론적으로 지어버린 뒤라(§ deriveNames, 한글도
	// 그대로 통과) 코드에서 다시 바꾸지 않는다. 대신 지금 워크트리에 곧 뜰 이 세션 자신에게 "이 브랜치명이
	// 팀 규칙과 안 맞으면 작업 시작 전에 네가 직접 git branch -m으로 바꿔라"라고 맡긴다 — 이미 그 워크트리
	// 안에서 shell을 쥔 에이전트라 리네임도, 팀 규칙이 요구하는 사전 문서 작성(예: 노션)도 스스로 할 수 있다.
	const rulePairs = [
		['이 태스크만의 특별 규칙 — 같은 레포의 다른 태스크에는 안 쓰인다', folder && folder.rule_task],
		['일반 규칙', repo && repo.rule_general],
		['워크트리 · 브랜치 생성 규칙 — 지금 브랜치명은 자동 생성된 것이다. 규칙과 안 맞으면 git branch -m으로 먼저 바꿔라', repo && repo.rule_branch],
		['개발 시작 전 필수 조건 — 충족 전엔 코드를 작성하지 마라', repo && repo.rule_predev],
	]
	const rules = teamRulesSection(rulePairs)
	const reminder = teamRulesReminder(rulePairs, '잊지 마라 — 코드를 작성하기 전에 다시 한번 확인해라.')
	// 팀 규칙은 초두 효과를 노려 작업 설명보다 먼저 두고(뒤에 review 컨텍스트까지 붙으면 길어져 묻히기
	// 쉽다), 끝에 짧게 한 번 더 되짚는다(최신 효과) — conductorSeed와 같은 3중 반복 원칙.
	const taskLine = `이 서브태스크를 진행해줘: "${subtask.name}"(태스크 "${task.name}"의 일부). ${subtask.desc || ''}`.trim()
	// "메인 태스크와 서브 태스크가 서로 대화하지 않아... 둘다 계속 멈춰" — 예전엔 여기서 끝나면 사람이
	// 상세 패널의 "진행" 버튼을 눌러줘야만 다음 서브태스크가 시작됐다(§ advanceSubtaskWork 예전 유일한
	// 호출부). 판단이 필요 없는 정상 완료는 서버가 바로 다음 단계를 시작하도록, 이 curl 하나로 스스로
	// 체인을 넘기게 한다 — 마지막 단계여도 같은 curl로 안전하게 "완료"만 기록된다(advanceSubtaskWork
	// 참고).
	const port = process.env.OPENRM_PORT || 8770
	// "서브 태스크가 끝나면... 어떻게 끝났고 어떤것들을 했는지 정리해서 보여줬으면해. 다이어그램을
	// 포함해서. 지금은 끝나도 뭐가 완료되었는지 확인하지 못해" — 완료 curl 자체의 JSON body에
	// reportHtml을 실어 보내게 한다(별도 API 왕복 안 만듦, § advanceSubtaskWork/db.cjs v25). 완성된
	// HTML을 요구하는 이유: 서버는 그대로 저장·서빙만 하고 렌더링을 안 하므로, 반쪽 마크업이면 그대로
	// 깨져 보인다.
	const advanceLine = `■ 이 서브태스크를 실제로 다 마쳤으면(테스트 통과·리뷰 반영 등 확인까지 끝난 상태) 사람이나 태스크 매니저를 기다리지 말고 바로 다음 단계를 직접 시작해라. 그 전에 뭘 했고 어떻게 끝났는지 정리한 완성된 HTML 리포트를 만들어라(<html>부터 시작하는 완전한 문서 — 무엇을 왜 했는지, 주요 변경점, 가능하면 흐름을 보여주는 다이어그램(Mermaid CDN 스크립트 태그나 인라인 SVG 중 편한 쪽) 포함). 파일로 먼저 써두고(예: /tmp/report.html), 셸 따옴표 escape 사고 없이 안전하게 JSON body를 만들어 이 curl로 보내라: node -e "const fs=require('fs');fs.writeFileSync('/tmp/report-body.json',JSON.stringify({reportHtml:fs.readFileSync('/tmp/report.html','utf8')}))" && curl -s -X POST http://localhost:${port}/api/tasks/${task.id}/subtask-work/advance -H 'Content-Type: application/json' -d @/tmp/report-body.json (마지막 단계면 다음 세션 없이 완료만 기록된다 — 안전하게 항상 이 curl을 써라)`
	// "메인 태스크와 서브 태스크가 서로 대화를 안 하거든... 업무가 멈추든" — 완료(advanceLine)와 대칭되는
	// "막힘" 보고 경로. 혼자 못 푸는 결정(정책 판단, 크리덴셜, 애매한 요구사항 등)을 만나면 조용히 멈추는
	// 대신 이 curl로 바로 지휘자를 깨운다 — 세션 자체는 안 죽는다, 응답 기다리며 계속 살아있어도 된다.
	const blockedLine = `■ 혼자 판단 못 할 결정이나 막힘(정책·크리덴셜·애매한 요구사항 등)을 만나면 조용히 멈추지 말고 바로 이 curl로 보고해라: curl -s -X POST http://localhost:${port}/api/tasks/${task.id}/subtask-work/report-blocked -H 'Content-Type: application/json' -d '{"reason":"<막힌 이유를 한두 문장으로>"}' (세션은 안 죽는다 — 응답 기다리며 계속 작업 가능하면 이어서 해도 된다)`
	const seed = (rules ? rules.trim() + '\n\n' : '') + taskLine + (wt.branch ? `\n지금 브랜치: ${wt.branch}` : '') + buildReviewContext(review) + (reminder ? `\n\n■ ${reminder}` : '') + `\n\n${advanceLine}\n\n${blockedLine}`
	const model = Settings.modelFor('dev')
	const t = await Term.create({ cwd: wt.path, command: 'claude', label: subtask.name, seed, model })
	if (!t.ok) return { ok: false, error: t.error }
	const modelLabel = Settings.modelLabel(model)
	StoreSubtaskSessions.create({ subtaskId: subtask.id, taskId: task.id, tmuxSession: t.name, worktreePath: wt.path, branch: wt.branch, model, modelLabel })
	syncFolderSession(task, { taskId: task.id, tmuxSession: t.name, worktreePath: wt.path, model, modelLabel })
	return { ok: true, subtaskId: subtask.id, subtaskName: subtask.name, tmuxSession: t.name, worktreePath: wt.path, modelLabel, base: wt.base || null }
}

// 사이드바(FolderCard/TaskRow)·오케스트레이터 탭은 states(folderId).sessions로 "이 태스크의 지금
// 세션"을 읽는다 — 사람이 폴더 오케스트레이션 버튼으로 건드렸든, 지휘자가 MCP로 자동 진행했든,
// 서버 재시작 후 이미 살아있던 세션을 다시 찾아낸 것이든 상관없이 항상 최신 서브태스크 세션을
// 가리키도록 한 곳에서 동기화한다.
function syncFolderSession(task, rec) {
	if (!task.folder_id) return
	const s = ensureState(task.folder_id)
	const idx = s.sessions.findIndex((x) => x.taskId === task.id)
	if (idx >= 0) s.sessions[idx] = rec
	else s.sessions.push(rec)
}

// 태스크의 "개발형" 서브태스크 체인을 시작한다 — 서브태스크가 아직 없으면 완료된 AI 검토의
// workUnits로 자동 생성한다. 이미 시작된(=subtask_sessions 기록이 있는) 서브태스크는 건너뛰고,
// 처음으로 아직 시작 안 한 서브태스크 하나만 워크트리+세션을 만든다(전부 한 번에 안 띄움 — 순차 진행).
async function startSubtaskWork(taskId) {
	const task = StoreTasks.get(taskId)
	if (!task) return { ok: false, error: 'task not found' }
	const subtasks = ensureWorkUnitSubtasks(task)
	if (!subtasks.length) return { ok: false, error: '서브태스크가 없습니다 — AI 검토를 먼저 완료하거나 직접 추가해주세요.' }
	const live = await Term.list().catch(() => [])
	let deadActive = null
	for (const st of subtasks) {
		const active = StoreSubtaskSessions.getActiveForSubtask(st.id)
		if (active && isLive(live, active.tmux_session)) {
			syncFolderSession(task, { taskId: task.id, tmuxSession: active.tmux_session, worktreePath: active.worktree_path, model: active.model, modelLabel: active.model_label })
			return { ok: true, already: true, subtaskId: st.id, subtaskName: st.name, tmuxSession: active.tmux_session }
		}
		// ended_at은 안 찍혔는데(=advanceSubtaskWork로 명시적으로 안 끝냄) 지금 안 살아있으면 서버
		// 재시작으로 죽은 것 — "이미 시작됨"으로 건너뛰지 말고 먼저 복원부터 시도한다("복원 경로 이어붙여").
		if (active && !deadActive) deadActive = { st, active }
	}
	if (deadActive) {
		const restored = await restoreByName(deadActive.active.tmux_session)
		if (restored) {
			const { st, active } = deadActive
			StoreSubtaskSessions.create({ subtaskId: st.id, taskId: task.id, tmuxSession: restored.name, worktreePath: active.worktree_path, branch: active.branch, model: active.model, modelLabel: active.model_label })
			syncFolderSession(task, { taskId: task.id, tmuxSession: restored.name, worktreePath: active.worktree_path, model: active.model, modelLabel: active.model_label })
			return { ok: true, restored: true, subtaskId: st.id, subtaskName: st.name, tmuxSession: restored.name }
		}
	}
	const next = subtasks.find((st) => !subtaskStarted(st.id))
	if (!next) return { ok: false, error: '모든 서브태스크가 이미 시작됐습니다 — 다음으로 넘기려면 진행을 쓰세요.' }
	return launchSubtask(task, next)
}

// 지금 진행 중인 서브태스크를 끝난 걸로 기록하고 다음 서브태스크의 워크트리+세션을 새로 만든다
// ("순차로 진행하게해줘"). 아래 주석대로 지금은 서브태스크 자신이 호출한다 — "사람/지휘자가 판단해야
// 한다"는 옛 설명은 지워졌다(더 밑 conductorSeed도 같이 고쳤다 — 지휘자 seed에 남아있던 낡은 문구).
// "메인 태스크와 서브 태스크가 서로 대화하지 않아... 둘다 계속 멈춰" — 이 함수는 전부터 있었지만
// 사람이 상세 패널에서 버튼을 눌러야만 호출됐다. 이제 launchSubtask의 seed가 서브태스크 자신에게
// "끝나면 이 curl로 직접 다음 단계로 넘겨라"를 지시하므로(§ launchSubtask), 실제로는 그 서브태스크
// 세션 자신이 이 함수를 호출한다 — 판단(지휘자 승인 등) 없이 서버가 바로 다음 단계를 시작한다.
async function advanceSubtaskWork(taskId, reportHtml) {
	const task = StoreTasks.get(taskId)
	if (!task) return { ok: false, error: 'task not found' }
	const subtasks = StoreSubtasks.listByTask(taskId)
	const liveIdx = subtasks.findIndex((st) => {
		const active = StoreSubtaskSessions.getActiveForSubtask(st.id)
		return !!active
	})
	if (liveIdx === -1) return { ok: false, error: '진행 중인 서브태스크가 없습니다 — 먼저 시작하세요.' }
	const current = subtasks[liveIdx]
	const currentSession = StoreSubtaskSessions.getActiveForSubtask(current.id)
	// "서브 태스크가 끝나면... 어떻게 끝났고 어떤것들을 했는지 정리해서 보여줬으면해" — advanceLine이
	// 완료 curl의 body에 실어 보내라고 지시한 HTML 리포트를 같은 UPDATE로 저장(§ db.cjs v25).
	StoreSubtaskSessions.markEnded(currentSession.id, reportHtml)
	const next = subtasks[liveIdx + 1]
	// "서로 대화를 안 하거든" — pushFeed(로그 기록)만으론 지휘자가 대화 로그를 스스로 보러 가지 않는
	// 한 절대 못 알아챈다. notifyConductor로 지휘자 pty에 직접 타이핑해 능동적으로 통보한다(사람→지휘자
	// conductorTell, 지휘자→서브태스크 conductorSay와 대칭되는 서브태스크→지휘자 다리).
	if (task.folder_id) {
		const s = ensureState(task.folder_id)
		delete s.blocked[current.id] // 막혀있다가 결국 스스로 풀고 완료한 경우 — 표시 해제.
		delete s.stalled[current.id]
		const text = next ? `"${current.name}" 완료 → 다음 단계 "${next.name}" 자동 시작` : `"${current.name}" 완료 — 마지막 단계였습니다.`
		await notifyConductor(task.folder_id, current.id, text, 'result')
		// 전체 체인이 다 끝났을 때만 OS 알림(중간 홉마다 울리면 시끄러움 — 사용자 확인).
		if (!next) Notify.notifyEscalation(`🏁 "${task.name}" 체인 완료`, `"${current.name}"까지 모든 단계가 끝났습니다.`)
	}
	if (!next) return { ok: true, done: true }
	return launchSubtask(task, next)
}

// "업무가 멈추든 업무가 어떻든간에 서로가 답장을 주는거야" — advanceSubtaskWork(완료)와 대칭되는
// "막힘" 보고. 세션은 안 죽인다(끝난 게 아니라 도움이 필요한 것뿐 — advance처럼 markEnded/launchSubtask
// 안 함). 완료와 달리 사람도 바로 알아야 하는 사안이라 OS 알림은 10초 tick을 기다리지 않고 즉시 쏜다.
async function reportSubtaskBlocked(taskId, reason) {
	const task = StoreTasks.get(taskId)
	if (!task) return { ok: false, error: 'task not found' }
	if (!task.folder_id) return { ok: false, error: '메인 태스크에 아직 연결되지 않았습니다.' }
	const subtasks = StoreSubtasks.listByTask(taskId)
	const liveIdx = subtasks.findIndex((st) => !!StoreSubtaskSessions.getActiveForSubtask(st.id))
	if (liveIdx === -1) return { ok: false, error: '진행 중인 서브태스크가 없습니다.' }
	const current = subtasks[liveIdx]
	const s = ensureState(task.folder_id)
	const cleanReason = String(reason || '').trim().slice(0, 500) || '(사유 없음)'
	s.blocked[current.id] = cleanReason
	await notifyConductor(task.folder_id, current.id, `"${current.name}" 막힘 — ${cleanReason}`, 'blocked')
	Notify.notifyEscalation(`🆘 "${current.name}" 도움 요청`, cleanReason)
	return { ok: true, subtaskId: current.id }
}

// "업무가 어떻든간에" — 명시적 보고(report-blocked) 없이 그냥 조용해지는 경우(컨텍스트 한도, 크래시,
// 보고를 잊음)를 잡는 안전망. blocked(확정 신호)와 달리 이건 추정이라 s.stalled에 따로 저장하고
// UI도 일부러 다른 색(amber)을 쓴다 — 둘을 섞으면 진짜 확정 신호의 긴급도가 희석된다.
const STALLED_THRESHOLD_MS = 15 * 60 * 1000
async function checkStalledSubtasks() {
	const now = Date.now()
	const live = await Term.list().catch(() => [])
	for (const folder of StoreFolders.list()) {
		const tasks = StoreTasks.listByFolder(folder.id)
		for (const task of tasks) {
			for (const st of StoreSubtasks.listByTask(task.id)) {
				const session = StoreSubtaskSessions.getActiveForSubtask(st.id)
				const s = ensureState(folder.id)
				if (!session || !isLive(live, session.tmux_session)) {
					delete s.stalled[st.id]
					continue
				}
				if (s.blocked[st.id]) continue // 이미 명시적으로 막힘 보고됨 — 중복 알림 방지
				const status = await Term.status(session.tmux_session).catch(() => null)
				if (!status || status.working || status.waiting || status.needsAuth) {
					delete s.stalled[st.id] // 정상으로 돌아옴 — 다음에 또 조용해지면 재알림 허용
					continue
				}
				const last = status.lastWorkingAt || session.started_at
				if (now - last < STALLED_THRESHOLD_MS || s.stalled[st.id]) continue
				s.stalled[st.id] = true
				const mins = Math.round((now - last) / 60000)
				await notifyConductor(folder.id, st.id, `"${st.name}" ${mins}분째 응답 없음 — 확인해봐라(막힌 게 아니라면 무시해도 됨).`, 'stalled')
				Notify.notifyEscalation(`💤 "${st.name}" 응답 없음`, `${mins}분째 조용합니다.`)
			}
		}
	}
}

// "서브태스크 클로드 세션은 어떻게 킬지 고민이야" — 다음으로 넘기지 않고 지금 서브태스크 세션만
// 끝낸다(사람이 직접 끄고 싶을 때). advanceSubtaskWork와 달리 다음 서브태스크를 새로 띄우지 않는다 —
// 그건 나중에 "진행"을 눌렀을 때 이 서브태스크가 이미 끝났다고 보고 자연스럽게 넘어간다.
async function stopSubtaskSession(subtaskId) {
	const active = StoreSubtaskSessions.getActiveForSubtask(subtaskId)
	if (!active) return { ok: false, error: '진행 중인 세션이 없습니다.' }
	await Term.kill(active.tmux_session).catch(() => {})
	StoreSubtaskSessions.markEnded(active.id)
	// blocked/stalled로 빨간 도움요청 점이 뜬 서브태스크를 advanceSubtaskWork를 거치지 않고 여기로
	// 바로 끄면(§ reportSubtaskBlocked/checkStalledSubtasks) 세션은 죽었는데 표시만 그대로 남아
	// 계속 "도움 요청"으로 보인다 — 세션이 끝난 이상 더는 유효한 신호가 아니니 같이 지운다.
	const st = StoreSubtasks.get(subtaskId)
	const task = st ? StoreTasks.get(st.task_id) : null
	if (task && task.folder_id) {
		const s = states.get(task.folder_id)
		if (s) {
			delete s.blocked[subtaskId]
			delete s.stalled[subtaskId]
		}
	}
	return { ok: true }
}

// 태스크 상세페이지(+SubtaskSessionPane 탭 오픈, +지휘자의 get_subtask_chain MCP 툴)가 폴링해 보여줄
// 상태 — 서브태스크별로 지금 세션이 실제로 살아있는지까지 확인한다. "세션이 바뀌면 안 돼" — 끝난
// 것(ended_at)도 아닌데 안 살아있으면(서버 재시작·컴퓨터 재부팅 등으로 죽은 것) alive:false만 보고하고
// 끝내지 않는다 — 여기서 바로 복원을 시도한다. 호출부(SubtaskSessionPane)가 alive:false를 "아직 워크트리
// 없음"과 구분 못 해 그냥 새 세션을 만들어버리던 게 원래 버그였다 — 상태를 물어보는 이 함수 자체가
// 먼저 복원해두면 호출부는 그냥 결과(alive:true)만 보고 그 세션에 붙으면 된다.
async function getSubtaskWorkState(taskId) {
	const subtasks = StoreSubtasks.listByTask(taskId)
	let live = await Term.list().catch(() => [])
	// "업무가 멈추든" — reportSubtaskBlocked가 폴더 state에 심어둔 표시를 이미 폴링되는 이 응답에
	// 얹는다(새 폴링 엔드포인트 불필요). 아직 폴더에 안 들어간 태스크면 blocked 볼 게 없으니 빈 맵.
	const task = StoreTasks.get(taskId)
	const folderState = task && task.folder_id ? states.get(task.folder_id) : null
	const blockedMap = folderState?.blocked || {}
	const stalledMap = folderState?.stalled || {}
	const result = []
	for (const st of subtasks) {
		const session = StoreSubtaskSessions.latestForSubtask(st.id)
		const branch = StoreBranches.listBySubtask(st.id)[0] || null
		if (session && !session.ended_at && !isLive(live, session.tmux_session)) {
			const restored = await restoreByName(session.tmux_session).catch(() => null)
			if (restored) live = await Term.list().catch(() => [])
		}
		result.push({
			id: st.id,
			name: st.name,
			started: !!session,
			alive: !!session && !session.ended_at && isLive(live, session.tmux_session),
			// "서브태스크가 완료되면 초록색 동그라미에 체크표시로" — ended_at은 advanceSubtaskWork가 이
			// 서브태스크를 명시적으로 다음 단계로 넘길 때만 찍힌다(§ 위 주석 "세션이 바뀌면 안 돼") — 그냥
			// 세션이 죽은 것(재시작 등, ended_at 없음)과 실제로 끝나서 다음으로 넘어간 것을 구분하는 진짜 신호.
			done: !!(session && session.ended_at),
			blocked: !!blockedMap[st.id],
			blockedReason: blockedMap[st.id] || null,
			stalled: !!stalledMap[st.id],
			tmuxSession: session ? session.tmux_session : null,
			worktreePath: session ? session.worktree_path : null,
			branch: branch ? branch.name : null,
			// "이 html파일은 해당 서브태스크 상세에서 계속 볼 수 있도록해줘" — 완료 시 저장된 리포트가
			// 있으면(§ advanceSubtaskWork) 서빙 URL을, 없으면 null(버튼 자체를 안 보여줌).
			reportUrl: session && session.report_html ? `/api/subtask-sessions/${session.id}/report` : null,
		})
	}
	return { ok: true, subtasks: result }
}

// folderId → { running, currentWaveIndex, sessions:[{taskId,tmuxSession,worktreePath}], log:[{t,dot,at}],
//              conductor:{session,model,startedAt}|null, feed:[{ts,from,to,text,kind}] }
const states = new Map()
// folderId currently inside start() — guards a concurrent double-start (e.g. double-click) from
// racing on the same task's Worktrees.ensure()/create() (git worktree add is not safe to run twice
// in parallel for the same path/branch). Frontend also disables the button, this is belt-and-suspenders.
const starting = new Set()

function blank() {
	// blocked: subtaskId → reason(§ reportSubtaskBlocked). stalled: subtaskId → true(§ checkStalledSubtasks).
	// 둘 다 같은 원칙(인메모리, 폴더당 하나, DB 영속화 불필요 — 재시작하면 그 서브태스크가 다시
	// 물어보거나 다시 감지되면 됨).
	return { running: false, currentWaveIndex: 0, sessions: [], log: [], conductor: null, feed: [], blocked: {}, stalled: {} }
}
function getState(folderId) {
	return states.get(folderId) || blank()
}
// 태스크 하나가 속한 (어느 폴더인지 몰라도) 현재 활성 세션 — PR 리뷰 "적용"이 지시를 보낼 대상 찾기용.
function findSessionForTask(taskId) {
	for (const s of states.values()) {
		const hit = s.sessions.find((x) => x.taskId === taskId)
		if (hit) return hit
	}
	return null
}
function ensureState(folderId) {
	let s = states.get(folderId)
	if (!s) {
		s = blank()
		states.set(folderId, s)
	}
	return s
}
function pushLog(s, t, dot) {
	s.log.push({ t, dot: dot || 'violet', at: Date.now() })
	if (s.log.length > 200) s.log.splice(0, s.log.length - 200) // 로그 캡
}
// 기록된 세션이 (리네임 포함) 아직 살아있는지 — cmux/claude가 세션명을 바꾸므로 baseName으로도 매칭.
function isLive(live, name) {
	return live.some((x) => x.name === name || Term.baseName(x.name) === Term.baseName(name))
}

async function start(folderId) {
	if (starting.has(folderId)) return { ok: false, error: '이미 시작 중입니다 — 잠시 후 다시 시도하세요.' }
	starting.add(folderId)
	try {
		const folder = StoreFolders.get(folderId)
		if (!folder) return { ok: false, error: 'folder not found' }
		const tasks = StoreTasks.listByFolder(folderId) // order_idx ASC = 웨이브 순서
		if (!tasks.length) return { ok: false, error: '폴더에 태스크가 없습니다.' }
		const s = ensureState(folderId)
		// "로딩이 돌길래 알아서 동작하고 있는줄 알았는데... 태스크 매니저를 접속해보니 이제야 클로드
		// 세션이 켜지고있어" — 지휘자(태스크 매니저)는 이 탭을 처음 열 때만 지연 시작하던 별도 세션이라,
		// 서브태스크 코딩 세션(스피너의 실체)은 이미 돌고 있는데 정작 지휘자는 콜드 스타트로 체감됐다.
		// 아래 서브태스크 기동과 동시에(대기 없이 병렬로) 같이 켜서, 탭을 열 때는 이미 돌고 있게 한다.
		const conductorStarting = startConductor(folderId).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
		const live = await Term.list().catch(() => [])
		for (const task of tasks) {
			// 이전 start에서 만든 세션이 아직 살아있으면 재사용(중복 생성 금지)
			const existing = s.sessions.find((x) => x.taskId === task.id)
			if (existing && isLive(live, existing.tmuxSession)) {
				pushLog(s, `재사용: "${task.name}" → ${existing.tmuxSession}`, 'blue')
				continue
			}
			// 레포는 이제 폴더 단위 — folder.repo_id가 우선이고, 이 마이그레이션 이전에 만들어진 폴더라
			// repo_id가 비어있으면 태스크에 남아있던 값으로 폴백(하위호환, 백필 없이도 계속 동작).
			const repo = StoreRepos.get(resolveRepoId({ folder, task }))
			if (task.repo_auto && repo && !repoAssignmentLooksRight(task, repo)) {
				StoreDecisions.record({
					folderId,
					taskId: task.id,
					kind: 'repo_verify_hold',
					reason: `AI가 자동배정한 레포(${repo.name})와 태스크명 사이에 겹치는 키워드가 없어 재확인이 필요합니다.`,
					meta: { repoId: repo.id, repoName: repo.name },
				})
				pushLog(s, `⚠️ 레포 배정 재확인 필요: "${task.name}" → ${repo.name} (키워드 안 겹침)`, 'amber')
			}
			// "메인태스크에서는 업무를 터미널로 시작하지말고. 워크트리를 만들고 시작하자. 메인태스크는
			// 오케스트레이션만 진행하는걸로." — 태스크 자신은 이제 절대 자기 워크트리·터미널을 직접 갖지
			// 않는다. 실제 코드 작업은 언제나 이 태스크의 서브태스크 체인(launchSubtask)에게 맡긴다 —
			// 서브태스크가 없으면 ensureWorkUnitSubtasks가 즉석에서 만들고(AI 검토 workUnits, 없으면
			// 태스크 자신을 그대로 옮겨담은 서브태스크 1개), 그 첫 서브태스크의 워크트리+세션을 띄운다.
			// launchSubtask가 s.sessions 동기화까지 처리하므로 여기서 따로 안 건드린다.
			const r = await startSubtaskWork(task.id)
			if (!r.ok) {
				pushLog(s, `세션 시작 실패: "${task.name}" — ${r.error}`, 'amber')
				continue
			}
			if (!folder.base && r.base) {
				StoreFolders.update(folderId, { base: r.base })
				folder.base = r.base
			}
			pushLog(s, r.already ? `재사용: "${task.name}" → ${r.tmuxSession}` : `투입: "${task.name}" → 서브태스크 "${r.subtaskName}" (${r.tmuxSession})`, r.already ? 'blue' : 'green')
		}
		// 실제로 세션이 하나라도 떴을 때만 running(정직한 상태 — advance가 헛돌지 않게). 스펙의 "running=true"는 정상경로.
		s.running = s.sessions.length > 0
		s.currentWaveIndex = 0
		pushLog(s, `오케스트레이션 시작 — ${s.sessions.length}개 세션 (총 ${tasks.length}개 태스크)`, 'violet')
		await conductorStarting
		return { ok: true, ...getState(folderId) }
	} finally {
		starting.delete(folderId)
	}
}

async function advance(folderId) {
	const s = states.get(folderId)
	if (!s || !s.running) return { ok: false, error: '오케스트레이션이 실행 중이 아닙니다. 먼저 start 하세요.' }
	if (!s.sessions.length) return { ok: false, error: '진행할 세션이 없습니다.' }
	// 현재 웨이브 태스크 세션에 "계속 진행" nudge — Actuator.dispatch 재사용(raw send-keys 직접 안 함).
	// 리네임 대비: 라이브 목록에서 baseName 매칭으로 실제 세션명을 다시 찾는다.
	const cur = s.sessions[Math.min(s.currentWaveIndex, s.sessions.length - 1)]
	let dispatched = false
	if (cur) {
		const live = await Term.list().catch(() => [])
		const match = live.find((x) => x.name === cur.tmuxSession || Term.baseName(x.name) === Term.baseName(cur.tmuxSession))
		const target = match ? match.name : cur.tmuxSession
		const d = await Actuator.dispatch({ session: target, message: '계속 진행해줘.', dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
		dispatched = !!d.ok
		pushLog(s, dispatched ? `▶ 진행 지시 → ${target}` : `진행 지시 실패 → ${target}: ${d.error || ''}`, dispatched ? 'blue' : 'amber')
	}
	// 다음 웨이브로 (수동 진행 — 완료 자동감지는 범위 밖)
	if (s.currentWaveIndex < s.sessions.length - 1) s.currentWaveIndex += 1
	pushLog(s, `웨이브 인덱스 → ${s.currentWaveIndex}`, 'violet')
	return { ok: true, dispatched, ...getState(folderId) }
}

async function stop(folderId) {
	const s = states.get(folderId)
	if (!s) return { ok: true, ...blank() }
	for (const sess of s.sessions) {
		await Term.kill(sess.tmuxSession).catch(() => {})
		pushLog(s, `세션 종료: ${sess.tmuxSession}`, 'amber')
	}
	s.running = false
	s.sessions = [] // 죽은 세션 참조 정리 (log는 히스토리로 보존)
	s.currentWaveIndex = 0
	pushLog(s, '오케스트레이션 정지', 'violet')
	return { ok: true, ...getState(folderId) }
}

// ── 지휘자(conductor) — 오케스트레이터 자체의 클로드 세션 (Phase 3.4) ──
// orch.cjs(구 그룹-지휘자)와 같은 발상(지휘자 세션이 OpenRM API 경유로 서브를 조율, 대화를 피드에
// 기록)이지만, 여기서는 group 문자열이 아니라 실제 folderId/taskId로 정확히 찾는다(퍼지 매칭 불필요 —
// states의 sessions 배열이 이미 taskId→tmuxSession을 정확히 알고 있음). 새 서브태스크를 직접 만드는
// 권한은 주지 않는다 — 있는 서브에게 지시만 전달(dispatch)하고 결과를 기록한다.
function pushFeed(s, { from, to, text, kind }) {
	s.feed.push({ ts: Date.now(), from: from || 'orch', to: to || 'orch', text: String(text || '').slice(0, 500), kind: kind || 'msg' })
	if (s.feed.length > 120) s.feed.splice(0, s.feed.length - 120)
}

function conductorSeed(folder, tasks, cwd) {
	const port = process.env.OPENRM_PORT || 8770
	const operator = Settings.operatorName()
	const list = tasks.map((t) => `- ${t.id}: ${t.name}${t.desc ? ' — ' + t.desc : ''}`).join('\n') || '(아직 태스크 없음)'
	const repo = StoreRepos.get(resolveRepoId({ folder }))
	const rulePairs = [
		['이 태스크만의 특별 규칙 — 같은 레포의 다른 태스크에는 안 쓰인다', folder && folder.rule_task],
		['일반 규칙', repo && repo.rule_general],
		['태스크 작성 규칙 — 서브태스크를 만들거나 다듬을 때 따른다', repo && repo.rule_task_writing],
	]
	const rules = teamRulesSection(rulePairs)
	const reminder = teamRulesReminder(rulePairs, '절대 잊지 마라 — 특히 서브태스크에 지시를 내릴 때마다.')
	return `[역할: "${folder.name}" 태스크 매니저] 너는 OpenRM에서 이 태스크의 진행을 관리하는 태스크 매니저야. ${operator}가 너와 직접 대화한다. 바로 실행하지 말고 계획부터 보고하고 승인받아.${rules}

■ 언어: ${operator}가 쓰는 언어에 맞춰 답변해라 — 영어로 물으면 영어로, 한국어로 물으면 한국어로.

■ 아주 중요한 원칙 — 너 자신은 절대 코드를 직접 작성하지 않는다. 지금 이 세션(cwd: ${cwd})은 실제
레포 워킹카피가 아니라 이 태스크 전용 오케스트레이션 자리다(다른 태스크의 매니저와 절대 안 겹침). 실제
코드 작업은 전부 아래 서브태스크 체인 툴로 만든 "서브태스크"의 자기 워크트리 안에서만 일어난다 — 너는
그 체인을 시작·확인·진행시키기만 한다.

■ 이 폴더의 태스크 목록 (taskId: 이름):
${list}

■ 태스크 하나의 실제 작업 진행 — get_subtask_chain / start_subtask_work / advance_subtask_work (taskId만 넘기면 됨):
0. ${rules ? '위 팀 규칙이 있으면 아래 단계를 진행하기 전에 다시 한번 확인해라 — 서브태스크를 만들거나 진행시킬 때마다 그 규칙에 맞는지 스스로 점검한다.' : '(이 레포엔 등록된 팀 규칙이 없다 — 특별한 제약 없이 진행)'}
1. get_subtask_chain({taskId})로 지금 서브태스크 체인 상태(뭐가 있고, 어느 게 살아있고, 워크트리·브랜치가
   뭔지)를 먼저 확인해라.
2. 서브태스크가 하나도 없거나 전부 아직 시작 전이면 start_subtask_work({taskId})로 첫 서브태스크의
   워크트리+세션을 띄운다(서브태스크가 없으면 AI 검토의 workUnits로, 그것도 없으면 태스크 자신으로
   자동 생성됨).
3. 서브태스크가 실제로 다 끝나면 그 서브태스크 세션 자신이 advance_subtask_work를 호출해 스스로
   다음 단계로 넘기고, 그 결과가 네 이 화면(pty)에 직접 타이핑돼 들어온다 — 네가 advance_subtask_work를
   먼저 호출해 판단할 필요는 없다(과거엔 그래야 했지만 지금은 아니다). 통보가 의심스럽거나 한참
   조용하면 get_subtask_chain/dispatch_subtask로 직접 확인해라.
   막힌 서브태스크가 있으면(도움요청 통보가 오거나 조용해서 확인해보니 막혀있으면) dispatch_subtask로
   맥락을 주거나 ${operator}에게 물어봐서 풀어줘라.
4. 모든 서브태스크가 끝나면(마지막 단계 완료 통보가 옴) ${operator}에게 완료를 보고해.

■ 서브에게 말 걸기·기록은 반드시 OpenRM API/MCP 경유(관측·대화 로그 기록용) — tmux로 직접 하지 마.
MCP 툴 dispatch_subtask/log_event/set_subtask_kind가 있으면(도구 목록 확인) 그걸 우선 써. 없거나
호출이 실패하면 아래 curl로 폴백해:
- 지금 진행 중인 서브태스크에 지시: curl -s -X POST http://localhost:${port}/api/folders/${folder.id}/conductor/say -H 'Content-Type: application/json' -d '{"taskId":"<위 목록의 taskId>","text":"<지시>"}'
- 결과/진행을 받으면 기록: curl -s -X POST http://localhost:${port}/api/folders/${folder.id}/conductor/event -H 'Content-Type: application/json' -d '{"from":"<taskId>","to":"orch","text":"<요약>","kind":"result"}'
- 큰 결정/계획을 ${operator}와 공유: curl -s -X POST http://localhost:${port}/api/folders/${folder.id}/conductor/event -H 'Content-Type: application/json' -d '{"from":"orch","to":"${operator}","text":"<계획/보고>","kind":"plan"}'
- 서브태스크 체인 시작/진행: curl -s -X POST http://localhost:${port}/api/tasks/<taskId>/subtask-work/start (또는 /advance)
- 체인 상태 확인: curl -s http://localhost:${port}/api/tasks/<taskId>/subtask-work/state
- kind(진행 방식) 판단·수정: curl -s -X POST http://localhost:${port}/api/folders/${folder.id}/conductor/set-kind -H 'Content-Type: application/json' -d '{"taskId":"<위 목록의 taskId>","kind":"single|chain|parallel","reason":"<왜 이 kind인지 한 줄>"}' — 이전 산출물 위에 이어서 작업해야 하면 chain, 서로 독립적이라 동시에 여러 버전을 시도해볼 만하면 parallel, 그 외엔 single. reason은 필수.

■ 앱 내부 브라우저 — MCP 툴 browser_open/browser_read/browser_click/browser_type/browser_close가 있으면
(도구 목록 확인) 자유롭게 써서 웹을 직접 확인해라. 링크를 열어 내용을 읽거나(예: 배포 로그, 외부 문서),
폼을 채우거나, 스크린샷 없이 텍스트만으로 페이지를 파악하고 싶을 때 쓴다. 이건 너만 보는 별도의
headless 세션이다 — ${operator}가 이 폴더의 "브라우저" 탭을 열어도 네 화면이 자동으로 보이지 않는다
(그쪽은 사람이 직접 조작하는 별개의 브라우저). ${operator}에게 뭔가 보여주고 싶으면 "브라우저 탭에
띄워놨어" 같은 말은 하지 말고, browser_read로 읽은 내용을 네가 직접 요약해서 말로 보고해라.

■ 원칙: 태스크 목표를 이해하고, 서브태스크별 진행 상황을 확인하고, 결과를 검증·종합해서 ${operator}에게
보고해. 지금 상황을 파악해 계획을 ${operator}에게 보고해줘.${reminder ? `\n\n■ ${reminder}` : ''}`
}

// "세션이 바뀌면 안 돼 — 강제로 꺼져도 그렇고" — tmux 제거로 세션이 이제 서버 프로세스의 자식이라
// 서버 재시작(코드 배포·컴퓨터 종료 등)에 세션도 같이 죽는다. 같은 자리에 새 세션을 또 만들기 전에,
// 정확히 그 세션 이름(스냅샷 키 그대로)으로 claude --continue 복원을 먼저 시도한다 — 워크트리가
// 지워졌거나 스냅샷이 없으면 조용히 null(호출부가 새로 만듦).
//
// 예전엔 라벨(사람이 보는 이름, 예: 서브태스크명/폴더명)로 스냅샷을 다시 찾았는데, 그 이름을 나중에
// 리네임하면(예: 서브태스크 제목 수정) 스냅샷에 저장된 옛 라벨과 안 맞아 복원이 조용히 실패하고 매번
// 새 세션이 생겼다("이전에 하던 세션이 아닌 새로운 세션이 나왔어" 버그의 근본 원인). 호출부가 이미
// DB에 안 변하는 진짜 세션 이름(tmux_session)을 갖고 있으니, 그걸 정확한 키로 바로 찾는다.
async function restoreByName(name) {
	const r = await Term.restore({ name }).catch(() => null)
	const result = r && r.results && r.results[0]
	return result && result.ok ? result : null
}

// "엉뚱한 세션을 물고있어" — 모든 지휘자가 똑같이 C.REPO를 cwd로 썼다. claude --continue는 "이
// cwd에서 가장 최근 대화"를 이어받으므로, 지휘자가 여러 개(폴더마다 하나)면 전부 같은 cwd를 공유해
// 서로 다른 폴더의 지휘자를 복원해도 completely 무관한 대화(심지어 다른 태스크의 지휘자 대화)를
// 이어받는 사고가 났다. 폴더마다 실제로는 아무 파일도 없는 전용 빈 디렉토리를 하나씩 줘서(git 저장소일
// 필요 없음 — claude는 아무 디렉토리에서나 동작) --continue가 그 폴더의 지휘자 대화만 정확히 찾게 한다.
const CONDUCTOR_CWD_ROOT = path.join(__dirname, '..', '.openrm', 'conductor-cwds')
function conductorCwd(folderId) {
	const dir = path.join(CONDUCTOR_CWD_ROOT, folderId)
	fs.mkdirSync(dir, { recursive: true })
	// 독립 git 저장소화 — trustFolder가 쓰는 gitRoot()이 모노레포 최상위로 안 올라가게 한다(폴더별로는
	// 이미 folderId로 유일하지만, git 저장소가 아니면 gitRoot()이 위로 계속 올라가 결국 모노레포
	// 루트로 수렴해 인스턴스 간 MCP 포트 등록이 서로 덮어써진다 — §term.cjs ensureOwnGitRoot 참고).
	Term.ensureOwnGitRoot(dir)
	return dir
}

// "엉뚱한 세션을 물고있어" — 모든 지휘자가 똑같이 C.REPO를 cwd로 썼던 시절의 낡은 스냅샷은 옛 공유
// cwd를 갖고 있어, 그 cwd로 복원하면 다른 지휘자의 대화를 물어온다. 그래서 스냅샷의 cwd는 절대 안
// 믿는다 — 실제 복원은 항상 지금의 conductorCwd(folder.id)로 직접 만든다("claude --continue"는 이
// cwd 기준으로 대화를 이어받는다). 여기 아래 두 확인은 "그 cwd에 이어받을 대화가 있을 것 같은지"를
// 판단하는 용도일 뿐이다.
//
// "세션이 바뀌면 안 돼" — 예전엔 이 판단을 folder.name으로 다시 지어낸 라벨("conductor-${folder.name}")
// 로 했는데, 폴더 이름을 나중에 바꾸면 그 라벨이 옛 스냅샷과 안 맞아 "한 번도 시작 안 한 폴더"로
// 오판하고 --continue 시도 자체를 건너뛰어버렸다(서브태스크 쪽과 같은 근본 버그 — restoreByName 참고).
// folder.conductor_session(§ db.cjs v24, 한 번 시작되면 절대 안 바뀌는 값)이 있으면 그걸로 판단하고,
// 아직 없는(v24 이전) 레거시 폴더만 옛 라벨 방식으로 폴백한다.
async function conductorEverStarted(folder) {
	if (folder.conductor_session) return true
	const items = await Term.restorable().catch(() => [])
	return items.some((r) => r.kind === 'agent' && r.label === `conductor-${folder.name}`)
}
async function restoreConductorSession(folder) {
	if (!(await conductorEverStarted(folder))) return null
	const cwd = conductorCwd(folder.id)
	const model = Settings.modelFor('orchestrator')
	// "태스크 매니저가 직접 개발했어... 개선이 필요해" — --continue가 실제로 이어받을 대화를 못 찾으면
	// (conductorCwd가 새 디렉토리라 흔함) term.cjs가 그 자리에 seed 없이 맨 claude를 새로 띄우기만
	// 했었다 — "너는 코드를 직접 안 쓰고 서브태스크에 위임만 한다"는 역할 지시 자체가 한 번도 전달되지
	// 않아, 그냥 평범한 코딩 에이전트처럼 직접 다 구현해버린 게 근본 원인이었다. --continue가 실패해
	// 새로 켜지는 경우에 한해 이 역할 시드를 주입하도록 넘긴다(성공적으로 이어받으면 이미 그 대화
	// 안에 이 지시가 있으니 다시 안 넣는다).
	const tasks = StoreTasks.listByFolder(folder.id)
	const t = await Term.create({ cwd, command: 'claude --continue', label: `conductor-${folder.name}`, model, mcpFolderId: folder.id, continueFallbackSeed: conductorSeed(folder, tasks, cwd) })
	if (t.ok) StoreFolders.update(folder.id, { conductorSession: t.name })
	return t.ok ? t : null
}

// "맥북 껏다킬거야. 세션전부 다시 살아나고 태스크도 살아나야해" — 예전엔 그 태스크 탭을 직접 열어야만
// (OrchestratorPane의 자동시작 useEffect) 그 자리에서 복원됐다(지연 복원). 서버가 뜨는 순간 이미
// 살아있었던 세션(스냅샷은 있는데 지금 안 살아있는 것)을 전부 한 번에 복원한다 — 단, "아직 한 번도
// 시작 안 한" 지휘자/서브태스크까지 새로 만들지는 않는다(그건 사람이 직접 시작해야 하는 행동).
async function restoreConductorIfSnapshotted(folder) {
	const s = ensureState(folder.id)
	const live = await Term.list().catch(() => [])
	if (s.conductor && isLive(live, s.conductor.session)) return
	const restored = await restoreConductorSession(folder)
	if (!restored) return
	const model = Settings.modelFor('orchestrator')
	const modelLabel = Settings.modelLabelFor('orchestrator')
	s.conductor = { session: restored.name, model, modelLabel, startedAt: Date.now(), cwd: conductorCwd(folder.id) }
	pushFeed(s, { from: 'orch', to: Settings.operatorName(), text: `태스크 매니저 세션 복원 (${modelLabel}) — 컴퓨터 재시작 후 자동 복원.`, kind: 'plan' })
}
async function restoreSubtasksIfSnapshotted(task) {
	const subtasks = StoreSubtasks.listByTask(task.id)
	const live = await Term.list().catch(() => [])
	for (const st of subtasks) {
		const active = StoreSubtaskSessions.getActiveForSubtask(st.id)
		if (!active || isLive(live, active.tmux_session)) continue // 시작한 적 없거나 이미 살아있음
		const restored = await restoreByName(active.tmux_session)
		if (!restored) continue
		StoreSubtaskSessions.create({ subtaskId: st.id, taskId: task.id, tmuxSession: restored.name, worktreePath: active.worktree_path, branch: active.branch, model: active.model, modelLabel: active.model_label })
		syncFolderSession(task, { taskId: task.id, tmuxSession: restored.name, worktreePath: active.worktree_path, model: active.model, modelLabel: active.model_label })
	}
}
async function restoreAllOnBoot() {
	const folders = StoreFolders.list()
	let restoredCount = 0
	for (const folder of folders) {
		const before = ensureState(folder.id).conductor
		await restoreConductorIfSnapshotted(folder).catch(() => {})
		if (!before && ensureState(folder.id).conductor) restoredCount++
		const tasks = StoreTasks.listByFolder(folder.id)
		for (const task of tasks) {
			await restoreSubtasksIfSnapshotted(task).catch(() => {})
		}
		// "메인 태스크 진행중 표기가 안나와" — restoreSubtasksIfSnapshotted가 syncFolderSession으로
		// s.sessions는 채워주지만, running 자체는 start()/stop()에서만 손대는 별도 플래그라 여기선
		// 한 번도 안 켜졌다. 서버 재시작(코드 배포 등)마다 이미 돌던 메인 태스크의 스피너가 꺼진 채로
		// 보이던 원인 — start()와 같은 기준(세션이 하나라도 있으면 running)으로 여기서도 맞춰준다.
		ensureState(folder.id).running = ensureState(folder.id).sessions.length > 0
	}
	return { ok: true, folders: folders.length, restoredConductors: restoredCount }
}

async function startConductor(folderId) {
	const folder = StoreFolders.get(folderId)
	if (!folder) return { ok: false, error: 'folder not found' }
	const s = ensureState(folderId)
	const live = await Term.list().catch(() => [])
	if (s.conductor && isLive(live, s.conductor.session)) return { ok: true, already: true, ...s.conductor }
	const tasks = StoreTasks.listByFolder(folderId)
	const model = Settings.modelFor('orchestrator')
	// modelLabelFor('orchestrator')는 fableLock 때문에 fable→opus로 바뀐 경우 "(비용 잠금)"을 붙여준다
	// (§06 — 화면엔 그냥 "Opus 4.8"로만 보여서 왜 지휘자가 Fable이 아닌지 헷갈리는 문제).
	const modelLabel = Settings.modelLabelFor('orchestrator')
	const cwd = conductorCwd(folderId)
	const label = `conductor-${folder.name}`
	const restored = await restoreConductorSession(folder)
	if (restored) {
		s.conductor = { session: restored.name, model, modelLabel, startedAt: Date.now(), cwd }
		pushFeed(s, { from: 'orch', to: Settings.operatorName(), text: `태스크 매니저 세션 복원 (${modelLabel}) — 직전 대화를 이어받습니다.`, kind: 'plan' })
		return { ok: true, ...s.conductor }
	}
	const t = await Term.create({ cwd, command: 'claude', label, seed: conductorSeed(folder, tasks, cwd), model, mcpFolderId: folderId })
	if (!t.ok) return { ok: false, error: t.error }
	StoreFolders.update(folderId, { conductorSession: t.name }) // "세션이 바뀌면 안 돼" — § db.cjs v24
	s.conductor = { session: t.name, model, modelLabel, startedAt: Date.now(), cwd }
	pushFeed(s, { from: 'orch', to: Settings.operatorName(), text: `태스크 매니저 세션 투입 (${modelLabel}) — 서브태스크 ${tasks.length}건. 계획 수립 중…`, kind: 'plan' })
	return { ok: true, ...s.conductor }
}

async function stopConductor(folderId) {
	const s = states.get(folderId)
	if (!s || !s.conductor) return { ok: true }
	await Term.kill(s.conductor.session).catch(() => {})
	pushFeed(s, { from: 'orch', to: Settings.operatorName(), text: '태스크 매니저 세션 종료', kind: 'msg' })
	s.conductor = null
	return { ok: true }
}

// 지휘자(conductor 세션 자신)가 curl로 호출 — 특정 서브태스크 세션에 지시 전달.
async function conductorSay(folderId, taskId, text) {
	if (!taskId || !text) return { ok: false, error: 'taskId·text 필수' }
	const s = states.get(folderId)
	if (!s) return { ok: false, error: '오케스트레이션 상태 없음' }
	const target = s.sessions.find((x) => x.taskId === taskId)
	if (!target) {
		pushFeed(s, { from: 'orch', to: taskId, text: `(전달 실패: 세션 없음) ${text}`, kind: 'error' })
		return { ok: false, error: `taskId ${taskId}의 세션이 없습니다.` }
	}
	const d = await Actuator.dispatch({ session: target.tmuxSession, message: text, dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
	pushFeed(s, { from: 'orch', to: taskId, text, kind: d.ok ? 'dispatch' : 'error' })
	return d.ok ? { ok: true, session: target.tmuxSession } : { ok: false, error: d.error }
}

// 운영자(=사람, UI)가 지휘자 세션에 직접 말 걸기.
async function conductorTell(folderId, text) {
	if (!text) return { ok: false, error: 'text 필수' }
	const s = states.get(folderId)
	if (!s || !s.conductor) return { ok: false, error: '태스크 매니저 세션이 없습니다(먼저 시작).' }
	const live = await Term.list().catch(() => [])
	const match = live.find((x) => x.name === s.conductor.session || Term.baseName(x.name) === Term.baseName(s.conductor.session))
	if (!match) return { ok: false, error: '태스크 매니저 세션이 죽었습니다.' }
	const d = await Actuator.dispatch({ session: match.name, message: text, dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
	pushFeed(s, { from: Settings.operatorName(), to: 'orch', text, kind: 'msg' })
	return d.ok ? { ok: true } : { ok: false, error: d.error }
}

// "메인 태스크와 서브 태스크가 서로 대화를 안 하거든" — 세 다리 중(사람→지휘자=conductorTell,
// 지휘자→서브태스크=conductorSay) 서브태스크→지휘자만 없었다. conductorTell과 완전히 같은
// 메커니즘(지휘자 pty에 실제로 타이핑)을 서브태스크/시스템 보고용으로 재사용 — 완료/막힘/침묵형
// 막힘 세 가지 보고 상태가 전부 이 함수 하나를 거친다.
async function notifyConductor(folderId, fromLabel, text, kind) {
	const s = states.get(folderId)
	if (!s || !s.conductor) return { ok: false, error: '태스크 매니저 세션이 없습니다.' }
	const live = await Term.list().catch(() => [])
	const match = live.find((x) => x.name === s.conductor.session || Term.baseName(x.name) === Term.baseName(s.conductor.session))
	if (!match) return { ok: false, error: '태스크 매니저 세션이 죽었습니다.' }
	const d = await Actuator.dispatch({ session: match.name, message: text, dryRun: false }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
	pushFeed(s, { from: fromLabel, to: 'orch', text, kind })
	return d.ok ? { ok: true } : { ok: false, error: d.error }
}

// 지휘자(또는 사람) → 대화 피드에 이벤트 기록만 (실제 전송 없음, 지휘자의 "결과 기록"/"계획 공유" 용도).
function conductorEvent(folderId, { from, to, text, kind }) {
	const s = ensureState(folderId)
	pushFeed(s, { from, to, text, kind })
	return { ok: true }
}

function conductorFeed(folderId) {
	const s = states.get(folderId)
	return { ok: true, feed: (s && s.feed) || [] }
}

// ⑤ kind 판단 — 지휘자(conductor 세션)가 curl로 호출. subTask 자체를 새로 만드는 게 아니라(그 권한은
// conductorSeed()가 명시적으로 금지), 이미 있는 subTask의 kind(single/chain/parallel)만 판단·수정한다
// — "AI는 범위를 스스로 만들지 않는다" 원칙과 충돌하지 않음("범위 안에서 어떻게 실행할지"만 다룸).
// 근거는 매번 강제로 남긴다(②와 같은 원칙) — feed(휘발성) + decisions(영속) 둘 다에 기록.
function conductorSetKind(folderId, taskId, kind, reason) {
	if (!taskId || !kind) return { ok: false, error: 'taskId·kind 필수' }
	if (!['single', 'chain', 'parallel'].includes(kind)) return { ok: false, error: `알 수 없는 kind: ${kind}` }
	const task = StoreTasks.get(taskId)
	if (!task) return { ok: false, error: 'task not found' }
	const prevKind = task.kind
	StoreTasks.update(taskId, { kind })
	StoreDecisions.record({ folderId, taskId, kind: 'kind_judge', reason: reason || '(근거 없음)', meta: { from: prevKind, to: kind } })
	const s = ensureState(folderId)
	pushFeed(s, { from: 'orch', to: Settings.operatorName(), text: `kind 판단: "${task.name}" ${prevKind} → ${kind} — ${reason || '(근거 없음)'}`, kind: 'plan' })
	return { ok: true, task: StoreTasks.get(taskId) }
}

module.exports = {
	start,
	advance,
	stop,
	getState,
	findSessionForTask,
	startConductor,
	stopConductor,
	conductorSay,
	conductorTell,
	conductorEvent,
	conductorFeed,
	conductorSetKind,
	startSubtaskWork,
	advanceSubtaskWork,
	reportSubtaskBlocked,
	checkStalledSubtasks,
	stopSubtaskSession,
	getSubtaskWorkState,
	restoreAllOnBoot,
}
