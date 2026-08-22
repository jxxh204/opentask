// term.cjs — OpenRM이 직접 호스팅하는 진짜 터미널. tmux 세션(영속) + node-pty 브리지(WS는 index.cjs).
// 세션은 'orm-' 접두로 격리 — OpenRM이 만든 것만 list/kill 한다(임의 tmux 세션 보호).
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const Worktrees = require('./worktrees.cjs') // dev 시작 시 node_modules/env 보장용 (worktrees→collector, 순환 없음)
const Settings = require('./settings.cjs')

// claude가 한 번도 안 본 cwd에서는 "이 폴더를 신뢰하시겠습니까?" 1회성 확인 다이얼로그가 뜨는데,
// 이게 뜨면 send-keys로 보낸 seed가 다이얼로그 위에 얹혀 채팅으로 전달되지 못하고 유실된다 —
// 오케스트레이션은 태스크마다 새 git worktree(=한 번도 안 본 경로)를 만드므로 매번 이 게이트에 걸린다.
// 워크트리는 사용자가 Setup에서 지정한 자기 레포 안이므로, "Yes, I trust this folder"를 직접 누르는 것과
// 동일하게 미리 신뢰 등록해 다이얼로그 자체가 안 뜨게 한다. 실패해도 세션 생성은 막지 않음(다이얼로그가
// 뜨면 뜨는 대로 진행 — best-effort).
const CLAUDE_CONFIG_PATH = process.env.OPENRM_CLAUDE_CONFIG || path.join(os.homedir(), '.claude.json')
// mcpFolderId가 있으면 이 세션은 지휘자다 — mcpDispatch.cjs(§12 "지휘 방식 개선")를 이 cwd의
// mcpServers에 등록해 curl-in-prompt 대신 구조화된 MCP 툴(dispatch_subtask/log_event/set_subtask_kind)을
// 쓸 수 있게 한다. 사람 개입 없이 자동 — trustFolder()가 이미 하고 있던 "신뢰 다이얼로그 미리 우회"와
// 같은 자리, 같은 방식.
function trustFolder(cwd, mcpFolderId) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf8'))
    cfg.projects = cfg.projects || {}
    const existing = cfg.projects[cwd] || {}
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
    cfg.projects[cwd] = {
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
// 필드 구분자 — 멀티문자 토큰. tmux 3.6a가 \x1f 등 제어문자(<0x20)를 format 출력에서 삭제하므로
// 세션명·cwd·명령에 절대 안 나오는 토큰 사용. (재부팅 후 /usr/local/bin/tmux 3.6a로 바뀌며 \x1f가 깨졌던 버그)
const US = '|:orm:|'

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
// cmux가 세션을 'orm-X_<10자리ts>_<n>_<cwd>_...'로 리네임 → 안정적 베이스(앞부분)만 추출.
// 이름에 . / 가 섞여 tmux new-session 라운드트립이 깨지므로, 항상 베이스로 매칭/attach 한다.
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
  // 정확 일치 + cmux 리네임(긴 이름)으로 들어온 경우 base 키도 제거
  for (const k of Object.keys(s)) {
    if (k === name || name === k || name.startsWith(k + '_')) {
      delete s[k]
      changed = true
    }
  }
  if (changed) saveSnap(s)
}

function tmux(args, timeout = 5000) {
  return new Promise((resolve) =>
    execFile('tmux', args, { timeout, maxBuffer: 4 << 20, env: process.env }, (e, out, err) =>
      resolve({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') }),
    ),
  )
}

// tmux 설치 여부 확인 — 온보딩의 필수 스텝. 개발실 오케스트레이션·개발실/디버깅의 실터미널이
// 전부 tmux에 의존하므로, 없으면 여기서 조기에 안내한다(오류를 나중에 개별 기능에서 겪지 않도록).
function checkAvailable() {
  return tmux(['-V'], 3000).then((r) => ({
    available: r.ok,
    version: r.ok ? r.out.trim() : null,
    error: r.ok ? null : (r.err || '실행 파일을 찾을 수 없음').trim(),
  }))
}

function slug(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'sh'
}

// OpenRM 소유 세션 목록 + 메타(cwd·현재 프로세스·attach 여부)
async function list() {
  // session_id($N)도 — 리네임된 이름엔 . 가 있어 -t 이름 타겟이 깨지므로 id로 죽인다.
  const r = await tmux(['list-sessions', '-F', ['#{session_id}', '#{session_name}', '#{session_created}', '#{session_attached}', '#{pane_current_path}', '#{pane_current_command}'].join(US)])
  if (!r.ok) return [] // 서버 없음 등
  const snap = loadSnap()
  const out = []
  for (const line of r.out.split('\n')) {
    if (!line) continue
    const [id, name, created, attached, cwd, cmd] = line.split(US)
    if (!name || !name.startsWith(PREFIX)) continue
    // 세션에 배분된 모델 — 스냅샷에서(정확 일치 or 베이스명 매칭, cmux 리네임 대비)
    const snapKey = snap[name] ? name : Object.keys(snap).find((k) => baseName(k) === baseName(name))
    out.push({ id, name, label: name.slice(PREFIX.length), created: Number(created) * 1000 || null, attached: attached === '1', cwd, command: cmd, model: (snapKey && snap[snapKey].model) || null })
  }
  return out
}

async function exists(name) {
  return (await tmux(['has-session', '-t', name])).ok
}

// 초기 지시(seed)를 claude TUI에 실제로 꽂힐 때까지 재시도하며 주입.
// 예전엔 고정 6초 setTimeout이었는데, MCP 인증 체크 등으로 부팅이 그보다 오래 걸리면 send-keys가
// 아직 입력을 못 받는 상태의 pane에 꽂혀 조용히 유실됐다(seed가 "주입됨"으로 기록되는데 실제 세션엔
// 아무 지시도 안 들어간 실버그 — 오케스트레이션 "시작"이 아무 반응 없는 것처럼 보이는 원인이었다).
// `❯` 프롬프트 렌더 여부는 스플래시 화면에도 이미 떠 있어 신호가 못 됐다 — 대신 "방금 타이핑한 텍스트가
// 실제로 화면에 반영됐는지"로 검증한다. 매 시도 전엔 C-u로 이전 시도의 잔여 입력을 지운다.
async function injectSeed(name, oneLine, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  const marker = oneLine.slice(0, 12)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await tmux(['send-keys', '-t', name, 'C-u'])
    await tmux(['send-keys', '-t', name, '-l', oneLine])
    await new Promise((res) => setTimeout(res, 400))
    const check = await tmux(['capture-pane', '-p', '-t', name])
    if (check.ok && check.out.includes(marker)) {
      // 텍스트가 화면에 꽂힌 것과 그 순간 Enter를 "제출"로 처리할 준비가 된 것은 다르다(claude
      // TUI 버전에 따라 렌더링↔입력 처리 타이밍이 어긋날 수 있음 — 실측: Enter 한 번으로도, 600ms
      // 후 재확인+한 번 더로도 씹혀서 프롬프트에 텍스트만 남고 제출 안 된 채 멈추는 케이스 확인됨,
      // 수동으로 몇 초 뒤 Enter를 다시 보내면 성공함). 프롬프트에서 marker가 사라질 때까지(=제출
      // 완료) 최대 ~18초 동안 1.2초 간격으로 Enter를 반복 재시도한다.
      for (let i = 0; i < 15; i++) {
        await tmux(['send-keys', '-t', name, 'Enter'])
        await new Promise((res) => setTimeout(res, 1200))
        const after = await tmux(['capture-pane', '-p', '-t', name])
        if (!after.ok || !after.out.includes(marker)) break // marker가 프롬프트에서 사라짐 = 제출됨
      }
      return true
    }
    await new Promise((res) => setTimeout(res, intervalMs))
  }
  return false
}

// 새 터미널 생성: 워크트리(cwd)에서 detached 세션 → (옵션) 명령 실행 + (옵션) 초기 지시(seed) 주입.
// mcpFolderId: 이 세션이 지휘자면 그 folderId — mcpDispatch.cjs를 이 cwd에 등록시킨다(trustFolder 참고).
async function create({ cwd, command, label, seed, model, mcpFolderId }) {
  if (!cwd) return { ok: false, error: 'cwd 필수' }
  try {
    if (!fs.statSync(cwd).isDirectory()) return { ok: false, error: 'cwd 디렉토리 아님' }
  } catch {
    return { ok: false, error: 'cwd 없음: ' + cwd }
  }
  // 유니크 세션명
  let base = PREFIX + slug(label || cwd.split('/').pop())
  let name = base
  for (let i = 2; await exists(name); i++) name = base + '-' + i

  // -e LANG: 세션 셸/claude가 UTF-8로 동작 → 한글 안 깨짐 (launchd 서버엔 LANG 없어 필수)
  const created = await tmux(['new-session', '-d', '-s', name, '-c', cwd, '-x', '200', '-y', '50', '-e', 'LANG=en_US.UTF-8', '-e', 'LC_CTYPE=en_US.UTF-8'])
  if (!created.ok) return { ok: false, error: 'tmux new-session 실패: ' + created.err }
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
  if (cmd && String(cmd).trim()) {
    await tmux(['send-keys', '-t', name, String(cmd), 'Enter'])
  }
  const seedText = seed && String(seed).trim()
  if (seedText) {
    const oneLine = seedText.replace(/[\r\n]+/g, ' ').slice(0, 2000)
    injectSeed(name, oneLine).catch(() => {})
  }
  recordSession(name, cwd, label || name.slice(PREFIX.length), command, model)
  return { ok: true, name, label: name.slice(PREFIX.length), cwd, command: command || null, model: model || null, modelLabel: model ? Settings.modelLabel(model) : null, seeded: !!seedText }
}

// 재부팅/종료로 사라진(스냅샷엔 있지만 현재 안 떠있는) 세션 목록.
// claude(cmux) 실행 시 세션명이 'orm-X_<ts>_..._<ver>'로 바뀌므로 prefix로 살아있음 판정.
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
      return { name, cwd: e.cwd, label: e.label, kind: e.kind, port: e.port, command: e.command, dirExists }
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
  const scr = await tmux(['capture-pane', '-t', name, '-p'])
  if (!scr.ok) return { exists: false }
  const text = scr.out
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
  return { exists: true, working, waiting, needsAuth, isClaude, tail }
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

// 개발서버 끄기 — 그 포트의 프로세스 종료 + 관련 dev tmux 세션 정리.
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
  // 그 dev tmux 세션도 종료 (스냅샷 kind=dev+port 매칭 또는 cwd+node/next)
  try {
    const snap = loadSnap()
    const live = await list()
    for (const s of live) {
      const meta = snap[baseName(s.name)] || snap[s.name]
      const devMatch = (meta && meta.kind === 'dev' && (!port || Number(meta.port) === Number(port))) || (cwd && s.cwd === cwd && /node|next|npm/i.test(s.command || ''))
      if (devMatch) {
        await tmux(['kill-session', '-t', s.id || s.name])
        forgetSession(s.name)
        out.killedSession = s.name
        break
      }
    }
  } catch (_) {}
  return out
}

// list() + 각 세션 상태 (개발실 그리드용)
async function listLive() {
  const sessions = await list()
  return Promise.all(sessions.map(async (s) => ({ ...s, status: await status(s.name).catch(() => null) })))
}

// 종료 (orm- 접두만 허용)
async function kill(name) {
  if (!name || !name.startsWith(PREFIX)) return { ok: false, error: 'OpenRM 세션만 종료 가능' }
  // cmux 리네임/중첩으로 같은 베이스의 세션이 여러 개일 수 있어 — 베이스 매칭으로 전부 종료(쓰레기 정리).
  const b = baseName(name)
  const live = await list()
  // 이름에 . 가 있으면 -t 이름 타겟 불가 → session_id($N)로 종료 (id 있을 때만)
  const targets = live.filter((s) => s.name === name || baseName(s.name) === b)
  let killed = 0
  for (const t of targets) {
    const r = await tmux(['kill-session', '-t', t.id || t.name])
    if (r.ok) killed++
  }
  if (!targets.length) {
    // 라이브 목록에 없으면 마지막으로 이름으로 시도
    const r = await tmux(['kill-session', '-t', name])
    if (r.ok) killed++
  }
  forgetSession(name) // 스냅샷도 제거 (base 매칭)
  return killed ? { ok: true, killed } : { ok: false, error: '종료 실패 (세션을 못 찾음)' }
}

// 특정 포트의 dev 서버가 도는 tmux 세션 찾기 (그 워크트리에서 재시작하기 위함).
// 포트의 '실제' 프로세스 cwd(진실의 원천)를 최우선으로 — 스냅샷 포트는 stale일 수 있어 신뢰 안 함.
//  반환: { cwd(=env를 바꿀 워크트리), session(제자리 재시작 가능한 dev tmux, 없으면 null) }
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
  const sessions = await list()
  const snap = loadSnap()
  const snapKeyFor = (name) => (snap[name] ? name : Object.keys(snap).find((k) => baseName(k) === baseName(name)))
  const devKey = (x) => { const k = snapKeyFor(x.name); return k && snap[k].kind === 'dev' ? k : null }
  if (procCwd) {
    // 실제 cwd와 일치하는 'dev' tmux 세션이 있으면 제자리 재시작 가능
    const s = sessions.find((x) => x.cwd === procCwd && devKey(x))
    const k = s ? devKey(s) : null
    return { cwd: procCwd, hasSession: !!s, name: s ? s.name : null, id: s ? s.id : null, command: (k && snap[k].command) || `npm run dev -- -p ${p}`, port: p }
  }
  // ② 포트에 프로세스가 없으면(꺼짐) → 스냅샷 dev 세션으로 폴백 (그 세션에서 다시 띄움)
  const s = sessions.find((x) => { const k = devKey(x); return k && snap[k].port === p })
  if (!s) return null
  const k = devKey(s)
  return { cwd: s.cwd, hasSession: true, name: s.name, id: s.id, command: (k && snap[k].command) || `npm run dev -- -p ${p}`, port: p }
}
// dev 세션을 그 터미널에서 재시작 — Ctrl-C(정상 종료·포트 해제) 후 원래 dev 명령 재실행. 같은 포트/워크트리 유지.
async function restartDevSession({ id, name, command, port }) {
  const tgt = id || name
  if (!tgt) return { ok: false, error: '세션 지정 필요' }
  const cmd = command || `npm run dev -- -p ${port}`
  await tmux(['send-keys', '-t', tgt, 'C-c'])
  await new Promise((r) => setTimeout(r, 1800)) // 포트 해제 대기
  await tmux(['send-keys', '-t', tgt, '-l', cmd])
  await tmux(['send-keys', '-t', tgt, 'Enter'])
  return { ok: true, restartedIn: name || tgt, command: cmd }
}

// 텍스트/명령 한 줄 전송(원샷 — 진짜 입력은 WS로)
async function send({ name, message, enter = true }) {
  if (!name || !name.startsWith(PREFIX) || !message) return { ok: false, error: 'name·message 필수' }
  if (!(await exists(name))) return { ok: false, error: '세션 없음' }
  const typed = await tmux(['send-keys', '-t', name, '-l', message])
  if (!typed.ok) return { ok: false, error: typed.err }
  if (enter) await tmux(['send-keys', '-t', name, 'Enter'])
  return { ok: true, sent: true }
}

module.exports = { list, listLive, status, create, kill, send, exists, startDevServer, stopDevServer, devSessionForPort, restartDevSession, freePort, restorable, restore, forget, baseName, PREFIX, checkAvailable, trustFolder }
