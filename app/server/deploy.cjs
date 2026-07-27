// deploy.cjs — 정기배포 브랜치(deploy-<배포DB ID>) 관리. develop 기준 생성 + origin push,
// 노션 링크 저장(팝업에서 PR/노션 링크로 이동), 삭제(브랜치 + 워크트리 + 원격).
'use strict'
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const C = require('./collector.cjs')

const REG_FILE = process.env.OPENRM_DEPLOYS_FILE || path.join(__dirname, '..', '.openrm-deploys.json')
const WEB_REPO = process.env.OPENRM_DEPLOY_REPO || ''
const DEPLOY_BASE = process.env.OPENRM_DEPLOY_BASE || 'develop'

const gitX = (args, t = 30000) =>
	new Promise((r) => execFile('git', ['-C', C.REPO, ...args], { timeout: t, maxBuffer: 4 << 20 }, (e, o, er) => r({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') })))
const gh = (args) => new Promise((r) => execFile('gh', args, { timeout: 20000, maxBuffer: 8 << 20 }, (e, o) => r(e ? '' : String(o || ''))))

function loadReg() {
	try {
		return JSON.parse(fs.readFileSync(REG_FILE, 'utf8'))
	} catch (_) {
		return {}
	}
}
function saveReg(r) {
	try {
		fs.writeFileSync(REG_FILE, JSON.stringify(r, null, 2))
		return true
	} catch (_) {
		return false
	}
}

// 입력(노션 링크 + 번호)에서 추출
function parse(input) {
	const s = String(input || '')
	const notion = (s.match(/https?:\/\/[^\s)\]\}"'<>]*notion[^\s)\]\}"'<>]*/i) || [])[0] || null
	// deploy-286 / 286 형태의 번호 (노션 hex id 오인 방지: 단독 1~5자리)
	const num = (s.match(/deploy-(\d{1,6})/i) || [])[1] || (s.match(/(^|\s)(\d{1,6})(\s|$)/) || [])[2] || null
	return { notion, num }
}

// 워크트리(deploy 브랜치가 체크아웃돼 있으면) 경로
async function worktreeOf(branch) {
	const raw = (await gitX(['worktree', 'list', '--porcelain'])).out
	let cur = null
	for (const line of raw.split('\n')) {
		if (line.startsWith('worktree ')) cur = line.slice(9).trim()
		else if (line.startsWith('branch ') && line.slice(7).trim().replace('refs/heads/', '') === branch) return cur
	}
	return null
}

async function prOf(branch) {
	const raw = await gh(['pr', 'list', '-R', WEB_REPO, '--head', branch, '--state', 'all', '-L', '1', '--json', 'number,url,state,title'])
	try {
		const a = JSON.parse(raw || '[]')
		return a[0] || null
	} catch {
		return null
	}
}

async function list() {
	const raw = (await gitX(['branch', '--list', 'deploy-*', '--format=%(refname:short)'])).out
	const branches = raw.split('\n').map((s) => s.trim()).filter(Boolean)
	const reg = loadReg()
	const slug = WEB_REPO
	const out = await Promise.all(
		branches.map(async (branch) => {
			const e = reg[branch] || {}
			const [pr, wt] = await Promise.all([prOf(branch), worktreeOf(branch)])
			return {
				branch,
				notionUrl: e.notionUrl || null,
				createdAt: e.createdAt || null,
				base: e.base || DEPLOY_BASE,
				branchUrl: `https://github.com/${slug}/tree/${branch}`,
				pr: pr ? { number: pr.number, url: pr.url, state: pr.state, title: pr.title } : null,
				worktree: wt,
			}
		}),
	)
	out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.branch.localeCompare(a.branch))
	return { ok: true, deploys: out, base: DEPLOY_BASE }
}

async function create({ input, num, notionUrl }) {
	const p = parse(input)
	const n = String(num || p.num || '').match(/\d+/)
	if (!n) return { ok: false, error: '배포 번호를 못 찾았어요. 번호(예: 286)를 함께 적어주세요.' }
	const notion = notionUrl || p.notion || null
	const branch = 'deploy-' + n[0]
	const baseOk = (await gitX(['rev-parse', '--verify', '--quiet', DEPLOY_BASE])).ok
	if (!baseOk) return { ok: false, error: `base 브랜치 없음: ${DEPLOY_BASE}` }
	const exists = (await gitX(['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch])).ok
	if (exists) return { ok: false, error: `이미 있는 브랜치: ${branch}` }
	const c = await gitX(['branch', branch, DEPLOY_BASE])
	if (!c.ok) return { ok: false, error: (c.err.split('\n').find((l) => l.trim()) || 'branch 생성 실패').slice(0, 140) }
	const push = await gitX(['push', '-u', 'origin', branch], 60000)
	const reg = loadReg()
	reg[branch] = { notionUrl: notion, base: DEPLOY_BASE, createdAt: Date.now() }
	saveReg(reg)
	return { ok: true, branch, base: DEPLOY_BASE, notionUrl: notion, pushed: push.ok, pushError: push.ok ? null : (push.err.split('\n').find((l) => l.trim()) || '').slice(0, 160) }
}

// 삭제: 워크트리(있으면) + 로컬 브랜치 + 원격 브랜치 + 레지스트리. deploy- 접두만 허용.
async function remove({ branch, deleteRemote = true }) {
	if (!branch || !/^deploy-\d+/.test(branch)) return { ok: false, error: 'deploy- 브랜치만 삭제 가능' }
	const done = { worktree: null, localBranch: false, remoteBranch: false, errors: [] }
	const wt = await worktreeOf(branch)
	if (wt) {
		const rm = await gitX(['worktree', 'remove', '--force', wt])
		if (rm.ok) done.worktree = wt
		else done.errors.push('워크트리 제거 실패: ' + (rm.err.split('\n')[0] || '').slice(0, 100))
	}
	const bd = await gitX(['branch', '-D', branch])
	if (bd.ok) done.localBranch = true
	else done.errors.push('로컬 브랜치 삭제 실패: ' + (bd.err.split('\n')[0] || '').slice(0, 100))
	if (deleteRemote) {
		const rd = await gitX(['push', 'origin', '--delete', branch], 60000)
		if (rd.ok) done.remoteBranch = true
		else done.errors.push('원격 브랜치 삭제 실패: ' + (rd.err.split('\n').find((l) => l.trim()) || '').slice(0, 100))
	}
	const reg = loadReg()
	if (reg[branch]) {
		delete reg[branch]
		saveReg(reg)
	}
	return { ok: true, branch, ...done }
}

// 이미 만들어진 배포 브랜치에 노션 링크를 나중에 추가/수정 (생성 시 비워둔 경우 등)
async function setNotion({ branch, notionUrl }) {
	if (!branch || !/^deploy-\d+/.test(branch)) return { ok: false, error: 'deploy- 브랜치만 가능' }
	const n = String(notionUrl || '').trim()
	if (!n) return { ok: false, error: '노션 링크를 입력하세요.' }
	const reg = loadReg()
	reg[branch] = { base: DEPLOY_BASE, createdAt: Date.now(), ...(reg[branch] || {}), notionUrl: n }
	saveReg(reg)
	return { ok: true, branch, notionUrl: n }
}

module.exports = { list, create, remove, setNotion }
