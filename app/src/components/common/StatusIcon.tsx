// TaskRow.tsx/FolderCard.tsx에 픽셀 단위로 동일하게 복붙돼 있던 상태 아이콘(대기/완료/인증필요/
// 입력대기/도움요청) 5종을 하나로 합친 것 — 사이드바 태스크 행·서브태스크 체인 노드가 공유해서 쓴다.
export const CLOCK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3.5 2" />
	</svg>
)
export const CHECK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
		<path d="M5 13l4 4L19 7" />
	</svg>
)
export const LOCK = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
		<rect x="5" y="11" width="14" height="9" rx="2" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	</svg>
)
export const QUESTION = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 9a3 3 0 1 1 4 2.8c-.9.4-1.5 1.1-1.5 2.2" />
		<path d="M12 17h.01" />
	</svg>
)
// "업무가 멈추든... 서로가 답장을 주는거야" — 서브태스크가 스스로 report-blocked로 보고한 "도움
// 필요" 상태 전용 아이콘. QUESTION(입력 대기)·LOCK(인증)과는 다른 신호라 느낌표로 구분한다.
export const HELP = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 7.5v6" />
		<path d="M12 17h.01" />
	</svg>
)
