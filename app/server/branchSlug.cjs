// branchSlug.cjs — 한글 제목 → 짧은 영어 브랜치 슬러그. tasks.cjs(레거시 업무 보드)와
// orchestrator.cjs(서브태스크 체인, "팀 규칙"의 브랜치 생성 규칙) 둘 다 같은 번역기를 쓴다.
'use strict'
const { execFile } = require('child_process')
const C = require('./collector.cjs')
const Settings = require('./settings.cjs')
const Ticket = require('./ticket.cjs')

const CLAUDE_BIN = process.env.OPENRM_CLAUDE_BIN || 'claude'

// 제목(한글) → 짧은 영어 브랜치 슬러그. 영어 위주면 그대로, 아니면 claude로 번역(실패 시 영어 단어 추출 폴백).
async function translateToEnglishSlug(text) {
	const t = String(text || '').trim()
	if (!t) return ''
	const base = t.replace(/^(fix|chore|feat|test|refactor|docs|style|perf)\s*(\([^)]*\))?\s*:?\s*/i, '').replace(Ticket.re('gi'), '')
	const enWords = (base.match(/[a-zA-Z][a-zA-Z0-9]*/g) || []).map((w) => w.toLowerCase())
	const fb = enWords.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
	const koCount = (base.match(/[가-힣]/g) || []).length
	if (koCount === 0 && fb) return fb // 이미 영어
	try {
		const r = await new Promise((res) => {
			const child = execFile(
				CLAUDE_BIN,
				['-p', `Translate this Korean software task title into a concise English git branch slug: 2-4 words, all lowercase, hyphen-separated, no ticket numbers, no quotes/backticks. Output ONLY the slug.\n\n${t}`, '--output-format', 'json', '--model', Settings.modelFor('translate')],
				{ cwd: C.REPO, timeout: 45000, maxBuffer: 4 << 20, env: process.env },
				(e, o) => res({ ok: !e, out: String(o || '') }),
			)
			try {
				child.stdin.end()
			} catch (_) {}
		})
		let out = r.out
		try {
			out = JSON.parse(r.out).result || out
		} catch (_) {}
		const slug = String(out).trim().toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
		if (slug) return slug
	} catch (_) {}
	return fb
}

module.exports = { translateToEnglishSlug }
