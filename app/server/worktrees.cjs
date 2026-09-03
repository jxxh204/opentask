// worktrees.cjs — git worktree 플릿을 직접 읽어 한눈에. state.json 의존 없이 항상 신선.
// 티켓당 격리 워크트리(에이전트 작업장)별 브랜치·미커밋·마지막커밋·base 대비 상태.
'use strict'
const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const C = require('./collector.cjs')
const Ticket = require('./ticket.cjs')

const BASE = process.env.OPENRM_BASE_BRANCH || 'origin/main'
const SEP = ''

function git(args, repo, timeoutMs = 7000) {
	return new Promise((resolve) => {
		execFile('git', ['-C', repo, ...args], { timeout: timeoutMs, maxBuffer: 1 << 20 }, (e, out) =>
			resolve(e ? '' : String(out || '')),
		)
	})
}

// 에러 메시지까지 회수하는 git (쓰기 작업용)
function gitX(args, repo, timeoutMs = 20000) {
	return new Promise((resolve) => {
		execFile('git', ['-C', repo, ...args], { timeout: timeoutMs, maxBuffer: 1 << 20 }, (e, out, err) =>
			resolve({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') }),
		)
	})
}

// 제목/내용 → 브랜치용 슬러그 (conventional prefix·티켓번호·특수문자 제거, 케밥, 길이 제한)
function slugFromDesc(desc) {
	let d = String(desc || '').trim()
	if (!d) return ''
	d = d.replace(/^(fix|chore|feat|test|refactor|docs|style|perf|build|ci)\s*(\([^)]*\))?\s*:?\s*/i, '') // fix(PROJ-x): 제거
	d = d.replace(Ticket.re('gi'), '') // 티켓번호 제거(어차피 앞에 붙음)
	let slug = d
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
	if (slug.length > 32) {
		slug = slug.slice(0, 32)
		const lastDash = slug.lastIndexOf('-') // 단어 중간에서 안 잘리게 마지막 '-'까지
		if (lastDash > 8) slug = slug.slice(0, lastDash)
	}
	return slug.replace(/-+$/g, '')
}

// "PROJ-1234-foo" | "1234-foo" | "1234" | "popup-fix" → { branch, dir }
// desc(제목)를 주면 id만 있을 때 branch를 "PROJ-1234-내용"으로 만든다.
function deriveNames(raw, desc) {
	const s = String(raw || '').trim()
	if (!s) return null
	const num = (s.match(/\d{3,}/) || [])[0]
	let branch = s
		.replace(/\s+/g, '-')
		.replace(/[^a-zA-Z0-9가-힣_/-]+/g, '-')
		.replace(/^-+|-+$/g, '')
	if (num && !new RegExp(`^${Ticket.PREFIX}-`, 'i').test(branch)) branch = `${Ticket.PREFIX}-` + branch
	branch = branch.replace(new RegExp(`^${Ticket.PREFIX}-`, 'i'), `${Ticket.PREFIX}-`)
	// branch가 "PREFIX-<번호>" 형태(내용 없음)이고 desc가 있으면 내용 슬러그를 붙여 구분
	if (new RegExp(`^${Ticket.PREFIX}-\\d+$`, 'i').test(branch)) {
		const ds = slugFromDesc(desc)
		if (ds) branch = branch + '-' + ds
	}
	const dirSlug = num || branch.replace(new RegExp(`^${Ticket.PREFIX}-`, 'i'), '').slice(0, 28) || 'task'
	return { branch, dir: 'at-' + dirSlug }
}

// base 미지정 시(지금 UI엔 폴더별 base를 정하는 곳이 없어 항상 미지정) 레포의 현재 체크아웃된
// 브랜치로 폴백. 예전엔 'develop' 하드코딩이었는데, 레포 기본 브랜치 이름이 dev/main/master 등
// 다르면 매번 "base 브랜치를 찾을 수 없음"으로 조용히 실패했다(오케스트레이션 세션이 0개로 끝남).
async function detectCurrentBranch(repo) {
	const r = await gitX(['rev-parse', '--abbrev-ref', 'HEAD'], repo)
	const b = r.ok ? r.out.trim() : ''
	return b && b !== 'HEAD' ? b : null // detached HEAD 등이면 폴백 불가
}

// 새 워크트리 생성 (티켓/브랜치 → at-<번호> 형제 디렉토리에 git worktree add).
// 브랜치가 이미 있으면 attach, 없으면 base에서 새로 분기.
// repoPath/repoBase: 멀티레포 프로젝트에서 태스크가 지정한 레포(store/repos.cjs) — 미지정 시 기존과
// 동일하게 AppConfig.rootPath(C.REPO) 단일 레포로 동작(하위호환, 동작 변화 없음).
async function create({ ticket, base, desc, dir: dirOverride, branch: explicitBranch, repoPath, repoBase } = {}) {
	const repo = repoPath || C.REPO
	let branch, dir
	let remoteFetched = false
	if (explicitBranch) {
		// 명시 브랜치(예: PR 브랜치)를 워크트리로 — 원격에만 있으면 fetch 후 attach
		branch = String(explicitBranch).trim()
		dir = (dirOverride && String(dirOverride).trim()) || ('at-' + branch.replace(new RegExp(`^${Ticket.PREFIX}-`, 'i'), '').replace(/[^a-zA-Z0-9._-]/g, '-')).slice(0, 60)
		await gitX(['fetch', 'origin', branch], repo).catch(() => {}) // origin/<branch> 갱신
		remoteFetched = true
	} else {
		const names = deriveNames(ticket, desc)
		if (!names) return { ok: false, error: '티켓/브랜치명을 입력하세요.' }
		branch = names.branch
		dir = (dirOverride && String(dirOverride).trim()) || names.dir
	}
	const parent = path.dirname(repo)
	const wtPath = path.join(parent, dir)
	if (fs.existsSync(wtPath)) return { ok: false, error: `이미 존재하는 폴더: ${dir} (기존 워크트리에서 시작하세요)` }

	const baseRef = (base && String(base).trim()) || repoBase || process.env.OPENRM_NEW_TASK_BASE || (await detectCurrentBranch(repo)) || 'main'
	const localExists = (await gitX(['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], repo)).ok
	let r
	if (localExists) {
		r = await gitX(['worktree', 'add', wtPath, branch], repo)
	} else if (explicitBranch) {
		// 원격 브랜치로 로컬 브랜치 만들며 워크트리 (origin/<branch> → 폴백 FETCH_HEAD)
		r = await gitX(['worktree', 'add', '-b', branch, wtPath, 'origin/' + branch], repo)
		if (!r.ok) r = await gitX(['worktree', 'add', '-b', branch, wtPath, 'FETCH_HEAD'], repo)
	} else {
		const baseOk = (await gitX(['rev-parse', '--verify', '--quiet', baseRef], repo)).ok
		if (!baseOk) return { ok: false, error: `base 브랜치를 찾을 수 없음: ${baseRef} (git fetch 필요할 수 있음)` }
		r = await gitX(['worktree', 'add', '-b', branch, wtPath, baseRef], repo)
	}
	if (!r.ok) return { ok: false, error: (r.err || 'git worktree add 실패').split('\n').filter(Boolean).slice(-1)[0] || 'git worktree add 실패' }
	const envCopied = copyEnvFiles(wtPath, repo)
	return { ok: true, path: wtPath, dir, branch, base: baseRef, created: true, attached: localExists, remoteFetched, envCopied }
}

// 워크트리 제거 — 폴더 제거(미커밋 변경 --force 폐기) + 로컬 브랜치 삭제. 초기화(reset)용.
async function removeFrom(repo, wtPath, branch) {
	const errors = []
	let worktreeRemoved = false
	let branchDeleted = false
	if (!wtPath) return { ok: false, errors: ['워크트리 경로 없음'] }
	const rm = await gitX(['worktree', 'remove', '--force', wtPath], repo)
	if (rm.ok) worktreeRemoved = true
	else {
		await gitX(['worktree', 'prune'], repo) // 폴더가 이미 없으면 메타만 정리
		if (!fs.existsSync(wtPath)) worktreeRemoved = true
		else errors.push('워크트리 제거 실패: ' + (rm.err.split('\n').find((l) => l.trim()) || '').slice(0, 120))
	}
	// main/develop 등 보호 브랜치는 삭제 안 함
	if (branch && !/^(develop|main|master)$/i.test(branch)) {
		const bd = await gitX(['branch', '-D', branch], repo)
		if (bd.ok) branchDeleted = true
		else errors.push('브랜치 삭제 실패: ' + (bd.err.split('\n').find((l) => l.trim()) || '').slice(0, 120))
	}
	return { ok: worktreeRemoved && errors.length === 0, worktreeRemoved, branchDeleted, errors }
}

function remove(wtPath, branch) {
	return removeFrom(C.REPO, wtPath, branch)
}

// gitignore된 env 파일을 워크트리로 복사 (없으면 next.config rewrites가 undefined로 dev 서버가 깨짐).
// 멱등 — 대상에 이미 있으면 건드리지 않음(수정본 보존). 워크트리 생성·재사용·dev 시작 때 항상 호출.
function copyEnvFiles(wtPath, repo = C.REPO) {
	const ENV_FILES = (process.env.OPENRM_WORKTREE_COPY || '.env.local,.env.development.local,.env.test.local,.env.production.local,.env.sentry-build-plugin').split(',').map((s) => s.trim()).filter(Boolean)
	const copied = []
	for (const f of ENV_FILES) {
		const srcF = path.join(repo, f)
		const dstF = path.join(wtPath, f)
		try {
			if (fs.existsSync(srcF) && !fs.existsSync(dstF)) {
				fs.copyFileSync(srcF, dstF)
				copied.push(f)
			}
		} catch (_) {}
	}
	return copied
}

// 새 워크트리에 node_modules 확보 — 메인 레포 node_modules를 심링크(즉시). git 워크트리는 node_modules를
// 공유 안 해서 그냥 `next dev` 하면 'next: command not found'. Next는 .next를 워크트리별로 써서 심링크 안전.
function ensureNodeModules(wtPath) {
	const dest = path.join(wtPath, 'node_modules')
	// '있음'만으로 OK 판단하면 안 됨 — 불완전 설치(next 바이너리 없음)면 'next: command not found'로 dev 실패.
	// 실제 실행 가능 여부(.bin/next 또는 next 패키지 존재)로 판단하고, 아니면 재링크한다.
	const usable = (base) => fs.existsSync(path.join(base, '.bin', 'next')) || fs.existsSync(path.join(base, 'next', 'package.json'))
	let stat = null
	try {
		stat = fs.lstatSync(dest, { throwIfNoEntry: false })
	} catch (_) {}
	if (stat) {
		if (stat.isSymbolicLink()) {
			if (fs.existsSync(dest) && usable(dest)) return { ok: true, already: true } // 유효 심링크
			try { fs.unlinkSync(dest) } catch (_) {} // 깨진 심링크 → 제거 후 재링크
		} else if (usable(dest)) {
			return { ok: true, already: true } // 실제 설치 디렉토리(정상)
		} else {
			// 디렉토리는 있으나 불완전(next 없음) → 옆으로 치우고 재링크 (rename=즉시, 실패 시 삭제)
			try {
				fs.renameSync(dest, dest + '.incomplete-' + Date.now())
			} catch (_) {
				try { fs.rmSync(dest, { recursive: true, force: true }) } catch (e) { return { ok: false, error: '불완전 node_modules 정리 실패: ' + String((e && e.message) || e) } }
			}
		}
	}
	const src = path.join(C.REPO, 'node_modules')
	if (!fs.existsSync(src)) return { ok: false, error: '메인 레포에 node_modules가 없음 — 먼저 메인에서 설치 필요' }
	try {
		fs.symlinkSync(src, dest, 'dir')
		return { ok: true, symlinked: true }
	} catch (e) {
		return { ok: false, error: 'node_modules 심링크 실패: ' + String((e && e.message) || e) }
	}
}

// 워크트리 재사용-또는-생성: 폴더가 이미 있으면 그대로 쓰고(existed), 없으면 create.
// ▶진행이 기존 워크트리에서 이어가도록 — create는 폴더 있으면 에러내지만 ensure는 재사용.
async function ensure({ ticket, base, desc, repoPath, repoBase } = {}) {
	const repo = repoPath || C.REPO
	const names = deriveNames(ticket, desc)
	if (!names) return { ok: false, error: '티켓/브랜치명을 입력하세요.' }
	const wtPath = path.join(path.dirname(repo), names.dir)
	if (fs.existsSync(wtPath)) {
		// 재사용 워크트리에도 빠진 env 파일 보강 (항상 복사 원칙)
		const envCopied = copyEnvFiles(wtPath, repo)
		const head = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], wtPath)).trim()
		return { ok: true, path: wtPath, dir: names.dir, branch: head || names.branch, existed: true, created: false, envCopied }
	}
	return await create({ ticket, base, desc, repoPath, repoBase })
}

// 정기배포 브랜치 생성: 숫자 번호 → deploy-<번호> 를 develop(기본) 기준으로 만들고 origin에 push.
async function createDeployBranch({ num, base } = {}) {
	const m = String(num || '').match(/\d+/)
	if (!m) return { ok: false, error: '배포 번호(숫자)를 입력하세요. 예: 286' }
	const branch = 'deploy-' + m[0]
	const baseRef = (base && String(base).trim()) || process.env.OPENRM_DEPLOY_BASE || 'develop'
	const baseOk = (await gitX(['rev-parse', '--verify', '--quiet', baseRef], C.REPO)).ok
	if (!baseOk) return { ok: false, error: `base 브랜치를 찾을 수 없음: ${baseRef}` }
	const exists = (await gitX(['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], C.REPO)).ok
	if (exists) return { ok: false, error: `이미 있는 브랜치: ${branch}` }
	const c = await gitX(['branch', branch, baseRef], C.REPO)
	if (!c.ok) return { ok: false, error: (c.err.split('\n').find((l) => l.trim()) || 'branch 생성 실패').slice(0, 140) }
	const p = await gitX(['push', '-u', 'origin', branch], C.REPO, 60000)
	return { ok: true, branch, base: baseRef, pushed: p.ok, pushError: p.ok ? null : (p.err.split('\n').find((l) => l.trim()) || '').slice(0, 160) }
}

function groupSlug(s) {
	return (
		String(s || '')
			.trim()
			.replace(/\s+/g, '-')
			.replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'group'
	)
}

// 그룹 통합 브랜치: 전용 워크트리를 base로 리셋 후 멤버 브랜치들을 순서대로 merge.
// 매번 base부터 다시 쌓아 항상 "지금" 멤버 상태를 반영(이전 병합 잔여물 없음). 충돌난 멤버는 스킵하고 계속 진행.
async function buildGroupBranch({ group, base, branches } = {}) {
	const g = String(group || '').trim()
	if (!g) return { ok: false, error: '그룹 필수' }
	const branch = 'group-' + groupSlug(g)
	const baseRef = (base && String(base).trim()) || process.env.OPENRM_NEW_TASK_BASE || 'develop'
	const baseOk = (await gitX(['rev-parse', '--verify', '--quiet', baseRef], C.REPO)).ok
	if (!baseOk) return { ok: false, error: `base 브랜치를 찾을 수 없음: ${baseRef}` }

	const wtPath = path.join(path.dirname(C.REPO), 'grp-' + groupSlug(g))
	if (!fs.existsSync(wtPath)) {
		const add = await gitX(['worktree', 'add', '-b', branch, wtPath, baseRef], C.REPO)
		if (!add.ok) {
			// 브랜치는 이미 있는데(재시도 등) 워크트리만 없던 경우 → attach로 재시도
			const localExists = (await gitX(['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], C.REPO)).ok
			const add2 = localExists ? await gitX(['worktree', 'add', wtPath, branch], C.REPO) : null
			if (!add2 || !add2.ok) return { ok: false, error: (add.err || '').split('\n').filter(Boolean).slice(-1)[0] || '워크트리 생성 실패' }
		}
	}
	// 매번 base로 리셋 — 이전 병합 이력 무관하게 항상 현재 멤버 상태만 반영
	const reset = await gitX(['checkout', '-B', branch, baseRef], wtPath)
	if (!reset.ok) return { ok: false, error: '브랜치 리셋 실패: ' + ((reset.err || '').split('\n').filter(Boolean).slice(-1)[0] || '') }
	await gitX(['clean', '-fd'], wtPath) // 미추적 잔여 파일만 정리(.gitignore는 보존 → node_modules/.env 안전)

	const merged = [],
		skipped = [],
		conflicts = []
	for (const b of branches || []) {
		if (!b || !b.branch) continue
		let ref = b.branch
		const localExists = (await gitX(['rev-parse', '--verify', '--quiet', 'refs/heads/' + ref], C.REPO)).ok
		if (!localExists) {
			const fetched = await gitX(['fetch', 'origin', ref], C.REPO, 30000)
			if (!fetched.ok) {
				skipped.push({ ...b, reason: '브랜치를 찾을 수 없음(로컬/원격 모두 없음)' })
				continue
			}
			ref = 'FETCH_HEAD'
		}
		// --no-verify: 새 워크트리는 npm install(=husky 훅 생성)을 안 거쳐 .husky/_/husky.sh가 없어 commit-msg 훅이 실패함.
		// 이 병합 커밋은 사람이 직접 커밋하는 게 아니라 미리보기용 통합 브랜치 생성 과정이라 훅 대상이 아님.
		const m = await gitX(['merge', '--no-edit', '--no-verify', ref], wtPath, 30000)
		if (m.ok) merged.push(b)
		else {
			// 충돌 상세는 stdout(CONFLICT/Automatic merge failed)에 찍힘 — stderr는 훅 경고 등 잡음일 수 있음
			const lines = (m.out + '\n' + m.err).split('\n').map((l) => l.trim()).filter(Boolean)
			const reason = lines.find((l) => /^CONFLICT/.test(l)) || lines.find((l) => /Automatic merge failed/.test(l)) || lines.slice(-1)[0] || '병합 충돌'
			await gitX(['merge', '--abort'], wtPath).catch(() => {})
			conflicts.push({ ...b, error: reason })
		}
	}
	copyEnvFiles(wtPath)
	return { ok: true, branch, path: wtPath, base: baseRef, merged, skipped, conflicts }
}

// 동시 실행 제한 (50개×여러 git → 폭주 방지)
async function mapLimit(items, limit, fn) {
	const out = []
	for (let i = 0; i < items.length; i += limit) {
		const batch = items.slice(i, i + limit)
		out.push(...(await Promise.all(batch.map(fn))))
	}
	return out
}

// 원격에서 이미 사라진(머지 후 삭제된) upstream을 가진 로컬 브랜치 집합.
// `%(upstream:track)`가 '[gone]'이면 upstream이 설정돼 있었는데 remote-tracking ref가 없어진 것 =
// 그 브랜치의 PR이 머지·삭제됐다는 강한 신호. 레포당 한 번(for-each-ref)이라 워크트리 수와 무관하게 가볍다.
async function goneBranches(repoPath) {
	const raw = await git(['for-each-ref', '--format=%(refname:short) %(upstream:track)', 'refs/heads'], repoPath || C.REPO)
	const set = new Set()
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue
		// "branch-name [gone]" — track 토큰은 항상 마지막. 브랜치명엔 공백이 없다.
		if (/\[gone\]\s*$/.test(line)) set.add(line.replace(/\s*\[gone\]\s*$/, '').trim())
	}
	return set
}

async function list(repoPath) {
	const repo = repoPath || C.REPO
	const [raw, gone] = await Promise.all([git(['worktree', 'list', '--porcelain'], repo), goneBranches(repo)])
	const wts = []
	let cur = null
	for (const line of raw.split('\n')) {
		if (line.startsWith('worktree ')) {
			cur = { path: line.slice(9).trim() }
			wts.push(cur)
		} else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace('refs/heads/', '')
		else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5).trim().slice(0, 9)
		else if (cur && line.startsWith('detached')) cur.detached = true
	}

	const worktrees = await mapLimit(wts, 8, async (w) => {
		// 🔴 status 는 gitX 로 — ok 플래그가 필요하다. git() 는 타임아웃/에러에도 '' 를 돌려주는데,
		// 그걸 "변경 0줄 = clean" 으로 오인하면 실제로는 dirty 한 워크트리를 자동 삭제 대상으로 잘못 분류한다.
		// (실제 사고: node_modules 심링크 등으로 status 가 7s 타임아웃 → '' → 오탐 clean → 자동 삭제.)
		const [st, last, ahead, behind] = await Promise.all([
			gitX(['status', '--porcelain'], w.path, 15000),
			git(['log', '-1', `--format=%cr${SEP}%s${SEP}%an${SEP}%ct`], w.path),
			git(['rev-list', '--count', `${BASE}..HEAD`], w.path),
			git(['rev-list', '--count', `HEAD..${BASE}`], w.path),
		])
		const statusOk = st.ok // false = 타임아웃/에러 → clean 여부 '모름'(안전측: 삭제 불가)
		const dirtyLines = st.out.split('\n').filter(Boolean)
		const [lastRel, lastSubject, author, lastTs] = last.trim().split(SEP)
		const branch = w.branch || (w.detached ? '(detached)' : '?')
		const isMain = w.path === repo
		const isGone = !isMain && !!w.branch && gone.has(w.branch)
		return {
			path: w.path,
			name: w.path.split('/').pop(),
			branch,
			ticket: Ticket.ticketOf(branch),
			head: w.head || null,
			dirty: dirtyLines.length,
			dirtySrc: dirtyLines.filter((l) => / src\//.test(l) || /\bsrc\//.test(l.slice(3))).length,
			statusOk,
			lastRel: lastRel || null,
			lastSubject: lastSubject || null,
			author: author || null,
			lastTs: Number(lastTs) || 0,
			ahead: Number(ahead.trim()) || 0,
			behind: Number(behind.trim()) || 0,
			isMain,
			// gone: 원격 브랜치가 머지·삭제됨(정리 후보). cleanable: gone + status 확인성공 + 변경 0줄일 때만.
			// statusOk 가 false(모름)면 절대 cleanable 로 두지 않는다 — 삭제는 '확인된 clean' 에만 허용.
			gone: isGone,
			cleanable: isGone && statusOk && dirtyLines.length === 0,
		}
	})

	// 정렬: 미커밋 있는 것 먼저 → 최근 커밋 순
	worktrees.sort((a, b) => (b.dirty > 0 ? 1 : 0) - (a.dirty > 0 ? 1 : 0) || b.lastTs - a.lastTs)
	const staleCleanable = worktrees.filter((w) => w.cleanable).length
	const staleDirty = worktrees.filter((w) => w.gone && !w.cleanable).length
	return { base: BASE, count: worktrees.length, staleCleanable, staleDirty, worktrees, builtAt: new Date().toISOString() }
}

// 안전 정리 — 원격에서 머지·삭제된(gone) 워크트리만 대상. 기본은 미커밋 없는(clean) 것만 지운다.
// dirty(미커밋 변경 있음)한 gone 워크트리는 사람 검토가 필요하므로 includeDirty=true일 때만 건드린다.
// dryRun이면 실제 삭제 없이 대상만 돌려준다(주기 배치 미리보기·UI 확인용).
async function pruneStale(repoPath, { dryRun = false, includeDirty = false } = {}) {
	const repo = repoPath || C.REPO
	const { worktrees } = await list(repo)
	const targets = worktrees.filter((w) => !w.isMain && w.gone && (includeDirty || w.cleanable))
	const skippedDirty = worktrees.filter((w) => !w.isMain && w.gone && !w.cleanable).map((w) => ({ path: w.path, branch: w.branch, dirty: w.dirty }))
	const removed = []
	const failed = []
	if (!dryRun) {
		for (const w of targets) {
			// 방어 2선 — 삭제 직전 권위 있는 status 재확인. includeDirty 가 아닌데 여기서 변경이 잡히거나
			// status 확인이 실패하면(모름) 삭제하지 않는다. list() 시점과 삭제 시점 사이의 변화도 잡는다.
			if (!includeDirty) {
				const chk = await gitX(['status', '--porcelain'], w.path, 15000)
				if (!chk.ok || chk.out.split('\n').filter(Boolean).length > 0) {
					failed.push({ path: w.path, branch: w.branch, errors: ['삭제 직전 재확인에서 미커밋 변경 또는 status 실패 — 건너뜀'] })
					continue
				}
			}
			const r = await removeFrom(repo, w.path, w.branch)
			if (r.ok) removed.push({ path: w.path, branch: w.branch })
			else failed.push({ path: w.path, branch: w.branch, errors: r.errors })
		}
	}
	return { ok: true, dryRun, base: BASE, targets: targets.map((w) => ({ path: w.path, branch: w.branch, dirty: w.dirty })), removed, failed, skippedDirty }
}

// 특정 브랜치가 이미 워크트리로 체크아웃돼 있으면 그 경로 (없으면 null)
async function pathForBranch(branch, repoPath) {
	const r = await gitX(['worktree', 'list', '--porcelain'], repoPath || C.REPO)
	if (!r.ok) return null
	let curPath = null
	for (const line of r.out.split('\n')) {
		if (line.startsWith('worktree ')) curPath = line.slice(9).trim()
		else if (line.startsWith('branch ') && line.slice(7).trim() === 'refs/heads/' + branch) return curPath
	}
	return null
}

// 개수만 필요할 때(레포 관리 테이블 배지 등) — list()처럼 워크트리마다 status/log/rev-list를
// 돌리지 않고 worktree 줄만 센다. 워크트리가 수십 개인 레포에서도 가볍다.
async function count(repoPath) {
	const raw = await git(['worktree', 'list', '--porcelain'], repoPath || C.REPO)
	return raw.split('\n').filter((l) => l.startsWith('worktree ')).length
}
module.exports = { list, create, ensure, remove, removeFrom, goneBranches, pruneStale, copyEnvFiles, ensureNodeModules, deriveNames, createDeployBranch, buildGroupBranch, pathForBranch, count }
