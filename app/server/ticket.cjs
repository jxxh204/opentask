// ticket.cjs — 티켓 접두사(예: GBIZ, JIRA, PROJ) 중앙 설정. OPENRM_TICKET_PREFIX로 자기 프로젝트에 맞게 바꾼다.
'use strict'
const PREFIX = process.env.OPENRM_TICKET_PREFIX || 'PROJ'
const RE_SRC = `${PREFIX}-\\d+`

function re(flags) {
	return new RegExp(RE_SRC, flags)
}

function ticketOf(text) {
	const m = String(text || '').match(re('i'))
	return m ? m[0] : null
}

function normalizeBranchPrefix(branch) {
	const b = String(branch || '')
	return re('i').test(b.slice(0, PREFIX.length + 1)) ? b.replace(new RegExp(`^${PREFIX}-`, 'i'), `${PREFIX}-`) : b
}

module.exports = { PREFIX, RE_SRC, re, ticketOf, normalizeBranchPrefix }
