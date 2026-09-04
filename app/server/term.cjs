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
// index.cjs와 같은 별칭(AppCfg) — 위 Settings(모델 배정용 server/settings.cjs)와는 다른 모듈이라
// 이름이 겹치면 안 된다. terminalTmux 전역 토글을 읽기 위해서만 쓴다(§ create()의 tmux 자동 래핑).
const AppCfg = require('./store/settings.cjs')

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
// 여러 OpenTask 인스턴스(포트가 다른 실행/데모/테스트)가 이 모노레포 체크아웃 하위의 고정 디렉토리를
// cwd로 쓰면(§control.cjs CONTROL_CWD, §orchestrator.cjs conductorCwd), gitRoot()이 전부 같은 모노레포
// 최상위로 수렴한다 — 그러면 registerControlMcp/trustFolder가 ~/.claude.json에 쓰는 MCP 서버 등록
// (특히 OPENTASK_PORT)을 인스턴스끼리 서로 덮어쓴다. 실제로 격리된 데모 인스턴스의 비서가 이 경합
// 때문에 실제 운영 인스턴스의 포트/DB를 직접 건드리려 시도한 사고로 확인됨. cwd 자신을 독립 git
// 저장소로 만들면 gitRoot()이 그 cwd 자신을 반환해 더 이상 위로 안 올라간다 — .git 존재 여부로
// 1회만 판단해서 호출마다 git init을 스폰하지 않는다.
function ensureOwnGitRoot(dir) {
  try {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      execFileSync('git', ['init', '-q'], { cwd: dir })
    }
  } catch (_) {}
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
// "계속 유지(백그라운드 실행 & 하나의 세션)" — 하이브마인드 전용, tmux가 있으면 control.cjs가 pty에
// 타이핑해 넣는 명령을 `claude --continue` 대신 `tmux new-session -A ...`로 바꿔, 서버가 재시작돼도
// (§ 파일 상단 "⚠️ 트레이드오프" 주석) 실제 claude 프로세스는 tmux 데몬 밑에서 안 죽는다. tmux는
// npm 패키지가 아니라 시스템 바이너리라(패키징된 앱을 받는 다른 팀원 맥엔 없을 수 있음) 있을 때만
// 쓰고 없으면 지금 경로(오늘 고친 DISABLE_UPDATE_PROMPT 복원)로 그대로 폴백 — 모듈 로드 시 1회만
// 확인하고 캐시(존재 여부가 프로세스 도중 바뀔 일은 없음, ensureOwnGitRoot와 같은 캐시 패턴).
let _hasTmux = null
function hasTmux() {
  if (_hasTmux === null) {
    try {
      execFileSync('tmux', ['-V'], { stdio: 'ignore' })
      _hasTmux = true
    } catch (_) {
      _hasTmux = false
    }
  }
  return _hasTmux
}

// "orm-control pane이 general-purpose 서브에이전트 pane 15개에 짓눌려 2칸 폭으로 찌부러짐" — 실제
// 재현·원인 확인(2026-09-01): Task 서브에이전트가 tmux 안에서 돌 때마다 새 pane을 열고, 끝나도
// 자동으로 안 닫힌다(claude CLI 자체 동작 — 이 앱 코드가 pane을 만드는 게 아니라 손쓸 수 없다). 창
// 하나에 빈 pane이 계속 쌓이면 tmux 레이아웃이 기존 pane들을 계속 눌러, 결국 진짜 대화가 오가는
// pane 0까지 몇 칸 폭으로 짜부라지고(실측: 2x29) 그 안 텍스트가 한두 글자씩 줄바꿈되어 완전히 못
// 읽는 화면이 된다 — 맨 처음 보고된 "orm-control" 스크린샷이 정확히 이 모양이었다. 사람이 매번
// 발견해서 수동으로 kill-pane 하는 대신 여기서 주기적으로 정리한다.
//
// 우리가 만든 세션만 건드린다 — 세션 이름 규칙이 둘이다: orm-<slug>(오케스트레이터/서브태스크/컨덕터,
// create()가 스스로 이 이름으로 tmux -s를 감쌈 — Term 이름이 곧 실제 tmux 세션명) 또는
// opentask-control-<port>(하이브마인드, control.cjs가 직접 조립한 tmux 명령이라 Term 쪽 이름
// "orm-control"과 실제 tmux 세션명이 다르다 — 여기서는 실제 tmux 세션명 기준으로 걸러야 한다).
const MANAGED_TMUX_SESSION_RE = /^(orm-|opentask-control-)/
function tmuxRun(args) {
  return new Promise((resolve) => {
    execFile('tmux', args, { timeout: 5000 }, (err, stdout) => resolve(err ? '' : stdout))
  })
}
function tmuxLines(out) {
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}
// pane 0(그 세션의 실제 대화 pane)은 절대 안 건드린다 — 그 외 pane 중 화면 내용이 완전히 빈 것만
// 정리한다(뭔가 찍혀 있으면 지금 뭘 하고 있는 중일 수 있어 그냥 둔다 — 오탐보다 안 지우는 쪽이 안전).
async function cleanupStalePanes() {
  if (!hasTmux()) return { ok: true, cleaned: 0 }
  const sessions_ = tmuxLines(await tmuxRun(['list-sessions', '-F', '#{session_name}'])).filter((s) => MANAGED_TMUX_SESSION_RE.test(s))
  let cleaned = 0
  for (const sess of sessions_) {
    const windows = tmuxLines(await tmuxRun(['list-windows', '-t', sess, '-F', '#{window_index}']))
    for (const win of windows) {
      const paneIdxs = tmuxLines(await tmuxRun(['list-panes', '-t', `${sess}:${win}`, '-F', '#{pane_index}']))
      if (paneIdxs.length <= 1) continue // pane 하나뿐이면(정상) 볼 것도 없음
      // 큰 인덱스부터 처리 — kill-pane 한 번이면 tmux가 남은 pane을 그 자리로 당겨 재번호를 매긴다
      // (실측 확인: pane 1을 지우면 pane 2가 곧바로 pane 1이 됨). 작은 인덱스부터 지우면 아직 안 본
      // 더 큰 인덱스가 그 사이에 통째로 밀려 엉뚱한 pane을 잡을 수 있다 — 큰 것부터면 아직 처리 안 한
      // 더 작은 인덱스들은 이 kill의 영향을 절대 안 받는다(그 위로 당겨올 pane 자체가 없으므로).
      const descending = paneIdxs.filter((pi) => pi !== '0').sort((a, b) => Number(b) - Number(a))
      for (const pi of descending) {
        const target = `${sess}:${win}.${pi}`
        const content = await tmuxRun(['capture-pane', '-t', target, '-p'])
        if (content.trim()) continue
        await tmuxRun(['kill-pane', '-t', target])
        cleaned++
      }
    }
  }
  if (cleaned) console.log(`[term] 빈 서브에이전트 pane ${cleaned}개 정리함`)
  return { ok: true, cleaned }
}

// "고스티도 tmux도 설정 토글로 제공해야해. 둘다 안깔려있는사람은 비활성화하고 경고표기" — Ghostty는
// 시스템 바이너리가 아니라 .app 번들이라 hasTmux()의 execFileSync 방식이 아니라 설치 경로 존재
// 여부로 확인한다(둘 다 흔한 설치 위치 — Homebrew cask도 /Applications에 심음). hasTmux()와 같은
// 캐시 패턴: 프로세스 도중 설치 여부가 바뀔 일은 없다.
let _hasGhostty = null
function hasGhostty() {
  if (_hasGhostty === null) {
    try {
      _hasGhostty = fs.existsSync('/Applications/Ghostty.app') || fs.existsSync(path.join(os.homedir(), 'Applications', 'Ghostty.app'))
    } catch (_) {
      _hasGhostty = false
    }
  }
  return _hasGhostty
}

// AppleScript 문자열 리터럴 안에 넣을 값 이스케이프 — 백슬래시 먼저, 그다음 큰따옴표(순서 중요).
function asEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Ghostty 자체 AppleScript 사전(https://ghostty.org/docs/features/applescript) — macOS에서 `-e`
// 플래그가 막혀 있어(실행 확인 다이얼로그 이슈) 대신 새 창을 만들고 텍스트를 타이핑해 넣는다.
// "터미널을 고스티로 열수는 없는거야?" — 실측(2026-09-02): 예전 `send key return to term`이 이 Ghostty
// 버전에서 "Unknown key name: \r (-1700)"으로 실패했다(AppleScript 문자열 리터럴엔 \n 이스케이프가 없어서
// 입력·제출을 두 단계로 나눴던 이유 자체는 맞지만, 그 제출 수단이 깨짐). `& return`(AppleScript의 CR
// 문자 상수를 문자열에 이어붙이는 표준 관용구)으로 입력과 제출을 한 번의 `input text`로 합쳐 그 서브
// 커맨드 자체를 안 쓴다.
function ghosttyScript(cwd, command) {
  const lines = ['tell application "Ghostty"', '  set cfg to new surface configuration', `  set initial working directory of cfg to "${asEscape(cwd)}"`, '  set win to new window with configuration cfg']
  if (command) {
    lines.push('  set term to focused terminal of selected tab of win')
    lines.push(`  input text ("${asEscape(command)}" & return) to term`)
  }
  lines.push('end tell')
  return lines.join('\n')
}

// "둘 다 설정 토글로... 고스티에서 열기" — 이 세션이 tmuxWrapped면 tmux attach로 지금 대화 그대로
// 붙고(§ create()), 아니면 그 워크트리 경로에서 새 셸만 연다.
// "터미널을 고스티로 열수는 없는거야?" — name(Term 자신의 북키핑 키)이 항상 실제 tmux 세션명인 건
// 아니다: create()가 스스로 tmux로 감쌀 때는 -s name이라 같지만, 호출부가 이미 완성된 tmux 명령을
// 통째로 넘긴 경우(예: control.cjs 하이브마인드 — name은 "orm-control"인데 실제 세션은
// "opentask-control-<port>")는 다르다(실측: 2026-09-02, `tmux attach -t orm-control` 자체가 존재하지
// 않는 세션이라 실패). tmuxWrapped인데 그 원본 명령 문자열 안에 -s 값이 있으면(=호출부가 직접 조립)
// 그걸 우선하고, 없으면(=create() 자신이 감쌈) name 그대로.
function openExternal(name) {
  const entry = sessions.get(name)
  if (!entry) return Promise.resolve({ ok: false, error: '세션을 찾을 수 없습니다' })
  if (!hasGhostty()) return Promise.resolve({ ok: false, error: 'Ghostty가 설치되어 있지 않습니다' })
  const preWrappedMatch = entry.tmuxWrapped && String(entry.command || '').match(/-s\s+(\S+)/)
  const tmuxSessionName = preWrappedMatch ? preWrappedMatch[1] : name
  const command = entry.tmuxWrapped ? `tmux attach -t ${tmuxSessionName}` : null
  const script = ghosttyScript(entry.cwd, command)
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 15000 }, (err) => {
      if (err) resolve({ ok: false, error: String(err.message || err) })
      else resolve({ ok: true, attached: !!command })
    })
  })
}

function spawnEnv() {
  const env = {
    ...process.env,
    LANG: process.env.LANG || 'en_US.UTF-8',
    LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8',
    // "너무 오래걸리네" / "캘린더 갔다오면 초기화돼" — create()가 스폰 직후 곧바로 명령을 pty에 써넣는데,
    // 이 순간 oh-my-zsh의 "Would you like to update? [Y/n]" 대화형 프롬프트가 로그인 셸 초기화 중
    // 떠 있으면 그 입력을 가로채 앞글자를 먹어버린다(실측: "claude --continue"가 "laude --continue"로
    // 잘려 "command not found"로 조용히 실패, 아무 에러 표시 없이 그냥 빈 셸에 멈춰있다 — Term.list()는
    // 셸 프로세스 자체는 살아있다고 보고해 겉으로는 "실행 중"으로 보인다). 하이브마인드뿐 아니라 이 함수를
    // 거치는 모든 pty(지휘자·서브태스크·즉석 세션)가 같은 경합에 노출돼 있었다 — 업데이트 프롬프트 자체를
    // 꺼서 경합의 원인을 없앤다(oh-my-zsh 공식 변수).
    DISABLE_UPDATE_PROMPT: 'true',
  }
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
// 화면 텍스트에서 줄바꿈만 무시하고 비교(공백류를 전부 지운 뒤 부분일치) — 좁은 pty에서 marker
// 자체가 한글 한두 글자씩 줄 경계에 걸려 쪼개지면(§ 위 MIN_PTY_COLS 주석의 사고) 원래는
// `screen.includes(marker)`가 절대 매치하지 않아, 제출을 위한 Enter 재시도 루프 자체가 시작도
// 안 되고 60초 뒤 조용히 포기해 텍스트만 입력창에 남는다(2026-09-01 실측 — MIN_PTY_COLS로 pty가
// 그렇게까지 좁아지는 경로는 막았지만, 그거와 별개로 이 매칭 자체도 더 튼튼하게 고쳐둔다).
function containsIgnoringWhitespace(screen, needle) {
  return screen.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))
}
// 주입 문자열 상한 — 예전엔 호출부마다 `.slice(0, 2000)`이 하드코딩돼 있었는데, 하이브마인드 역할
// 시드가 2,573자로 자라면서 뒤 573자(크론잡·설정 툴 설명, curl 폴백, "■ 원칙", 그리고 ask()로 함께
// 실어 보낸 사람의 실제 질문 "■ 지금 바로 이걸 도와줘")가 통째로 잘려 나가고 있었다 — 조용히 잘리니
// 아무도 몰랐다(2026-09-04 확인). 200열 pty에서 4,000자는 20줄 남짓이라 입력창에 그대로 들어간다.
const INJECT_MAX_CHARS = 4000
function toOneLine(text) {
  return String(text).replace(/[\r\n]+/g, ' ').slice(0, INJECT_MAX_CHARS)
}
async function injectSeed(name, oneLine, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  // 긴 지시문은 붙여넣는 순간 입력창이 여러 줄로 불어나 앞부분이 화면 밖으로 밀릴 수 있다 — 앞 12자
  // 하나만 보면 그때 "안 꽂혔다"로 오판해 60초 내내 재시도만 하다 끝난다. 앞/뒤 어느 쪽이든 보이면
  // 꽂힌 것으로 본다.
  const head = oneLine.slice(0, 12)
  const tail = oneLine.slice(-24)
  const onScreen = (s) => containsIgnoringWhitespace(s, head) || containsIgnoringWhitespace(s, tail)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const entry = sessions.get(name)
    if (!entry || entry.exited) return false
    entry.proc.write('\x15') // Ctrl-U — 라인 지우기
    entry.proc.write(oneLine)
    await new Promise((res) => setTimeout(res, 400))
    const screen = capturePane(name) || ''
    if (onScreen(screen)) {
      // 텍스트가 화면에 꽂힌 것과 그 순간 Enter를 "제출"로 처리할 준비가 된 것은 다르다(claude
      // TUI 버전에 따라 렌더링↔입력 처리 타이밍이 어긋날 수 있음 — 실측: Enter 한 번으로도, 600ms
      // 후 재확인+한 번 더로도 씹혀서 프롬프트에 텍스트만 남고 제출 안 된 채 멈추는 케이스 확인됨,
      // 수동으로 몇 초 뒤 Enter를 다시 보내면 성공함). 프롬프트에서 marker가 사라질 때까지(=제출
      // 완료) 최대 ~18초 동안 1.2초 간격으로 Enter를 반복 재시도한다.
      for (let i = 0; i < 15; i++) {
        entry.proc.write('\r')
        await new Promise((res) => setTimeout(res, 1200))
        const after = capturePane(name) || ''
        if (!onScreen(after)) break // 화면에서 사라짐 = 제출됨
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

// 오래되고 큰 대화를 `--continue`로 이어받을 때 클로드가 띄우는 "요약으로 재개할지" 확인 메뉴 —
// bypassPermissions(도구 승인 우회)는 이 화면엔 안 먹힌다. 별개의 TUI 프롬프트라 사람이 Enter를
// 눌러줘야 넘어가고, 그러기 전까진 세션이 그 화면에 멈춰 서브태스크가 죽은 것처럼 보인다. 기본
// 선택지가 이미 "1. Resume from summary (recommended)"라 Enter만 보내면 그대로 확정된다.
const RESUME_PROMPT_RE = /Resuming the full session will consume|Resume from summary \(recommended\)/i

// "태스크를 새로 키면 새로 켜줘. 세션은 동일해도" — conductorCwd를 폴더별로 분리한 뒤로 그 cwd에
// claude가 이어받을 대화 자체가 없는 게 정상 케이스가 됐다(새 폴더거나, 이전 대화가 옛 공유 cwd
// 아래 있던 경우). `claude --continue`가 "No conversation found to continue"를 내고 그냥 셸
// 프롬프트로 떨어지면, 세션 이름/자리는 그대로 둔 채 같은 세션 안에서 이어받기 없이 새로 켠다 —
// 사람이 매번 죽은 세션을 보고 수동으로 재시작할 필요 없게.
//
// ⚠️ tmux로 감싼 명령(§ control.cjs의 하이브마인드, 아래 create()의 terminalTmux 자동 래핑)에선 이
// "화면을 보고 판단한다"가 통째로 무너진다 — tmux는 붙는 순간 대체 화면(alternate screen)으로
// 넘어가고, 안쪽 claude가 죽으면 세션째 끝나면서 그 화면을 통째로 되돌린다. 실측(2026-09-04, 하이브
// 마인드 전면 먹통 사고)으로 확인된 연쇄: ① "No conversation found..."는 이미 사라지는 중인 tmux
// 화면에서만 잠깐 보이고, ② 그걸 보고 쏜 폴백 명령은 바깥 셸이 아니라 죽어가는 tmux로 들어가 통째로
// 유실되고, ③ 대체 화면이 걷히면 그 문자열이 화면에 없는 게 당연하니 아래 성공 판정이 무조건 참이 돼
// "새로 켜졌다"고 오인하고, ④ 그 상태로 seed까지 주입해 맨 zsh 프롬프트에 역할 지시문이 타이핑된다
// (`zsh: bad pattern: [역할:`). 그 뒤로는 사람이 보낸 말도 전부 셸 명령이 된다(`command not found:
// 전체`) — 세션 자체는 살아있으니 UI는 영원히 "생성 중"으로 돈다. 그래서 tmux 래핑이면 실패 감지도
// 성공 판정도 화면이 아니라 tmux 자신에게 묻는다(has-session).
function tmuxSessionOf(cmd) {
  const m = String(cmd)
    .trim()
    .match(/^tmux\s+new-session\b.*?\s-s\s+(\S+)/)
  return m ? m[1] : null
}
function tmuxAlive(session) {
  if (!session) return false
  try {
    execFileSync('tmux', ['has-session', '-t', session], { stdio: 'ignore' })
    return true
  } catch (_) {
    return false
  }
}

async function watchContinueFallback(name, cmd, fallbackSeed) {
  if (!/--continue\b/.test(String(cmd))) return
  const fallback = String(cmd).replace(/\s*--continue\b/, '').trim()
  if (!fallback) return
  const tmuxName = tmuxSessionOf(cmd)
  const start = Date.now()
  let resumeConfirmed = false
  let deadPolls = 0
  // "처음엔 컨티뉴가없는데 명령하니까 문제가 생기는거였네" — 8초 안에 못 잡으면 이 워처는 그냥
  // 조용히 포기하고, "No conversation found..." 에러만 화면에 남은 채 아무도 새로 안 켜준다.
  // claude CLI 콜드스타트가 8초를 넘기는 경우가 실측됐다(병렬 세션 많을 때 특히) — 같은 이유로
  // electron/main.cjs의 백엔드 헬스체크도 12초→120초로 늘린 전례가 있다. 60초로 넉넉하게.
  while (Date.now() - start < 60000) {
    await new Promise((res) => setTimeout(res, 500))
    const entry = sessions.get(name)
    if (!entry || entry.exited) return
    const screen = capturePane(name) || ''
    if (!resumeConfirmed && RESUME_PROMPT_RE.test(screen)) {
      entry.proc.write('\r')
      resumeConfirmed = true
      continue
    }
    if (tmuxName) {
      // tmux 세션이 살아있으면 정상 — 죽었으면(=안쪽 claude가 즉시 끝났으면) 이유가 뭐든 폴백 대상이다.
      // 셸/tmux 콜드스타트를 감안해 8초는 봐주고, 그 뒤 두 번 연속 없을 때만 실패로 확정한다. 화면의
      // "No conversation found..."를 못 보고 지나쳐도(위 대체 화면 문제) 여기서 잡힌다.
      if (Date.now() - start < 8000 || tmuxAlive(tmuxName)) {
        deadPolls = 0
        continue
      }
      if (++deadPolls < 2) continue
    } else if (!/No conversation found to continue/i.test(screen)) {
      continue
    }
    // 셸이 "No conversation found..." 에러를 아직 다 그리는 중일 때 바로 다음 명령을 흘려보내면
    // 프롬프트에 씹혀 타이핑만 되고 제출이 안 된 채 남는 경우가 실측됐다(injectSeed가 겪은 것과
    // 같은 종류의 렌더링↔입력 타이밍 문제) — Ctrl-U로 잔여 입력을 지우고 재시도하며, 실제로 새
    // 세션이 떴는지 확인될 때까지 최대 4초 기다린 뒤에만 다음 시도로 넘어간다(1.5초 한 번만 보고
    // 재시도하면, 늦게 뜬 세션 안으로 같은 명령을 한 번 더 타이핑해 넣게 된다).
    for (let i = 0; i < 5; i++) {
      const e = sessions.get(name)
      if (!e || e.exited) return
      e.proc.write('\x15')
      e.proc.write(fallback + '\r')
      let relaunched = false
      for (let j = 0; j < 8 && !relaunched; j++) {
        await new Promise((res) => setTimeout(res, 500))
        const after = capturePane(name) || ''
        // tmux면 세션 존재가 유일하게 믿을 수 있는 신호다. 아니면 예전대로 화면에서 이 명령 문자열이
        // 사라지거나(=클로드 스플래시가 그 자리를 덮음) claude TUI 신호가 뜨는 걸로 제출을 확인한다.
        relaunched = tmuxName ? tmuxAlive(tmuxName) : !after.includes(fallback) || /esc to interrupt|for agents|Claude Code/i.test(after)
      }
      if (!relaunched) continue
      // "태스크 매니저가 직접 개발했어" — --continue가 실패해 이어받을 대화 없이 맨몸으로 새로
      // 켜진 세션이다. 최초 생성 때만 주는 역할 지시(seed)를 여기서도 넣어주지 않으면 자기가
      // 지휘자인지도 모른 채 평범한 코딩 에이전트처럼 직접 다 구현해버린다.
      const seedText = fallbackSeed && String(fallbackSeed).trim()
      if (seedText) {
        const oneLine = toOneLine(seedText)
        injectSeed(name, oneLine).catch(() => {})
      }
      return
    }
    return
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

  // "고스티도 tmux도 설정 토글로 제공해야해" — 전역 설정이 켜져 있고 tmux가 실제로 깔려 있으면, 이
  // 세션의 진짜 셸에 심는 명령을 tmux new-session -A로 감싼다(§ control.cjs의 하이브마인드 전용
  // 패턴을 전체 세션으로 일반화). 이미 tmux로 시작하는 명령(예: control.cjs 자체 조립)은 다시 안
  // 감싼다 — 세션명(name)이 곧 tmux 세션명이라 "이 세션이 외부에서 attach 가능한지" 판단에 별도
  // 매핑이 필요 없다(§ openExternal).
  if (cmd && !/^tmux\s/.test(String(cmd).trim()) && hasTmux() && AppCfg.getAppConfig().terminalTmux) {
    const esc = (s) => String(s).replace(/(["\\$`])/g, '\\$1')
    cmd = `tmux new-session -A -s ${name} -c "${esc(cwd)}" "${esc(cmd)}"`
  }

  const entry = spawnEntry(name, cwd)
  entry.command = command || null
  entry.label = label || name.slice(PREFIX.length)
  entry.model = model || null
  entry.kind = kindOf(command)
  entry.tmuxWrapped = /^tmux\s/.test(String(cmd || '').trim())

  if (cmd && String(cmd).trim()) {
    // 갓 스폰한 로그인 셸이 아직 입력을 받을 준비가 되기 전에 들어온 첫 바이트를 먹어버릴 때가
    // 있다(시스템 부하가 클 때 재현 확인 — "claude"가 "laude"로 잘려 들어가 "command not found"가
    // 남) — 실제 명령 앞에 빈 개행을 하나 흘려보내 그 유실을 흡수한다. 셸이 이미 준비돼 있었어도
    // 빈 줄 하나가 프롬프트를 한 번 더 그릴 뿐 부작용은 없다.
    entry.proc.write('\r')
    entry.proc.write(String(cmd) + '\r')
    if (/\bclaude\b/.test(String(cmd))) watchContinueFallback(name, cmd, continueFallbackSeed).catch(() => {})
  }
  const seedText = seed && String(seed).trim()
  if (seedText) {
    const oneLine = toOneLine(seedText)
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
// "질문이 안왔는데?" 조사 중 발견한 별개 사고: 이 pty는 화면에 보여주는 용도(XTerm 위젯 — 좁은
// 도킹 패널에 끼워 넣힐 때도 있다, § ControlPane.tsx LivePromptPanel의 raw 폴백)와 상태 판정의
// 데이터 소스(capturePane — status()/parseLivePrompt가 읽는 바로 그 화면) 둘 다로 동시에 쓰인다.
// 위젯이 작은 컨테이너에 맞춰 resize()를 부르면 그 좁은 크기가 pty 자체를 줄여버려서(실측: 27열까지)
// 데이터 소스 쪽도 같이 망가진다 — 텍스트가 한두 글자씩 줄바꿈되고, injectSeed의 marker 매칭이
// 그 줄바꿈에 걸려 제출이 씹히는 사고로까지 이어졌다(2026-09-01 실측: 처음 보고된 "orm-control"
// 스크린샷의 깨진 화면도 결국 이 경로 — 좁은 뷰포트가 이 pty를 실제로 줄여놓은 상태였다). 화면
// 위젯은 자기보다 넓은 pty를 스크롤해서 보여주면 그만이라 표시 목적으로 이보다 더 좁힐 이유가
// 없다 — 요청 크기와 무관하게 이 바닥 밑으로는 절대 안 내려가게 못박는다.
const MIN_PTY_COLS = 80
const MIN_PTY_ROWS = 24
function clampSize(cols, rows) {
  return [Math.max(cols, MIN_PTY_COLS), Math.max(rows, MIN_PTY_ROWS)]
}

function attachWs(name, ws, { cols, rows } = {}) {
  const entry = sessions.get(name)
  if (!entry) return () => {}
  if (cols && rows) {
    try {
      const [c, r] = clampSize(cols, rows)
      entry.proc.resize(c, r)
      entry.term.resize(c, r)
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
      const [c, r] = clampSize(cols, rows)
      entry.proc.resize(c, r)
      entry.term.resize(c, r)
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
  // "이미 답한 질문인데 또 떴다고 나옴" — working/waiting/needsAuth/needsResume는 전부 "지금 화면에
  // 뭐가 떠 있나"를 묻는 판정인데, 예전엔 capturePane 전체(스크롤백까지 포함해 최대 rows줄, 기본
  // 50줄)를 그대로 정규식에 넣었다. 이미 끝난 대화 속 문장(예: AskUserQuestion에 실제로 있던 질문
  // 문구 "진행할까요?")이 화면 위쪽에 그대로 남아있으면 그 문구가 waiting 정규식과 우연히 겹쳐
  // "아직 대기 중"으로 오판했다(실측, 2026-09-01 — control.cjs getLivePrompt가 이 오탐을 그대로
  // 물려받아 이미 답변까지 끝난 질문을 raw 터미널로 다시 띄우는 버그로 드러남). 실제 살아있는
  // 상태 신호(상태줄·인터랙티브 프롬프트 박스)는 항상 화면 맨 아래(커서 근처)에만 나타나므로,
  // 마지막 24줄만 보고 판정한다 — AskUserQuestion 박스(실측 최대 18줄 안팎)도 여유 있게 들어간다.
  const recent = text.split('\n').slice(-24).join('\n')
  // "서브태스크에 로딩이 안생기는" — 실측: 서버가 뜬 순간(lastWorkingAt) 이후로 실제 작업 중인 세션도
  // 'esc to interrupt'가 한 번도 안 잡혀 42분째 그 값 그대로였다(→ 15분 임계값을 넘겨 stalled로 오판,
  // subChainDot이 stalled를 alive보다 우선해 초록 스피너가 영영 안 뜸). 현재 CLI 상태줄은
  // "Lollygagging… (6m 18s · ↓ 24.4k tokens)"처럼 'esc to interrupt' 없이 "…(…tokens" 꼴로만 뜨는
  // 경우가 실측됨 — 완료 요약줄("Brewed for 8m 57s · done 11:36 AM")은 말줄임표가 없어 안 겹친다.
  const working = /esc to interrupt/i.test(recent) || /…\s*\([^)]*tokens?/i.test(recent)
  const needsAuth = /MFA|ExpiredToken|재인증|인증.*만료|AccessDenied|권한.*요청/i.test(recent)
  // ❯ 단독/'to manage'/'for agents'는 claude가 유휴 상태(다음 지시 기다림)일 때도 항상 떠 있는 UI 껍데기라
  // '질문 대기'로 오판(거의 항상 true)했음 — 실제 결정 필요한 프롬프트에서만 뜨는 문구로 좁힌다.
  // ☐(빈 체크박스)는 AskUserQuestion류 구조화 질문(단답/스테퍼 폼) 헤더에서만 관측됨 — 실사용 세션 전수 확인.
  const waiting = !working && /Do you want|계속할까|진행할까|\(y\/n\)|Enter to select|to navigate|Esc to cancel|☐/i.test(recent)
  // watchContinueFallback이 보통 이 화면을 Enter로 자동 확정하지만, 그 워처는 세션 생성 직후 60초만
  // 지켜본다 — 그 창을 놓치면(예: 앱이 오래 떠 있다가 뒤늦게 이 화면이 뜨는 경우) waiting에도 걸리긴
  // 하지만 원인이 뭉뚱그려진다. 재개 확인 메뉴라는 걸 구체적으로 알 수 있게 따로 뗀다.
  const needsResume = RESUME_PROMPT_RE.test(recent)
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
  return { exists: true, working, waiting, needsAuth, needsResume, isClaude, tail, lastWorkingAt: lastWorkingAt.get(name) || null }
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
  toOneLine, // injectSeed에 넣기 전 정규화(개행 제거 + 상한) — 호출부마다 다른 숫자를 쓰지 않게.
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
  ensureOwnGitRoot,
  hasTmux,
  hasGhostty,
  openExternal,
  // WS 브리지(index.cjs) 전용 — 세션 레지스트리에 직접 접근.
  ensureNamed,
  attachWs,
  write,
  resize,
  // "질문이 안왔는데?" — AskUserQuestion류 인터랙티브 프롬프트는 사람이 답하기 전까진 jsonl 대화
  // 기록에 아예 안 쓰인다(실측 확인, § control.cjs parseLivePrompt). 대화 기록 폴링으론 원천적으로
  // 못 잡으니, 살아있는 pty 화면(xterm.js 헤드리스 버퍼 — tmux 유무와 무관하게 항상 동작)을 직접
  // 읽어야 한다. status()가 이미 내부적으로 쓰던 걸 control.cjs에서도 쓸 수 있게 노출한다.
  capturePane,
  // "orm-control pane이 짜부라짐" 안전망(§ 위 cleanupStalePanes 주석) — index.cjs가 주기적으로 호출.
  cleanupStalePanes,
}
