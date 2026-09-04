// control.cjs — "관제" 에이전트: 태스크 하나가 아니라 OpenTask 앱 전체(캘린더 일정, 크론잡, 운영
// 설정)를 대화로 조작하는 별도의 최상위 세션. orchestrator.cjs의 conductor 패턴(Term.create + seed
// + MCP 툴)을 그대로 따르되, git worktree가 아니라 이 앱 자체가 대상이라 특정 폴더에 묶이지 않는다
// (§"오케스트레이터의 기준이 어려워" — 태스크 지휘자와 이름·자리를 분리해서 혼동을 없앤다).
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const Term = require('./term.cjs')
const Settings = require('./settings.cjs')
const Notify = require('./notify.cjs')
const Transcript = require('./transcript.cjs') // projectDirFor — claude CLI의 대화 기록 위치(§ hasResumableConversation)

const CLAUDE_CONFIG_PATH = process.env.OPENRM_CLAUDE_CONFIG || path.join(os.homedir(), '.claude.json')
// "비서 껏다키면 이전에 명령한것 지워져" — CONTROL_CWD가 앱 루트 자체였던 시절엔, 이 코드베이스에서
// 작업 중인 무관한 개발 세션들과 claude --continue의 "이 cwd에서 가장 최근 대화" 탐색 범위를 공유했다.
// conductor가 이미 겪고 고친 것과 완전히 같은 버그다(§ orchestrator.cjs conductorCwd 위 "엉뚱한
// 세션을 물고있어" 주석) — 전용 빈 디렉토리를 줘서 --continue가 절대 다른 세션과 안 섞이게 한다.
// 포트별로 디렉토리를 분리 + 독립 git 저장소화 — 여러 인스턴스가 동시에 떠도 gitRoot()이 서로
// 다른 값을 반환해 ~/.claude.json MCP 등록(registerControlMcp)이 인스턴스끼리 안 덮어쓴다
// (§term.cjs ensureOwnGitRoot 주석 — 비서가 실제 앱 포트/DB를 건드릴 뻔한 사고로 확인된 버그).
//
// __dirname 기준이면 안 된다 — 패키징된 앱은 이 파일이 app.asar.unpacked(마운트된 읽기전용 DMG
// 볼륨 위) 안에 있어, 여기 mkdirSync가 ENOENT로 실행 자체를 막는다(v0.1.4에서 실제 재현: 이전
// 빌드 산출물에 우연히 남아있던 폴더 덕에 v0.1.3까지는 안 드러났을 뿐인 잠재 버그). db.cjs의
// DATA_DIR과 동일하게 OPENRM_DATA_DIR(Electron이 app.getPath('userData')로 세팅, 항상 쓰기 가능)을
// 우선 쓰고, 그게 없는 순수 dev 모드(`npm run dev`/`start`)에서만 기존 레포-상대 경로로 폴백한다.
const DATA_DIR = process.env.OPENRM_DATA_DIR || path.join(__dirname, '..', '.openrm')
const CONTROL_CWD = path.join(DATA_DIR, `control-cwd-${process.env.OPENRM_PORT || 8770}`)
fs.mkdirSync(CONTROL_CWD, { recursive: true })
Term.ensureOwnGitRoot(CONTROL_CWD)

let state = null // { session, model, modelLabel, startedAt, cwd } | null — 폴더별 Map이 필요 없다(전역 하나)

function isLive(live, name) {
	return live.some((x) => x.name === name || Term.baseName(x.name) === Term.baseName(name))
}

// mcpDispatch.cjs(지휘자 전용)와 같은 신뢰-다이얼로그-우회 + MCP 등록 패턴(term.cjs trustFolder
// 참고)이지만 대상 MCP 서버가 다르다(mcpControl.cjs, 폴더 스코프 없음). Term.create가 내부에서 다시
// 부르는 trustFolder(cwd, undefined)는 "이미 신뢰됨 + mcpFolderId 없음" 조합이면 아무것도 안 건드리고
// 즉시 리턴하므로(term.cjs 참고), 여기서 먼저 등록해두면 그 뒤 Term.create 호출에도 안전하게 남는다.
//
// ~/.claude.json의 등록 키는 cwd 그대로가 아니라 Term.gitRoot(cwd) — claude CLI가 프로젝트를 식별하는
// 기준이 실제로는 git 리포지토리 최상위이기 때문이다(term.cjs의 gitRoot 주석 참고). CONTROL_CWD가
// OpenTask 앱 자신의 루트(openrm/app)인데, 이 앱은 모노레포의 하위 디렉토리라 git root는 한 단계 위
// (openrm)다 — cwd 그대로 키를 쓰면 CLI가 그 등록을 영원히 못 찾는다(`claude mcp list`로 직접 확인된
// 버그: opentask-control이 설정엔 있는데 세션엔 전혀 안 잡힘).
function registerControlMcp(cwd) {
	try {
		const key = Term.gitRoot(cwd)
		// 첫 실행 사용자는 ~/.claude.json이 아직 없다 — 없으면 빈 설정에서 새로 만든다(§term.cjs
		// readClaudeConfig). 예전엔 여기서 던지고 아래 catch가 삼켜 MCP 등록이 통째로 건너뛰어졌다.
		const cfg = Term.readClaudeConfig()
		cfg.projects = cfg.projects || {}
		const existing = cfg.projects[key] || {}
		const mcpServers = { ...(existing.mcpServers || {}) }
		mcpServers['opentask-control'] = {
			command: process.execPath,
			args: [path.join(__dirname, 'mcpControl.cjs')],
			env: { OPENTASK_CONTROL: '1', OPENTASK_PORT: String(process.env.OPENRM_PORT || 8770) },
		}
		cfg.projects[key] = {
			allowedTools: [],
			mcpContextUris: [],
			enabledMcpjsonServers: [],
			disabledMcpjsonServers: [],
			...existing,
			mcpServers,
			hasTrustDialogAccepted: true,
		}
		fs.writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(cfg, null, 2))
	} catch (_) {}
}

function controlSeed(extra) {
	const port = process.env.OPENRM_PORT || 8770
	const operator = Settings.operatorName()
	return `[역할: OpenTask 하이브마인드] 너는 특정 태스크가 아니라 OpenTask 앱 전체를 대화로 조작하는 하이브마인드야. ${operator}가 너와 직접 대화한다. 바로 실행하지 말고 계획부터 보고하고 승인받아.

■ 코드는 네가 직접 안 건드린다 — 하이브마인드=설계, 메인태스크(지휘자)=명령, 서브태스크=업무. 이 3단
구조가 무너지면 안 된다. Bash로 조사하는 것(grep/read/git log, 스크린샷으로 화면 확인 등)은 괜찮지만,
Edit/Write로 레포 파일을 고치거나 git commit/push를 하는 건 네 역할이 아니다 — ${operator}가 이미지
붙여서 "이것도 저거처럼 고쳐줘"처럼 바로 손대고 싶은 요청을 해도 마찬가지다. 코드 작업이 필요하면:
- 그 태스크가 이미 시작돼 지휘자가 살아있으면 dispatch_to_task로 구체적으로 지시해라.
- 아직 시작 안 됐거나(일감함) 서브태스크가 전부 완료돼 지휘자가 없으면, create_subtask로 뭘 해야
  하는지 명확히 적은 서브태스크를 만들고, ${operator}에게 "서브태스크 만들어뒀습니다 — 상세페이지에서
  개발 시작을 눌러주세요"라고 안내해라. 네가 대신 실제 워크트리+클로드 세션을 못 띄운다(§ 아래
  create_subtask 설명) — 이건 제약이지 우회할 방법을 찾으라는 뜻이 아니다.

■ 언어: ${operator}가 쓰는 언어에 맞춰 답변해라 — 영어로 물으면 영어로, 한국어로 물으면 한국어로. 대화
도중 상대가 언어를 바꾸면 너도 바로 그 언어로 전환한다.

■ 할 수 있는 일 — MCP 툴(도구 목록에서 opentask-control로 시작하는 것들)을 우선 써라:
- list_tasks: 전체 보드(폴더/태스크/서브태스크/마감일) 조회
- create_task / update_task / delete_task: 태스크 생성·상세정보(이름/설명/진행방식/레포/마감일/기간/색상) 수정·삭제
- start_task: 일감함 태스크를 실제로 착수(폴더 승격 + 오케스트레이션 개시) — 사이드바 "시작" 버튼과 동일. 레포 자동배정은 없다(과거에 있었지만 검증 없이 엉뚱한 레포에 배정되는 사고로 꺼짐) —
  레포가 안 정해진 채로 start_task를 부르면 서브태스크가 레포 없이 오케스트레이션을 시도하다 막힌다.
  create_task에 repo를 안 채웠으면 start_task 전에 반드시 사람에게 레포를 물어봐서 채워라 — "자동으로
  알아서 배정될 거예요" 같은 말은 절대 하지 마라.
- reschedule_task: 태스크 마감일(캘린더 날짜)만 빠르게 변경
- dispatch_to_task: 이미 시작된 태스크의 지휘자(태스크 매니저) 세션에 직접 지시를 전달. 운영 모드 점검 중 방향 수정·재촉·막힘 해소 지시에 쓴다 — 아직 시작 안 된(일감함) 태스크엔 지휘자가 없어 못 쓴다.
- report_task_verify: 캘린더 위 현황판에 "이 태스크는 이렇게 확인하면 된다"를 보고(로컬서버 URL, 스크린샷 경로, 확인용 명령어 등). ${operator}와 대화하다가 직접 확인한 방법이 생기면(예: 사람이 보여준 화면을 보고 판단했거나, 리포트를 읽고 정리한 확인 방법이 있으면) 이걸로 남겨라 — 서브태스크·태스크 매니저도 각자 자기 관점에서 같은 걸 보고하니, 네 게 최신이면 그게 그대로 보인다.
- create_subtask / update_subtask / delete_subtask: 태스크 하나를 개발/개발자테스트/QA/배포 같은 단계로 쪼갠 서브태스크 관리(각자 자기 설명·예정일·기간을 가짐). 실제 워크트리+클로드 세션을 띄우는 건 이 툴셋에 없다 — 그건 태스크 상세페이지에서 사람이 직접 하는 무거운 동작이라 하이브마인드가 대신하지 않는다.
- list_blocked_periods / create_blocked_period / delete_blocked_period: 캘린더 차단 기간(예: "QA 기간") 관리 — 만들면 겹치는 기존 일정이 자동으로 뒤로 밀린다.
- list_cron_jobs / create_cron_job / update_cron_job / delete_cron_job / run_cron_job_now: 크론잡(자동화) 관리
- read_settings / update_setting: 운영 설정 조회·변경 (경로/앱/배포/웹훅 등만 — GitHub 토큰, DB 연결문자열 같은 비밀값은 이 툴로 못 건드린다. 그건 설정 화면에서 사람이 직접 해야 함)

MCP 툴이 안 보이거나 호출이 실패하면 curl로 폴백: curl -s http://localhost:${port}/api/... (엔드포인트는 OpenTask 서버 코드 기준)

■ 하이브마인드답게 — "태스크 만들어줘"처럼 이름만 던져주고 끝나는 요청이 흔하다. 설명·마감일·기간·레포처럼
뭘 만들지에 실제로 영향을 주는 정보가 비어있으면 추측해서 그냥 만들지 말고, 짧게 하나씩 물어봐서
채운 뒤에 만들어라(팀 규칙 빈칸을 물어보며 채우는 것과 같은 태도). 사소한 값(색상 등)까지 전부 캐물어
피곤하게 만들 필요는 없다 — 실제로 판단이 갈리는 것만.

■ 원칙: 요청을 이해하고, 뭘 할지 먼저 ${operator}에게 확인받은 뒤 실행해. 완료하면 뭘 했는지 요약해서 보고해.${extra ? `\n\n■ 지금 바로 이걸 도와줘:\n${extra}` : ''}`
}

// tmux가 있으면 하이브마인드용 세션 이름을 포트별로 고정 — 여러 인스턴스(포트 다른 실행/데모)가 같은
// tmux 세션을 두고 다투지 않게 CONTROL_CWD와 같은 포트-스코프 규칙을 그대로 따른다.
const TMUX_SESSION = `opentask-control-${process.env.OPENRM_PORT || 8770}`

// "유저가 직접 확인하는 것도 쉬워야하는데" — 운영 모드가 실제로 살아 돌고 있는지 채팅을 스크롤하지
// 않고도 한눈에 알 수 있게, 마지막으로 점검이 실행된 시각을 getState에 얹는다(헤더에 "마지막 점검:
// HH:MM"으로 표시 — § ControlPane.tsx). opsMode 자체는 설정(Settings.opsMode)이 단일 진실 소스.
let lastOpsTickAt = null
// state는 await 사이에 다른 경로가 비울 수 있다(stop/reset, 그리고 자동 모델 폴백 §maybeFallbackModel
// — 실측: 폴백이 세션을 갈아끼우는 중에 들어온 폴링이 state.session을 읽다 TypeError로 터졌다).
// 진입 시점의 값을 지역 변수로 붙잡아 쓰고, 전역은 "지금도 그대로인가"를 확인할 때만 본다.
async function getState() {
	const opsMode = !!Settings.get('opsMode')
	const cur = state
	if (!cur) return { running: false, session: null, cwd: CONTROL_CWD, modelLabel: null, persistent: Term.hasTmux(), opsMode, lastOpsTickAt }
	const live = await Term.list().catch(() => [])
	if (!isLive(live, cur.session)) {
		if (state === cur) state = null // 그 사이 새 세션이 들어섰으면 남의 것을 지우면 안 된다
		return { running: false, session: null, cwd: CONTROL_CWD, modelLabel: null, persistent: Term.hasTmux(), opsMode, lastOpsTickAt }
	}
	return { running: true, stalled: !!controlStalled, persistent: Term.hasTmux(), opsMode, lastOpsTickAt, ...cur }
}

// "멈춘상황을 어떻게 인지할 수 있을까? 지금은 인지가 어려워" — orchestrator.cjs checkStalledSubtasks의
// 지휘자·서브태스크용 안전망과 같은 개념을 하이브마인드에도 그대로 적용한다. 하이브마인드는 폴더 하나에
// 묶이지 않는 전역 세션이라 맵이 아니라 모듈 전역 불리언 하나로 충분하다.
const STALLED_THRESHOLD_MS = 3 * 60 * 1000
let controlStalled = false
async function checkStalled() {
	const cur = state
	if (!cur) {
		controlStalled = false
		return
	}
	const live = await Term.list().catch(() => [])
	if (!isLive(live, cur.session)) {
		controlStalled = false
		return
	}
	// 채팅 패널을 안 열어두면 아래 getLivePrompt 폴링이 안 도니, 한도 감지도 여기서 같이 한다 —
	// 60초 주기(§ index.cjs loop)라 패널을 보고 있을 때보다 느릴 뿐 결과는 같다.
	if (troubleFrom(Term.capturePane(cur.session) || '', cur.model) === 'limit') {
		await maybeFallbackModel()
		return
	}
	const status = await Term.status(cur.session).catch(() => null)
	if (!status || status.working || status.waiting || status.needsAuth) {
		controlStalled = false
		return
	}
	const last = status.lastWorkingAt || cur.startedAt
	if (Date.now() - last < STALLED_THRESHOLD_MS || controlStalled) return
	controlStalled = true
	const mins = Math.round((Date.now() - last) / 60000)
	Notify.notifyEscalation('💤 하이브마인드 응답 없음', `${mins}분째 조용합니다.`)
}

// "비서 세션이 자꾸 초기화돼" — term.cjs 세션은 이 서버 프로세스의 자식이라 서버 재시작마다(코드
// 수정 후 재기동 등) 죽는다(§ term.cjs 상단 주석). state는 메모리 변수라 재시작 후엔 항상 null이라,
// 예전엔 매번 seed와 함께 완전히 새 claude를 켜서 지금까지의 대화가 통째로 날아갔다. orchestrator.cjs의
// 지휘자 세션과 같은 복원 경로(claude --continue + continueFallbackSeed)를 그대로 따른다 — CONTROL_CWD가
// 비서 전용 고정 디렉토리라 --continue가 정확히 이 비서의 마지막 대화를 이어받고, 이어받을 대화가
// 없을 때만(최초 시작 등, term.cjs watchContinueFallback) 이 seed로 새로 시작한다.
// "무조건 이렇게 동작하도록 할 수 있을까?" — 프롬프트(§ controlSeed "코드는 네가 직접 안 건드린다")만으론
// 강제가 아니라 요청일 뿐이다(에이전트가 무시할 수 있다 — 실제로 그랬다, § GBIZ-30781 사고). Claude
// Code CLI의 --disallowedTools로 세션 시작 시점에 아예 도구 자체를 막는다 — 이건 권한 프롬프트(허용/거부
// 다이얼로그)가 아니라 무조건 차단이라 하이브마인드가 뭐라고 판단하든 우회할 수 없다(§scheduler.cjs
// runInstruction의 --allowedTools와 같은 발상, 여기선 화이트리스트가 아니라 블랙리스트 — 하이브마인드는
// Slack 등 다른 MCP 툴도 정당하게 쓰므로 전체 허용목록을 여기서 다시 나열하면 깨지기 쉽다). Edit/Write/
// NotebookEdit(파일 직접 수정)과 git commit/add/push(Bash로 우회해도 최종적으로 커밋은 못 함)만 막고,
// grep/read/git log 같은 조사용 Bash는 그대로 둔다(§ 운영 모드 상태 점검에 필요).
const CONTROL_DISALLOWED_TOOLS = "'Edit,Write,NotebookEdit,Bash(git commit:*),Bash(git add:*),Bash(git push:*)'"

// 하이브마인드를 띄우는 명령 한 줄 — start()/reset()이 각자 조립하던 걸 합친다(모델·차단 도구·tmux
// 래핑은 항상 같아야 하고, 다른 건 --continue 하나뿐이다).
// tmux 있으면 claude를 직접 타이핑해 넣는 대신 `tmux new-session -A`(있으면 붙고, 없으면 만듦)로
// 감싼다 — 서버가 재시작돼도 tmux 데몬 밑의 claude 프로세스는 안 죽으니 다음 start() 호출이 즉시
// 그 세션에 재부착된다("계속 유지" 요청).
//
// --model을 여기서 직접 박는 이유: Term.create의 모델 자동 주입은 명령이 `claude`로 시작할 때만
// 걸리는데(§term.cjs create의 정규식), tmux로 감싸면 claude가 따옴표 안쪽에 들어가 그 규칙에 안
// 걸린다. 그래서 헤더엔 "Opus 5 (비용 잠금)"이 떠 있는데 실제 프로세스엔 --model이 없는 상태로
// 오래 돌고 있었다(`ps`로 확인) — 라벨이 거짓말을 하지 않게 실제로 고정한다.
function buildCommand(model, { resume }) {
	const inner = `claude --model ${model}${resume ? ' --continue' : ''} --disallowedTools ${CONTROL_DISALLOWED_TOOLS}`
	return Term.hasTmux() ? `tmux new-session -A -s ${TMUX_SESSION} -c "${CONTROL_CWD}" "${inner}"` : inner
}

// --continue는 이 cwd에 이어받을 대화가 실제로 있을 때만 의미가 있다. 없으면 claude가 즉시
// "No conversation found to continue"를 내고 죽는데, tmux로 감싸면 그 화면이 통째로 걷혀버려서
// term.cjs의 폴백 감시가 제때 못 잡는다(§term.cjs watchContinueFallback의 대체 화면 주석 — 그 결과
// 하이브마인드가 맨 zsh 프롬프트에 방치되고 사람이 보낸 말이 전부 셸 명령으로 들어갔다, 2026-09-04).
// 게다가 CONTROL_CWD는 포트별로 갈리므로(위 주석) "기록이 아예 없는" 상태는 예외가 아니라 아주 흔한
// 정상 케이스다(dev는 8770, 패키징 앱은 18771 — 실행 방식만 바꿔도 빈 cwd가 된다). 폴백 감시를
// 안전망으로만 남겨두고, 처음부터 맞는 명령으로 띄운다.
function hasResumableConversation(cwd) {
	try {
		return fs.readdirSync(Transcript.projectDirFor(cwd)).some((f) => f.endsWith('.jsonl'))
	} catch (_) {
		return false
	}
}

async function start(extra) {
	const live = await Term.list().catch(() => [])
	if (state && isLive(live, state.session)) return { ok: true, already: true, ...state }
	registerControlMcp(CONTROL_CWD)
	const model = Settings.modelFor('control')
	const resume = hasResumableConversation(CONTROL_CWD)
	const command = buildCommand(model, { resume })
	// 이어받을 게 있으면 예전대로 --continue + 폴백 시드(이어받기 실패 시에만 씀), 없으면 처음부터
	// 새 대화이므로 reset()과 같은 경로 — seed를 바로 주입한다.
	const seedText = controlSeed(extra)
	const t = await Term.create({
		cwd: CONTROL_CWD,
		command,
		label: 'control',
		model,
		...(resume ? { continueFallbackSeed: seedText } : { seed: seedText }),
	})
	if (!t.ok) return { ok: false, error: t.error }
	const modelLabel = Settings.modelLabelFor('control')
	state = { session: t.name, model, modelLabel, startedAt: Date.now(), cwd: CONTROL_CWD }
	return { ok: true, ...state }
}

async function stop() {
	const cur = state
	if (!cur) return { ok: true }
	state = null // 먼저 비운다 — kill을 기다리는 동안 들어온 폴링이 죽는 중인 세션을 붙잡지 않게
	await Term.kill(cur.session).catch(() => {})
	// "정지"는 뷰어만 끊는 게 아니라 진짜 정지 — tmux 모드면 데몬 쪽 세션도 같이 죽인다(안 그러면
	// tmux 세션이 백그라운드에 영영 남아 다음 start()가 죽은 게 아니라 그 낡은 세션에 재부착됨).
	if (Term.hasTmux()) {
		try {
			execFileSync('tmux', ['kill-session', '-t', TMUX_SESSION], { stdio: 'ignore' })
		} catch (_) {}
	}
	return { ok: true }
}

// "세션을 초기화하는거나.. 하이브마인드를 자주사용해서 사용성 개선이 필요해" — 기존 "재시작"
// 버튼(restart, ControlPane.tsx)은 사실 claude --continue라 같은 대화를 그대로 이어받는다(tmux만
// 새로 뜸, § start()) — 대화가 꼬였거나 너무 길어졌을 때 진짜 새로 시작할 방법이 없었다. 이건
// stop()과 같은 방식으로 완전히 죽인 뒤, --continue 없이 맨 claude를 새로 띄운다 — 예전 대화의
// jsonl 파일은 디스크에 그대로 남지만(삭제 안 함) 다시 이어받지 않는다, 진짜 빈 대화로 시작.
async function reset(extra) {
	if (state) await Term.kill(state.session).catch(() => {})
	if (Term.hasTmux()) {
		try {
			execFileSync('tmux', ['kill-session', '-t', TMUX_SESSION], { stdio: 'ignore' })
		} catch (_) {}
	}
	state = null
	registerControlMcp(CONTROL_CWD)
	const model = Settings.modelFor('control')
	const command = buildCommand(model, { resume: false })
	const t = await Term.create({ cwd: CONTROL_CWD, command, label: 'control', model, seed: controlSeed(extra) })
	if (!t.ok) return { ok: false, error: t.error }
	const modelLabel = Settings.modelLabelFor('control')
	state = { session: t.name, model, modelLabel, startedAt: Date.now(), cwd: CONTROL_CWD }
	return { ok: true, ...state }
}

// "한도 걸리면 자동 폴백" — 하이브마인드 기본 모델은 fable이다(§settings.cjs MODEL_POLICY.control).
// 주간 한도를 다 쓰면 claude는 세션을 죽이지 않고 "You've reached your Fable limit"만 남긴 채 아무
// 응답도 못 한다 — 사람 눈엔 그냥 멈춤이고, 실제로 첫 사용자가 이걸 무한로딩으로 겪었다(2026-09-04
// 빈 cwd 콜드스타트 재현에서 그대로 실측). 이미 있던 킬스위치(Settings.fableLock — 켜면 fable 배정이
// 전부 opus로 스왑된다, §settings.cjs modelFor)를 사람이 눌러주길 기다리는 대신 여기서 자동으로 켜고
// 세션을 다시 띄운다. 대화는 --continue로 그대로 이어진다(§ start의 hasResumableConversation).
//
// 한 프로세스에서 한 번만 — 폴백한 opus까지 막힌 경우 무한 재시작으로 번지면 안 된다. fableLock은
// 설정 파일에 남으니 다음 실행부터는 처음부터 opus로 뜨고, 사람이 설정에서 되돌릴 수 있다.
let modelFallbackDone = false
async function maybeFallbackModel() {
	const cur = state
	if (modelFallbackDone || !cur || !/fable/.test(cur.model || '')) return false
	modelFallbackDone = true // await 앞에서 세운다 — 1초 폴링이 겹쳐 두 번 재시작하는 걸 막는다.
	const before = cur.modelLabel
	Settings.save({ fableLock: true })
	await stop()
	const r = await start()
	Notify.notifyEscalation('🔁 하이브마인드 모델 전환', `${before} 사용 한도에 걸려 ${Settings.modelLabelFor('control')}(으)로 바꿔 다시 띄웠습니다.`)
	return r.ok
}

// "중간에 대화 정지 기능도 있어야함" — 세션은 안 죽인다(stop과 다름), 지금 생성 중인 응답만 ESC로 끊는다.
async function interrupt() {
	if (!state) return { ok: false, error: '하이브마인드 세션이 없습니다.' }
	return Term.interrupt(state.session)
}

// "이게 그냥 작성하기는 어려운데... 나한테 질문하면서 작성하게 할 수 있도록 관제에 질문하는 버튼
// 있으면 어떨까" — 팀 규칙처럼 빈 화면에 자연어를 바로 적기 어려운 자리에서, 관제에게 맥락(레포·
// 어떤 규칙칸)을 실어 보내면 관제가 사람에게 되물어가며 대신 채워준다. 관제가 이미 떠 있으면 그
// 세션에 새 지시를 안전하게 얹고(injectSeed — 화면에 실제로 찍혔는지 확인 후 제출), 아직 없으면
// 최초 seed 자체에 이 요청을 포함해 콜드 스타트 중 이중 주입 경합을 피한다.
async function ask(text) {
	if (!text || !String(text).trim()) return { ok: false, error: 'text 필수' }
	const live = await Term.list().catch(() => [])
	if (state && isLive(live, state.session)) {
		const oneLine = Term.toOneLine(text)
		await Term.injectSeed(state.session, oneLine).catch(() => {})
		return { ok: true, already: true, ...state }
	}
	return await start(text)
}

// "하이브마인드 전체 운영 모드... 전체 태스크 그래프를 그리고 태스크 업무 방향성 확인과 지시. 기간내에
// 끝낼 수 있도록 지속적인 추적과 멈춤을 확인하고 지시 이행" — 새 알고리즘을 따로 짜는 대신, 이미 대화
// 중인 하이브마인드 자신에게 주기적으로 같은 점검 프롬프트를 다시 넣어 스스로(list_tasks로 전체 그래프
// 확인 → dispatch_to_task로 지휘자에게 지시) 판단·행동하게 한다 — 하이브마인드가 이미 가진 도구·판단력을
// 그대로 재사용(§ mcpControl.cjs dispatch_to_task).
//
// "명시도 해줘" — 이 프롬프트는 사람이 친 게 아니라 시스템이 넣은 거라는 걸 채팅에서 구분할 수 있어야
// 한다. 고정 마커로 시작해서 넣고, transcript.cjs가 이 마커를 보고 그 턴을 auto:true로 표시해
// ControlPane.tsx가 일반 사용자 말풍선과 다르게(자동 점검 배지) 그린다 — 새 UI 표면을 안 만들고 이미
// 보고 있는 채팅 안에서 바로 구분되게.
const OPS_TICK_MARKER = '[운영 모드 자동 점검]'
async function runOpsModeTick() {
	if (!Settings.get('opsMode')) return { ok: true, skipped: 'off' }
	const cur = state
	if (!cur) return { ok: true, skipped: 'not-running' }
	const live = await Term.list().catch(() => [])
	const match = live.find((x) => x.name === cur.session || Term.baseName(x.name) === Term.baseName(cur.session))
	if (!match) return { ok: true, skipped: 'no-session' }
	// 바쁘면(생성 중이거나 다른 질문 대기 중) 끼어들지 않고 다음 15분 tick에 다시 시도한다 — injectSeed가
	// 지금 타이핑 중인 걸 덮어쓰거나 응답 도중에 새 지시가 섞여 들어가는 걸 막는다.
	const status = await Term.status(match.name).catch(() => null)
	if (!status || status.working || status.waiting) return { ok: true, skipped: 'busy' }
	const prompt = `${OPS_TICK_MARKER} list_tasks로 전체 태스크 그래프를 확인하고, 각 태스크가 기한 안에 끝날 방향으로 가고 있는지 점검해라. 멈췄거나(막힘·응답없음) 방향이 어긋난 게 있으면 dispatch_to_task로 해당 태스크의 지휘자에게 구체적으로 지시해라. 전부 정상이면 지시 없이 짧게 "이상 없음"이라고만 보고해라. 판단이 필요한 애매한 사안이면 지시하지 말고 사람에게 물어봐라.`
	const oneLine = prompt.replace(/[\r\n]+/g, ' ')
	await Term.injectSeed(match.name, oneLine).catch(() => {})
	lastOpsTickAt = Date.now()
	return { ok: true }
}

// "이걸 UI로 풀어줘 답변할 수 없어. AskUserQuestion를 UI로 표현해서 마우스로 클릭 가능하도록" →
// 처음엔 대화 기록(jsonl) 폴링에서 "tool_use는 있는데 result가 아직 null"인 순간을 붙잡아 그 input을
// 그대로 파싱해 버튼으로 그리는 방식으로 만들었다("질문이 안왔는데?"로 실패가 드러남) — 실제로 그
// jsonl 파일을 떠 있는 세션 것으로 직접 열어보니, AskUserQuestion의 tool_use 레코드 자체가 **사람이
// 답하기 전까진 파일에 전혀 안 쓰인다**(2026-09-01 실측: 화면엔 질문이 떠 있는데 jsonl 마지막 줄은
// 그 이전 Bash 호출의 결과였다). 그래서 대화 기록 폴링으론 "지금 질문이 떠 있다" 자체를 원천적으로
// 감지할 수 없다 — 그 상태가 jsonl에 나타나는 유일한 순간은 이미 답변까지 끝난 뒤뿐이다.
//
// 대신 살아있는 pty 화면을 직접 읽는다(§term.cjs capturePane — xterm.js 헤드리스 버퍼라 tmux 유무와
// 무관하게 항상 동작, status()가 stalled 판정에 쓰던 것과 같은 소스). 화면 텍스트를 파싱해 옵션
// 목록·멀티선택 여부·체크 상태까지 뽑아낸다 — AskUserQuestion 렌더링에만 고정으로 붙는 "Type
// something" 옵션 줄을 트리거로 삼는다(다른 프롬프트엔 안 나옴, 실측 확인). 키 시퀀스 자체는 여전히
// 실측(§ 이전 buildAnswerKeys 실험)대로지만, 이제 한 번에 여러 질문을 미리 계산해 배치로 쏘지 않고
// **클릭 하나 = 지금 화면에 보이는 것 그대로 키 하나**로 좁혔다 — 그 편이 옵션 인덱스가 화면과
// 어긋날 위험이 아예 없다(항상 방금 파싱한 실제 화면 기준으로만 키를 계산).
const ASK_TRIGGER_RE = /Type something/
// 권한 확인류(Bash 실행/파일 수정/ExitPlanMode 승인) — 화면 구조(❯ N. 라벨 목록)는 AskUserQuestion과
// 똑같은데 자유 입력 슬롯("Type something")이 없어서 위 트리거만으론 못 잡혔다("가끔 터미널창을 그냥
// 준다" — 실측 재현: Bash/Edit/Write 승인, ExitPlanMode 승인 전부 raw 폴백으로 떨어짐). 이 계열은 전부
// "Do you want to ...?"/"Would you like to proceed?" 헤더로 시작하는 게 실측 공통점이라(§ term.cjs
// status() waiting 판정과 같은 근거) 이걸 두 번째 트리거로 추가 — 아래 옵션 파싱 로직은 그대로 재사용.
const CONFIRM_TRIGGER_RE = /Do you want to\b|Would you like to proceed\?/i
function parseLivePrompt(text) {
	if (!text) return null
	// Review 화면 — 여러 질문에 다 답한 뒤 최종 확인. "1. Submit answers"가 항상 첫 항목이라 옵션
	// 파싱 없이도 action 'submit'/'cancel' 두 가지로 고정.
	if (/Ready to submit your answers\?/.test(text)) {
		const m = text.match(/Review your answers\s*\n([\s\S]*?)\n\s*Ready to submit your answers\?/)
		return { kind: 'review', summary: (m ? m[1] : '').trim() }
	}
	if (!ASK_TRIGGER_RE.test(text) && !CONFIRM_TRIGGER_RE.test(text)) return null
	const lines = text.split('\n')
	// "❯ 1. Red" / "  2. [ ] Cheese" 형태 — 체크박스는 멀티선택일 때만 붙는다.
	const optionRe = /^\s*❯?\s*(\d+)\.\s*(\[[ x✔]\]\s*)?(.+?)\s*$/
	let firstOptionIdx = -1
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(optionRe)
		if (m && m[1] === '1') {
			firstOptionIdx = i
			break
		}
	}
	if (firstOptionIdx < 0) return null
	// 질문 텍스트는 옵션 목록 바로 위, 첫 비어있지 않은 줄 — 화면이 짧아 이 줄이 스크롤 밖이면
	// 그냥 빈 문자열(옵션 파싱 자체는 그 줄과 무관하게 항상 성공한다).
	let question = ''
	for (let j = firstOptionIdx - 1; j >= 0; j--) {
		const t = lines[j].trim()
		if (!t) continue
		question = t
		break
	}
	const options = []
	let multiSelect = false
	let n = 1
	for (let i = firstOptionIdx; i < lines.length; i++) {
		const m = lines[i].match(optionRe)
		if (!m) continue
		if (Number(m[1]) !== n) break // 번호가 끊기면(예: 다음 탭·"Chat about this") 실제 옵션 끝
		const label = m[3].replace(/\.$/, '').trim()
		if (/^Type something$/i.test(label)) break // 자유 입력 슬롯 — 이 버튼 UI 범위 밖
		if (m[2]) multiSelect = true
		options.push({ label, checked: !!(m[2] && /[x✔]/.test(m[2])) })
		n++
	}
	if (!options.length) return null
	return { kind: 'question', question, multiSelect, options }
}

// 지금 화면이 AskUserQuestion류 프롬프트를 보여주고 있는지 + (파싱되면) 그 구조까지 함께 돌려준다.
// prompt가 null인데 waiting만 true면(예: 파싱 못 한 다른 형태의 인터랙티브 프롬프트) 프론트가
// raw XTerm 폴백으로 물러난다 — status()의 waiting 판정(§term.cjs)을 그대로 재사용해 최소한
// "뭔가 사람 입력을 기다리고 있다"는 신호는 항상 놓치지 않는다.
// "멈추기도 동작안하고 채팅창도 꺠져" — ControlPane.tsx의 "지금 생성 중인가"는 예전엔 오직 대화
// 기록(jsonl) 모양(마지막 턴이 assistant/text로 안 끝났으면 생성 중)으로만 추측했다. /compact 같은
// 로컬 명령은 그 자체로 끝 — 뒤이어 assistant 응답이 절대 안 온다(§ transcript.cjs isSyntheticUserContent
// 주석과 같은 발견) — 그러면 마지막 턴이 영원히 user로 남아 "생성 중"으로 오판, 점 3개가 안 꺼지고
// 정지 버튼을 눌러도(ESC 전송) 정작 CLI는 이미 유휴 상태라 아무 일도 안 일어난다(실측, 2026-09-02).
// 대화 기록 대신 실제 pty의 working 신호(§term.cjs status — "esc to interrupt" 등 실측된 판정, stalled
// 감지에도 쓰는 바로 그것)를 함께 돌려줘 프론트가 이걸 진짜 기준으로 삼게 한다.
// status().working은 "esc to interrupt"/"…(…tokens" 같은 고정 문구가 화면에 보일 때만 잡는다 —
// 실측(2026-09-02)해보니 긴 응답이 빠르게 줄줄 스트리밍되는 동안엔 그 문구 자체가 화면에 아예 안
// 뜨는 구간이 있다(토큰이 실제로 계속 찍히고 있는데도 status.working=false). 그래서 1초 폴링
// 주기와 맞춰, 직전 스냅샷과 화면 전체가 달라졌는지도 같이 본다 — 어디가 달라졌든 뭔가 계속 그려지고
// 있다는 뜻이라 그 자체로 "생성 중"의 더 일반적인 증거다. 세션당 마지막 스냅샷만 들고 있으면 충분
// (다음 폴링 tick의 비교 대상).
const lastCaptureBySession = new Map()
// "처음쓰는사람이 쓰자마자 무한로딩이 걸렸어" — 세션(pty)이 살아있기만 하면 UI는 계속 "생성 중"만
// 그렸다. 정작 무슨 일이 벌어졌는지(모델 한도, claude 미설치, 로그인 안 됨, 이어받기 실패)는 그
// 화면에 텍스트로 다 찍혀 있는데 채팅 UI가 화면을 안 보여주니 사람은 알 길이 없었다(2026-09-04
// 첫 사용자 제보). 이미 매초 읽고 있는 그 화면에서 치명적 신호만 골라 함께 돌려준다 — 새 폴링
// 경로를 만들지 않고 기존 live-prompt에 얹는다. 오탐이 나면 멀쩡한 대화에 빨간 띠가 뜨므로,
// 추측성 휴리스틱은 넣지 않고 실제로 관측된 문구만 좁게 잡는다.
const TROUBLE_PATTERNS = [
	{ key: 'noCli', re: /command not found:?\s*claude|claude:?\s*command not found/i },
	{ key: 'login', re: /Select login method|Please run \/login|Invalid API key/i },
	{ key: 'badModel', re: /(?:invalid|unknown|unsupported) model|model [^\n]{0,24}(?:not found|not available|does not exist)/i },
	{ key: 'noConvo', re: /No conversation found to continue/i },
]
// "You've reached your Fable limit." — 어느 모델의 한도인지가 문구 안에 들어있다. 이걸 지금 쓰는
// 모델과 대조하는 게 중요하다: 폴백으로 모델을 바꿔 다시 띄우면 --continue가 지난 대화를 화면에
// 그대로 다시 그려서 옛 한도 문구가 계속 남는다(2026-09-04 실측) — 그냥 두면 이미 해결된 사고가
// 영원히 경고로 뜨고 maybeFallbackModel도 계속 다시 불린다.
const LIMIT_RE = /reached your ([A-Za-z][\w.-]*) limit/i
function troubleFrom(text, model) {
	const hit = String(text || '').match(LIMIT_RE)
	if (hit && new RegExp(hit[1], 'i').test(String(model || ''))) return 'limit'
	// status()의 working/waiting 판정과 달리 마지막 24줄로 좁히면 안 된다 — 그 판정들이 보는 신호는
	// 항상 화면 맨 아래 상태줄에 있지만, 사고 문구는 대화 영역 한가운데에 찍힌다(실측: "You've reached
	// your Fable limit"이 입력창보다 훨씬 위에 남아 24줄 컷에 안 걸렸다). capturePane은 스크롤백이
	// 아니라 지금 보이는 화면만 주므로, 화면에서 밀려나면 자연히 사라진다.
	for (const p of TROUBLE_PATTERNS) if (p.re.test(String(text || ''))) return p.key
	return null
}
async function getLivePrompt() {
	const cur = state
	if (!cur) return { ok: true, waiting: false, working: false, prompt: null, trouble: null }
	const live = await Term.list().catch(() => [])
	const match = live.find((x) => x.name === cur.session || Term.baseName(x.name) === Term.baseName(cur.session))
	if (!match) return { ok: true, waiting: false, working: false, prompt: null, trouble: null }
	const [status, text] = await Promise.all([Term.status(match.name).catch(() => null), Promise.resolve(Term.capturePane(match.name) || '')])
	const prompt = parseLivePrompt(text)
	const trouble = troubleFrom(text, cur.model)
	// 패널을 보고 있는 동안은 이 폴링이 1초마다 도니, 60초짜리 안전망(§ checkStalled)보다 여기서 먼저
	// 잡힌다. 재시작은 오래 걸리므로 응답을 붙잡지 않고 던져만 둔다 — 이미 뜬 화면은 다음 tick에 바뀐다.
	if (trouble === 'limit') maybeFallbackModel().catch(() => {})
	const prevText = lastCaptureBySession.get(match.name)
	lastCaptureBySession.set(match.name, text)
	const changedSinceLastPoll = prevText !== undefined && prevText !== text
	return {
		ok: true,
		waiting: !!(prompt || (status && status.waiting)),
		working: !!((status && status.working) || changedSinceLastPoll),
		prompt,
		trouble,
	}
}

// action: { type: 'select'|'toggle', index: number } | { type: 'next' } | { type: 'submit' } | { type: 'cancel' }
// — 전부 지금 화면 기준으로 프론트가 직접 고른 것(§ ControlPane.tsx LivePromptPanel)을 그대로 키
// 하나로 옮긴다. select/toggle의 index는 parseLivePrompt가 돌려준 options의 0-based 인덱스.
function keyForAction(action) {
	if (!action || typeof action !== 'object') return null
	if ((action.type === 'select' || action.type === 'toggle') && Number.isInteger(action.index) && action.index >= 0) {
		return String(action.index + 1)
	}
	if (action.type === 'next') return '\x1b[C' // → (오른쪽 화살표) — xterm.js가 실제 키보드 입력 때 보내는 것과 같은 표준 CSI 시퀀스.
	if (action.type === 'submit') return '1' // Review 화면의 "1. Submit answers"
	if (action.type === 'cancel') return '2' // Review 화면의 "2. Cancel"
	return null
}
async function sendLiveAction(action) {
	const cur = state
	if (!cur) return { ok: false, error: '하이브마인드 세션이 없습니다.' }
	const key = keyForAction(action)
	if (key == null) return { ok: false, error: '알 수 없는 동작' }
	const live = await Term.list().catch(() => [])
	const match = live.find((x) => x.name === cur.session || Term.baseName(x.name) === Term.baseName(cur.session))
	if (!match) return { ok: false, error: '하이브마인드 세션이 살아있지 않습니다.' }
	Term.write(match.name, key)
	return { ok: true }
}

module.exports = { getState, start, stop, reset, ask, interrupt, getLivePrompt, sendLiveAction, runOpsModeTick, checkStalled, CONTROL_CWD, OPS_TICK_MARKER }
