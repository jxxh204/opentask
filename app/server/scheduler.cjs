// scheduler.cjs — Automations 실행 루프(§07 "크론잡 생성"). monitor.cjs/notify.cjs와 같은 패턴
// (setInterval 폴링, 프로세스가 켜져 있는 동안만 동작) — OS cron/launchd 연동은 안 함(로컬 전용 도구에
// 과한 인프라). 지금은 액션 하나만 지원한다: create_task(새 일감 생성) — "AI는 범위를 스스로 만들지
// 않는다"(§12) 원칙과 충돌 없음, 사람이 미리 설정해둔 스케줄을 그대로 실행할 뿐 즉흥적 판단이 아님.
'use strict'
const CronJobs = require('./store/cronJobs.cjs')
const StoreTasks = require('./store/tasks.cjs')

const CHECK_MS = 30000

async function runJob(job) {
	try {
		if (job.action_type === 'create_task') {
			const a = job.action
			StoreTasks.create({ folderId: null, name: a.name || job.name, desc: a.desc || `Automations "${job.name}"에서 자동 생성`, repoId: a.repoId || null })
		}
	} catch (e) {
		console.error(`[scheduler] job "${job.name}" 실행 실패:`, (e && e.stack) || e)
	} finally {
		CronJobs.markRan(job.id)
	}
}

async function tick() {
	let due
	try {
		due = CronJobs.dueJobs()
	} catch (_) {
		return
	}
	for (const job of due) await runJob(job)
}

function start() {
	tick()
	return setInterval(tick, CHECK_MS)
}

module.exports = { start, runJob }
