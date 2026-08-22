// collector.js — 대상 레포(REPO_PATH)의 state.json + 런타임(tmux/gh/포트)을
// 정규화 read-model로 모음. 의존성 0. god-object state.json은 읽기만.
'use strict'
const fs = require('fs')
const path = require('path')
const net = require('net')
const { execFile } = require('child_process')
const AppCfg = require('./store/settings.cjs')
const { ghEnv } = require('./ghEnv.cjs')

// OpenRM은 레포 밖 서비스 → 대상 레포 경로가 필요하다. 우선순위: Setup 페이지가 쓰는
// AppConfig.rootPath(실사용 소스) → REPO_PATH 환경변수(하위호환) → 이 앱 자신의 상위 디렉토리(데모 폴백).
// ⚠️ 매번 새로 계산해야 함 — 예전엔 여기서 한 번 얼려(const) 부팅 시점 값만 썼는데, 그러면 Setup에서
//    프로젝트 루트를 입력해도 worktrees.cjs/architecture.cjs 등 C.REPO를 쓰는 모든 곳이 재시작 전까진
//    (또는 REPO_PATH 미설정이면 영영) openRM 자신의 소스 디렉토리를 대상으로 삼는 실제 버그였다.
function resolveRepo() {
	const cfg = AppCfg.getAppConfig()
	if (cfg.rootPath && String(cfg.rootPath).trim()) return String(cfg.rootPath).trim()
	return process.env.REPO_PATH || path.resolve(__dirname, '..')
}
const DEMO_STATE_PATH = path.join(__dirname, '..', 'demo', 'state.json')

function resolveStatePath() {
	if (process.env.CONTROL_STATE && fs.existsSync(process.env.CONTROL_STATE)) return process.env.CONTROL_STATE
	let best = null
	const workflowDir = path.join(resolveRepo(), '.docs', 'workflow')
	try {
		for (const feat of fs.readdirSync(workflowDir)) {
			const p = path.join(workflowDir, feat, 'state.json')
			if (fs.existsSync(p)) {
				const m = fs.statSync(p).mtimeMs
				if (!best || m > best.m) best = { p, m }
			}
		}
	} catch (_) {}
	// 실제 워크플로우 상태가 없으면 번들 데모 데이터로 폴백 — "설치 후 바로 실행"이 빈 화면이 되지 않도록.
	if (!best && fs.existsSync(DEMO_STATE_PATH)) return DEMO_STATE_PATH
	return best ? best.p : null
}

const runtime = { tmux: {}, ports: {}, prs: {}, updatedAt: { tmux: 0, ports: 0, prs: 0 } }

// 데이터 신선도: state.json 파일이 마지막으로 쓰인 시각(=실데이터 나이의 신뢰 가능한 신호)
function stateMtimeISO() {
	try {
		return STATE_PATH ? new Date(fs.statSync(STATE_PATH).mtimeMs).toISOString() : null
	} catch {
		return null
	}
}

function exec(cmd, args, timeoutMs = 4000) {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1 << 20, cwd: resolveRepo(), env: cmd === 'gh' ? ghEnv() : process.env }, (err, stdout) =>
			resolve(err ? null : String(stdout || ''))
		)
	})
}

function checkPort(port) {
	return new Promise((resolve) => {
		const sock = net.connect({ host: '127.0.0.1', port }, () => {
			sock.destroy()
			resolve(true)
		})
		sock.on('error', () => resolve(false))
		sock.setTimeout(800, () => {
			sock.destroy()
			resolve(false)
		})
	})
}

function deriveStatus(agent) {
	const sess = agent.tmuxSession
	const alive = sess ? runtime.tmux[sess]?.alive : false
	const note = (agent.claudeProcess?.leadNote || agent.note || '').toLowerCase()
	const blocked = /차단|block|pending|대기중|확인 필요/.test(note)
	if (!alive) return { code: 'idle', label: '⚪ 대기', dot: 'w' }
	if (blocked) return { code: 'blocked', label: '🟡 차단', dot: 'y' }
	return { code: 'working', label: '🟢 작업중', dot: 'g' }
}

function normalize(raw) {
	const backlogs = (raw.backlogs || []).map((b) => ({
		id: b.id,
		title: b.title,
		branch: b.branch,
		pr: b.pr || b.prNumber || null,
		prUrl: b.prUrl || null,
		status: b.status || 'plan',
		notionUrl: b.notionId ? `https://www.notion.so/${String(b.notionId).replace(/-/g, '')}` : null,
		figmaNodes: b.figmaNodes || [],
	}))

	const LANE = {
		plan: 'plan',
		queued: 'plan',
		'api-pending': 'plan',
		'awaiting-decision': 'plan',
		pending: 'plan',
		draft: 'progress',
		'in-progress': 'progress',
		open: 'review',
		'review-requested': 'review',
		'on-hold': 'hold',
		skip: 'hold',
		merged: 'done',
		closed: 'done',
	}
	const laneOf = (s) => LANE[s] || (/merged/.test(s || '') ? 'done' : 'plan')
	const lanes = { plan: [], progress: [], review: [], hold: [], done: [] }
	const byStatus = {}
	for (const b of backlogs) {
		lanes[laneOf(b.status)].push(b)
		byStatus[b.status] = (byStatus[b.status] || 0) + 1
	}

	const agents = (raw.currentAgents || []).map((a) => {
		const cp = a.claudeProcess || {}
		const sess = a.tmuxSession
		const rt = sess ? runtime.tmux[sess] : null
		const devPort = a.ports?.dev
		return {
			agent: a.agent,
			color: a.color || '#58a6ff',
			tmuxSession: sess,
			cmuxWorkspace: a.cmuxWorkspace,
			worktreePath: a.worktreePath,
			devUrl: a.devUrl || (devPort ? `http://localhost:${devPort}` : null),
			ports: a.ports || {},
			chain: a.chain || [],
			currentBacklog: (a.chain || [])[0] || null,
			pr: a.pr || a.prNumber || null,
			status: deriveStatus(a),
			tmuxAlive: !!rt?.alive,
			lastOutput: rt?.lastLine || null,
			lastPrompt: cp.lastPrompt ? cp.lastPrompt.slice(0, 160) : null,
			lastPromptAt: cp.lastPromptAt || null,
			leadNote: cp.leadNote || a.note || null,
			devPortUp: devPort != null ? !!runtime.ports[devPort] : null,
		}
	})

	return {
		feature: raw.feature || null,
		epic: raw.epic || null,
		phase: raw.phase || null,
		lastUpdated: raw.lastUpdated || null,
		counts: {
			agents: agents.length,
			working: agents.filter((a) => a.status.code === 'working').length,
			blocked: agents.filter((a) => a.status.code === 'blocked').length,
			idle: agents.filter((a) => a.status.code === 'idle').length,
			backlogs: backlogs.length,
			byLane: Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, v.length])),
			byStatus,
		},
		agents,
		backlogs: lanes,
		runtimeFreshness: runtime.updatedAt,
		statePath: STATE_PATH,
		demoMode: STATE_PATH === DEMO_STATE_PATH,
		stateMtime: stateMtimeISO(),
		repo: resolveRepo(),
		builtAt: new Date().toISOString(),
	}
}

let STATE_PATH = resolveStatePath()

function readModel() {
	STATE_PATH = STATE_PATH && fs.existsSync(STATE_PATH) ? STATE_PATH : resolveStatePath()
	if (!STATE_PATH) return { error: `state.json not found under ${path.join(resolveRepo(), '.docs', 'workflow')}/*/`, agents: [], backlogs: {} }
	try {
		return normalize(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')))
	} catch (e) {
		return { error: 'state.json parse failed: ' + e.message, agents: [], backlogs: {} }
	}
}

function readRaw() {
	try {
		return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
	} catch {
		return {}
	}
}

async function pollTmux() {
	const sessions = (readRaw().currentAgents || []).map((a) => a.tmuxSession).filter(Boolean)
	for (const s of sessions) {
		const has = await exec('tmux', ['has-session', '-t', s])
		const alive = has !== null
		let lastLine = null
		if (alive) {
			const cap = await exec('tmux', ['capture-pane', '-t', s, '-p', '-S', '-12'])
			if (cap) {
				const lines = cap
					.split('\n')
					.map((l) => l.replace(/\s+$/, ''))
					.filter((l) => l.trim())
				lastLine = lines[lines.length - 1] || null
			}
		}
		runtime.tmux[s] = { alive, lastLine }
	}
	runtime.updatedAt.tmux = Date.now()
}

async function pollPorts() {
	const ports = new Set()
	for (const a of readRaw().currentAgents || [])
		for (const v of Object.values(a.ports || {})) if (typeof v === 'number') ports.add(v)
	for (const p of ports) runtime.ports[p] = await checkPort(p)
	runtime.updatedAt.ports = Date.now()
}

async function pollPRs() {
	const out = await exec(
		'gh',
		['pr', 'list', '--state', 'open', '-L', '100', '--json', 'number,state,title,headRefName'],
		8000
	)
	if (!out) return
	try {
		for (const pr of JSON.parse(out))
			runtime.prs[pr.number] = { state: pr.state, title: pr.title, branch: pr.headRefName }
		runtime.updatedAt.prs = Date.now()
	} catch (_) {}
}

module.exports = {
	readModel,
	pollTmux,
	pollPorts,
	pollPRs,
	get STATE_PATH() {
		return STATE_PATH
	},
	get REPO() {
		return resolveRepo()
	},
	get WORKFLOW_DIR() {
		return path.join(resolveRepo(), '.docs', 'workflow')
	},
}
