// linkBrief.cjs — "태스크 상세에 너무 정보가 없어. 노션·피그마 파일에서 중요한 정보들은 외부에서도
// 보여야해 요약해서라도... 개발할 때 이것만 보면 개발할 수 있다 정도 요약정보." 태스크/서브태스크
// 설명(desc)에 사람이 그냥 붙여넣은 노션·피그마 URL마다, 헤드리스 claude(+Notion/Figma MCP — 사용자
// 전역 설정에 이미 등록돼 있다고 가정, § tasks.cjs ENRICH_PROMPT와 동일 전제)로 핵심 정책 요약을
// 뽑아 캐싱한다. 피그마는 완성 이미지도 같이 필요해서(figma.cjs의 로컬 Dev Mode MCP 직결 경로 —
// 헤드리스 claude를 거치지 않아 더 빠르고 확실) 텍스트 요약과 병렬로 따로 받는다.
'use strict'
const { execFile } = require('child_process')
const C = require('./collector.cjs')
const AgentJobs = require('./store/agentJobs.cjs')
const LinkBriefs = require('./store/linkBriefs.cjs')
const Prompts = require('./prompts.cjs')
const Settings = require('./settings.cjs')
const Figma = require('./figma.cjs')

const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'
const JOB_KIND = 'link-brief'
const STALE_MS = 24 * 3600 * 1000 // 이보다 오래된 'ok' 캐시는 다시 물어봐도 됨(내용이 갱신됐을 수 있음)

function linkKind(url) {
	const s = String(url || '').toLowerCase()
	if (s.includes('figma.com')) return 'figma'
	if (s.includes('notion')) return 'doc'
	return null
}

function parseFinalJson(text) {
	let t = text
	try {
		const j = JSON.parse(text)
		t = j.result || j.text || text
	} catch (_) {
		/* not an envelope — use raw text */
	}
	const m = String(t).match(/\{[\s\S]*\}/)
	if (!m) return null
	try {
		return JSON.parse(m[0])
	} catch (_) {
		return null
	}
}

// err는 실제 stderr만 담는다 — 비어있을 때 e.message로 대체하면(execFile 표준 동작) "Command failed:
// claude -p <프롬프트 전문>"이 그대로 들어와, 호출부의 "첫 줄만 뽑기"가 실제 오류 대신 프롬프트의
// 첫 문장을 오류 메시지로 잘못 보여준다(§ 실제로 겪은 버그 — 노션/피그마 요약 실패 메시지가 프롬프트
// 문장이었음). stderr가 비어있으면 종료 코드만 남겨 호출부가 명확한 메시지를 만들게 한다.
function runClaude(prompt, model) {
	return new Promise((resolve) => {
		const child = execFile(CLAUDE_BIN, ['-p', prompt, '--output-format', 'json', '--model', model], { cwd: C.REPO, timeout: 170000, maxBuffer: 16 << 20, env: process.env }, (e, out, err) =>
			resolve({ ok: !e, out: String(out || ''), err: String(err || ''), code: e ? e.code ?? null : null }),
		)
		try {
			child.stdin.end()
		} catch (_) {
			/* ignore */
		}
	})
}
function claudeErrorMessage(r) {
	const line = r.err.split('\n').find((l) => l.trim())
	if (line) return line.slice(0, 160)
	return r.code != null ? `claude 종료 코드 ${r.code}(자세한 오류 없음 — 다시 시도해 보세요)` : 'claude 실행 실패'
}

async function runJob(ownerType, ownerId, url, kind) {
	const promptKey = kind === 'figma' ? 'link.brief.figma' : 'link.brief.notion'
	const model = Settings.modelFor('linkBrief')
	const [claudeResult, imageResult] = await Promise.all([runClaude(Prompts.render(promptKey, { url }), model), kind === 'figma' ? Figma.screenshotForUrl(url).catch(() => null) : Promise.resolve(null)])
	if (!claudeResult.ok) {
		LinkBriefs.markError(ownerType, ownerId, url, '요약 실패: ' + claudeErrorMessage(claudeResult))
		return
	}
	const data = parseFinalJson(claudeResult.out)
	if (!data || !data.summary) {
		LinkBriefs.markError(ownerType, ownerId, url, 'AI 응답 파싱 실패')
		return
	}
	LinkBriefs.markOk(ownerType, ownerId, url, {
		summary: String(data.summary).slice(0, 600),
		policies: Array.isArray(data.policies) ? data.policies.map((p) => String(p).slice(0, 200)).slice(0, 6) : [],
		imageUrl: (imageResult && imageResult.ok && imageResult.url) || null,
	})
}

// "자동 생성 — 링크가 붙는 즉시 백그라운드로" (§ 사용자 선택). 이미 'ok'로 캐싱돼 있고 24시간 안
// 지났으면(문서가 그 사이 바뀌었을 수도 있지만 매번 다시 부르면 태스크 상세를 열 때마다 헤드리스
// claude가 도는 셈이라 비용이 크다) 그대로 재사용, 'pending'이면 이미 도는 잡이 있으니 중복 생성 안 함.
function ensureBrief({ ownerType, ownerId, url }) {
	const kind = linkKind(url)
	if (!kind) return { ok: false, error: '지원하지 않는 링크 종류' }
	const existing = LinkBriefs.get(ownerType, ownerId, url)
	if (existing && existing.status === 'pending') return { ok: true, status: 'pending' }
	if (existing && existing.status === 'ok' && existing.generated_at && Date.now() - existing.generated_at < STALE_MS) return { ok: true, status: 'ok' }
	const job = AgentJobs.create({ kind: JOB_KIND, refType: ownerType, refId: ownerId, input: { url, kind }, label: '요약 생성 중…' })
	LinkBriefs.upsertPending(ownerType, ownerId, url, kind, job.id)
	runJob(ownerType, ownerId, url, kind)
		.then(() => AgentJobs.markDone(job.id, { ok: true }))
		.catch((e) => {
			LinkBriefs.markError(ownerType, ownerId, url, String((e && e.message) || e))
			AgentJobs.markDone(job.id, { ok: false, error: String((e && e.message) || e) })
		})
	return { ok: true, status: 'pending', jobId: job.id }
}

function listByOwner(ownerType, ownerId) {
	return LinkBriefs.listByOwner(ownerType, ownerId)
}

module.exports = { ensureBrief, listByOwner, linkKind }
