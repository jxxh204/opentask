import type { TermStatus } from '../api/term'

// TaskRow.tsx(태스크 행)와 FolderCard.tsx(폴더/지휘자 헤더)가 각자 다시 짜던 "지금 이 세션 상태가
// 뭐야?" 우선순위 판정을 하나로 합친 것 — 완료(done)/정체(stalled)는 두 화면이 서로 다른 신호로만
// 갖고 있다(TaskRow는 PR 머지 여부만, FolderCard는 지휘자 stalled만) — 호출부가 자기가 가진 신호만
// 넘기면 되고, 안 넘긴 신호는 그 우선순위 칸을 그냥 건너뛴다.
export type SessionStatus = 'done' | 'needsAuth' | 'needsResume' | 'needsInput' | 'stalled' | 'running' | 'idle'

export function deriveSessionStatus(input: { done?: boolean; term?: TermStatus; stalled?: boolean; running?: boolean }): SessionStatus {
	if (input.done) return 'done'
	if (input.term?.needsAuth) return 'needsAuth'
	if (input.term?.needsResume) return 'needsResume'
	if (input.term?.waiting) return 'needsInput'
	if (input.stalled) return 'stalled'
	if (input.running) return 'running'
	return 'idle'
}

// TaskRow.tsx/FolderCard.tsx의 서브태스크 체인 노드가 각자 다시 짜던 "이 서브태스크에 붙은 실시간
// 세션이 인증/입력을 기다리나" 판정 — SubtaskWorkStatus 자체엔 없고 tmux 세션명으로 termStatus를
// 조인해야만 알 수 있다.
export function deriveSubtaskAlert(term: TermStatus | undefined): { needsAuth: boolean; needsInput: boolean } {
	const needsAuth = !!term?.needsAuth
	const needsInput = !needsAuth && !!term?.waiting
	return { needsAuth, needsInput }
}
