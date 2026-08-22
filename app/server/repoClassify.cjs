// repoClassify.cjs — 멀티레포 프로젝트에서 새 태스크가 어느 레포 작업인지 헤드리스 claude로 자동 판정.
// 레지스트리(store/repos.cjs)에 2개 이상 등록돼 있을 때만 의미가 있다 — 0~1개면 오케스트레이션이
// 지금처럼 단일 rootPath를 그대로 쓰므로 스킵(하위호환, 기존 세팅에 아무 영향 없음).
'use strict'
const { execFile } = require('child_process')
const C = require('./collector.cjs')
const StoreRepos = require('./store/repos.cjs')
const StoreTasks = require('./store/tasks.cjs')
const StoreDecisions = require('./store/decisions.cjs')
const Prompts = require('./prompts.cjs')

const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'

async function classifyTask(taskId) {
	const repos = StoreRepos.list()
	if (repos.length < 2) return { ok: false, skipped: 'repos<2' }
	const task = StoreTasks.get(taskId)
	if (!task) return { ok: false, error: 'task not found' }
	const repoList = repos.map((r) => `- id:${r.id} name:"${r.name}" — ${r.description || '(설명 없음)'}`).join('\n')
	const prompt = Prompts.render('task.repoClassify', { title: task.name, desc: task.desc || '(없음)', repoList })

	const r = await new Promise((resolve) => {
		const child = execFile(CLAUDE_BIN, ['-p', prompt, '--output-format', 'json'], { cwd: C.REPO, timeout: 60000, maxBuffer: 8 << 20, env: process.env }, (e, o, er) =>
			resolve({ ok: !e, out: String(o || ''), err: String(er || (e && e.message) || '') }),
		)
		try {
			child.stdin.end() // stdin 즉시 닫아 EOF — claude가 stdin 대기하지 않게
		} catch (_) {}
	})
	if (!r.ok) return { ok: false, error: '분류 실패: ' + ((r.err.split('\n').find((l) => l.trim()) || '').slice(0, 140) || 'claude 실행 실패') }

	let text = r.out
	try {
		const j = JSON.parse(r.out)
		text = j.result || j.text || r.out
	} catch (_) {}
	const m = String(text).match(/\{[\s\S]*\}/)
	let data = null
	if (m) {
		try {
			data = JSON.parse(m[0])
		} catch (_) {}
	}
	if (!data || !data.repoId) return { ok: false, error: 'AI 응답 파싱 실패', raw: String(text).slice(0, 200) }
	const chosen = repos.find((rp) => rp.id === data.repoId)
	if (!chosen) return { ok: false, error: '알 수 없는 repoId: ' + data.repoId }

	StoreTasks.update(taskId, { repoId: chosen.id, repoAuto: true })
	// 판정 이유를 여기서 처음으로 실제 저장한다 — 이전엔 반환값에만 담겨 호출부(index.cjs, fire-and-forget)가
	// 그냥 버리고 있었다. ⑤ kind 판단과 같은 원칙: 사람이 나중에 "왜 이 레포로 판정했는지" 훑어볼 수 있어야 함.
	StoreDecisions.record({
		folderId: task.folder_id,
		taskId,
		kind: 'repo_assign',
		reason: data.reason || '(근거 없음)',
		meta: { repoId: chosen.id, repoName: chosen.name, confidence: data.confidence ?? null },
	})
	return { ok: true, repoId: chosen.id, repoName: chosen.name, confidence: data.confidence ?? null, reason: data.reason || null }
}

module.exports = { classifyTask }
