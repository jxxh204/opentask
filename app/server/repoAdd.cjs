// repoAdd.cjs — "레포 추가" 모달의 clone/새 프로젝트 두 경로. 폴더 찾아보기(기존 폴더 등록)는
// FolderPicker/FolderBrowserModal(이미 있는 /api/setup/fs/* 인프라)로 충분해서 여기선 다루지 않는다.
'use strict'
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const StoreRepos = require('./store/repos.cjs')

function git(args, cwd, timeoutMs = 120000) {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 4 << 20 }, (e, out, err) =>
			resolve({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') }),
		)
	})
}

function nameFromUrl(url) {
	const base = String(url || '').trim().replace(/\/+$/, '').split('/').pop() || 'repo'
	return base.replace(/\.git$/, '')
}

// URL에서 clone → parentPath/name 자리에 실제 git clone 실행 → 성공하면 레포로 등록.
async function cloneRepo({ url, parentPath, name }) {
	if (!url || !String(url).trim()) return { ok: false, error: 'URL이 필요합니다.' }
	if (!parentPath) return { ok: false, error: '대상 폴더가 필요합니다.' }
	const dirName = (name && String(name).trim()) || nameFromUrl(url)
	const target = path.join(parentPath, dirName)
	if (fs.existsSync(target)) return { ok: false, error: `이미 존재하는 폴더: ${target}` }
	if (!fs.existsSync(parentPath)) return { ok: false, error: `대상 폴더가 없습니다: ${parentPath}` }
	const r = await git(['clone', String(url).trim(), dirName], parentPath)
	if (!r.ok) return { ok: false, error: 'git clone 실패: ' + (r.err.split('\n').find((l) => l.trim()) || r.err).slice(0, 300) }
	const repo = StoreRepos.create({ name: dirName, path: target })
	return { ok: true, repo }
}

// 빈 폴더 새로 만들고 git init → 레포로 등록.
async function initRepo({ parentPath, name }) {
	if (!parentPath) return { ok: false, error: '대상 폴더가 필요합니다.' }
	if (!name || !String(name).trim()) return { ok: false, error: '프로젝트 이름이 필요합니다.' }
	const target = path.join(parentPath, String(name).trim())
	if (fs.existsSync(target)) return { ok: false, error: `이미 존재하는 폴더: ${target}` }
	try {
		fs.mkdirSync(target, { recursive: true })
	} catch (e) {
		return { ok: false, error: '폴더 생성 실패: ' + (e && e.message) }
	}
	const r = await git(['init'], target)
	if (!r.ok) return { ok: false, error: 'git init 실패: ' + (r.err.split('\n').find((l) => l.trim()) || r.err).slice(0, 300) }
	const repo = StoreRepos.create({ name: String(name).trim(), path: target })
	return { ok: true, repo }
}

module.exports = { cloneRepo, initRepo }
