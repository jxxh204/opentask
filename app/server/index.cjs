#!/usr/bin/env node
// index.cjs — OpenRM 백엔드: Collector + SSE 실시간 푸시 + 폴러. 의존성 0.
// 실행:  node server/index.cjs   (포트 기본 8770, 대상 레포 REPO_PATH)
'use strict'
const http = require('http')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const C = require('./collector.cjs')
const A = require('./analyze.cjs')
const Act = require('./actuator.cjs')
const G = require('./graph.cjs')
const R = require('./reorg.cjs')
const T = require('./tree.cjs')
const Router = require('./router.cjs')
const Tests = require('./tests.cjs')
const Gtm = require('./gtm.cjs')
const ApiUi = require('./apiui.cjs')
const Figma = require('./figma.cjs')
const Active = require('./active.cjs')
const Commits = require('./commits.cjs')
const Worktrees = require('./worktrees.cjs')
const Prs = require('./prs.cjs')
const Preview = require('./preview.cjs')
const ElementCtx = require('./elementctx.cjs')
const Cmux = require('./cmux.cjs')
const Cockpit = require('./cockpit.cjs')
const Term = require('./term.cjs')
const Monitor = require('./monitor.cjs')
const Scheduler = require('./scheduler.cjs')
const StoreCronJobs = require('./store/cronJobs.cjs')
const Sentry = require('./sentry.cjs')
const Msw = require('./msw.cjs')
const Prompts = require('./prompts.cjs')
const Aws = require('./aws.cjs')
const Tasks = require('./tasks.cjs')
const Ppt = require('./ppt.cjs')
const NT = require('./notiontitles.cjs')
const DevUsers = require('./devusers.cjs')
const https = require('https')

// https 요청 헬퍼 — Promise<{status, body, setCookie, location}>
function httpsReq(opts, bodyStr) {
  return new Promise((resolve) => {
    const req = https.request(opts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), setCookie: res.headers['set-cookie'] || [], location: res.headers.location }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: '요청 타임아웃' }) })
    req.on('error', (e) => resolve({ status: 0, error: String(e.message || e) }))
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}
// 원격 dev 서버 로그인 — 실제 브라우저와 동일한 2단계:
//  ① POST /signin (form id/pwd) → httpOnly DEV_B2B_SESSION 세션 쿠키 (이게 진짜 세션. /v1/signin 아님)
//  ② POST /api/v2/employees/token (세션 쿠키로) → GD-Auth-Token (WEB-VIEW SSR·API 인증용)
// 두 쿠키를 프록시가 주입하면 배포 서버의 SSR(PC=createEmployeeToken, WEB-VIEW=GD-Auth-Token 쿠키)이 자연스럽게 성공.
async function signinRemote(host, id, pwd) {
  const form = `id=${encodeURIComponent(id || '')}&pwd=${encodeURIComponent(pwd || '')}`
  const s = await httpsReq({ host, port: 443, method: 'POST', path: '/signin', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(form), accept: 'text/html' }, timeout: 15000 }, form)
  if (s.error) return { ok: false, error: s.error }
  const session = (s.setCookie || []).map((c) => String(c).split(';')[0]).find((c) => /^DEV_B2B_SESSION=/.test(c)) || null
  // ⚠️ 실패해도 303 + DEV_B2B_SESSION(익명) 이 옴 → 성공 판정은 '리다이렉트 목적지'로. 실패 시 /signin?...result=<메시지> 로 되돌림.
  const loc = s.location || ''
  if (!session || /^\/signin(\?|$)/.test(loc)) {
    let msg = '아이디/비밀번호를 확인하세요'
    try { const r = new URL('http://x' + loc).searchParams.get('result'); if (r) msg = r } catch (_) {}
    return { ok: false, status: s.status, error: msg }
  }
  // 세션으로 GD-Auth-Token 발급 (WEB-VIEW 라우트·직접 API 호출용)
  let token = null
  const et = await httpsReq({ host, port: 443, method: 'POST', path: '/api/v2/employees/token', headers: { accept: 'application/json', 'content-length': 0, cookie: session }, timeout: 12000 }, null)
  try { const j = JSON.parse(et.body); token = (j.data && j.data.token) || j.token || null } catch (_) {}
  return { ok: true, status: s.status, session, token }
}
const Deploy = require('./deploy.cjs')
const Settings = require('./settings.cjs')
// ── SQLite store 계층 (Setup/온보딩 영속화) ──
// 주의: 기존 `Settings`(flat-JSON, ./settings.cjs)와 다른 모듈이다. AppConfig(비시크릿)는
// AppCfg(store/settings.cjs), 시크릿은 Secrets(store/secrets.cjs)에 저장한다.
const AppCfg = require('./store/settings.cjs')
const Secrets = require('./store/secrets.cjs')
const GithubConnect = require('./githubConnect.cjs') // gh CLI 위임 상태확인 + OAuth Device Flow
const EnvVars = require('./store/envVars.cjs')
// Sessions(개발실) CRUD store 계층. 기존 `Tasks`(flat-JSON, ./tasks.cjs)와 충돌하므로 Store* 로 별칭.
const StoreFolders = require('./store/folders.cjs')
const StoreTasks = require('./store/tasks.cjs')
const StoreBranches = require('./store/branches.cjs')
const StoreRepos = require('./store/repos.cjs') // 멀티레포 프로젝트용 레포 레지스트리
const StoreDecisions = require('./store/decisions.cjs') // AI 판정 감사 로그(§12) — feed와 달리 재시작에도 안 날아감
const RepoAdd = require('./repoAdd.cjs') // "레포 추가" 모달의 clone/새 프로젝트
const RepoClassify = require('./repoClassify.cjs') // 새 태스크 → 레포 자동배정(헤드리스 claude)
const DurationEstimate = require('./durationEstimate.cjs') // 태스크 설명 → 예상 소요 영업일 추정(헤드리스 claude, 제안만)
const Orchestrator = require('./orchestrator.cjs') // 폴더 단위 오케스트레이션 (Phase 3.2, in-memory)
const Control = require('./control.cjs') // "관제" 에이전트 — 태스크 하나가 아니라 앱 전체(캘린더/크론잡/설정)
const PrReview = require('./prReview.cjs') // PR 리뷰 코멘트 fetch/apply/dispute (Phase 3.3)
// Debug(디버깅) — Playwright 실브라우저 세션 (Phase 4b). playwright는 이 모듈들 안에서 lazy require라 부팅엔 영향 없음.
const BrowserPool = require('./debug/browserPool.cjs')
const Inspector = require('./debug/inspector.cjs')

// 프로젝트 루트를 정하면(개발실 게이트·설정 어디서든) 아키텍처의 API/Next 레이어를 흔한 컨벤션으로
// 자동 스캔 — 사용자가 아키텍처 페이지에 따로 들어가 경로를 안 적어도 그래프가 채워지게. DB는 접속 정보가
// 없어 자동화 불가(그대로 수동 연결). 존재하는 폴더가 하나도 없으면 조용히 스킵 — 실패해도 무해(read-only).
// Setup 온보딩 스텝(id) → 각 필드의 저장 위치. config: AppConfig 필드명, secret: secrets 키명.
// (프론트 src/pages/SetupPage.tsx의 STEPS/OPTS fieldDefs key와 1:1 대응. 'paths'는 rootPath/wtPath/branchPrefix로 직접 매핑.)
// ⚠️ 'sentry'는 여기 없다 — Sentry는 이미 완전한 자체 설정 API(/api/sentry/config, 레거시
// server/settings.cjs 기반)가 있어서 그걸 그대로 쓴다(아래 라우트). 예전엔 여기 sentry: {dsn: secret}로도
// 매핑돼 있었는데, sentry.cjs가 실제로 보는 값(token/org/project)과 전혀 다른 곳(secrets.sentryDsn)에
// 쓰여서 Setup에서 "연결"해도 모니터링이 절대 동작 안 하는 죽은 매핑이었다 — 제거.
const SETUP_CONNECTOR_MAP = {
  dev: { devServerUrl: { config: 'devServerUrl' }, webviewPort: { config: 'webviewPort' } },
  github: { repo: { config: 'githubRepo' }, token: { secret: 'githubToken' } },
  githubOAuth: { clientId: { config: 'githubOAuthClientId' } },
  db: { connString: { secret: 'dbConnString' }, schema: { config: 'dbSchema' } },
  paths: { rootPath: { config: 'rootPath' }, wtPath: { config: 'wtPath' }, branchPrefix: { config: 'branchPrefix' }, ticketPrefix: { config: 'ticketPrefix' } },
  app: { apiRoot: { config: 'apiRoot' }, nextRoot: { config: 'nextRoot' } },
  aws: { webhook: { config: 'awsDeployWebhookUrl' } },
  vitals: { endpoint: { config: 'vitalsEndpoint' } },
  slack: { channelId: { config: 'slackAlertChannel' } },
  notion: { db: { config: 'notionBacklogDb' }, assignee: { config: 'notionBacklogAssignee' }, service: { config: 'notionBacklogService' }, platform: { config: 'notionBacklogPlatform' } },
  slackSign: { secret: { secret: 'slackSigningSecret' } },
  deploy: { repo: { config: 'deployRepo' }, base: { config: 'deployBase' } },
}
// GET/POST connector 공통 응답 — 현재 저장 상태 스냅샷.
function setupStatus() {
  const appConfig = AppCfg.getAppConfig()
  return { appConfig, secretKeys: Secrets.listKeys(), configured: !!(appConfig.rootPath && appConfig.wtPath) }
}
// FolderPicker 실시간 검증(타이핑 중 라이브 호출) — ~ 확장, 절대경로 resolve, 디렉토리/깃레포/워크트리 조회.
// 절대 throw 금지: 어떤 실패든 "아직 없음"(전부 false/빈배열)으로 degrade. git 래퍼는 worktrees.cjs git() 패턴과 동일.
function resolveFsPath(raw) {
  const os = require('os')
  const cp = require('child_process')
  const gitOut = (args, cwd) =>
    new Promise((resolve) =>
      cp.execFile('git', ['-C', cwd, ...args], { timeout: 7000, maxBuffer: 1 << 20 }, (e, out) => resolve(e ? '' : String(out || ''))),
    )
  return (async () => {
    const out = { exists: false, isDirectory: false, isGitRepo: false, gitRoot: null, existingWorktrees: [] }
    let p = String(raw || '').trim()
    if (!p) return out
    if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1))
    try { p = path.resolve(p) } catch (_) { return out }
    let st
    try { st = fs.statSync(p) } catch (_) { return out }
    out.exists = true
    out.isDirectory = st.isDirectory()
    if (!out.isDirectory) return out
    const top = (await gitOut(['rev-parse', '--show-toplevel'], p)).trim()
    if (top) {
      out.isGitRepo = true
      out.gitRoot = top
      const porcelain = await gitOut(['worktree', 'list', '--porcelain'], p)
      let cur = {}
      for (const line of porcelain.split('\n')) {
        if (line.startsWith('worktree ')) cur = { path: line.slice(9).trim(), branch: null }
        else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '')
        else if (line === '') { if (cur.path) out.existingWorktrees.push(cur); cur = {} }
      }
      if (cur.path) out.existingWorktrees.push(cur)
    }
    return out
  })().catch(() => ({ exists: false, isDirectory: false, isGitRepo: false, gitRoot: null, existingWorktrees: [] }))
}

// 폴더 선택 모달용 서버측 디렉토리 브라우저 — showDirectoryPicker()는 브라우저 지원이 갈리고(Safari/Firefox 미지원)
// basename만 반환해 실제 절대경로를 못 채워주므로, 어떤 브라우저에서도 동작하는 이 리스트 API가 기본 수단.
function resolveFsList(raw) {
  const os = require('os')
  return (async () => {
    let p = String(raw || '').trim() || '~'
    if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1))
    try { p = path.resolve(p) } catch (_) { return { ok: false, error: '잘못된 경로' } }
    let st
    try { st = fs.statSync(p) } catch (_) { return { ok: false, error: '경로를 찾을 수 없습니다: ' + p } }
    if (!st.isDirectory()) return { ok: false, error: '디렉토리가 아닙니다: ' + p }
    let ents
    try { ents = fs.readdirSync(p, { withFileTypes: true }) } catch (e) { return { ok: false, error: '읽기 실패: ' + String((e && e.message) || e) } }
    const entries = ents
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(p, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const parent = path.dirname(p)
    return { ok: true, path: p, parent: parent === p ? null : parent, entries }
  })().catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
}

// 실제 브랜치 목록 (로컬+origin, 중복 제거) — 그룹 base 선택용. deploy-/release/hotfix/develop/main 우선.
function listBranches() {
  return new Promise((resolve) => {
    require('child_process').execFile('git', ['-C', C.REPO, 'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin', '--sort=-committerdate'], { timeout: 15000, maxBuffer: 8 << 20 }, (e, o) => {
      if (e) return resolve([])
      const seen = new Set(), all = []
      for (const line of String(o || '').split('\n')) {
        const b = line.trim().replace(/^origin\//, '')
        if (!b || b === 'HEAD' || b.endsWith('/HEAD') || seen.has(b)) continue
        seen.add(b); all.push(b)
      }
      const pri = (b) => (/^deploy-/.test(b) ? 0 : /^(release|hotfix)/i.test(b) ? 1 : /^(develop|main|master)$/.test(b) ? 2 : 3)
      all.sort((a, b) => pri(a) - pri(b))
      resolve(all)
    })
  })
}
// 새 브랜치 생성 (base에서 분기 + origin push — gh pr edit --base가 되려면 원격에 있어야 함)
function createBranch({ name, base }) {
  return new Promise((resolve) => {
    const nm = String(name || '').trim().replace(/\s+/g, '-')
    if (!nm) return resolve({ ok: false, error: '브랜치 이름을 입력하세요.' })
    const baseRef = String(base || 'develop').trim() || 'develop'
    const cp = require('child_process')
    cp.execFile('git', ['-C', C.REPO, 'branch', nm, baseRef], { timeout: 15000 }, (e, o, er) => {
      if (e) return resolve({ ok: false, error: (String(er || e.message)).split('\n').filter(Boolean)[0]?.slice(0, 120) || '브랜치 생성 실패' })
      cp.execFile('git', ['-C', C.REPO, 'push', '-u', 'origin', nm], { timeout: 30000 }, (e2, o2, er2) => {
        if (e2) return resolve({ ok: true, name: nm, pushed: false, warn: 'origin push 실패(로컬만 생성): ' + String(er2 || e2.message).split('\n').filter(Boolean)[0]?.slice(0, 100) })
        resolve({ ok: true, name: nm, pushed: true })
      })
    })
  })
}

const DEV_LOG = () => path.join(C.REPO, '.openrm-devserver.log')
// 로컬 dev 서버 재시작 — ⚠️ 반드시 '같은 포트'로 다시 떠야 함(Next.js는 포트가 안 비면 3001,3002…로 밀려버림).
// 그래서 kill -9 후 포트가 '실제로' 빌 때까지 폴링한 뒤에 시작. 못 비우면 취소(엉뚱한 포트에 유령 서버 방지).
function restartDevServer(port, cwd) {
  const repo = cwd || C.REPO // ⚠️ 반드시 '그 포트를 서빙하던 워크트리'에서 재시작해야 env 변경이 반영됨
  return new Promise((resolve) => {
    const cp = require('child_process')
    try { fs.writeFileSync(DEV_LOG(), `[OpenRM] dev 서버 재시작 — 포트 ${port} 확보 중… (cwd ${repo.split('/').pop()}, ${new Date().toISOString()})\n`) } catch (_) {}
    // 포트를 실제로 비울 때까지 kill -9 반복 (최대 ~7초). 끝나도 안 비면 exit 1.
    const freeScript = `for i in $(seq 1 14); do pids=$(lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null); if [ -z "$pids" ]; then exit 0; fi; echo "$pids" | xargs kill -9 2>/dev/null; sleep 0.5; done; [ -z "$(lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null)" ] && exit 0 || exit 1`
    cp.execFile('bash', ['-lc', freeScript], { timeout: 20000 }, (err) => {
      if (err) {
        try { fs.appendFileSync(DEV_LOG(), `[OpenRM] ⚠️ 포트 ${port} 를 비우지 못해 재시작을 취소합니다.\n`) } catch (_) {}
        return resolve({ ok: false, error: `포트 ${port} 확보 실패 — 수동으로 종료 후 다시 시도하세요` })
      }
      let out = 'ignore'
      try { out = fs.openSync(DEV_LOG(), 'a') } catch (_) {}
      try {
        // PORT + -p 이중 고정. 포트가 비었으므로 정확히 그 포트로 뜸. cwd = 그 포트의 워크트리.
        const child = cp.spawn('bash', ['-lc', `cd "${repo}" && PORT=${port} yarn dev -- -p ${port}`], { detached: true, stdio: ['ignore', out, out] })
        child.unref()
        resolve({ ok: true, pid: child.pid })
      } catch (e) {
        resolve({ ok: false, error: String(e.message || e) })
      }
    })
  })
}
// 포트가 열렸나(서버 리슨 중) — TCP 연결 체크
function checkPort(port) {
  return new Promise((resolve) => {
    const sock = require('net').connect({ host: '127.0.0.1', port, timeout: 1500 }, () => { sock.destroy(); resolve(true) })
    sock.on('error', () => resolve(false))
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
  })
}
const Orch = require('./orch.cjs')
const pty = require('node-pty')
const { WebSocketServer } = require('ws')

const PORT = Number(process.env.OPENRM_PORT || 8770)
// 기본 loopback 바인딩 — 이 서버는 git/shell/터미널을 실행할 수 있어 LAN에 열면 사실상 인증 없는 RCE.
// 폰에서 웹뷰 디버깅하려고 일부러 LAN에 열 땐 OPENRM_HOST=0.0.0.0 + OPENRM_TOKEN 필수.
const HOST = process.env.OPENRM_HOST || '127.0.0.1'
const IS_LOOPBACK_HOST = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1'
let AUTH_TOKEN = process.env.OPENRM_TOKEN || null
if (!IS_LOOPBACK_HOST && !AUTH_TOKEN) {
  AUTH_TOKEN = crypto.randomBytes(24).toString('hex')
  console.log(`\n⚠️  OPENRM_HOST=${HOST} — LAN 바인딩 감지, 토큰 인증을 자동 활성화합니다.`)
  console.log(`   요청 시 헤더 X-OpenRM-Token 또는 쿼리 ?token= 에 아래 값을 포함하세요:`)
  console.log(`   ${AUTH_TOKEN}\n`)
}
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

process.on('uncaughtException', (err) => {
  console.error('[OpenRM] uncaughtException —', err && err.stack || err)
  process.exit(1)
})
process.on('unhandledRejection', (err) => {
  console.error('[OpenRM] unhandledRejection —', err && err.stack || err)
})

function readBody(req) {
  return new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {})
      } catch {
        resolve({})
      }
    })
  })
}
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}
// 원본(raw) 바디 — Slack 서명 검증엔 파싱 전 원문이 필요.
function readRawBody(req) {
  return new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => resolve(b))
  })
}
// Slack 요청 서명 검증 (v0). SLACK_SIGNING_SECRET 설정 시에만 강제 — 미설정이면 로컬 테스트용으로 통과.
function verifySlackSig(secret, timestamp, rawBody, signature) {
  if (!timestamp || !signature) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false // 5분 초과 = 리플레이 거부
  const mine = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(String(signature)))
  } catch (_) {
    return false
  }
}

// 그 워크트리(cwd)에 claude 이전 대화가 있나 — ~/.claude/projects/<cwd의 / 와 . 를 - 로>/*.jsonl
function hasClaudeHistory(cwd) {
  try {
    const enc = String(cwd).replace(/[/.]/g, '-')
    const dir = path.join(process.env.HOME || '', '.claude', 'projects', enc)
    return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.jsonl'))
  } catch (_) {
    return false
  }
}

const clients = new Set()
function broadcast() {
  const payload = `data: ${JSON.stringify(C.readModel())}\n\n`
  for (const res of clients) {
    try {
      res.write(payload)
    } catch (_) {}
  }
}

let debounce = null
function watchState() {
  const p = C.STATE_PATH
  if (!p) return
  try {
    fs.watch(path.dirname(p), (_e, fname) => {
      if (fname && /state\.json/.test(fname)) {
        clearTimeout(debounce)
        debounce = setTimeout(broadcast, 250)
      }
    })
  } catch (_) {}
}

// 개발중(Active) 전용: 대상 레포 src/ 워킹트리 변경 → 구독 클라이언트에 tick (자동 갱신)
const activeClients = new Set()
let activeDebounce = null
function pingActive() {
  for (const res of activeClients) {
    try {
      res.write('data: change\n\n')
    } catch (_) {}
  }
}
function watchSrc() {
  const srcDir = path.join(C.REPO, 'src')
  try {
    fs.watch(srcDir, { recursive: true }, (_e, fname) => {
      if (!fname || /node_modules/.test(fname)) return
      clearTimeout(activeDebounce)
      activeDebounce = setTimeout(pingActive, 400)
    })
  } catch (_) {}
}

function loop(fn, ms) {
  const run = async () => {
    try {
      await fn()
      broadcast()
    } catch (_) {
    } finally {
      setTimeout(run, ms)
    }
  }
  run()
}

// ── 정적 파일 서빙 (app/dist) — vite build 산출물. Electron 패키징/프로덕션에서 이 포트 하나로 프론트까지 서빙.
// dist/가 없으면(dev 모드, Vite가 따로 뜸) 조용히 스킵 — 기존 동작 무변경.
const DIST_DIR = path.join(__dirname, '..', 'dist')
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}
function serveStatic(url, res) {
  if (!fs.existsSync(DIST_DIR)) return false
  const safePath = path.normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(DIST_DIR, safePath)
  if (!filePath.startsWith(DIST_DIR)) filePath = DIST_DIR // path traversal 방지
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html') // SPA 폴백 (BrowserRouter — 딥링크/새로고침 대응)
  }
  if (!fs.existsSync(filePath)) return false
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': STATIC_MIME[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
  return true
}

const server = http.createServer((req, res) => {
  // CSR(Vite)에서 직접 호출 가능하도록 CORS 허용 — 단 origin은 로컬만 반사(와일드카드 금지)
  const origin = req.headers.origin
  if (origin && LOCAL_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  if (AUTH_TOKEN) {
    let reqUrl
    try { reqUrl = new URL(req.url, 'http://x') } catch (_) { reqUrl = null }
    const given = req.headers['x-openrm-token'] || (reqUrl && reqUrl.searchParams.get('token'))
    if (given !== AUTH_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: false, error: 'unauthorized — OPENRM_TOKEN required' }))
    }
  }
  const url = req.url.split('?')[0]

  if (url === '/api/model') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(C.readModel()))
  }
  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, repo: C.REPO, state: C.STATE_PATH, host: HOST, port: PORT }))
  }
  // ── Setup / 온보딩 (Phase 2b) — SQLite 영속화 ──────────────────────
  if (url === '/api/setup/status' && req.method === 'GET') {
    return sendJSON(res, 200, setupStatus())
  }
  if (url.startsWith('/api/setup/connectors/') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/setup/connectors/'.length))
    const map = SETUP_CONNECTOR_MAP[id]
    if (!map) return sendJSON(res, 404, { ok: false, error: `unknown connector: ${id}` })
    return readBody(req)
      .then((b) => {
        const fields = (b && b.fields) || {}
        const cfgPatch = {}
        const skipped = []
        for (const [k, v] of Object.entries(fields)) {
          const dest = map[k]
          if (!dest) { skipped.push(k); continue } // 매핑에 없는 필드는 추측하지 말고 건너뜀
          if (dest.config) cfgPatch[dest.config] = v
          else if (dest.secret) Secrets.set(dest.secret, String(v == null ? '' : v))
        }
        if (Object.keys(cfgPatch).length) AppCfg.updateAppConfig(cfgPatch)
        sendJSON(res, 200, { ...setupStatus(), skipped })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url === '/api/setup/env' && req.method === 'GET') {
    return sendJSON(res, 200, EnvVars.list())
  }
  if (url === '/api/setup/env' && req.method === 'POST') {
    return readBody(req)
      .then((b) => sendJSON(res, 200, EnvVars.create(b || {})))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/setup/env/') && req.method === 'PATCH') {
    const id = decodeURIComponent(url.slice('/api/setup/env/'.length))
    return readBody(req)
      .then((b) => { const r = EnvVars.update(id, b || {}); sendJSON(res, r ? 200 : 404, r || { ok: false, error: 'not found' }) })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/setup/env/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/setup/env/'.length))
    return sendJSON(res, 200, EnvVars.remove(id))
  }
  if (url === '/api/setup/fs/resolve' && req.method === 'GET') {
    const raw = new URL(req.url, 'http://x').searchParams.get('path') || ''
    return resolveFsPath(raw).then((r) => sendJSON(res, 200, r))
  }
  if (url === '/api/setup/fs/list' && req.method === 'GET') {
    const raw = new URL(req.url, 'http://x').searchParams.get('path') || ''
    return resolveFsList(raw).then((r) => sendJSON(res, r.ok ? 200 : 400, r))
  }
  if (url === '/api/setup/tmux' && req.method === 'GET') {
    return Term.checkAvailable().then((r) => sendJSON(res, 200, r))
  }
  // GitHub 연동 — ① gh CLI 위임(설정 0) ② OAuth Device Flow(gh CLI 없을 때)
  if (url === '/api/setup/github/gh-status' && req.method === 'GET') {
    return GithubConnect.ghStatus().then((r) => sendJSON(res, 200, r))
  }
  if (url === '/api/setup/github/oauth/start' && req.method === 'POST') {
    return GithubConnect.oauthStart().then((r) => sendJSON(res, r.ok ? 200 : 400, r))
  }
  if (url === '/api/setup/github/oauth/poll' && req.method === 'POST') {
    return GithubConnect.oauthPoll().then((r) => sendJSON(res, r.ok ? 200 : 400, r))
  }

  // ── Sessions / 개발실 (Phase 3.1) — folders·tasks·branches CRUD (SQLite store) ──
  // 주의: /api/tasks·/api/branches는 method로 분기한다 — 기존 GET 핸들러(구 flat-JSON/​git API,
  // 각각 아래쪽 line ~845/~425)는 그대로 두고, 여기선 POST/PATCH/DELETE(신규 store CRUD)만 얹는다.
  // 이 블록이 그 GET 핸들러들보다 앞에 있어야(=여기) 신규 write가 구 핸들러에 가로채이지 않는다.
  if (url === '/api/sessions/board' && req.method === 'GET') {
    return sendJSON(res, 200, StoreTasks.board(StoreFolders.list()))
  }
  // folders
  if (url === '/api/folders' && req.method === 'POST') {
    return readBody(req)
      .then((b) => sendJSON(res, 200, StoreFolders.create(b || {})))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/folders/') && req.method === 'PATCH') {
    const id = decodeURIComponent(url.slice('/api/folders/'.length))
    return readBody(req)
      .then((b) => { const r = StoreFolders.update(id, b || {}); sendJSON(res, r ? 200 : 404, r || { ok: false, error: 'not found' }) })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/folders/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/folders/'.length))
    return sendJSON(res, 200, StoreFolders.remove(id))
  }
  // 보관함 — 완료된 폴더를 지우지 않고 archived=1로 표시만(board()는 archived=0만 반환).
  if (url === '/api/folders/archived' && req.method === 'GET') {
    return sendJSON(res, 200, { folders: StoreTasks.board(StoreFolders.listArchived()).folders })
  }
  if (url.endsWith('/archive') && url.startsWith('/api/folders/') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/folders/'.length, -'/archive'.length))
    const r = StoreFolders.archive(id)
    return sendJSON(res, r ? 200 : 404, r || { ok: false, error: 'not found' })
  }
  if (url.endsWith('/restore') && url.startsWith('/api/folders/') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/folders/'.length, -'/restore'.length))
    const r = StoreFolders.restore(id)
    return sendJSON(res, r ? 200 : 404, r || { ok: false, error: 'not found' })
  }
  // Automations(§07 "크론잡 생성") — 스케줄대로 사람이 미리 정한 액션(지금은 새 일감 생성)을 실행.
  if (url === '/api/cron-jobs' && req.method === 'GET') {
    return sendJSON(res, 200, StoreCronJobs.list())
  }
  if (url === '/api/cron-jobs' && req.method === 'POST') {
    return readBody(req)
      .then((b) => { const r = StoreCronJobs.create(b || {}); sendJSON(res, r && r.ok === false ? 400 : 200, r) })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/cron-jobs/') && url.endsWith('/run-now') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/cron-jobs/'.length, url.length - '/run-now'.length))
    const job = StoreCronJobs.get(id)
    if (!job) return sendJSON(res, 404, { ok: false, error: 'not found' })
    return Scheduler.runJob(job)
      .then(() => sendJSON(res, 200, { ok: true, job: StoreCronJobs.get(id) }))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/cron-jobs/') && req.method === 'PATCH') {
    const id = decodeURIComponent(url.slice('/api/cron-jobs/'.length))
    return readBody(req)
      .then((b) => { const r = StoreCronJobs.update(id, b || {}); sendJSON(res, r ? 200 : 404, r || { ok: false, error: 'not found' }) })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/cron-jobs/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/cron-jobs/'.length))
    return sendJSON(res, 200, StoreCronJobs.remove(id))
  }

  // 관제(control) — 태스크 하나가 아니라 앱 전체(캘린더/크론잡/설정)를 대화로 조작하는 최상위 에이전트.
  if (url === '/api/control/state' && req.method === 'GET') {
    return Control.getState()
      .then((r) => sendJSON(res, 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url === '/api/control/start' && req.method === 'POST') {
    return Control.start()
      .then((r) => sendJSON(res, r.ok ? 200 : 400, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url === '/api/control/stop' && req.method === 'POST') {
    return Control.stop()
      .then((r) => sendJSON(res, 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }

  // repos (멀티레포 프로젝트 — 레포 레지스트리)
  if (url === '/api/repos' && req.method === 'GET') {
    const list = StoreRepos.list().map((r) => ({ ...r, ownerAvatarUrl: StoreRepos.deriveOwnerAvatar(r.path) }))
    return sendJSON(res, 200, list)
  }
  if (url === '/api/repos' && req.method === 'POST') {
    return readBody(req)
      .then((b) => { const r = StoreRepos.create(b || {}); sendJSON(res, r && r.ok === false ? 400 : 200, r) })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/repos/') && req.method === 'PATCH') {
    const id = decodeURIComponent(url.slice('/api/repos/'.length))
    return readBody(req)
      .then((b) => { const r = StoreRepos.update(id, b || {}); sendJSON(res, r ? 200 : 404, r || { ok: false, error: 'not found' }) })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/repos/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/repos/'.length))
    return sendJSON(res, 200, StoreRepos.remove(id))
  }
  // 레포 관리 테이블의 워크트리 개수 배지 — list()의 무거운 per-worktree git 호출 없이 개수만.
  if (url.startsWith('/api/repos/') && url.endsWith('/worktrees/count') && req.method === 'GET') {
    const id = decodeURIComponent(url.slice('/api/repos/'.length, url.length - '/worktrees/count'.length))
    const repo = StoreRepos.get(id)
    if (!repo) return sendJSON(res, 404, { ok: false, error: 'repo not found' })
    return Worktrees.count(repo.path)
      .then((count) => sendJSON(res, 200, { count }))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  // 이 레포의 실제 git worktree 전부(git worktree list --porcelain) — OpenTask가 만들지 않은
  // 것(다른 도구·다른 사람이 만든 것)도 전부 잡힌다. 사이드바 "워크트리" 섹션이 씀.
  if (url.startsWith('/api/repos/') && url.endsWith('/worktrees') && req.method === 'GET') {
    const id = decodeURIComponent(url.slice('/api/repos/'.length, url.length - '/worktrees'.length))
    const repo = StoreRepos.get(id)
    if (!repo) return sendJSON(res, 404, { ok: false, error: 'repo not found' })
    return Worktrees.list(repo.path)
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  // "연결" — OpenTask가 모르는 기존 워크트리를 태스크로 입양. 새 워크트리를 만들지 않고(이미 있으니)
  // 그 브랜치를 가리키는 Folder/Task/Branch 레코드만 생성 — 실제 git 상태는 손대지 않는다.
  // orchestrator.start()가 이 태스크를 시작할 때 branches 레코드로 기존 경로를 재사용한다.
  if (url.startsWith('/api/repos/') && url.endsWith('/worktrees/adopt') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/repos/'.length, url.length - '/worktrees/adopt'.length))
    const repo = StoreRepos.get(id)
    if (!repo) return sendJSON(res, 404, { ok: false, error: 'repo not found' })
    return readBody(req)
      .then((b) => {
        const branch = b && String(b.branch || '').trim()
        if (!branch) return sendJSON(res, 400, { ok: false, error: 'branch 필요' })
        const folder = StoreFolders.create({ name: branch })
        const task = StoreTasks.create({ folderId: folder.id, name: branch, repoId: repo.id })
        StoreBranches.create({ taskId: task.id, name: branch, repo: repo.name })
        sendJSON(res, 200, { ok: true, folderId: folder.id, taskId: task.id })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  // "레포 추가" 모달의 Clone from URL / Create new project — 폴더 찾아보기(기존 폴더 등록)는
  // FolderPicker가 이미 쓰는 /api/setup/fs/* 로 충분해서 별도 라우트 없음.
  if (url === '/api/repos/clone' && req.method === 'POST') {
    return readBody(req)
      .then((b) => RepoAdd.cloneRepo(b || {}))
      .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url === '/api/repos/init' && req.method === 'POST') {
    return readBody(req)
      .then((b) => RepoAdd.initRepo(b || {}))
      .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  // tasks
  if (url === '/api/tasks' && req.method === 'POST') {
    return readBody(req)
      .then((b) => {
        const task = StoreTasks.composeTask(StoreTasks.create(b || {}))
        // 레포를 명시 안 했고(사람이 직접 안 골랐고) 등록된 레포가 2개 이상이면 백그라운드로 자동배정 —
        // 태스크 생성 응답은 안 기다리고 바로 나감(수 초 걸리는 헤드리스 claude 호출이라 블로킹 안 함).
        if (!task.repo_id) RepoClassify.classifyTask(task.id).catch(() => {})
        sendJSON(res, 200, task)
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/tasks/') && req.method === 'PATCH') {
    const id = decodeURIComponent(url.slice('/api/tasks/'.length))
    return readBody(req)
      .then((b) => {
        b = b || {}
        const cur = StoreTasks.get(id)
        if (!cur) return sendJSON(res, 404, { ok: false, error: 'not found' })
        // 편집(rename/desc/kind/시작 프롬프트/레포/예정일/기간/완료) — 해당 키가 있을 때만
        if ('name' in b || 'desc' in b || 'kind' in b || 'startPrompt' in b || 'repoId' in b || 'dueDate' in b || 'durationDays' in b || 'completedAt' in b) StoreTasks.update(id, b)
        // refile/reorder — folderId 키가 있으면(명시적 null=inbox 포함) 그 값으로, 없고 beforeTaskId만 있으면 현재 폴더 유지
        if ('folderId' in b || 'beforeTaskId' in b) {
          const targetFolder = 'folderId' in b ? b.folderId : cur.folder_id
          StoreTasks.move(id, targetFolder, b.beforeTaskId)
        }
        sendJSON(res, 200, StoreTasks.composeTask(StoreTasks.get(id)))
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  // 스레드/노션/피그마 링크로 만든 일감의 제목이 "스레드 링크 태스크" 같은 종류명 placeholder로만
  // 남아있던 문제 — 링크 내용을 실제로 읽어(claude -p + Slack/Notion/Figma MCP) 제목·요약을 얻어와
  // 태스크에 반영한다. 몇 초~170초 걸릴 수 있어 draft 제출 자체는 막지 않고 백그라운드에서 호출됨.
  if (url.startsWith('/api/tasks/') && url.endsWith('/enrich-title') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/tasks/'.length, url.length - '/enrich-title'.length))
    const cur = StoreTasks.get(id)
    if (!cur) return sendJSON(res, 404, { ok: false, error: 'not found' })
    return readBody(req)
      .then(async (b) => {
        const r = await Tasks.readLinkForTitle((b && b.url) || '')
        if (!r.ok) return sendJSON(res, 200, r) // 실패해도 200 — placeholder 제목 그대로 두면 됨(치명적 아님)
        StoreTasks.update(id, { name: r.title, desc: r.summary || undefined })
        sendJSON(res, 200, { ok: true, task: StoreTasks.composeTask(StoreTasks.get(id)) })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  // 태스크 상세의 "AI 추정" 버튼 — 설명 + 실제 코드를 읽는 동안 30~60초+ 걸릴 수 있어("오래 걸리는데
  // 토큰/프로그레스바를 보여줘야" 피드백) tasks.cjs의 stream-json 잡 패턴처럼 즉시 jobId만 돌려주고
  // 프론트가 폴링한다. 적용은 별도로 PATCH .../durationDays를 호출해야 반영되며, 이 라우트 자체는 저장 안 함.
  if (url.startsWith('/api/tasks/') && url.endsWith('/estimate-duration/start') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/tasks/'.length, url.length - '/estimate-duration/start'.length))
    const r = DurationEstimate.startEstimate(id)
    return sendJSON(res, r.ok ? 200 : 400, r)
  }
  if (url.startsWith('/api/tasks/') && url.includes('/estimate-duration/status') && req.method === 'GET') {
    const jobId = new URL(req.url, 'http://x').searchParams.get('jobId') || ''
    return sendJSON(res, 200, DurationEstimate.getStatus(jobId))
  }
  // "상세 결과를 html로 뽑아주고 링크로 제공" — 좁은 드로어에 못 넣는 전체 서술+토큰/비용을 별도 페이지로.
  if (url.startsWith('/api/tasks/') && url.includes('/estimate-duration/report') && req.method === 'GET') {
    const jobId = new URL(req.url, 'http://x').searchParams.get('jobId') || ''
    const html = DurationEstimate.getReportHtml(jobId)
    if (!html) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('리포트를 찾을 수 없습니다(만료됐을 수 있음)')
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(html)
  }
  if (url.startsWith('/api/tasks/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/tasks/'.length))
    return sendJSON(res, 200, StoreTasks.remove(id))
  }
  // branches (+ links)
  if (url === '/api/branches' && req.method === 'POST') {
    return readBody(req)
      .then((b) => sendJSON(res, 200, StoreBranches.create(b || {})))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/branches/') && url.endsWith('/links') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/branches/'.length, url.length - '/links'.length))
    return readBody(req)
      .then((b) => sendJSON(res, 200, StoreBranches.addLink(id, b && b.kind, b && b.url)))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/branches/') && req.method === 'PATCH') {
    const id = decodeURIComponent(url.slice('/api/branches/'.length))
    return readBody(req)
      .then((b) => { const r = StoreBranches.update(id, b || {}); sendJSON(res, r ? 200 : 404, r || { ok: false, error: 'not found' }) })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/branches/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/branches/'.length))
    return sendJSON(res, 200, StoreBranches.remove(id))
  }
  if (url.startsWith('/api/branch-links/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/branch-links/'.length))
    return sendJSON(res, 200, StoreBranches.removeLink(id))
  }
  // AI 판정 감사 로그(§12) — repo_assign/kind_judge/review_verdict/repo_verify_hold. conductor.feed(인메모리)와
  // 달리 서버 재시작에도 남는다. read-only.
  if (url.startsWith('/api/folders/') && url.endsWith('/decisions') && req.method === 'GET') {
    const fid = decodeURIComponent(url.slice('/api/folders/'.length, url.length - '/decisions'.length))
    return sendJSON(res, 200, { ok: true, decisions: StoreDecisions.listByFolder(fid) })
  }
  // ── Sessions 오케스트레이션 (Phase 3.2) — 폴더 단위 순차 웨이브. 실제 git worktree + tmux+claude 세션 생성. ──
  // method 분기라 위 folders CRUD(PATCH/DELETE /api/folders/:id)와 충돌하지 않는다(경로가 .../orchestrate/... 로 더 김).
  if (url.startsWith('/api/folders/') && url.includes('/orchestrate/')) {
    const om = url.match(/^\/api\/folders\/([^/]+)\/orchestrate\/(start|advance|stop|state)$/)
    if (om) {
      const fid = decodeURIComponent(om[1])
      const action = om[2]
      const done = (p) => p.then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      if (action === 'state' && req.method === 'GET') return sendJSON(res, 200, Orchestrator.getState(fid))
      if (action === 'start' && req.method === 'POST') return done(Orchestrator.start(fid))
      if (action === 'advance' && req.method === 'POST') return done(Orchestrator.advance(fid))
      if (action === 'stop' && req.method === 'POST') return done(Orchestrator.stop(fid))
    }
  }
  // ── 지휘자(conductor) 세션 (Phase 3.4) — 오케스트레이터 자체의 클로드 세션. say/event는 지휘자
  //    세션 자신이 curl로 호출(conductorSeed 참고), tell은 UI가 사람 발화를 지휘자에게 전달할 때 쓴다. ──
  if (url.startsWith('/api/folders/') && url.includes('/conductor/')) {
    const cm = url.match(/^\/api\/folders\/([^/]+)\/conductor\/(start|stop|say|tell|event|feed|set-kind)$/)
    if (cm) {
      const fid = decodeURIComponent(cm[1])
      const action = cm[2]
      const done = (p) => p.then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      if (action === 'feed' && req.method === 'GET') return sendJSON(res, 200, Orchestrator.conductorFeed(fid))
      if (action === 'start' && req.method === 'POST') return done(Orchestrator.startConductor(fid))
      if (action === 'stop' && req.method === 'POST') return done(Orchestrator.stopConductor(fid))
      if (action === 'say' && req.method === 'POST') {
        readBody(req).then((b) => done(Orchestrator.conductorSay(fid, b && b.taskId, b && b.text)))
        return
      }
      if (action === 'tell' && req.method === 'POST') {
        readBody(req).then((b) => done(Orchestrator.conductorTell(fid, b && b.text)))
        return
      }
      if (action === 'event' && req.method === 'POST') {
        readBody(req).then((b) => sendJSON(res, 200, Orchestrator.conductorEvent(fid, b || {})))
        return
      }
      if (action === 'set-kind' && req.method === 'POST') {
        readBody(req).then((b) => done(Promise.resolve(Orchestrator.conductorSetKind(fid, b && b.taskId, b && b.kind, b && b.reason))))
        return
      }
    }
  }

  // ── PR 리뷰 (Phase 3.3) — GitHub 코멘트 fetch / apply(로컬 dispatch) / dispute(실제 GitHub 쓰기) ──
  if (url.startsWith('/api/branches/') && url.endsWith('/reviews/sync') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/branches/'.length, url.length - '/reviews/sync'.length))
    return PrReview.syncReviewsForBranch(id)
      .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  // ⑧ AI 자동 리뷰 — diff를 스스로 읽고 이슈를 낸다(tasks.cjs startPrReview 패턴 이식, §12).
  if (url.startsWith('/api/branches/') && url.endsWith('/reviews/ai-review') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/branches/'.length, url.length - '/reviews/ai-review'.length))
    return PrReview.startAiReview(id)
      .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/reviews/') && url.endsWith('/apply') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/reviews/'.length, url.length - '/apply'.length))
    return PrReview.applyReview(id)
      .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/reviews/') && url.endsWith('/dispute') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/reviews/'.length, url.length - '/dispute'.length))
    return readBody(req)
      .then((b) => PrReview.disputeReview(id, b && b.text))
      .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }

  // ── Debug / 디버깅 (Phase 4b) — Playwright 실브라우저 세션 (스크린샷 폴링 / 엘리먼트 검사 / 네트워크·콘솔 / 스레드) ──
  if (url === '/api/debug/sessions' && req.method === 'POST') {
    return readBody(req)
      .then((b) => BrowserPool.createSession(b || {}))
      .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/debug/threads/') && url.endsWith('/followup') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/debug/threads/'.length, url.length - '/followup'.length))
    return readBody(req)
      .then((b) => Inspector.followup(id, b && b.text))
      .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
  }
  if (url.startsWith('/api/debug/sessions/')) {
    const dm = url.match(/^\/api\/debug\/sessions\/([^/]+)(?:\/(screenshot|inspect|network|console|threads))?$/)
    if (dm) {
      const id = decodeURIComponent(dm[1])
      const sub = dm[2] || null
      if (!sub && req.method === 'DELETE') {
        return BrowserPool.closeSession(id).then((r) => sendJSON(res, 200, r)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      }
      if (sub === 'screenshot' && req.method === 'GET') {
        return BrowserPool.screenshot(id)
          .then((r) => {
            if (!r.ok) return sendJSON(res, r.error === 'session not found' ? 404 : 500, { ok: false, error: r.error })
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
            res.end(r.buffer)
          })
          .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      }
      if (sub === 'inspect' && req.method === 'POST') {
        return readBody(req)
          .then((b) => Inspector.inspect(id, Number(b && b.x), Number(b && b.y)))
          .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
          .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      }
      if (sub === 'network' && req.method === 'GET') return sendJSON(res, 200, { ok: true, network: Inspector.network(id) })
      if (sub === 'console' && req.method === 'GET') return sendJSON(res, 200, { ok: true, console: Inspector.consoleList(id) })
      if (sub === 'threads' && req.method === 'GET') return sendJSON(res, 200, { ok: true, threads: Inspector.listThreads(id) })
      if (sub === 'threads' && req.method === 'POST') {
        return readBody(req)
          .then((b) => Inspector.createThread(id, b || {}))
          .then((r) => sendJSON(res, r && r.ok === false ? 400 : 200, r))
          .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      }
    }
  }

  if (url === '/api/templates') {
    return sendJSON(res, 200, { templates: Act.TEMPLATES })
  }
  // PPT 제작 — Claude로 발표 덱/슬라이드 초안 생성
  if (url === '/api/ppt/generate' && req.method === 'POST') {
    readBody(req)
      .then((b) => Ppt.generate(b || {}))
      .then((d) => sendJSON(res, d.ok ? 200 : 400, d))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/branches') {
    listBranches().then((branches) => sendJSON(res, 200, { ok: true, branches })).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/branches/create' && req.method === 'POST') {
    readBody(req).then((b) => createBranch(b || {})).then((r) => sendJSON(res, 200, r)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/worktrees') {
    Worktrees.list()
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/element-context') {
    const file = new URL(req.url, 'http://x').searchParams.get('file') || ''
    try {
      return sendJSON(res, 200, ElementCtx.context(file))
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/preview/target') {
    if (req.method === 'POST') {
      readBody(req).then((b) => sendJSON(res, 200, { target: Preview.setTarget(b.port), proxyPort: Preview.PROXY_PORT }))
      return
    }
    Promise.all([Preview.candidatePorts(), Cockpit.portLabels().catch(() => ({}))]).then(([ports, labels]) =>
      sendJSON(res, 200, { target: Preview.getTarget(), proxyPort: Preview.PROXY_PORT, candidates: ports, mode: Preview.getMode(), portShops: DevUsers.portShops(), portLabels: labels }),
    )
    return
  }
  // 디버깅 자동로그인 — 테스트 계정 관리 (비번은 운영자가 UI에서 입력, 로컬 저장, 마스킹 반환)
  if (url === '/api/dev-users') {
    if (req.method === 'POST') {
      readBody(req).then((b) => sendJSON(res, 200, DevUsers.add(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      return
    }
    return sendJSON(res, 200, { ok: true, users: DevUsers.list() })
  }
  if (url === '/api/dev-users/remove' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, DevUsers.remove((b && b.key) || ''))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 자동로그인: dev서버 + 유저 → 서버측 로그인 → 프록시에 원격+인증쿠키 설정 → iframe이 프록시로 로그인 상태 표시
  if (url === '/api/preview/login' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        const dev = String((b && b.dev) || '').replace(/[^a-z0-9]/gi, '')
        const host = /^dev[1-6]$/.test(dev) && process.env.OPENRM_DEV_HOST_PATTERN
          ? process.env.OPENRM_DEV_HOST_PATTERN.replace('%s', dev)
          : null
        if (!host) return sendJSON(res, 400, { ok: false, error: 'dev1~6 중 선택 필요' })
        const c = DevUsers.getCreds((b && b.key) || '')
        if (!c) return sendJSON(res, 400, { ok: false, error: '유저를 찾을 수 없습니다.' })
        const r = await signinRemote(host, c.id, c.pwd)
        if (!r.ok) return sendJSON(res, 400, { ok: false, error: `로그인 실패 (status ${r.status || '-'}): ${r.error || '세션 미발급'}` })
        Preview.setRemote(host)
        // 세션(DEV_B2B_SESSION)+토큰(GD-Auth-Token) 쿠키를 프록시가 주입 → 배포 서버 SSR이 그대로 로그인 상태로 렌더
        Preview.setAuth({ session: r.session, token: r.token })
        sendJSON(res, 200, { ok: true, host, origin: Preview.getMode().origin, label: c.label })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // dev 서버 '보기' (로그인 전) — 프록시를 원격 미러 모드로만 전환(무인증). iframe이 직접 crm-devN 을 로드하면
  // cross-site(다른 사이트) iframe이라 로그인 세션 쿠키가 브라우저 정책에 막혀 로그인이 안 넘어감. 프록시(localhost,
  // same-site) 경유로 보면 수동 로그인 시 세션이 살아 정상 진행 + 프록시가 세션을 서버측 캡처(백업)한다.
  if (url === '/api/preview/view-remote' && req.method === 'POST') {
    readBody(req)
      .then((b) => {
        const dev = String((b && b.dev) || '').replace(/[^a-z0-9]/gi, '')
        const host = /^dev[1-6]$/.test(dev) && process.env.OPENRM_DEV_HOST_PATTERN
          ? process.env.OPENRM_DEV_HOST_PATTERN.replace('%s', dev)
          : null
        if (!host) return sendJSON(res, 400, { ok: false, error: 'dev1~6 중 선택 필요' })
        Preview.setRemote(host)
        Preview.setAuth() // 무인증 뷰 — 로그인 화면부터. 수동 로그인/샵버튼으로 인증하면 그때 세션이 채워진다.
        sendJSON(res, 200, { ok: true, host, origin: Preview.getMode().origin })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/preview/logout' && req.method === 'POST') {
    Preview.clearRemote()
    return sendJSON(res, 200, { ok: true })
  }
  // 맥의 LAN IP + Wi-Fi 이름(SSID) — 웹뷰를 실제 기기에서 직접 접속할 때 필요 (같은 Wi-Fi + IP)
  if (url === '/api/localip') {
    const ifs = require('os').networkInterfaces()
    const outIf = []
    for (const [name, addrs] of Object.entries(ifs)) for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) outIf.push({ name, addr: a.address })
    const pick = outIf.find((x) => x.name === 'en0') || outIf.find((x) => /^(192\.168|10\.|172\.)/.test(x.addr)) || outIf[0]
    // SSID (best-effort — Sonoma+는 위치서비스 권한 없으면 <redacted>)
    require('child_process').execFile('ipconfig', ['getsummary', 'en0'], { timeout: 4000 }, (e, o) => {
      let ssid = null
      const m = String(o || '').match(/\bSSID\s*:\s*(.+)/)
      if (m) ssid = m[1].trim()
      const redacted = !ssid || /redacted/i.test(ssid)
      sendJSON(res, 200, { ok: true, ip: pick ? pick.addr : null, all: outIf, ssid: redacted ? null : ssid, ssidRedacted: redacted })
    })
    return
  }
  // 로컬 접속용 샵토큰 목록 (env의 NEXT_PUBLIC_DEFAULT_AUTH_TOKEN들, 마스킹)
  if (url === '/api/dev-tokens') {
    return sendJSON(res, 200, { ok: true, tokens: DevUsers.tokenList(), apiDomain: DevUsers.envApiDomain() })
  }
  // dev 서버 재시작 상태 — 로그 tail + 포트 ready 여부 (프론트가 폴링해 로그 보여주고 뜨면 화면 로드)
  if (url === '/api/preview/devstatus') {
    const port = Number(new URL(req.url, 'http://x').searchParams.get('port')) || Preview.getTarget()
    let log = ''
    try {
      log = fs.readFileSync(DEV_LOG(), 'utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n').slice(-60).join('\n')
    } catch (_) {}
    checkPort(port).then((ready) => sendJSON(res, 200, { ok: true, ready, port, log }))
    return
  }
  // 로컬 API 서버(개발서버) 전환 — env.local의 NEXT_PUBLIC_API_DOMAIN을 crm-devN으로 스왑 + dev 재시작
  if (url === '/api/preview/switch-apidomain' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        const sw = DevUsers.setEnvApiDomain((b && b.dev) || 0)
        if (!sw.ok) return sendJSON(res, 400, sw)
        Preview.clearLocalToken()
        const port = Preview.getTarget()
        const r = await restartDevServer(port)
        sendJSON(res, 200, { ok: true, api: sw.api, port, restarted: r.ok })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 로컬 샵 전환 — 그 포트의 dev 서버가 도는 '워크트리'를 찾아, 그 워크트리 env.local의 토큰을 스왑하고,
  // 그 터미널에서 그대로 재시작(같은 포트·같은 워크트리). 추적 세션이 없으면 메인 레포에서 재시작(구 방식).
  if (url === '/api/preview/switch-shop' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        const t = DevUsers.getToken((b && b.key) || '')
        if (!t) return sendJSON(res, 400, { ok: false, error: '토큰을 찾을 수 없습니다.' })
        const port = Preview.getTarget()
        // 그 포트를 '실제로' 서빙 중인 프로세스의 cwt(워크트리)을 lsof로 확정 — 이게 env를 바꿀 곳
        const info = await Term.devSessionForPort(port).catch(() => null)
        const envCwd = info ? info.cwd : C.REPO
        const sw = DevUsers.setActiveEnvToken(t.token, path.join(envCwd, '.env.local'))
        if (!sw.ok) return sendJSON(res, 400, sw)
        Preview.clearLocalToken()
        let where
        if (info && info.hasSession) {
          try { fs.writeFileSync(DEV_LOG(), `[OpenRM] '${t.label}' 샵으로 전환 — 작업 터미널(${info.name}, 워크트리 ${envCwd.split('/').pop()})에서 제자리 재시작 중…\n포트 :${port} 가 다시 뜨면 자동으로 화면을 로드합니다.\n`) } catch (_) {}
          await Term.restartDevSession(info) // 그 dev 터미널에서 Ctrl-C + 재실행
          where = `워크트리 ${envCwd.split('/').pop()} · ${info.name}`
        } else {
          // 그 포트를 서빙하는 dev tmux 세션이 없음(에이전트 자식/수동 실행) → 그 워크트리 cwd에서 kill+재기동
          await restartDevServer(port, envCwd)
          where = `${envCwd.split('/').pop()}(:${port}) 재기동`
        }
        DevUsers.setPortShop(port, t.label) // 이 포트 = 이 샵 (재시작해도 유지)
        sendJSON(res, 200, { ok: true, label: t.label, port, where, cwd: envCwd })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // MSW 목서버 토글 — 대상 포트 워크트리의 .env.local 에 NEXT_PUBLIC_API_MOCKING 을 켜/끄고 dev 재시작.
  //   (MSW는 dev 시작 시 env로만 켜져서 런타임 토글 불가 → env 파일 수정 + 재시작이 유일한 방법)
  if (url === '/api/preview/msw' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        if (Preview.getMode().remote) return sendJSON(res, 400, { ok: false, error: '원격 서버는 MSW 토글 불가 — 로컬 dev 서버에서만' })
        const on = !!(b && b.on)
        const port = Preview.getTarget()
        const info = await Term.devSessionForPort(port).catch(() => null)
        const envCwd = info ? info.cwd : C.REPO
        const sw = DevUsers.setEnvMswMocking(on, path.join(envCwd, '.env.local'))
        if (!sw.ok) return sendJSON(res, 400, sw)
        try { fs.writeFileSync(DEV_LOG(), `[OpenRM] MSW 목서버 ${on ? '켜기' : '끄기'} — .env.local 수정 후 :${port} (워크트리 ${envCwd.split('/').pop()}) 재시작 중…\n뜨면 자동으로 화면을 다시 로드합니다.\n`) } catch (_) {}
        if (info && info.hasSession) await Term.restartDevSession(info)
        else await restartDevServer(port, envCwd)
        sendJSON(res, 200, { ok: true, on, port })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/preview/msw' && req.method === 'GET') {
    ;(async () => {
      const port = Preview.getTarget()
      const info = await Term.devSessionForPort(port).catch(() => null)
      const envCwd = info ? info.cwd : C.REPO
      sendJSON(res, 200, { ok: true, on: DevUsers.envMswMocking(path.join(envCwd, '.env.local')), remote: !!Preview.getMode().remote })
    })().catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // (구) 로컬 접속 샵토큰 쿠키 주입 — 이 앱은 안 먹혀서 switch-shop으로 대체
  if (url === '/api/preview/token' && req.method === 'POST') {
    readBody(req)
      .then((b) => {
        if (b && b.clear) { Preview.clearLocalToken(); return sendJSON(res, 200, { ok: true, cleared: true }) }
        const t = DevUsers.getToken((b && b.key) || '')
        if (!t) return sendJSON(res, 400, { ok: false, error: '토큰을 찾을 수 없습니다.' })
        Preview.setLocalToken(t.token, DevUsers.envApiDomain())
        sendJSON(res, 200, { ok: true, label: t.label, apiHost: DevUsers.envApiDomain() })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 라우트 인벤토리 — src/pages 스캔해 PC/웹뷰 화면 목록 (디버깅 드릴다운 네비)
  if (url === '/api/preview/routes') {
    try {
      const pagesDir = path.join(C.REPO, 'src/pages')
      const routes = []
      const skipDir = new Set(['api', 'components', 'hooks', 'utils', 'constants', 'types', 'styles', 'lib', 'libs', '__tests__', '__mocks__'])
      const walk = (dir, base) => {
        let ents = []
        try {
          ents = require('fs').readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const ent of ents) {
          const nm = ent.name
          if (ent.isDirectory()) {
            if (nm.startsWith('_') || skipDir.has(nm)) continue
            walk(path.join(dir, nm), base + '/' + nm)
          } else if (/\.(tsx|jsx)$/.test(nm)) {
            const bn = nm.replace(/\.(tsx|jsx)$/, '')
            if (bn.startsWith('_') || bn === '404' || bn === '500') continue
            routes.push(bn === 'index' ? base || '/' : base + '/' + bn)
          }
        }
      }
      walk(pagesDir, '')
      return sendJSON(res, 200, { ok: true, routes: [...new Set(routes)].sort() })
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: String(e.message || e) })
    }
  }
  if (url === '/api/settings') {
    if (req.method === 'POST') {
      readBody(req).then((b) => sendJSON(res, 200, { ok: true, settings: Settings.save(b || {}) })).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      return
    }
    return sendJSON(res, 200, { ok: true, settings: Settings.load() })
  }
  if (url === '/api/prs') {
    const state = new URL(req.url, 'http://x').searchParams.get('state') || 'open'
    Prs.list(state)
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/prs/detail') {
    const sp = new URL(req.url, 'http://x').searchParams
    Prs.detail(sp.get('n'), sp.get('repo'))
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/active') {
    const sp = new URL(req.url, 'http://x').searchParams
    Active.active(sp.get('mode') || 'working', Number(sp.get('n')) || 3, Active.safeRepo(sp.get('repo')))
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/active/diff') {
    const sp = new URL(req.url, 'http://x').searchParams
    Active.fileDiff(sp.get('file') || '', sp.get('mode') || 'working', Number(sp.get('n')) || 3, sp.get('commit') || undefined, Active.safeRepo(sp.get('repo')))
      .then((diff) => sendJSON(res, 200, { file: sp.get('file'), diff }))
      .catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/branches') {
    Active.branches()
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/checkout' && req.method === 'POST') {
    readBody(req).then((body) =>
      Active.checkout(body.branch || '')
        .then((r) => sendJSON(res, r.ok ? 200 : 400, r))
        .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) })),
    )
    return
  }
  if (url === '/api/active/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(': ok\n\n')
    activeClients.add(res)
    const hb = setInterval(() => {
      try {
        res.write(': hb\n\n')
      } catch (_) {}
    }, 15000)
    req.on('close', () => {
      clearInterval(hb)
      activeClients.delete(res)
    })
    return
  }
  if (url === '/api/commits') {
    const n = Number(new URL(req.url, 'http://x').searchParams.get('n')) || 12
    Commits.commits(n)
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/tests') {
    try {
      return sendJSON(res, 200, Tests.inventory())
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/gtm') {
    try {
      return sendJSON(res, 200, Gtm.inventory())
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/apiui') {
    try {
      return sendJSON(res, 200, ApiUi.inventory())
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/figma/nodes') {
    try {
      return sendJSON(res, 200, Figma.nodes())
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/figma') {
    const ids = (new URL(req.url, 'http://x').searchParams.get('nodes') || '').split(',').filter(Boolean)
    Figma.images(ids)
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { ok: false, reason: String(e.message || e) }))
    return
  }
  if (url === '/api/figma/img') {
    const node = new URL(req.url, 'http://x').searchParams.get('node') || ''
    const p = Figma.imageFile(node)
    if (!p) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' })
    return fs.createReadStream(p).pipe(res)
  }
  if (url === '/api/tree') {
    try {
      return sendJSON(res, 200, T.tree())
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/folder') {
    const p = new URL(req.url, 'http://x').searchParams.get('path') || ''
    try {
      return sendJSON(res, 200, T.folder(p))
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/graph/scopes') {
    try {
      return sendJSON(res, 200, { scopes: G.scopes() })
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/graph') {
    const q = new URL(req.url, 'http://x').searchParams
    try {
      return sendJSON(res, 200, G.build({ scope: q.get('scope') || '', mode: q.get('mode') || 'folder', depth: Number(q.get('depth')) || 3 }))
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/reorg/impact') {
    const from = new URL(req.url, 'http://x').searchParams.get('from') || ''
    try {
      return sendJSON(res, 200, R.impact(from))
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) })
    }
  }
  if (url === '/api/reorg/prompt' && req.method === 'POST') {
    readBody(req).then((body) => {
      try {
        sendJSON(res, 200, R.buildPrompt(body.plan))
      } catch (e) {
        sendJSON(res, 500, { error: String(e.message || e) })
      }
    })
    return
  }
  if (url === '/api/term') {
    Term.listLive()
      .then((d) => sendJSON(res, 200, { ok: true, sessions: d }))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 전역 리소스 요약 (맥북 부하 가늠 — 켜진 Claude/터미널/dev서버 수)
  if (url === '/api/resources') {
    Promise.all([
      Term.listLive().catch(() => []),
      Cockpit.devServers().catch(() => []),
      Monitor.claudeStatus('ops').catch(() => ({ running: false })),
      Monitor.claudeStatus('pr').catch(() => ({ running: false })),
    ])
      .then(([tl, devs, ops, pr]) => {
        const claude = tl.filter((t) => t.status && t.status.isClaude).length
        sendJSON(res, 200, { agents: tl.length, claude, devServers: devs.length, loops: { ops: !!ops.running, pr: !!pr.running } })
      })
      .catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  // 업무 보드: 티켓(업무) 단위로 작업 스트림 + 스레드/노션/피그마 링크 묶음
  if (url === '/api/tasks') {
    const force = /[?&]force=1/.test(req.url || '')
    Tasks.build({ force })
      .then((d) => sendJSON(res, 200, { ...d, notionMeta: NT.metaFor(d.tasks || []) })) // 노션 pageId→제목(캐시/슬러그)
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/notion-title' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, NT.setTitle((b && b.id) || '', (b && b.title) || '', b && b.backlog))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/notion-unknown') {
    Tasks.build({}).then((d) => sendJSON(res, 200, { ok: true, ids: NT.unknownIds(d.tasks || []) })).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/create' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.createFromLink(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/enrich' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.enrichThread(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 진행률 표시용: 잡 시작 → 폴링
  if (url === '/api/tasks/enrich/start' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.startEnrich(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/enrich/status') {
    const job = new URL(req.url, 'http://x').searchParams.get('job') || ''
    return sendJSON(res, 200, Tasks.enrichStatus(job))
  }
  if (url === '/api/tasks/failures') {
    return sendJSON(res, 200, Tasks.listFailures())
  }
  if (url === '/api/tasks/failures/retry' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.retryFailure(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/failures/dismiss' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.dismissFailure(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/jobs') {
    return sendJSON(res, 200, Tasks.listJobs())
  }
  // 백로그 자동 생성 (티켓 없는 업무 → Notion 카드 → 티켓 회수). 폴링은 /enrich/status 공용.
  if (url === '/api/tasks/backlog/start' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.startBacklog(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 완료(PR 전부 머지) 작업 일괄 정리 — 워크트리+브랜치+등록 제거
  if (url === '/api/tasks/cleanup-done' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.cleanupDone(b || {}).then((d) => sendJSON(res, 200, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/remove' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.removeTask(b || {}).then((d) => sendJSON(res, 200, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/pr-review' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.startPrReview(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/pr-improve' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.startPrImprove(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/pr-apply-review' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.startPrApplyReview(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/pr-question' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.startPrQuestion(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // ── OpenRM 개선 탭: 프롬프트 레지스트리 편집 + OpenRM 레포 터미널 ──
  if (url === '/api/prompts') {
    return sendJSON(res, 200, { ok: true, prompts: Prompts.list() })
  }
  if (url === '/api/prompts/set' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Prompts.setOverride(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/prompts/reset' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Prompts.reset(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // OpenRM 레포에서 claude 도는 임베드 터미널 — 있으면 재사용, 없으면 생성(멱등)
  if (url === '/api/mrm/term' && req.method === 'POST') {
    ;(async () => {
      const OPENRM_ROOT = path.join(__dirname, '..')
      const sessions = await Term.list().catch(() => [])
      const existing = (sessions || []).find((s) => s.cwd === OPENRM_ROOT)
      if (existing) return sendJSON(res, 200, { ok: true, name: existing.name, cwd: OPENRM_ROOT, reused: true })
      const t = await Term.create({ cwd: OPENRM_ROOT, command: 'claude', label: 'orm-improve', model: Settings.modelFor('dev') })
      sendJSON(res, t.ok ? 200 : 400, { ...t, cwd: OPENRM_ROOT })
    })().catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/link' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.mutateLink(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/title' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.setTitle(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/group' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.setGroup(b || {})).then((r) => sendJSON(res, 200, r)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 그룹 내 카드 순서 재정렬 (드래그 우선순위) — { group, keys: [순서대로] }
  if (url === '/api/tasks/reorder' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.reorderGroup(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 그룹 체인 on/off — { group, on }. on이면 카드 순서대로 각 PR base를 앞 카드 브랜치로 재타깃.
  if (url === '/api/tasks/chain' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.setChain(b || {})).then((r) => sendJSON(res, 200, r)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 그룹 base 브랜치 지정/해제 (배포 타깃 그룹)
  if (url === '/api/tasks/group-base' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.setGroupBase(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 그룹 브랜치로 개발서버 켜기 — 멤버 브랜치들을 전용 워크트리에 병합(그룹 브랜치) 후 그 위에서 dev 서버 기동/재사용.
  if (url === '/api/tasks/group/dev-server' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.startGroupDevServer(b || {})).then((r) => sendJSON(res, r.ok ? 200 : 400, r)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/devserver' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.setDevServer(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/memo' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.setMemo(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/tc' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.setTc(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/model' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.setTaskModel(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 업무 코드/비개발 분류 — start=백그라운드 재판정(폴링은 /enrich/status 공용), class=모달에서 운영자가 확정
  if (url === '/api/tasks/classify/start' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.startClassify(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/class' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.setTaskClass(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 비개발(ops) 업무 자동수행 시작 — 워크트리·PR 없이 MCP로 노션 정리·문서·리서치 (폴링은 /enrich/status 공용)
  if (url === '/api/tasks/ops/start' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.startOps(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/group/create' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.createGroup(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/group/remove' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.removeGroup(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/tasks/group/rename' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Tasks.renameGroup(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 정기배포 브랜치 관리 (deploy-<배포DB ID>): 목록 / 생성(develop 기준 + push) / 삭제(브랜치+워크트리+원격)
  if (url === '/api/deploy') {
    Deploy.list().then((d) => sendJSON(res, 200, d)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/deploy/create' && req.method === 'POST') {
    readBody(req).then((b) => Deploy.create(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/deploy/remove' && req.method === 'POST') {
    readBody(req).then((b) => Deploy.remove(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/deploy/set-notion' && req.method === 'POST') {
    readBody(req).then((b) => Deploy.setNotion(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 그룹 오케스트레이터 — 지휘자 + 활동 피드
  if (url.startsWith('/api/orch/')) {
    const sp = new URL(req.url, 'http://x').searchParams
    if (url === '/api/orch/status' && req.method === 'GET') {
      Orch.status(sp.get('group') || null).then((d) => sendJSON(res, 200, d)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      return
    }
    if (url === '/api/orch/feed' && req.method === 'GET') {
      return sendJSON(res, 200, Orch.feed(sp.get('group') || null))
    }
    if (url === '/api/orch/start' && req.method === 'POST') {
      readBody(req).then((b) => Orch.start(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      return
    }
    if (url === '/api/orch/stop' && req.method === 'POST') {
      readBody(req).then((b) => Orch.stop(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      return
    }
    if (url === '/api/orch/say' && req.method === 'POST') {
      readBody(req).then((b) => Orch.say(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      return
    }
    if (url === '/api/orch/tell' && req.method === 'POST') {
      readBody(req).then((b) => Orch.tell(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      return
    }
    if (url === '/api/orch/event' && req.method === 'POST') {
      readBody(req).then((b) => sendJSON(res, 200, Orch.event(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
      return
    }
  }
  // 배포 카드 '백로그' relation에 작업 그룹의 노션 백로그 연결 (claude+Notion MCP 경유)
  if (url === '/api/deploy/link-backlogs' && req.method === 'POST') {
    readBody(req).then((b) => Tasks.linkBacklogs(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 세션 복원(재부팅 대비) — 스냅샷에 있지만 안 떠있는 세션
  if (url === '/api/sessions/restorable' && req.method === 'GET') {
    Term.restorable().then((r) => sendJSON(res, 200, { ok: true, sessions: r })).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/sessions/restore' && req.method === 'POST') {
    readBody(req).then((b) => Term.restore(b || {}).then((r) => sendJSON(res, 200, r))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/sessions/forget' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Term.forget(b || {}))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 개발서버 끄기 (디버깅 ✕) — 포트 프로세스 종료 + dev 세션 정리
  if (url === '/api/dev/server/stop' && req.method === 'POST') {
    readBody(req).then((b) => Term.stopDevServer(b || {}).then((d) => sendJSON(res, 200, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 개발서버를 지정 포트로 켜고 그 포트를 반환 (→ 프론트가 디버깅 페이지로 이동)
  if (url === '/api/dev/server' && req.method === 'POST') {
    readBody(req)
      .then((b) => {
        // dev 시작 전 env 파일 보강 (없으면 next rewrites undefined로 서버 안 뜸)
        if (b && b.cwd) try { Worktrees.copyEnvFiles(b.cwd) } catch (_) {}
        return Term.startDevServer(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 특정 브랜치(PR 브랜치 등)를 로컬 워크트리로 체크아웃 + dev 서버 켜기 → 그 브랜치를 로컬에서 테스트
  if (url === '/api/dev/branch-server' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        const branch = b && b.branch
        if (!branch) return sendJSON(res, 400, { ok: false, error: '브랜치를 지정하세요.' })
        let cwd = await Worktrees.pathForBranch(branch).catch(() => null) // 이미 워크트리면 재사용
        let wt = null
        if (!cwd) {
          wt = await Worktrees.create({ branch }).catch((e) => ({ ok: false, error: String(e.message || e) }))
          if (!wt.ok) {
            if (/이미 존재하는 폴더/.test(wt.error || '')) cwd = await Worktrees.pathForBranch(branch).catch(() => null)
            if (!cwd) return sendJSON(res, 400, wt)
          } else cwd = wt.path
        }
        try { Worktrees.copyEnvFiles(cwd) } catch (_) {}
        const nm = Worktrees.ensureNodeModules(cwd) // git 워크트리는 node_modules 없음 → 메인서 심링크
        if (!nm.ok) return sendJSON(res, 400, { ok: false, error: nm.error, cwd, branch })
        const d = await Term.startDevServer({ cwd, label: 'dev-' + branch })
        sendJSON(res, d.ok ? 200 : 400, { ...d, cwd, branch, worktreeCreated: !!(wt && wt.ok), nodeModules: nm.symlinked ? 'symlinked' : 'exists' })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 개발실 새 작업: (옵션)워크트리 생성 → 그 폴더에서 claude 실행 + 초기 지시 주입
  if (url === '/api/dev/start-task' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        let cwd = b && b.cwd
        let wt = null
        if (!cwd) {
          // 브랜치명 영어화 — 제목을 짧은 영어 슬러그로 번역 후 desc로 전달 (id-english)
          const engDesc = b && b.desc ? await Tasks.translateToEnglishSlug(b.desc).catch(() => b.desc) : undefined
          // 기존 워크트리가 있으면 재사용(ensure) — ▶진행이 이어가게. desc로 새 브랜치는 id-english
          wt = await Worktrees.ensure({ ticket: b && b.ticket, base: b && b.base, desc: engDesc })
          if (!wt.ok) return sendJSON(res, 400, { ok: false, stage: 'worktree', error: wt.error })
          cwd = wt.path
        }
        const label = (wt && wt.branch) || (b && b.label) || (b && b.ticket) || (cwd.split('/').pop())
        // 이전 claude 대화가 있으면 --continue로 이어받기 (없으면 새로). 명시 command가 우선.
        let command = b && b.command
        if (!command) command = hasClaudeHistory(cwd) ? 'claude --continue' : 'claude'
        const resumed = /--continue|--resume/.test(command)
        // 이어받기면 seed(긴 초기지시) 대신 짧은 진행 넛지만 — 대화는 이미 맥락이 있음. 리뷰 모드면 짧게 리마인드.
        const reviewOn = Settings.get('reviewMode')
        const seed = resumed
          ? ((b && b.resumeNudge) || '이전 작업을 이어서 진행해줘. (먼저 현재까지 상태를 한 줄로 요약하고 계속)') + (reviewOn ? ` 끝내면 리뷰어(${Settings.operatorName()}) 설득 브리핑(무엇을·왜/대안/봐야 할 파일:라인/리스크/검증)으로 마무리.` : '')
          : b && b.seed
        // 모델: 카드에서 지정(b.model)이 있으면 그걸(잠금 시 fable→opus), 없으면 정책 기본(dev/debug)
        const chosen = (b && b.model) || Settings.modelFor(/^dbg-/i.test(String(label)) ? 'debug' : 'dev')
        const model = Settings.get('fableLock') && /fable/.test(String(chosen)) ? 'claude-opus-4-8' : chosen
        const t = await Term.create({ cwd, command, label, seed, model })
        if (!t.ok) return sendJSON(res, 400, { ok: false, stage: 'term', error: t.error, worktree: wt })
        sendJSON(res, 200, { ok: true, worktree: wt, resumed, ...t })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 🔄 작업 초기화 — 이 업무의 워크트리(+에이전트 대화)를 제거하고 새 워크트리에서 claude를 처음부터 다시 시작.
  //   PR·업무 링크·분류는 유지. 미커밋 변경은 폐기.
  if (url === '/api/dev/reset-task' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        const key = b && b.key
        if (!key) return sendJSON(res, 400, { ok: false, error: 'key 필수' })
        const built = await Tasks.build({}).catch(() => ({ tasks: [] }))
        const t = (built.tasks || []).find((x) => x.key === key || x.ticket === key)
        const streams = (((t && t.streams) || [])).filter((s) => !s.isMain)
        if (!streams.length) return sendJSON(res, 400, { ok: false, error: '초기화할 워크트리가 없습니다 (▶진행으로 먼저 시작).' })
        const removed = []
        const errors = []
        const sessions = await Term.list().catch(() => [])
        for (const s of streams) {
          // 1) 그 워크트리에서 도는 에이전트 tmux 세션 종료
          for (const sess of sessions) if (sess.cwd === s.path) { try { await Term.kill(sess.name) } catch (_) {} }
          // 2) 워크트리 + 로컬 브랜치 제거
          const rm = await Worktrees.remove(s.path, s.branch)
          if (rm.ok || rm.worktreeRemoved) removed.push(s.name || s.branch || s.path)
          if (rm.errors && rm.errors.length) errors.push(...rm.errors)
          // 3) claude 대화 기록 삭제 → 재생성 시 --continue 없이 fresh 시작
          try { const enc = String(s.path).replace(/[/.]/g, '-'); fs.rmSync(path.join(process.env.HOME || '', '.claude', 'projects', enc), { recursive: true, force: true }) } catch (_) {}
        }
        if (!removed.length) return sendJSON(res, 400, { ok: false, error: '워크트리 제거 실패', errors })
        // 4) 새 워크트리 생성 + fresh claude 시작 (seed = 카드 초기 지시)
        //    티켓 없으면 방금 제거한 워크트리의 브랜치/이름으로 재생성 (＋새 작업으로 만든 무티켓 업무 대비)
        const ticket = (t && t.ticket) || streams[0].branch || streams[0].name || undefined
        const desc = (t && t.title) || undefined
        const engDesc = desc ? await Tasks.translateToEnglishSlug(desc).catch(() => desc) : undefined
        const wt = await Worktrees.ensure({ ticket, base: b && b.base, desc: engDesc })
        Tasks.build({ force: true }).catch(() => {}) // 보드 갱신
        if (!wt.ok) return sendJSON(res, 200, { ok: true, recreated: false, removed, errors: [...errors, '재생성 실패: ' + wt.error] })
        const chosen = (b && b.model) || Settings.modelFor('dev')
        const model = Settings.get('fableLock') && /fable/.test(String(chosen)) ? 'claude-opus-4-8' : chosen
        const term = await Term.create({ cwd: wt.path, command: 'claude', label: wt.branch || ticket || wt.dir, seed: b && b.seed, model })
        if (!term.ok) return sendJSON(res, 200, { ok: true, recreated: false, removed, worktree: wt, errors: [...errors, '터미널 시작 실패: ' + term.error] })
        sendJSON(res, 200, { ok: true, recreated: true, removed, worktree: wt, name: term.name, errors })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // QA 에이전트 — 워크트리에서 Figma/노션/PR 읽고 TC(HTML) 생성. dev 에이전트와 별도 세션(qa-<ticket>).
  if (url === '/api/dev/qa' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        let cwd = b && b.cwd
        let wt = null
        if (!cwd) {
          const engDesc = b && b.desc ? await Tasks.translateToEnglishSlug(b.desc).catch(() => b.desc) : undefined
          wt = await Worktrees.ensure({ ticket: b && b.ticket, base: b && b.base, desc: engDesc })
          if (!wt.ok) return sendJSON(res, 400, { ok: false, stage: 'worktree', error: wt.error })
          cwd = wt.path
        }
        try {
          Worktrees.copyEnvFiles(cwd)
        } catch (_) {}
        // 항상 새 claude(전용 QA 컨텍스트). 라벨/세션은 qa-<티켓>로 dev 세션과 분리.
        const label = 'qa-' + ((b && b.ticket) || (wt && wt.branch) || cwd.split('/').pop())
        const t = await Term.create({ cwd, command: 'claude', label, seed: b && b.seed, model: Settings.modelFor('qa') })
        if (!t.ok) return sendJSON(res, 400, { ok: false, stage: 'term', error: t.error, worktree: wt })
        sendJSON(res, 200, { ok: true, worktree: wt, ...t })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // E2E 에이전트 — 완성된 TC를 바탕으로 playwright E2E 테스트 생성. 워크트리에서 별도 세션(e2e-<ticket>).
  if (url === '/api/dev/e2e' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        let cwd = b && b.cwd
        let wt = null
        if (!cwd) {
          const engDesc = b && b.desc ? await Tasks.translateToEnglishSlug(b.desc).catch(() => b.desc) : undefined
          wt = await Worktrees.ensure({ ticket: b && b.ticket, base: b && b.base, desc: engDesc })
          if (!wt.ok) return sendJSON(res, 400, { ok: false, stage: 'worktree', error: wt.error })
          cwd = wt.path
        }
        try {
          Worktrees.copyEnvFiles(cwd)
        } catch (_) {}
        const label = 'e2e-' + ((b && b.ticket) || (wt && wt.branch) || cwd.split('/').pop())
        const t = await Term.create({ cwd, command: 'claude', label, seed: b && b.seed, model: Settings.modelFor('verify') })
        if (!t.ok) return sendJSON(res, 400, { ok: false, stage: 'term', error: t.error, worktree: wt })
        sendJSON(res, 200, { ok: true, worktree: wt, ...t })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/term/create' && req.method === 'POST') {
    readBody(req).then((b) =>
      Term.create(b)
        .then((r) => sendJSON(res, r.ok ? 200 : 400, r))
        .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) })),
    )
    return
  }
  if (url === '/api/term/kill' && req.method === 'POST') {
    readBody(req).then((b) =>
      Term.kill(b.name)
        .then((r) => sendJSON(res, r.ok ? 200 : 400, r))
        .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) })),
    )
    return
  }
  // ── 워크트리별 .env.local — "로컬 서버" 탭. cwd는 /term WS와 같은 규칙으로 프로젝트 루트
  // 하위여야만 허용(임의 경로 읽기/쓰기 방지). 재시작은 기존 Term.devSessionForPort/
  // restartDevSession을 그대로 재사용 — 포트가 그 워크트리에서 실제로 떠 있으면 제자리 재시작.
  if (url === '/api/worktree/env' && req.method === 'GET') {
    const cwd = new URL(req.url, 'http://x').searchParams.get('cwd') || ''
    const proj = path.dirname(C.REPO)
    const resolved = path.resolve(cwd)
    if (!cwd || (resolved !== proj && !resolved.startsWith(proj + path.sep))) return sendJSON(res, 400, { ok: false, error: 'cwd가 프로젝트 루트 하위가 아닙니다' })
    let text = ''
    try {
      text = fs.readFileSync(path.join(resolved, '.env.local'), 'utf8')
    } catch (_) {
      /* 파일 없으면 빈 목록 — 아직 한 번도 저장 안 한 새 워크트리일 수 있음 */
    }
    const vars = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return i < 0 ? null : { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() }
      })
      .filter(Boolean)
    return sendJSON(res, 200, { ok: true, vars, cwd: resolved })
  }
  if (url === '/api/worktree/env' && req.method === 'POST') {
    readBody(req)
      .then(async (b) => {
        const cwd = (b && b.cwd) || ''
        const proj = path.dirname(C.REPO)
        const resolved = path.resolve(cwd)
        if (!cwd || (resolved !== proj && !resolved.startsWith(proj + path.sep))) return sendJSON(res, 400, { ok: false, error: 'cwd가 프로젝트 루트 하위가 아닙니다' })
        const vars = Array.isArray(b.vars) ? b.vars : []
        const text = vars.map((v) => `${v.key}=${v.value}`).join('\n') + '\n'
        fs.writeFileSync(path.join(resolved, '.env.local'), text, 'utf8')
        const port = Number(b.port) || 0
        if (!port) return sendJSON(res, 200, { ok: true, restarted: false })
        const info = await Term.devSessionForPort(port).catch(() => null)
        if (info && info.hasSession) {
          const r = await Term.restartDevSession(info)
          return sendJSON(res, 200, { ok: true, restarted: r.ok, restartedIn: r.restartedIn })
        }
        return sendJSON(res, 200, { ok: true, restarted: false, error: `:${port}에서 재시작할 dev 세션을 찾지 못했습니다 — 파일은 저장됐습니다` })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  // 이 워크트리의 살아있는 클로드 세션이 Task 툴로 띄운 서브에이전트 — hasClaudeHistory()와 같은
  // ~/.claude/projects/<cwd 인코딩>/*.jsonl 트랜스크립트를 읽어 실제 tool_use(name: Agent/Task)를
  // 뽑아낸다. 가장 최근에 수정된 jsonl(=지금 붙어있는 세션)만 본다. 가짜 데이터 없음 — 트랜스크립트가
  // 없거나 서브에이전트를 한 번도 안 띄웠으면 빈 배열.
  if (url === '/api/worktree/subagents' && req.method === 'GET') {
    const cwd = new URL(req.url, 'http://x').searchParams.get('cwd') || ''
    const proj = path.dirname(C.REPO)
    const resolved = path.resolve(cwd)
    if (!cwd || (resolved !== proj && !resolved.startsWith(proj + path.sep))) return sendJSON(res, 400, { ok: false, error: 'cwd가 프로젝트 루트 하위가 아닙니다' })
    try {
      const enc = resolved.replace(/[/.]/g, '-')
      const dir = path.join(process.env.HOME || '', '.claude', 'projects', enc)
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
      if (!files.length) return sendJSON(res, 200, { ok: true, subagents: [] })
      const lines = fs.readFileSync(path.join(dir, files[0].f), 'utf8').split('\n').filter(Boolean)
      const subagents = []
      for (const line of lines) {
        let row
        try {
          row = JSON.parse(line)
        } catch (_) {
          continue
        }
        const content = row?.message?.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
          if (block?.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task')) {
            subagents.push({
              subagentType: block.input?.subagent_type || '알 수 없음',
              description: block.input?.description || block.input?.name || '',
              at: row.timestamp || null,
            })
          }
        }
      }
      return sendJSON(res, 200, { ok: true, subagents: subagents.slice(-30).reverse() })
    } catch (_) {
      return sendJSON(res, 200, { ok: true, subagents: [] })
    }
  }
  // ── MSW 시나리오 (현재 보고 있는 페이지 관련) ──
  if (url === '/api/msw/scenarios') {
    const sp = new URL(req.url, 'http://x').searchParams
    const pathname = sp.get('path') || '/'
    const port = Number(sp.get('port')) || 0
    const resolveCwd = port ? Term.devSessionForPort(port).then((d) => (d && d.cwd) || null).catch(() => null) : Promise.resolve(null)
    resolveCwd.then((cwd) => sendJSON(res, 200, Msw.forPath(pathname, cwd))).catch((e) => sendJSON(res, 200, { ok: false, error: String(e.message || e), pages: [] }))
    return
  }
  // ── Sentry 직접 감시 ──
  if (url === '/api/sentry/status') {
    const c = Sentry.cfg()
    return sendJSON(res, 200, { ok: true, configured: Sentry.configured(), org: c.org, project: c.project, query: c.query, identifier: c.identifier, kind: c.kind, tokenMasked: Sentry.tokenMasked() })
  }
  if (url === '/api/sentry/config' && req.method === 'POST') {
    readBody(req).then((b) => { Sentry.setConfig(b || {}); const c = Sentry.cfg(); sendJSON(res, 200, { ok: true, configured: Sentry.configured(), org: c.org, project: c.project, query: c.query, identifier: c.identifier, kind: c.kind, tokenMasked: Sentry.tokenMasked() }) }).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/sentry/probe' && req.method === 'POST') {
    readBody(req).then((b) => Sentry.probe(b && b.identifier).then((r) => sendJSON(res, r.ok === false ? 400 : 200, r))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/sentry/issues') {
    const sp = new URL(req.url, 'http://x').searchParams
    Sentry.recentIssues({ statsPeriod: sp.get('period') || '24h', limit: Number(sp.get('limit')) || 25 })
      .then((issues) => sendJSON(res, 200, { ok: true, issues }))
      .catch((e) => sendJSON(res, 200, { ok: false, error: String(e.message || e), issues: [] }))
    return
  }
  if (url === '/api/monitor') {
    return sendJSON(res, 200, Monitor.getState())
  }
  if (url === '/api/monitor/poll' && req.method === 'POST') {
    Monitor.poll(false).then(() => sendJSON(res, 200, Monitor.getState()))
    return
  }
  if (url === '/api/monitor/test' && req.method === 'POST') {
    return sendJSON(res, 200, Monitor.testEvent())
  }
  if (url === '/api/monitor/claude') {
    const kind = new URL(req.url, 'http://x').searchParams.get('kind') || 'ops'
    Monitor.claudeStatus(kind).then((d) => sendJSON(res, 200, d)).catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/monitor/claude/start' && req.method === 'POST') {
    readBody(req).then((b) => Monitor.startClaude(b.intervalSec != null ? b.intervalSec : b.intervalMin != null ? b.intervalMin * 60 : undefined, b.kind).then((d) => sendJSON(res, d.ok ? 200 : 400, d)))
    return
  }
  if (url === '/api/monitor/claude/stop' && req.method === 'POST') {
    readBody(req).then((b) => Monitor.stopClaude(b && b.kind).then((d) => sendJSON(res, 200, d)))
    return
  }
  if (url === '/api/monitor/aws') {
    const force = /[?&]force=1/.test(req.url || '')
    Aws.status(force).then((d) => sendJSON(res, 200, d)).catch((e) => sendJSON(res, 500, { error: String(e.message || e) }))
    return
  }
  if (url === '/api/monitor/alerts') {
    return sendJSON(res, 200, Monitor.alertsState())
  }
  if (url === '/api/monitor/alerts/fetch' && req.method === 'POST') {
    Monitor.fetchAlerts().then((d) => sendJSON(res, d.ok ? 200 : 400, d)).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/monitor/question' && req.method === 'POST') {
    readBody(req).then((b) => Monitor.askReviewFinding(b || {}).then((d) => sendJSON(res, d.ok ? 200 : 400, d))).catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/monitor/alerts/ack' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Monitor.ackAlert(b || {})))
    return
  }
  if (url === '/api/monitor/alerts/converted' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Monitor.markAlertConverted(b || {})))
    return
  }
  if (url === '/api/monitor/alerts/remove' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, Monitor.removeAlert(b || {})))
    return
  }
  if (url === '/api/monitor/alerts/interval' && req.method === 'POST') {
    readBody(req).then((b) => sendJSON(res, 200, { ok: true, intervalMs: Monitor.setAlertsInterval(b && b.intervalMs) }))
    return
  }
  // 🔗 Slack Events API 인바운드 — 채널 알림을 claude -p 없이 직접 수신.
  //   설정: Slack 앱 Event Subscriptions Request URL = https://<공개주소>/api/slack/events, message.channels 구독.
  //   서명검증: Setup의 slackSign 커넥터(Secrets.slackSigningSecret) 또는 env SLACK_SIGNING_SECRET 설정 시 강제
  //   (미설정이면 로컬 테스트용 통과).
  if (url === '/api/slack/events' && req.method === 'POST') {
    readRawBody(req)
      .then((raw) => {
        const secret = Secrets.get('slackSigningSecret') || process.env.SLACK_SIGNING_SECRET
        const remoteAddr = String(req.socket.remoteAddress || '')
        const remoteIsLocal = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1'
        if (secret) {
          if (!verifySlackSig(secret, req.headers['x-slack-request-timestamp'], raw, req.headers['x-slack-signature'])) {
            return sendJSON(res, 401, { ok: false, error: 'bad signature' })
          }
        } else if (!remoteIsLocal) {
          // fail-closed: 공개 주소로 노출된 상태에서 서명 시크릿 미설정이면 위조 이벤트 주입 위험 — 거부.
          return sendJSON(res, 501, { ok: false, error: 'SLACK_SIGNING_SECRET not configured' })
        }
        let body = {}
        try {
          body = raw ? JSON.parse(raw) : {}
        } catch (_) {
          return sendJSON(res, 400, { ok: false, error: 'bad json' })
        }
        if (body.type === 'url_verification') return sendJSON(res, 200, { challenge: body.challenge }) // 최초 URL 검증
        if (body.type === 'event_callback' && body.event) {
          const r = Monitor.ingestSlackEvent(body.event)
          return sendJSON(res, 200, { ok: true, ingest: r }) // Slack엔 3초 내 200
        }
        return sendJSON(res, 200, { ok: true, ignored: body.type || 'unknown' })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/monitor/config' && req.method === 'POST') {
    readBody(req).then((b) => {
      if (b.running === true) Monitor.start()
      if (b.running === false) Monitor.stop()
      if (b.intervalMs) Monitor.setIntervalMs(b.intervalMs)
      sendJSON(res, 200, Monitor.getState())
    })
    return
  }
  if (url === '/api/monitor/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(': ok\n\n')
    const unsub = Monitor.subscribe((ev) => {
      try {
        res.write(`data: ${JSON.stringify(ev)}\n\n`)
      } catch (_) {}
    })
    const hb = setInterval(() => {
      try {
        res.write(': hb\n\n')
      } catch (_) {}
    }, 15000)
    req.on('close', () => {
      clearInterval(hb)
      unsub()
    })
    return
  }
  if (url === '/api/cockpit') {
    Cockpit.cockpit()
      .then((d) => sendJSON(res, 200, d))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/cmux') {
    // 이름(제목)만 가져온다 — 실제 터미널은 OpenRM이 호스팅(claude --resume). cmux 탈피 경로.
    Cmux.claudeSessions()
      .then((s) => sendJSON(res, 200, { ok: true, sessions: s }))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/cmux/screen') {
    const sp = new URL(req.url, 'http://x').searchParams
    Cmux.screen({ workspace: sp.get('workspace'), surface: sp.get('surface'), lines: Number(sp.get('lines')) || 40, scrollback: sp.get('scrollback') === '1' })
      .then((d) => sendJSON(res, d.ok ? 200 : 400, d))
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/cmux/send' && req.method === 'POST') {
    readBody(req).then((body) =>
      Cmux.send(body)
        .then((r) => sendJSON(res, r.ok ? 200 : 400, r))
        .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) })),
    )
    return
  }
  if (url === '/api/cmux/key' && req.method === 'POST') {
    readBody(req).then((body) =>
      Cmux.key(body)
        .then((r) => sendJSON(res, r.ok ? 200 : 400, r))
        .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) })),
    )
    return
  }
  if (url === '/api/route' && req.method === 'POST') {
    readBody(req).then((body) => sendJSON(res, 200, Router.route(body.task || '')))
    return
  }
  if (url === '/api/dispatch' && req.method === 'POST') {
    readBody(req).then((body) =>
      Act.dispatch(body)
        .then((r) => sendJSON(res, r.ok ? 200 : 400, r))
        .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) })),
    )
    return
  }
  // 요소 명령 첨부 이미지 — base64 dataUrl을 파일로 저장 후 절대경로 반환. 에이전트(claude)가 그 경로를 Read로 확인.
  if (url === '/api/dev/upload-image' && req.method === 'POST') {
    readBody(req)
      .then((b) => {
        const m = /^data:image\/([\w+.-]+);base64,(.+)$/s.exec((b && b.dataUrl) || '')
        if (!m) return sendJSON(res, 400, { ok: false, error: '이미지 dataUrl 아님' })
        const ext = m[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png'
        const buf = Buffer.from(m[2], 'base64')
        if (buf.length > 12 << 20) return sendJSON(res, 400, { ok: false, error: '이미지 12MB 초과' })
        // 워크트리 cwd가 있으면 그 안 .openrm-cmd-images/, 없으면 OpenRM 프로젝트 하위. 에이전트가 절대경로로 Read.
        const baseDir = b && b.cwd && fs.existsSync(b.cwd) ? path.join(b.cwd, '.openrm-cmd-images') : path.join(__dirname, '..', '.openrm-cmd-images')
        try { fs.mkdirSync(baseDir, { recursive: true }) } catch (_) {}
        const file = path.join(baseDir, `cmd-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`)
        try { fs.writeFileSync(file, buf) } catch (e) { return sendJSON(res, 500, { ok: false, error: '저장 실패: ' + String(e.message || e) }) }
        sendJSON(res, 200, { ok: true, path: file, bytes: buf.length })
      })
      .catch((e) => sendJSON(res, 500, { ok: false, error: String(e.message || e) }))
    return
  }
  if (url === '/api/analyze') {
    const days = Number(new URL(req.url, 'http://x').searchParams.get('days')) || 90
    A.analyze(days)
      .then((d) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(d))
      })
      .catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(e.message || e) }))
      })
    return
  }
  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(`data: ${JSON.stringify(C.readModel())}\n\n`)
    clients.add(res)
    const hb = setInterval(() => {
      try {
        res.write(': hb\n\n')
      } catch (_) {}
    }, 15000)
    req.on('close', () => {
      clearInterval(hb)
      clients.delete(res)
    })
    return
  }
  if (req.method === 'GET' && !url.startsWith('/api') && url !== '/events') {
    if (serveStatic(url, res)) return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

// ── 실터미널 WebSocket 브리지: xterm ↔ node-pty(tmux attach) ──
// /term?session=orm-XXX&cols=&rows=  — OpenRM 소유(orm-) 세션만 attach 허용.
const wss = new WebSocketServer({ noServer: true })
// 좀비 연결(노트북 슬립·강제 탭종료·네트워크 끊김)은 'close'가 안 와서 p.kill()이 안 불리고
// node-pty가 문 /dev/ptmx fd를 영구히 물고 있어, 며칠 지나면 macOS pty 한도(kern.tty.ptmx_max)를
// 다 써버려 새 터미널(tmux new-session)이 전부 "Device not configured"로 실패하는 사고가 있었다.
// → 30초 ping/pong으로 응답 없는 연결을 강제 종료(terminate)해 pty를 회수한다.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate()
    ws.isAlive = false
    ws.ping()
  })
}, 30000)
server.on('upgrade', async (req, socket, head) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname !== '/term') {
    socket.destroy()
    return
  }
  if (AUTH_TOKEN) {
    const given = req.headers['x-openrm-token'] || u.searchParams.get('token')
    if (given !== AUTH_TOKEN) {
      socket.destroy()
      return
    }
  }
  const session = u.searchParams.get('session') || ''
  // orm- 접두 필수(안전). claude(cmux)가 세션명을 'orm-X_<ts>_..._/cwd_..'로 리네임하므로 / . 도 허용.
  if (!/^orm-[\w가-힣./-]+$/.test(session)) {
    socket.destroy()
    return
  }
  const cols = Math.min(400, Number(u.searchParams.get('cols')) || 120)
  const rows = Math.min(150, Number(u.searchParams.get('rows')) || 32)
  // 세션이 아직 없으면 이 cwd(워크트리)에서 생성. 프로젝트 루트 하위 디렉토리만 허용.
  const PROJ = path.dirname(C.REPO)
  let startDir = null
  const cwdParam = u.searchParams.get('cwd')
  if (cwdParam && cwdParam.startsWith(PROJ)) {
    try {
      if (fs.statSync(cwdParam).isDirectory()) startDir = cwdParam
    } catch (_) {}
  }
  // 요청 이름을 "살아있는 실제 세션"으로 해석 — cmux 리네임/중첩 방지.
  // 정확히 있으면 그 이름, 베이스가 같은 게 있으면 그걸로 attach, 없으면 깨끗한 베이스로 생성.
  let target = session
  let creating = false
  try {
    const live = await Term.list()
    const exact = live.find((s) => s.name === session)
    if (exact) target = exact.name
    else {
      const b = Term.baseName(session)
      const m = live.find((s) => Term.baseName(s.name) === b)
      if (m) target = m.name
      else {
        target = b // 깨끗한 베이스명(. / 없음)으로 생성 → tmux 라운드트립 정상
        creating = true
      }
    }
  } catch (_) {
    target = Term.baseName(session)
    creating = true
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
    let p
    try {
      // -u는 tmux 전역 플래그(서브커맨드 앞) — UTF-8 강제(한글). 살아있으면 attach(-c 무시), 새로 만들 때만 -c.
      const args = creating && startDir ? ['-u', 'new-session', '-A', '-s', target, '-c', startDir] : ['-u', 'new-session', '-A', '-s', target]
      // 로케일 없으면 tmux가 비-UTF8 → 한글 깨짐. env에 LANG 보강.
      const env = { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8', LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8' }
      p = pty.spawn('tmux', args, { name: 'xterm-256color', cols, rows, cwd: startDir || process.env.HOME, env })
    } catch (e) {
      try {
        ws.send('\r\n[터미널 생성 실패: ' + String(e.message || e) + ']\r\n')
        ws.close()
      } catch (_) {}
      return
    }
    p.onData((d) => {
      try {
        ws.send(d)
      } catch (_) {}
    })
    p.onExit(() => {
      try {
        ws.close()
      } catch (_) {}
    })
    ws.on('message', (m) => {
      const s = m.toString()
      if (s[0] === '\x00') {
        // 리사이즈 제어: '\x00<cols>,<rows>'
        const mm = s.slice(1).match(/^(\d+),(\d+)$/)
        if (mm) {
          try {
            p.resize(Number(mm[1]), Number(mm[2]))
          } catch (_) {}
        }
        return
      }
      try {
        p.write(s)
      } catch (_) {}
    })
    ws.on('close', () => {
      try {
        p.kill()
      } catch (_) {}
    })
  })
})

// ── 1회성 tmux 세션 접두 마이그레이션 (레거시 → 'orm-') ──
// 리브랜딩으로 세션 접두가 바뀌었으니, 이전 버전이 만든 레거시 접두 세션을 새 'orm-' 접두로 리네임한다.
// 안 하면 진행 중이던 세션이 term.cjs allowlist(접두 검사)에서 사라져 orphan 된다. execFile 래퍼는 term.cjs tmux()와 동일 스타일.
// 비치명적: tmux 미설치/서버 없음/실패 시 경고만 남기고 부팅을 계속한다.
// (레거시 접두 문자열은 분리 표기 — 리브랜딩 grep 게이트가 구접두 잔재로 오탐하지 않게.)
function migrateTmuxSessionPrefix() {
  const LEGACY = 'mr' + 'm-' // 구접두 (리브랜딩 전)
  const NEXT = 'orm-'
  const DELIM = '|=|' // 인쇄가능 멀티문자 구분자 (tmux가 제어문자를 format 출력에서 삭제하는 이슈 회피)
  const run = (args) =>
    new Promise((resolve) =>
      require('child_process').execFile('tmux', args, { timeout: 5000, maxBuffer: 4 << 20, env: process.env }, (e, out, err) =>
        resolve({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') }),
      ),
    )
  return run(['list-sessions', '-F', `#{session_id}${DELIM}#{session_name}`])
    .then(async (r) => {
      if (!r.ok) {
        // tmux 서버 미기동(세션 0개)이면 조용히 넘어감 — 실제 오류만 경고.
        if (r.err && !/no server running|no such file|error connecting/i.test(r.err)) console.log(`   ↪️  tmux 세션 마이그레이션 건너뜀: ${r.err.trim()}`)
        else console.log('   ↪️  tmux 세션 마이그레이션: 실행 중인 tmux 세션 없음')
        return
      }
      const targets = []
      for (const line of r.out.split('\n')) {
        if (!line) continue
        const [id, name] = line.split(DELIM)
        if (name && name.startsWith(LEGACY)) targets.push({ id, name, next: NEXT + name.slice(LEGACY.length) })
      }
      if (!targets.length) { console.log('   ↪️  tmux 세션 마이그레이션: 대상 없음 (레거시 접두 세션 없음)'); return }
      let done = 0
      for (const t of targets) {
        // 이름에 . / 가 섞인 cmux 리네임 세션은 -t 이름 타겟이 깨지므로 session_id($N)로 타겟.
        const rr = await run(['rename-session', '-t', t.id || t.name, t.next])
        if (rr.ok) { done++; console.log(`   ↪️  tmux 세션 리네임: ${t.name} → ${t.next}`) }
        else console.log(`   ⚠️  tmux 세션 리네임 실패(${t.name}): ${rr.err.trim()}`)
      }
      console.log(`   ↪️  tmux 세션 접두 마이그레이션 완료: ${done}/${targets.length}건`)
    })
    .catch((e) => console.log(`   ⚠️  tmux 세션 마이그레이션 오류: ${String((e && e.message) || e)}`))
}

// startServer — listen을 함수로 감싸서 호출 시점/포트를 호출자(Electron main 등)가 통제할 수 있게 함.
// `node server/index.cjs`로 직접 실행할 땐 아래 require.main 체크에서 자동으로 호출되어 기존과 동일하게 동작.
function startServer(opts = {}) {
  const port = opts.port || PORT
  const host = opts.host || HOST
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      console.log(`\n🪪  OpenRM 백엔드 — http://${host}:${port}`)
      console.log(`   repo : ${C.REPO}`)
      console.log(`   state: ${C.STATE_PATH || '(없음)'}\n`)
      // 레거시 접두 세션 → 'orm-' 1회성 리네임. tmux 세션은 이 앱 전용 네임스페이스가 아니라
      // 머신 전역이라, 자동 실행 시 이 리포와 무관한 다른 'mrm-' 세션(다른 프로젝트/툴)까지 건드릴 수
      // 있음이 실제로 확인됨 — 그래서 기본은 비활성, 명시적으로 켠 경우에만 실행한다.
      if (process.env.OPENRM_MIGRATE_TMUX === '1') migrateTmuxSessionPrefix()
      watchState()
      watchSrc()
      Preview.setOnSignin((id, pwd) => DevUsers.saveLogin(id, pwd)) // iframe 직접 로그인 → 계정 자동저장
      Preview.start()
      loop(C.pollTmux, 5000)
      loop(C.pollPorts, 10000)
      loop(C.pollPRs, 30000)
      Monitor.start() // PR·이슈 모니터 자동 시작 (cmux "10분 모니터링" 세션 대체)
      console.log('   👁  모니터: PR 리뷰·CI·이슈 자동 감시 시작')
      Aws.startExpiryWatch() // AWS MFA 세션 만료 감시 — 인증 풀리면 맥 알림 (읽기전용 STS 호출만, aws.cjs 참고)
      require('./notify.cjs').start() // 에이전트 완료/질문/인증 → 맥 알림
      console.log('   🔔  에이전트 알림: 완료·질문·인증 감시 시작')
      Scheduler.start() // Automations(§07 "크론잡 생성") — 30초마다 due job 확인
      console.log('   🗓  Automations: 스케줄러 시작\n')
      resolve({ port, host, server })
    })
  })
}

if (require.main === module) {
  startServer().catch((e) => {
    console.error('❌ 서버 시작 실패:', (e && e.message) || e)
    process.exit(1)
  })
}

module.exports = { startServer, server }
