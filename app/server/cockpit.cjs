// cockpit.cjs — 병렬 개발 한눈 콕핏. 작업 스트림(=git 워크트리)마다 git·PR/CI·dev서버를 조인.
// 터미널 툴(cmux/tmux) 무관: 데이터는 git·gh·lsof에서 직접 뽑는다.  (PR은 prs.cjs 1회 gh 호출 재사용)
'use strict'
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const C = require('./collector.cjs')
const Prs = require('./prs.cjs')
const Cmux = require('./cmux.cjs')
const Ticket = require('./ticket.cjs')
const Term = require('./term.cjs') // 에이전트(tmux) 세션이 도는 워크트리도 active로 잡기 위함 (term은 cockpit 미참조 → 순환 없음)
const StoreRepos = require('./store/repos.cjs')
const Worktrees = require('./worktrees.cjs') // goneBranches 재사용 (worktrees는 cockpit 미참조 → 순환 없음)

// "방금 만진 곳" 감지에서 제외할 자동생성 노이즈 (아이콘 배럴·생성물·스냅샷)
const IGNORE_TOUCH = /(^|\/)(svgr\.[tj]sx?|.*\.generated\..*|.*\.snap)$/
// 미커밋 파일들의 최근 mtime = 사용자가 그 워크트리를 마지막으로 만진 시각
function touchedFromStatus(status, root) {
  let touchedMs = 0
  let touchedFile = null
  for (const line of status.split('\n')) {
    if (!line) continue
    const f = line.slice(3).trim().replace(/^.*-> /, '') // rename "old -> new"
    if (!f || IGNORE_TOUCH.test(f)) continue
    try {
      const m = fs.statSync(path.join(root, f)).mtimeMs
      if (m > touchedMs) {
        touchedMs = m
        touchedFile = f
      }
    } catch (_) {}
  }
  return { touchedMs, touchedFile }
}

// "PR 상황이 여전히 안 보여" — 이 파일 전체가 C.REPO(AppConfig.rootPath, 사실상 데모/단일 레포 폴백) 하나만
// 스캔했다. 실제 태스크 워크트리는 store/repos.cjs에 등록된 레포마다(예: gongbiz-crm-b2b-web) 따로 있는데
// C.REPO는 그중 아무 상관 없는 레포를 가리킬 수 있어(§ resolveRepo 폴백 순서) byBranch가 늘 텅 비었다.
// 등록된 레포가 있으면 그 전부를, 없으면(기존 단일-레포 세팅) C.REPO 하나만 스캔한다.
function repoPaths() {
	const repos = StoreRepos.list()
	return repos.length ? repos.map((r) => r.path) : [C.REPO]
}

// 워크트리/프로젝트가 사는 루트들 — dev 서버를 이 하위로 한정해 postgres/redis 등 인프라 잡음 제외.
// 매번 새로 계산(§ collector.cjs resolveRepo와 동일 이유 — 레포 등록/해제가 재시작 없이 반영돼야 함).
function projRoots() {
	return [...new Set(repoPaths().map((p) => path.dirname(p)))]
}

const BASE = process.env.OPENRM_BASE_BRANCH || 'origin/main'
const ticketOf = Ticket.ticketOf

function sh(cmd, args, timeout = 6000) {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (e, out) => resolve(e ? '' : String(out || ''))),
  )
}
const git = (args, repo) => sh('git', ['-C', repo, ...args])

// ok 플래그가 필요한 곳(=삭제 안전 판정)용 — sh 는 타임아웃/에러에도 '' 라 status 를 clean 으로 오인한다.
function shOk(cmd, args, timeout = 12000) {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (e, out) => resolve({ ok: !e, out: String(out || '') })),
  )
}
const gitOk = (args, repo) => shOk('git', ['-C', repo, ...args])

// 동시 git 호출 제한 (54개×여러 호출 폭주 방지)
async function mapLimit(items, limit, fn) {
  const out = []
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))))
  return out
}

// ── 떠있는 dev 서버: lsof LISTEN → {port, pid, cwd, kind, ticket} ──
function classify(cmd) {
  if (/storybook|:6006|6006/.test(cmd)) return 'storybook'
  if (/vite/.test(cmd)) return 'vite'
  if (/next/.test(cmd)) return 'next'
  if (/webpack|react-scripts/.test(cmd)) return 'webpack'
  return 'node'
}
function lsof(args) {
  return new Promise((resolve) =>
    execFile('lsof', args, { timeout: 5000, maxBuffer: 8 << 20 }, (e, out) => resolve(String(out || ''))),
  )
}
async function devServers() {
  // node/뷰 서버 LISTEN 포트 수집 (3000~6999 + 일반 dev 포트). StreamDeck/시스템 잡음 제외.
  const out = await lsof(['-nP', '-iTCP', '-sTCP:LISTEN'])
  const byPid = {} // pid → ports[]
  for (const line of out.split('\n')) {
    if (!/\(LISTEN\)/.test(line)) continue
    const pid = line.split(/\s+/)[1]
    const m = line.match(/:(\d+)\s+\(LISTEN\)/) // 끝의 :PORT (LISTEN)
    if (!pid || !m) continue
    const port = Number(m[1])
    if (port < 3000 || port > 6999) continue
    ;(byPid[pid] = byPid[pid] || new Set()).add(port)
  }
  const servers = []
  for (const pid of Object.keys(byPid)) {
    const cmd = (await sh('ps', ['-o', 'command=', '-p', pid])).trim()
    if (/StreamDeck|Elgato|ControlCe|chrome-devtools-mcp/i.test(cmd)) continue
    const cwdOut = await lsof(['-a', '-p', pid, '-d', 'cwd', '-Fn'])
    const cwd = (cwdOut.split('\n').find((l) => l.startsWith('n')) || '').slice(1)
    if (!cwd || !projRoots().some((root) => cwd.startsWith(root))) continue // 프로젝트 외부(인프라/시스템) 제외
    for (const port of byPid[pid])
      servers.push({ port, pid: Number(pid), cwd, kind: classify(cmd), ticket: ticketOf(cwd) })
  }
  return servers.sort((a, b) => a.port - b.port)
}

// ── 포트 → 작업명: 디버깅 화면에서 "무슨 작업인지" 표시용 ──
// dev 서버 cwd의 git 브랜치(가장 설명적) + 티켓 + 폴더명. 마운트/포트변경 시에만 호출(비폴링).
async function portLabels() {
  const servers = await devServers()
  const out = {}
  await mapLimit(servers, 8, async (s) => {
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], s.cwd)).trim()
    out[s.port] = {
      ticket: s.ticket || ticketOf(branch),
      branch: branch && branch !== 'HEAD' ? branch : null,
      name: path.basename(s.cwd),
    }
  })
  return out
}

// ── 작업 스트림: 워크트리 + git상태 + PR/CI + devServer 조인 ──
async function streams() {
  const paths = repoPaths()
  // 레포별로 워크트리 목록 + 머지·삭제된(gone) 브랜치 집합을 함께 수집 → 각 워크트리에 소속 레포의 gone 판정을 붙인다.
  const perRepo = await mapLimit(paths, 4, async (p) => ({
    repo: p,
    raw: await git(['worktree', 'list', '--porcelain'], p),
    gone: await Worktrees.goneBranches(p).catch(() => new Set()),
  }))
  const wts = []
  for (const { repo, raw, gone } of perRepo) {
    let cur = null
    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        cur = { path: line.slice(9).trim(), repo, goneSet: gone }
        wts.push(cur)
      } else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace('refs/heads/', '')
      else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5).trim().slice(0, 9)
      else if (cur && line.startsWith('detached')) cur.detached = true
    }
  }

  // dev 서버 + PR 동시 수집
  const [devs, prData] = await Promise.all([devServers(), Prs.list('open').catch(() => ({ prs: [] }))])
  const prByBranch = {}
  for (const p of prData.prs || []) prByBranch[p.branch] = p
  const devByPath = {} // 최장 prefix 매칭
  for (const d of devs) {
    let best = null
    for (const w of wts) if (d.cwd && d.cwd.startsWith(w.path) && (!best || w.path.length > best.length)) best = w.path
    if (best) (devByPath[best] = devByPath[best] || []).push(d)
  }

  const enriched = await mapLimit(wts, 8, async (w) => {
    const [st, last, ahead, behind] = await Promise.all([
      gitOk(['status', '--porcelain'], w.path), // ok 필요 — 타임아웃/에러를 clean 으로 오인하지 않기 위해
      git(['log', '-1', '--format=%cr%s'], w.path),
      git(['rev-list', '--count', `${BASE}..HEAD`], w.path),
      git(['rev-list', '--count', `HEAD..${BASE}`], w.path),
    ])
    const statusOk = st.ok
    const dirty = st.out.split('\n').filter(Boolean).length
    const [rel, subject] = (last || '').trim().split('')
    const pr = prByBranch[w.branch] || null
    const devList = devByPath[w.path] || []
    return {
      path: w.path,
      name: w.path.split('/').pop(),
      branch: w.branch || (w.detached ? '(detached)' : ''),
      ticket: ticketOf(w.branch) || ticketOf(w.path),
      isMain: paths.includes(w.path),
      dirty,
      // gone: 원격 브랜치가 머지·삭제됨(정리 후보). cleanable: gone + status 확인성공 + 변경 0줄일 때만.
      gone: !paths.includes(w.path) && !!w.branch && !!w.goneSet && w.goneSet.has(w.branch),
      cleanable: !paths.includes(w.path) && !!w.branch && !!w.goneSet && w.goneSet.has(w.branch) && statusOk && dirty === 0,
      repoPath: w.repo,
      ahead: Number(ahead.trim()) || 0,
      behind: Number(behind.trim()) || 0,
      lastRel: rel || null,
      lastSubject: subject || null,
      pr: pr ? { number: pr.number, state: pr.state, draft: pr.draft, ci: pr.ci, review: pr.review, url: pr.url } : null,
      dev: devList.map((d) => ({ port: d.port, kind: d.kind })),
      ...touchedFromStatus(status, w.path),
    }
  })

  // 활성 우선 정렬: dev > dirty > PR > 그외, 그 안에서 최근순
  const score = (s) => (s.dev.length ? 4 : 0) + (s.dirty ? 2 : 0) + (s.pr ? 1 : 0)
  enriched.sort((a, b) => score(b) - score(a) || (b.ahead || 0) - (a.ahead || 0))
  return { all: enriched, devs, prError: prData.error || null }
}

// stale-while-revalidate — 무거운 gh+git(워크트리 54개)로 빌드가 ~12초라 동기 대기하면 렉.
// 캐시 있으면 즉시 반환, 오래됐으면 백그라운드로만 갱신.
let cache = { at: 0, data: null, building: false }
const COCKPIT_FRESH = 15000
async function cockpit() {
  const age = Date.now() - cache.at
  if (cache.data) {
    if (age < COCKPIT_FRESH) return cache.data
    if (!cache.building) {
      cache.building = true
      buildCockpit()
        .then((d) => {
          cache = { at: Date.now(), data: d, building: false }
        })
        .catch(() => {
          cache.building = false
        })
    }
    return cache.data // stale 즉시 반환
  }
  const d = await buildCockpit()
  cache = { at: Date.now(), data: d, building: false }
  return d
}
async function buildCockpit() {
  const { all, devs, prError } = await streams()
  // 에이전트(claude tmux)가 도는 워크트리 cwd — fresh(변경/PR/dev 없음)여도 '작업 중'이므로 active로 포함
  const agentCwds = new Set((await Term.list().catch(() => [])).map((s) => s.cwd).filter(Boolean))
  const active = all.filter((s) => s.dev.length || s.dirty || s.pr || s.ahead || agentCwds.has(s.path))

  // ── "지금 작업 중" 자동 감지 ── 방금 만진 워크트리 + cmux가 포커스한 곳
  const focusedCwd = await Cmux.focusedCwd().catch(() => null)
  const byPath = Object.fromEntries(all.map((s) => [s.path, s]))
  const focused = focusedCwd && byPath[focusedCwd] ? { ticket: byPath[focusedCwd].ticket, name: byPath[focusedCwd].name, branch: byPath[focusedCwd].branch, path: focusedCwd } : focusedCwd ? { name: path.basename(focusedCwd), path: focusedCwd } : null
  const recent = all
    .filter((s) => s.touchedMs > 0)
    .sort((a, b) => b.touchedMs - a.touchedMs)
    .slice(0, 6)
    .map((s) => ({ ticket: s.ticket, name: s.name, branch: s.branch, touchedMs: s.touchedMs, touchedFile: s.touchedFile, dirty: s.dirty, pr: s.pr, isMain: s.isMain }))

  // 브랜치명 → git/PR 요약. Sessions 사이드바가 태스크·서브태스크 행에 PR 배지·ahead/behind를
  // 실데이터로 붙이는 용도(TaskRow) — streams() 전체를 매번 다시 돌리는 대신 이 캐시된 결과를 재사용.
  const byBranch = {}
  for (const s of all) if (s.branch) byBranch[s.branch] = { dirty: s.dirty, ahead: s.ahead, behind: s.behind, pr: s.pr }
  // "PR뱃지도 자동으로 안잡혀" — 서브태스크 세션이 자기 워크트리 안에서 직접 git checkout -b로 브랜치를
  // 바꾸면 StoreBranches에 기록된 브랜치명이 그 순간 낡아버려 byBranch 조회가 영영 빗나간다. 워크트리
  // 경로는 에이전트가 브랜치를 갈아타도 안 바뀌므로 경로 기준으로도 같은 데이터를 실어 — 프론트가
  // subtaskWork.worktreePath로 조회하면 브랜치명이 뭐로 바뀌든 항상 지금 실제 상태를 찾는다.
  const pathStatus = {}
  for (const s of all) pathStatus[s.path] = { dirty: s.dirty, ahead: s.ahead, behind: s.behind, pr: s.pr, branch: s.branch || null }

  const data = {
    ok: true,
    now: { focused, recent },
    summary: {
      devCount: devs.length,
      streamsTotal: all.length,
      streamsActive: active.length,
      dirty: all.filter((s) => s.dirty).length,
      prOpen: all.filter((s) => s.pr && !s.pr.draft).length,
      prDraft: all.filter((s) => s.pr && s.pr.draft).length,
      ciFail: all.filter((s) => s.pr && s.pr.ci === 'fail').length,
      // 사이드바 하단 "master · N 작업" 표시용 — 메인 워크트리(isMain)가 지금 어느 브랜치에 있는지.
      mainBranch: (all.find((s) => s.isMain) || {}).branch || null,
    },
    devServers: devs,
    active,
    byBranch,
    byPath: pathStatus,
    streamsTotal: all.length,
    prError,
    builtAt: new Date().toISOString(),
  }
  return data
}

module.exports = { cockpit, devServers, streams, portLabels }
