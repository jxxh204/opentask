import { api } from './client'

export interface TermCreateResult {
	ok: boolean
	name: string
	label: string
	cwd: string
	command: string | null
	model: string | null
	modelLabel: string | null
	seeded: boolean
	error?: string
}

// 오케스트레이터가 관리하는 메인 세션과 별개로, 같은 워크트리에서 새 클로드 세션을 띄운다
// (server/term.cjs Term.create — 세션명 중복 시 자동으로 -2, -3… 붙여 유니크하게 만든다).
export function createTerm(input: { cwd: string; command?: string; label?: string; seed?: string }) {
	return api.post<TermCreateResult>('/api/term/create', input)
}
export function killTerm(name: string) {
	return api.post<{ ok: boolean }>('/api/term/kill', { name })
}

export interface TermStatus {
	exists: boolean
	working?: boolean
	waiting?: boolean
	needsAuth?: boolean
	// 오래되고 큰 세션을 --continue로 이어받을 때 뜨는 "요약으로 재개할지" 확인 메뉴에 멈춰 있음
	// (server/term.cjs watchContinueFallback이 보통 자동으로 넘겨주지만, 그 60초 창을 놓치면 여기 걸림).
	needsResume?: boolean
	isClaude?: boolean
	tail?: string
	lastWorkingAt?: number | null
}
export interface TermLiveSession {
	name: string
	status: TermStatus | null
}
// 사이드바가 "지금 질문 대기 중/인증 필요"를 보여주기 위한 실시간 세션 상태 목록 — tmux 화면을
// 스크레이프한 결과(term.cjs status()). 저장된 값이 아니라 매번 그 자리에서 계산됨.
export function listTerm() {
	return api.get<{ ok: boolean; sessions: TermLiveSession[] }>('/api/term')
}
