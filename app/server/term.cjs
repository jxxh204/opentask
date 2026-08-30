// term.cjs — OpenRM이 직접 호스팅하는 진짜 터미널. node-pty로 이 서버 프로세스의 자식으로 셸을
// 직접 띄운다(과거엔 tmux 세션 위에 얹었으나 "tmux는 다른사람이 쓸때 불편해서" 제거 — 다른 사람이
// 세션에 직접 붙어 쓸 때 tmux 자체의 존재가 걸리적거렸다). 화면 상태는 헤드리스 xterm(@xterm/headless)
// 으로 이 프로세스 안에서 그대로 재현해 tmux capture-pane을 대체하고, 브라우저가 여러 번 붙었다
// 떨어져도(WS 재연결) @xterm/addon-serialize로 그 순간 화면을 그대로 되돌려준다.
//
// ⚠️ 트레이드오프(사용자에게 명시적으로 확인함): tmux는 별도 서버 데몬이라 OpenRM 백엔드가 죽어도
// 세션이 안 죽었지만, 지금은 세션(node-pty 프로세스)이 이 서버 프로세스의 자식이라 서버가 재시작되면
// (코드 배포·컴퓨터 종료 등) 세션도 같이 죽는다 — 그래서 이 파일의 recordSession/restorable/restore
// ("복원 경로")가 장식이 아니라 핵심이 됐다: 죽으면 스냅샷(cwd·kind·모델)으로 claude --continue를
// 다시 띄워 대화를 이어받는다.
//
// 세션은 'orm-' 접두로 격리 — OpenRM이 만든 것만 list/kill 한다(임의 프로세스 보호).
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile, execFileSync } = require('child_process')
const pty = require('node-pty')
const { Terminal } = require('@xterm/headless')
const { SerializeAddon } = require('@xterm/addon-serialize')
const Worktrees = require('./worktrees.cjs') // dev 시작 시 node_modules/env 보장용 (worktrees→collector, 순환 없음)
const Settings = require('./settings.cjs')

// claude가 한 번도 안 본 cwd에서는 "이 폴더를 신뢰하시겠습니까?" 1회성 확인 다이얼로그가 뜨는데,
// 이게 뜨면 주입한 seed가 다이얼로그 위에 얹혀 채팅으로 전달되지 못하고 유실된다 —
// 오케스트레이션은 태스크마다 새 git worktree(=한 번도 안 본 경로)를 만드므로 매번 이 게이트에 걸린다.
// 워크트리는 사용자가 Setup에서 지정한 자기 레포 안이므로, "Yes, I trust this folder"를 직접 누르는 것과
// 동일하게 미리 신뢰 등록해 다이얼로그 자체가 안 뜨게 한다. 실패해도 세션 생성은 막지 않음(다이얼로그가
// 뜨면 뜨는 대로 진행 — best-effort).
const CLAUDE_CONFIG_PATH = process.env.OPENRM_CLAUDE_CONFIG || path.join(os.homedir(), '.claude.json')
// ~/.claude.json의 projects[] 키는 겉보기엔 "우리가 넘긴 cwd 그대로"처럼 보이지만, 실측 결과 claude
// CLI가 실제로 프로젝트를 식별하는 기준은 그 cwd가 속한 git 리포지토리의 최상위(toplevel)다. cwd가
// git root 자체면(대부분의 워크트리가 그렇다 — `git worktree add`가 만드는 디렉토리는 그 자체가
// toplevel) 차이가 없지만, OpenTask 자신처럼 모노레포의 하위 디렉토리(openrm/app, git root는 한 단계
// 위 openrm)를 cwd로 넘기면 CLI는 그 상위 git root 키에서 설정을 찾고, 우리가 하위 디렉토리 키에
// 써둔 mcpServers/hasTrustDialogAccepted는 통째로 무시한다 — `claude mcp list`로 직접 재현·확인함
// (§"비서가 opentask-control MCP를 쓰는걸 어려워해" — opentask-control이 설정 파일엔 있는데 세션엔
// 전혀 안 잡히던 원인). 그래서 등록 전에 항상 git root로 먼저 정규화한다.
function gitRoot(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    return out || cwd
  } catch (_) {
    return cwd
  }
}
// mcpFolderId가 있으면 이 세션은 지휘자다 — mcpDispatch.cjs(§12 "지휘 방식 개선")를 이 cwd의
// mcpServers에 등록해 curl-in-prompt 대신 구조화된 MCP 툴(dispatch_subtask/log_event/set_subtask_kind)을
// 쓸 수 있게 한다. 사람 개입 없이 자동 — trustFolder()가 이미 하고 있던 "신뢰 다이얼로그 미리 우회"와
// 같은 자리, 같은 방식.
function trustFolder(cwd, mcpFolderId) {
  try {
    const key = gitRoot(cwd)
    const cfg = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf8'))
    cfg.projects = cfg.projects || {}
    const existing = cfg.projects[key] || {}
    const alreadyTrusted = !!existing.hasTrustDialogAccepted
    // 신뢰 다이얼로그는 이미 처리됐고 MCP 등록도 필요 없으면 더 손댈 게 없다 — 파일 쓰기 생략.
    if (alreadyTrusted && !mcpFolderId) return
    const mcpServers = { ...(existing.mcpServers || {}) }
    if (mcpFolderId) {
      mcpServers['opentask-dispatch'] = {
        command: process.execPath, // Node 바이너리 절대경로 — PATH에 없는 쉘에서도 항상 동작
        args: [path.join(__dirname, 'mcpDispatch.cjs')],
        env: { OPENTASK_FOLDER_ID: mcpFolderId, OPENTASK_PORT: String(process.env.OPENRM_PORT || 8770) },
      }
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

const PREFIX = 'orm-'

// ── 세션 스냅샷 (재부팅 대비 OpenRM 자체 복원) ──
// OpenRM이 띄운 세션을 cwd·kind·포트와 함께 디스크에 기록. kill하면 제거.
// 재부팅으로 세션이 다 죽어도 스냅샷은 남아 → restorable()이 "복원 가능"으로 노출.
const SNAP_FILE = process.env.OPENRM_SESSIONS_FILE || path.join(__dirname, '..', '.openrm-sessions.json')
function loadSnap() {
  try {
    return JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8'))
  } catch (_) {
    return {}
  }
}
function saveSnap(s) {
  try {
    fs.writeFileSync(SNAP_FILE, JSON.stringify(s, null, 2))
  } catch (_) {}
}
// 이제 세션명이 외부(과거의 tmux/cmux)에서 리네임될 일이 없다 — 우리가 만든 이름 그대로 죽을 때까지
// 유지된다. 그래도 스냅샷 키 매칭 호출부가 많아 안전하게 남겨둔다(정상 케이스는 항상 n === name).
function baseName(n) {
  return String(n || '').split(/_\d{9,}_/)[0]
}
function kindOf(command) {
  const c = String(command || '')
  if (/\bclaude\b/.test(c)) return 'agent'
  if (/npm run dev|next dev|yarn dev|pnpm dev|\bvite\b/.test(c)) return 'dev'
  return 'shell'
}
function portOf(command) {
  const m = String(command || '').match(/-p\s+(\d{2,5})/)
  return m ? Number(m[1]) : null
}
function recordSession(name, cwd, label, command, model) {
  const s = loadSnap()
  s[name] = { cwd, label: label || null, command: command || null, model: model || null, kind: kindOf(command), port: portOf(command), savedAt: Date.now() }
  saveSnap(s)
}
function forgetSession(name) {
  const s = loadSnap()
  let changed = false
  // 정확 일치 + (혹시 남아있는) 베이스 매칭으로 들어온 경우 base 키도 제거
  for (const k of Object.keys(s)) {
    if (k === name || name === k || name.startsWith(k + '_')) {
      delete s[k]
      changed = true
    }
  }
  if (changed) saveSnap(s)
}

// ── 세션 레지스트리(구 tmux 서버의 자리) ──
// name -> { proc: node-pty IPty, term: 헤드리스 xterm(화면 상태), serializeAddon, cwd, command, label,
//           model, kind, createdAt, wsClients: Set<WebSocket>, exited }
const sessions = new Map()
// "업무가 멈추든" — status()가 working:true를 관측할 때마다 갱신되는 "마지막으로 실제 작업 중이었던
// 시각". status() 자체은 매번 화면을 다시 긁는 상태없는 함수라 "얼마나 오래 조용했는지"를 기억 못 했다 —
// stalled(침묵형 막힘) 감지의 유일한 전제조건이라 여기 최소한으로 추가한다(§ orchestrator.cjs checkStalledSubtasks).
const lastWorkingAt = new Map()

function slug(s) {
  return (
    String(s || '')
      .trim()
      .replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'sh'
  )
}

// OpenTask 자신이 Claude Code 세션(개발할 때의 나 자신) 안에서 실행되고 있으면 이 서버 프로세스가
// CLAUDECODE/CLAUDE_CODE_SESSION_ID/CLAUDE_CODE_CHILD_SESSION 등 "이 프로세스는 어느 세션의 자식인가"를
// 나타내는 식별 변수를 통째로 물려받는다. 이걸 그대로 pty 자식에 다시 물려주면, 거기서 띄우는
// 지휘자/서브태스크/비서용 claude 프로세스가 "나는 (나 자신인) 다른 세션의 자식 세션이다"라고 착각한다.
// 확인된 증상 두 가지: (1) 대화 기록이 "중첩 세션이니 안 남긴다"로 조용히 꺼짐(→
// CLAUDE_CODE_FORCE_SESSION_PERSISTENCE로 개별 대응했었음), (2) 프로젝트 레벨 MCP 서버(opentask-control 등,
// ~/.claude.json에 정상 등록돼 있어도)가 로드되지 않아 비서가 MCP 툴을 아예 못 봄(ToolSearch가 빈 결과).
// 둘 다 같은 뿌리라 변수 하나씩 땜질하는 대신, 세션 정체성을 나타내는 변수 전체를 pty 자식 env에서 지운다.
const CLAUDE_IDENTITY_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'AI_AGENT',
  'ORCA_WORKTREE_ID',
  'ORCA_WORKSPACE_ID',
]
function spawnEnv() {
  const env = { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8', LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8' }
  for (const k of CLAUDE_IDENTITY_ENV_KEYS) delete env[k]
  return env
}

// 실제 pty+헤드리스 터미널을 name으로 스폰해 레지스트리에 등록한다. create()/ensureNamed() 공용 내부 함수.
function spawnEntry(name, cwd, { cols = 200, rows = 50 } = {}) {
  const shell = process.env.SHELL || '/bin/zsh'
  const proc = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    // -e LANG 대신 env로 넘김(tmux 전용 플래그였음) — 셸/claude가 UTF-8로 동작 → 한글 안 깨짐.
    env: spawnEnv(),
  })
  const term = new Terminal({ cols, rows, allowProposedApi: true })
  const serializeAddon = new SerializeAddon()
  term.loadAddon(serializeAddon)
  const entry = { proc, term, serializeAddon, cwd, command: null, label: name.slice(PREFIX.length), model: null, kind: 'shell', createdAt: Date.now(), wsClients: new Set(), exited: false }
  sessions.set(name, entry)
  proc.onData((data) => {
    try {
      term.write(data)
    } catch (_) {}
    for (const ws of entry.wsClients) {
      try {
        ws.send(data)
      } catch (_) {}
    }
  })
  proc.onExit(() => {
    entry.exited = true
    for (const ws of entry.wsClients) {
      try {
        ws.close()
      } catch (_) {}
    }
  })
  return entry
}

// tmux 설치 확인은 이제 의미가 없다(node-pty는 이 앱에 번들된 네이티브 모듈, 외부 바이너리 불필요) —
// 온보딩이 그래도 이 엔드포인트를 부르면 항상 "사용 가능"으로 답한다(하위호환, 실질적 체크는 없음).
function checkAvailable() {
  return Promise.resolve({ available: true, version: null, error: null })
}

// OpenRM 소유 세션 목록 + 메타(cwd·현재 프로세스·attach 여부)
async function list() {
  const snap = loadSnap()
  const out = []
  for (const [name, entry] of sessions) {
    if (entry.exited) continue
    const snapKey = snap[name] ? name : Object.keys(snap).find((k) => baseName(k) === baseName(name))
    out.push({
      id: name,
      name,
      label: entry.label,
      created: entry.createdAt,
      attached: entry.wsClients.size > 0,
      cwd: entry.cwd,
      command: entry.command,
      model: entry.model || (snapKey && snap[snapKey].model) || null,
    })
  }
  return out
}

async function exists(name) {
  const e = sessions.get(name)
  return !!e && !e.exited
}

// 초기 지시(seed)를 claude TUI에 실제로 꽂힐 때까지 재시도하며 주입.
// 예전엔 고정 6초 setTimeout이었는데, MCP 인증 체크 등으로 부팅이 그보다 오래 걸리면 입력이
// 아직 준비 안 된 상태의 화면에 꽂혀 조용히 유실됐다(seed가 "주입됨"으로 기록되는데 실제 세션엔
// 아무 지시도 안 들어간 실버그 — 오케스트레이션 "시작"이 아무 반응 없는 것처럼 보이는 원인이었다).
// `❯` 프롬프트 렌더 여부는 스플래시 화면에도 이미 떠 있어 신호가 못 됐다 — 대신 "방금 타이핑한 텍스트가
// 실제로 화면에 반영됐는지"로 검증한다. 매 시도 전엔 Ctrl-U로 이전 시도의 잔여 입력을 지운다.
async function injectSeed(name, oneLine, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  const marker = oneLine.slice(0, 12)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const entry = sessions.get(name)
    if (!entry || entry.exited) return false
    entry.proc.write('\x15') // Ctrl-U — 라인 지우기
    entry.proc.write(oneLine)
    await new Promise((res) => setTimeout(res, 400))
    const screen = capturePane(name) || ''
    if (screen.includes(marker)) {
      // 텍스트가 화면에 꽂힌 것과 그 순간 Enter를 "제출"로 처리할 준비가 된 것은 다르다(claude
      // TUI 버전에 따라 렌더링↔입력 처리 타이밍이 어긋날 수 있음 — 실측: Enter 한 번으로도, 600ms
      // 후 재확인+한 번 더로도 씹혀서 프롬프트에 텍스트만 남고 제출 안 된 채 멈추는 케이스 확인됨,
      // 수동으로 몇 초 뒤 Enter를 다시 보내면 성공함). 프롬프트에서 marker가 사라질 때까지(=제출
      // 완료) 최대 ~18초 동안 1.2초 간격으로 Enter를 반복 재시도한다.
      for (let i = 0; i < 15; i++) {
        entry.proc.write('\r')
        await new Promise((res) => setTimeout(res, 1200))
        const after = capturePane(name) || ''
        if (!after.includes(marker)) break // marker가 화면에서 사라짐 = 제출됨
      }
      return true
    }
    await new Promise((res) => setTimeout(res, intervalMs))
  }
  return false
}

// tmux capture-pane -p(스크롤백 아니라 지금 보이는 화면만)의 대체 — 헤드리스 xterm의 뷰포트만 읽는다.
function capturePane(name) {
  const entry = sessions.get(name)
  if (!entry) return null
  const buf = entry.term.buffer.active
  const lines = []
  for (let i = buf.baseY; i < buf.baseY + entry.term.rows; i++) {
    const line = buf.getLine(i)
    lines.push(line ? line.translateToString(true) : '')
  }
  return lines.join('\n')
}

// "태스크를 새로 키면 새로 켜줘. 세션은 동일해도" — conductorCwd를 폴더별로 분리한 뒤로 그 cwd에
// claude가 이어받을 대화 자체가 없는 게 정상 케이스가 됐다(새 폴더거나, 이전 대화가 옛 공유 cwd
// 아래 있던 경우). `claude --continue`가 "No conversation found to continue"를 내고 그냥 셸
// 프롬프트로 떨어지면, 세션 이름/자리는 그대로 둔 채 같은 세션 안에서 이어받기 없이 새로 켠다 —
// 사람이 매번 죽은 세션을 보고 수동으로 재시작할 필요 없게.
async function watchContinueFallback(name, cmd, fallbackSeed) {
  if (!/--continue\b/.test(String(cmd))) return
  const start = Date.now()
  // "처음엔 컨티뉴가없는데 명령하니까 문제가 생기는거였네" — 8초 안에 못 잡으면 이 워처는 그냥
  // 조용히 포기하고, "No conversation found..." 에러만 화면에 남은 채 아무도 새로 안 켜준다.
  // claude CLI 콜드스타트가 8초를 넘기는 경우가 실측됐다(병렬 세션 많을 때 특히) — 같은 이유로
  // electron/main.cjs의 백엔드 헬스체크도 12초→120초로 늘린 전례가 있다. 60초로 넉넉하게.
  while (Date.now() - start < 60000) {
    await new Promise((res) => setTimeout(res, 500))
    const entry = sessions.get(name)
    if (!entry || entry.exited) return
    const screen = capturePane(name) || ''
    if (/No conversation found to continue/i.test(screen)) {
      const fallback = String(cmd).replace(/\s*--continue\b/, '').trim()
      if (!fallback) return
      // 셸이 "No conversation found..." 에러를 아직 다 그리는 중일 때 바로 다음 명령을 흘려보내면
      // 프롬프트에 씹혀 타이핑만 되고 제출이 안 된 채 남는 경우가 실측됐다(injectSeed가 겪은 것과
      // 같은 종류의 렌더링↔입력 타이밍 문제) — Ctrl-U로 잔여 입력을 지우고 재시도하며, 화면에서
      // 이 명령 문자열 그대로가 사라지거나(=클로드 스플래시가 그 자리를 덮음) claude TUI 신호가
      // 뜨는 걸로 실제 제출을 확인한다.
      for (let i = 0; i < 5; i++) {
        entry.proc.write('\x15')
        entry.proc.write(fallback + '\r')
        await new Promise((res) => setTimeout(res, 1500))
        const after = capturePane(name) || ''
        if (!after.includes(fallback) || /esc to interrupt|for agents|Claude Code/i.test(after)) {
          // "태스크 매니저가 직접 개발했어" — --continue가 실패해 이어받을 대화 없이 맨몸으로 새로
          // 켜진 세션이다. 최초 생성 때만 주는 역할 지시(seed)를 여기서도 넣어주지 않으면 자기가
          // 지휘자인지도 모른 채 평범한 코딩 에이전트처럼 직접 다 구현해버린다.
          const seedText = fallbackSeed && String(fallbackSeed).trim()
          if (seedText) {
            const oneLine = seedText.replace(/[\r\n]+/g, ' ').slice(0, 2000)
            injectSeed(name, oneLine).catch(() => {})
          }
          return
        }
      }
      return
    }
  }
}

// 새 터미널 생성: 워크트리(cwd)에서 셸 프로세스 → (옵션) 명령 실행 + (옵션) 초기 지시(seed) 주입.
// mcpFolderId: 이 세션이 지휘자면 그 folderId — mcpDispatch.cjs를 이 cwd에 등록시킨다(trustFolder 참고).
async function create({ cwd, command, label, seed, model, mcpFolderId, continueFallbackSeed }) {
  if (!cwd) return { ok: false, error: 'cwd 필수' }
  try {
    if (!fs.statSync(cwd).isDirectory()) return { ok: false, error: 'cwd 디렉토리 아님' }
  } catch {
    return { ok: false, error: 'cwd 없음: ' + cwd }
  }
  // 유니크 세션명
  let base = PREFIX + slug(label || cwd.split('/').pop())
  let name = base
  for (let i = 2; sessions.has(name); i++) name = base + '-' + i

  // 모델 자동 배분 — claude 명령인데 호출부가 모델을 안 넘겼으면(오케스트레이터를 거치지 않는 즉석
  // 세션 등) 여기서 기본 배분한다. 이게 없으면 사이드바/탭 어디에도 모델이 안 뜬다(빈 데이터가 아니라
  // 아예 배분 자체가 안 된 것 — orchestrator.cjs가 겪었던 것과 같은 갭).
  if (!model && command && /\bclaude\b/.test(String(command))) model = Settings.modelFor('dev')
  // claude 명령에 --model 주입 (이미 있으면 유지)
  let cmd = command
  if (model && cmd && /(^|\/|\s)claude(\s|$)/.test(String(cmd)) && !/--model/.test(String(cmd))) {
    cmd = String(cmd).replace(/^(\s*\S+)/, `$1 --model ${model}`)
  }
  if (cmd && /\bclaude\b/.test(String(cmd))) trustFolder(cwd, mcpFolderId)

  const entry = spawnEntry(name, cwd)
  entry.command = command || null
  entry.label = label || name.slice(PREFIX.length)
  entry.model = model || null
  entry.kind = kindOf(command)

  if (cmd && String(cmd).trim()) {
    entry.proc.write(String(cmd) + '\r')
    if (/\bclaude\b/.test(String(cmd))) watchContinueFallback(name, cmd, continueFallbackSeed).catch(() => {})
  }
  const seedText = seed && String(seed).trim()
  if (seedText) {
    const oneLine = seedText.replace(/[\r\n]+/g, ' ').slice(0, 2000)
    injectSeed(name, oneLine).catch(() => {})
  }
  recordSession(name, cwd, entry.label, command, model)
  return { ok: true, name, label: entry.label, cwd, command: command || null, model: model || null, modelLabel: model ? Settings.modelLabel(model) : null, seeded: !!seedText }
}

// /term WS가 요청한 이름으로 세션을 "있으면 그대로, 없으면 정확히 그 이름으로" 만든다 — create()처럼
// 이름을 슬러그+중복회피로 다시 계산하지 않는다(WS URL의 session= 파라미터와 실제 세션명이 어긋나면
// 브라우저가 자기가 요청한 세션에 못 붙는다). 명령/시드 없는 맨 셸 — 즉석 "터미널"/"클로드 세션" 탭용.
function ensureNamed(name, cwd) {
  const existing = sessions.get(name)
  if (existing && !existing.exited) return { ok: true, name, created: false }
  try {
    if (!fs.statSync(cwd).isDirectory()) return { ok: false, error: 'cwd 없음: ' + cwd }
  } catch {
    return { ok: false, error: 'cwd 없음: ' + cwd }
  }
  spawnEntry(name, cwd)
  recordSession(name, cwd, name.slice(PREFIX.length), null, null)
  return { ok: true, name, created: true }
}

// WS 연결을 세션에 붙인다 — attach 순간 지금까지의 화면을 그대로 복원(@xterm/addon-serialize, 예전
// tmux attach가 기존 화면을 그대로 보여주던 것과 동일 효과)하고, 이후 실시간 출력을 계속 전달한다.
// 여러 WS가 동시에 붙을 수 있고(다른 사람이 같이 보는 것도 tmux 시절처럼 가능), 하나가 끊겨도(반환된
// detach 호출) 세션 자체(node-pty 프로세스)는 안 죽는다 — 이게 "닫아도 세션은 산다" 요구의 핵심.
function attachWs(name, ws, { cols, rows } = {}) {
  const entry = sessions.get(name)
  if (!entry) return () => {}
  if (cols && rows) {
    try {
      entry.proc.resize(cols, rows)
      entry.term.resize(cols, rows)
    } catch (_) {}
  }
  try {
    const snapshot = entry.serializeAddon.serialize()
    if (snapshot) ws.send(snapshot)
  } catch (_) {}
  entry.wsClients.add(ws)
  return () => entry.wsClients.delete(ws)
}

function write(name, data) {
  const entry = sessions.get(name)
  if (entry && !entry.exited) {
    try {
      entry.proc.write(data)
    } catch (_) {}
  }
}

function resize(name, cols, rows) {
  const entry = sessions.get(name)
  if (entry && !entry.exited) {
    try {
      entry.proc.resize(cols, rows)
      entry.term.resize(cols, rows)
    } catch (_) {}
  }
}

// 재부팅/종료로 사라진(스냅샷엔 있지만 현재 안 떠있는) 세션 목록.
function liveMatches(snapName, liveNames) {
  return liveNames.some((ln) => ln === snapName || ln.startsWith(snapName + '_'))
}
async function restorable() {
  const liveNames = (await list()).map((x) => x.name)
  const snap = loadSnap()
  return Object.keys(snap)
    .filter((n) => !liveMatches(n, liveNames))
    .map((name) => {
      const e = snap[name]
      let dirExists = false
      try {
        dirExists = fs.statSync(e.cwd).isDirectory()
      } catch (_) {}
      return { name, cwd: e.cwd, label: e.label, kind: e.kind, port: e.port, command: e.command, dirExists, savedAt: e.savedAt || 0 }
    })
}
// 복원: dev → 빈 포트로 재시작, agent → claude --continue(직전 대화 이어받기), shell → 빈 셸
async function restoreSession(name) {
  const snap = loadSnap()
  const e = snap[name]
  if (!e) return { ok: false, error: '스냅샷에 없음' }
  if (await exists(name)) return { ok: true, name, alreadyRunning: true } // 이미 떠있으면 성공(노옵) — 실패 아님
  try {
    if (!fs.statSync(e.cwd).isDirectory()) return { ok: false, error: '워크트리 없음: ' + e.cwd }
  } catch (_) {
    return { ok: false, error: '워크트리 없음: ' + e.cwd }
  }
  let command = e.command
  if (e.kind === 'dev') {
    const port = (await freePort()) || 3000
    command = `npm run dev -- -p ${port}`
  } else if (e.kind === 'agent') {
    command = 'claude --continue' // 직전 대화 이어받기 (cwd 기준)
  }
  const r = await create({ cwd: e.cwd, command, label: e.label || name.slice(PREFIX.length) })
  return r.ok ? { ok: true, name: r.name, kind: e.kind, port: portOf(command) } : r
}
async function restore({ name, kind, all } = {}) {
  if (name) return { ok: true, results: [{ name, ...(await restoreSession(name)) }] }
  const items = await restorable()
  const targets = items.filter((e) => e.dirExists && (all || (kind && e.kind === kind)))
  const results = []
  for (const t of targets) results.push({ name: t.name, kind: t.kind, ...(await restoreSession(t.name)) })
  return { ok: true, results }
}
function forget({ name, all } = {}) {
  if (all) {
    saveSnap({})
    return { ok: true, forgotten: 'all' }
  }
  if (name) forgetSession(name)
  return { ok: true, forgotten: name || null }
}

// 세션 화면을 스크레이프해 에이전트 상태 추정 (작업중/입력대기/claude여부 + 마지막 줄).
async function status(name) {
  if (!name || !name.startsWith(PREFIX)) return null
  const entry = sessions.get(name)
  if (!entry || entry.exited) return { exists: false }
  const text = capturePane(name) || ''
  const working = /esc to interrupt/i.test(text)
  const needsAuth = /MFA|ExpiredToken|재인증|인증.*만료|AccessDenied|권한.*요청/i.test(text)
  // ❯ 단독/'to manage'/'for agents'는 claude가 유휴 상태(다음 지시 기다림)일 때도 항상 떠 있는 UI 껍데기라
  // '질문 대기'로 오판(거의 항상 true)했음 — 실제 결정 필요한 프롬프트에서만 뜨는 문구로 좁힌다.
  // ☐(빈 체크박스)는 AskUserQuestion류 구조화 질문(단답/스테퍼 폼) 헤더에서만 관측됨 — 실사용 세션 전수 확인.
  const waiting = !working && /Do you want|계속할까|진행할까|\(y\/n\)|Enter to select|to navigate|Esc to cancel|☐/i.test(text)
  const isClaude = /esc to interrupt|to manage|for agents|claude|tokens|⏵⏵/i.test(text)
  const tail = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' · ')
    .slice(0, 160)
  // "응답없음" 판정(§orchestrator.cjs checkStalledSubtasks)의 기준선. working일 때만 갱신하면 서버가
  // 막 재시작된 직후엔 이 세션에 대한 기록이 아예 없어(인메모리 Map이라 재시작하면 비워짐) 호출부가
  // session.started_at까지 거슬러 올라가 폴백하는데, 몇 시간 전에 시작한 멀쩡한 세션도 그 순간 잠깐
  // idle이면 즉시 "몇 시간째 응답없음"으로 오탐한다. working 여부와 무관하게 "이 세션을 처음 관측한
  // 시각"을 기준선으로 한 번은 찍어둬 — 재시작 후 첫 관측부터 정상적으로 새 유예 기간이 시작되게 한다.
  if (working || !lastWorkingAt.has(name)) lastWorkingAt.set(name, Date.now())
  return { exists: true, working, waiting, needsAuth, isClaude, tail, lastWorkingAt: lastWorkingAt.get(name) || null }
}

// 빈 포트 찾기 (3000~3099 중 LISTEN 안 된 첫 포트)
function listeningPorts() {
  return new Promise((r) =>
    execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { timeout: 5000, maxBuffer: 8 << 20 }, (e, o) => {
      const set = new Set()
      for (const line of String(o || '').split('\n')) {
        const m = line.match(/:(\d+)\s+\(LISTEN\)/)
        if (m) set.add(Number(m[1]))
      }
      r(set)
    }),
  )
}
async function freePort(lo = 3000, hi = 3099) {
  const used = await listeningPorts()
  for (let p = lo; p <= hi; p++) if (!used.has(p)) return p
  return null
}
// 개발서버를 "지정 포트"로 띄움 → 디버깅 페이지에서 그 포트를 바로 볼 수 있게 포트를 반환.
async function startDevServer({ cwd, label }) {
  if (!cwd) return { ok: false, error: 'cwd 필수' }
  // ⚠️ 모든 dev 시작의 단일 관문 — 워크트리 필수 준비를 여기서 보장(어느 호출 경로든 누락 방지):
  //   ① node_modules 심링크(불완전이면 재링크) → 'next: command not found' 재발 차단
  //   ② .env 파일 보강 → next rewrites undefined로 서버 안 뜨는 것 방지
  try {
    const nm = Worktrees.ensureNodeModules(cwd)
    if (!nm.ok) return { ok: false, error: 'node_modules 준비 실패: ' + nm.error }
    Worktrees.copyEnvFiles(cwd)
  } catch (e) {
    return { ok: false, error: '워크트리 준비 실패: ' + String((e && e.message) || e) }
  }
  const port = await freePort()
  if (!port) return { ok: false, error: '빈 포트 없음 (3000-3099)' }
  const r = await create({ cwd, command: `npm run dev -- -p ${port}`, label: label || 'dev-' + cwd.split('/').pop() })
  if (!r.ok) return r
  return { ok: true, port, name: r.name, label: r.label }
}

// 개발서버 끄기 — 그 포트의 프로세스 종료 + 관련 dev 세션 정리.
async function stopDevServer({ port, cwd }) {
  const out = { ok: true, killedPids: [], killedSession: null }
  if (port) {
    const pids = await new Promise((res) =>
      execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { timeout: 5000 }, (e, o) => res(String(o || '').split('\n').map((s) => s.trim()).filter(Boolean))),
    )
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM')
        out.killedPids.push(pid)
      } catch (_) {}
    }
  }
  // 그 dev 세션도 종료 (kind=dev+port 매칭 또는 cwd+node/next)
  for (const [name, entry] of sessions) {
    if (entry.exited) continue
    const devMatch = (entry.kind === 'dev' && (!port || Number(portOf(entry.command)) === Number(port))) || (cwd && entry.cwd === cwd && /node|next|npm/i.test(entry.command || ''))
    if (devMatch) {
      try {
        entry.proc.kill()
      } catch (_) {}
      sessions.delete(name)
      forgetSession(name)
      out.killedSession = name
      break
    }
  }
  return out
}

// list() + 각 세션 상태 (개발실 그리드용)
async function listLive() {
  const live = await list()
  return Promise.all(live.map(async (s) => ({ ...s, status: await status(s.name).catch(() => null) })))
}

// 종료 (orm- 접두만 허용)
async function kill(name) {
  if (!name || !name.startsWith(PREFIX)) return { ok: false, error: 'OpenRM 세션만 종료 가능' }
  const b = baseName(name)
  let killed = 0
  for (const [key, entry] of sessions) {
    if (key === name || baseName(key) === b) {
      try {
        entry.proc.kill()
      } catch (_) {}
      sessions.delete(key)
      killed++
    }
  }
  forgetSession(name) // 스냅샷도 제거 (base 매칭)
  return killed ? { ok: true, killed } : { ok: false, error: '종료 실패 (세션을 못 찾음)' }
}

// 특정 포트의 dev 서버가 도는 세션 찾기 (그 워크트리에서 재시작하기 위함).
// 포트의 '실제' 프로세스 cwd(진실의 원천)를 최우선으로 — 스냅샷 포트는 stale일 수 있어 신뢰 안 함.
//  반환: { cwd(=env를 바꿀 워크트리), session(제자리 재시작 가능한 dev 세션, 없으면 null) }
async function devSessionForPort(port) {
  const p = Number(port)
  if (!p) return null
  // ① 포트 리슨 프로세스의 실제 cwd (lsof) — 지금 그 포트를 서빙하는 서버가 읽는 .env.local 위치
  const pid = await new Promise((res) =>
    execFile('lsof', ['-ti', `tcp:${p}`, '-sTCP:LISTEN'], { timeout: 5000 }, (e, o) => res(String(o || '').split('\n').map((v) => v.trim()).filter(Boolean)[0])),
  )
  let procCwd = null
  if (pid)
    procCwd = await new Promise((res) =>
      execFile('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { timeout: 5000 }, (e, o) => {
        const m = String(o || '').split('\n').find((l) => l.startsWith('n'))
        res(m ? m.slice(1) : null)
      }),
    )
  const sess = await list()
  const isDev = (s) => sessions.get(s.name)?.kind === 'dev'
  if (procCwd) {
    // 실제 cwd와 일치하는 'dev' 세션이 있으면 제자리 재시작 가능
    const s = sess.find((x) => x.cwd === procCwd && isDev(x))
    return { cwd: procCwd, hasSession: !!s, name: s ? s.name : null, id: s ? s.id : null, command: (s && s.command) || `npm run dev -- -p ${p}`, port: p }
  }
  // ② 포트에 프로세스가 없으면(꺼짐) → dev 세션 중 그 포트로 기록된 것으로 폴백
  const s = sess.find((x) => isDev(x) && portOf(x.command) === p)
  if (!s) return null
  return { cwd: s.cwd, hasSession: true, name: s.name, id: s.id, command: s.command || `npm run dev -- -p ${p}`, port: p }
}
// dev 세션을 그 터미널에서 재시작 — Ctrl-C(정상 종료·포트 해제) 후 원래 dev 명령 재실행. 같은 포트/워크트리 유지.
async function restartDevSession({ id, name, command, port }) {
  const tgt = id || name
  if (!tgt) return { ok: false, error: '세션 지정 필요' }
  const entry = sessions.get(tgt)
  if (!entry || entry.exited) return { ok: false, error: '세션 없음' }
  const cmd = command || `npm run dev -- -p ${port}`
  entry.proc.write('\x03') // Ctrl-C
  await new Promise((r) => setTimeout(r, 1800)) // 포트 해제 대기
  entry.proc.write(cmd)
  entry.proc.write('\r')
  entry.command = cmd
  return { ok: true, restartedIn: name || tgt, command: cmd }
}

// "중간에 대화 정지 기능도 있어야함" — claude CLI 자신이 생성 중 화면에 "esc to interrupt"를
// 띄운다(§ status() working 판정에 이미 이 문자열을 씀 — 실제 CLI가 ESC로 중단됨을 확인해주는
// 근거). raw ESC 하나만 pty에 써넣으면 된다 — restartDevSession의 Ctrl-C(\x03)와 같은 raw
// keystroke 패턴.
async function interrupt(name) {
  const entry = sessions.get(name)
  if (!entry || entry.exited) return { ok: false, error: '세션 없음' }
  entry.proc.write('\x1b')
  return { ok: true }
}

// 텍스트/명령 한 줄 전송(원샷 — 진짜 입력은 WS로)
async function send({ name, message, enter = true }) {
  if (!name || !name.startsWith(PREFIX) || !message) return { ok: false, error: 'name·message 필수' }
  const entry = sessions.get(name)
  if (!entry || entry.exited) return { ok: false, error: '세션 없음' }
  entry.proc.write(message)
  if (enter) entry.proc.write('\r')
  return { ok: true, sent: true }
}

module.exports = {
  list,
  listLive,
  status,
  create,
  kill,
  send,
  interrupt,
  exists,
  // "관제에게 질문하는 버튼" — send()는 한 방 던지고 끝(제출 확인 없음)이라 세션이 아직 스플래시
  // 렌더링 중이면 씹혀 유실될 수 있다. injectSeed는 원래 새 세션 최초 지시 전용이었지만 화면에
  // 실제로 찍혔는지 확인하고 제출까지 재시도하는 유일한 함수라 control.cjs의 ask()도 그대로 재사용한다.
  injectSeed,
  startDevServer,
  stopDevServer,
  devSessionForPort,
  restartDevSession,
  freePort,
  restorable,
  restore,
  forget,
  baseName,
  PREFIX,
  checkAvailable,
  trustFolder,
  gitRoot,
  // WS 브리지(index.cjs) 전용 — 세션 레지스트리에 직접 접근.
  ensureNamed,
  attachWs,
  write,
  resize,
}
