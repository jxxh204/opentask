// ticket.cjs — 티켓 접두사(예: GBIZ, JIRA, PROJ) 중앙 설정.
// 우선순위: Setup 페이지의 AppConfig.ticketPrefix → OPENRM_TICKET_PREFIX 환경변수 → 'PROJ'.
// 매번 새로 계산해야 함(게터) — collector.cjs의 REPO 게터와 같은 이유: Setup에서 바꾸면
// 재시작 없이 바로 반영되게.
'use strict'
const AppCfg = require('./store/settings.cjs')

function currentPrefix() {
	const cfg = AppCfg.getAppConfig()
	if (cfg.ticketPrefix && String(cfg.ticketPrefix).trim()) return String(cfg.ticketPrefix).trim()
	return process.env.OPENRM_TICKET_PREFIX || 'PROJ'
}

function re(flags) {
	return new RegExp(`${currentPrefix()}-\\d+`, flags)
}

function ticketOf(text) {
	const m = String(text || '').match(re('i'))
	return m ? m[0] : null
}

function normalizeBranchPrefix(branch) {
	const b = String(branch || '')
	const p = currentPrefix()
	return re('i').test(b.slice(0, p.length + 1)) ? b.replace(new RegExp(`^${p}-`, 'i'), `${p}-`) : b
}

module.exports = {
	get PREFIX() {
		return currentPrefix()
	},
	get RE_SRC() {
		return `${currentPrefix()}-\\d+`
	},
	re,
	ticketOf,
	normalizeBranchPrefix,
}
