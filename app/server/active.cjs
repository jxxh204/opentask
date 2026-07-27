// active.cjs — "지금 개발중인 곳"을 git으로 추적하고, 변경 파일마다 API 정확성 + 테스트 유무를 검증.
// OpenRM을 "전체 사전" → "현재 작업 도구"로 만드는 핵심 뷰.
'use strict'
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const C = require('./collector.cjs')
const Api = require('./apiusage.cjs')

const SRC = path.join(C.REPO, 'src')
const rel = (abs) => path.relative(C.REPO, abs).replace(/\\/g, '/')
const TESTRE = /\.(test|spec)\.(ts|tsx|js|jsx)$/

function git(args, repo = C.REPO) {
  return new Promise((resolve) => {
    execFile('git', ['-C', repo, ...args], { timeout: 10000, maxBuffer: 8 << 20 }, (e, out) => resolve(e ? '' : String(out || '')))
  })
}

// 변경 파일 수집 (mode: working=미커밋 / recent=최근 N커밋 / branch=develop 기준 전체). repo=워크트리 경로
async function changedFiles(mode, n, repo = C.REPO) {
  const files = new Map() // path → status
  if (mode === 'working') {
    const out = await git(['status', '--porcelain', '--', 'src'], repo)
    for (const line of out.split('\n').filter(Boolean)) {
      const xy = line.slice(0, 2).trim()
      let p = line.slice(3).trim()
      if (p.includes(' -> ')) p = p.split(' -> ')[1] // rename
      files.set(p, xy || 'M')
    }
  } else {
    const base = mode === 'recent' ? `HEAD~${n || 3}` : (await git(['merge-base', 'HEAD', 'develop'], repo)).trim() || 'HEAD~5'
    const out = await git(['diff', '--name-status', base, 'HEAD', '--', 'src'], repo)
    for (const line of out.split('\n').filter(Boolean)) {
      const [st, ...rest] = line.split('\t')
      const p = rest[rest.length - 1]
      if (p) files.set(p, st)
    }
  }
  return files
}

// 같은 폴더에 형제 테스트가 있나
function hasSiblingTest(repoRelPath, repo = C.REPO) {
  const dir = path.join(repo, path.dirname(repoRelPath))
  const base = path.basename(repoRelPath).replace(/\.(ts|tsx)$/, '')
  try {
    const ents = fs.readdirSync(dir)
    // 1) 정확히 <base>.test.* 2) 폴더 내 아무 테스트라도
    if (ents.some((e) => e === `${base}.test.tsx` || e === `${base}.test.ts` || e === `${base}.spec.tsx` || e === `${base}.spec.ts`)) return 'exact'
    if (ents.some((e) => TESTRE.test(e))) return 'sibling'
    // __tests__ 하위
    if (fs.existsSync(path.join(dir, '__tests__'))) {
      const t = fs.readdirSync(path.join(dir, '__tests__'))
      if (t.some((e) => e.includes(base)) ) return 'exact'
      if (t.some((e) => TESTRE.test(e))) return 'sibling'
    }
  } catch {
    /* skip */
  }
  return 'none'
}

function needsTest(repoRelPath) {
  const b = path.basename(repoRelPath)
  if (TESTRE.test(b) || /\.(stories|scenario|mock|d)\./.test(b)) return false
  if (/\.tsx$/.test(b)) return true // 컴포넌트/페이지
  if (/^use[A-Z]/.test(b)) return true // 훅
  if (/(util|helper|service|api|query)/i.test(repoRelPath) && /\.ts$/.test(b)) return true // 로직성 유틸
  return false
}

// 테스트 파일의 it/test 제목 = 검증 항목
function parseTitles(content) {
  const re = /\b(?:it|test)(?:\.\w+)?\s*\(\s*[`'"]([^`'"]+)[`'"]/g
  const out = []
  let m
  while ((m = re.exec(content))) out.push(m[1])
  return out
}

// 변경 파일에 딸린 테스트들(형제 <base>.test.* + __tests__) — 어떤 케이스가 이 파일을 검증하나
function relatedTests(repoRelPath, repo = C.REPO) {
  const dir = path.join(repo, path.dirname(repoRelPath))
  const base = path.basename(repoRelPath).replace(/\.(ts|tsx)$/, '')
  const found = []
  const add = (absFile) => {
    try {
      found.push({ file: path.relative(repo, absFile).replace(/\\/g, '/'), cases: parseTitles(fs.readFileSync(absFile, 'utf8')) })
    } catch {
      /* skip */
    }
  }
  for (const ext of ['test.tsx', 'test.ts', 'spec.tsx', 'spec.ts']) {
    const f = path.join(dir, `${base}.${ext}`)
    if (fs.existsSync(f)) add(f)
  }
  const td = path.join(dir, '__tests__')
  if (fs.existsSync(td)) {
    try {
      for (const e of fs.readdirSync(td)) if (e.includes(base) && TESTRE.test(e)) add(path.join(td, e))
    } catch {
      /* skip */
    }
  }
  return found
}

// 단일 파일 평가 (working 카피든 커밋 blob이든 content만 주면 동일 판정). 공용.
function evaluateFile(p, content, status, repo = C.REPO) {
  const scan = Api.scanFile(p.replace(/^src\//, ''), content)
  const test = needsTest(p) ? hasSiblingTest(p, repo) : 'na'
  const apiCalls = Object.entries(scan.apiCalls).map(([name, count]) => ({ name, count }))
  const highFlags = scan.flags.filter((f) => f.level === 'high').length

  let verdict = 'ok'
  const issues = []
  if (highFlags) {
    verdict = 'bad'
    issues.push(`API 오용 ${highFlags}`)
  } else if (scan.flags.length) {
    verdict = 'warn'
    issues.push(`API 의심 ${scan.flags.length}`)
  }
  if (test === 'none') {
    if (verdict === 'ok') verdict = 'warn'
    issues.push('테스트 없음')
  }
  return { file: p, status, usesApi: scan.usesApi, apiCalls, hooks: scan.hooks, flags: scan.flags, test, needsTest: needsTest(p), verdict, issues, relatedTests: relatedTests(p, repo) }
}

function isVerifiable(p) {
  return /\.(ts|tsx)$/.test(p) && !TESTRE.test(p) && !/\.(stories|d)\./.test(p)
}

async function active(mode = 'working', n = 3, repo = C.REPO) {
  const changed = await changedFiles(mode, n, repo)
  const items = []
  for (const [p, status] of changed) {
    if (!isVerifiable(p)) continue
    const abs = path.join(repo, p)
    let content = ''
    try {
      content = fs.readFileSync(abs, 'utf8')
    } catch {
      continue // 삭제된 파일
    }
    items.push(evaluateFile(p, content, status, repo))
  }

  // 정렬: bad → warn → ok
  const rank = { bad: 0, warn: 1, ok: 2 }
  items.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.file.localeCompare(b.file))

  const branch = (await git(['branch', '--show-current'], repo)).trim()
  return {
    mode,
    branch,
    repo: repo === C.REPO ? null : repo,
    worktree: repo === C.REPO ? null : path.basename(repo),
    counts: {
      files: items.length,
      bad: items.filter((i) => i.verdict === 'bad').length,
      warn: items.filter((i) => i.verdict === 'warn').length,
      ok: items.filter((i) => i.verdict === 'ok').length,
      apiFiles: items.filter((i) => i.usesApi).length,
      missingTest: items.filter((i) => i.test === 'none').length,
    },
    items,
    builtAt: new Date().toISOString(),
  }
}

// 워크트리 경로 가드 — 절대경로 + .git 존재 (임의 경로 차단). 아니면 메인 레포로 폴백.
function safeRepo(repo) {
  if (!repo || repo === C.REPO) return C.REPO
  try {
    if (path.isAbsolute(repo) && fs.existsSync(path.join(repo, '.git'))) return repo
  } catch {
    /* fallthrough */
  }
  return C.REPO
}

// 단일 파일 diff (펼침 시 지연 로드). working=HEAD 대비(+ untracked는 전체 추가), recent/branch=base 대비.
async function fileDiff(file, mode = 'working', n = 3, commit, repo = C.REPO) {
  if (!/^src\//.test(file) || file.includes('..')) return '' // 경로 가드
  if (commit && /^[\w]+$/.test(commit)) return git(['show', '--format=', commit, '--', file], repo) // 특정 커밋의 해당 파일 diff
  if (mode === 'working') {
    const tracked = (await git(['ls-files', '--', file], repo)).trim()
    if (!tracked) {
      try {
        return fs
          .readFileSync(path.join(repo, file), 'utf8')
          .split('\n')
          .map((l) => '+' + l)
          .join('\n')
      } catch {
        return ''
      }
    }
    return git(['diff', 'HEAD', '--', file], repo)
  }
  const base = mode === 'recent' ? `HEAD~${n || 3}` : (await git(['merge-base', 'HEAD', 'develop'], repo)).trim() || 'HEAD~5'
  return git(['diff', base, 'HEAD', '--', file], repo)
}

// 로컬 브랜치 목록 + 현재 브랜치 + 미커밋 여부(전환 위험 안내용)
async function branches() {
  const out = await git(['branch', '--format=%(refname:short)'])
  const list = out.split('\n').map((s) => s.trim()).filter(Boolean)
  const current = (await git(['branch', '--show-current'])).trim()
  const dirty = !!(await git(['status', '--porcelain'])).trim()
  return { current, list, dirty }
}

// 브랜치 전환 (git checkout). 미커밋 충돌 시 git 이 거부 → stderr 그대로 반환(강제 X).
function checkout(branch) {
  return new Promise((resolve) => {
    if (!/^[\w./-]+$/.test(branch || '')) return resolve({ ok: false, error: '유효하지 않은 브랜치명' })
    execFile('git', ['-C', C.REPO, 'checkout', branch], { timeout: 15000 }, (e, _out, stderr) => {
      if (e) resolve({ ok: false, error: String(stderr || e.message || '').trim() || 'checkout 실패' })
      else resolve({ ok: true, branch })
    })
  })
}

module.exports = { active, evaluateFile, isVerifiable, git, fileDiff, branches, checkout, safeRepo }
