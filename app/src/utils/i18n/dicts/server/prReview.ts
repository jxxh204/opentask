// app/server/prReview.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// 문자열로 도착해 t()로 번역 불가능하다. 아래는 이번 라운드 번역 대상에서 제외:
//   - `PR을 찾을 수 없음: ${branch.repo} (head=${branch.name})` (L91, L107, L287)
//   - `이 mainTask의 재시도 횟수(${retryLimit}회)를 이미 다 썼습니다 — 직접 확인해주세요.` (L241)
//   - `세션이 살아있지 않습니다: ${rec.tmuxSession} (먼저 오케스트레이션 start).` (L260)
//   - `재시도 ${retryLimit}회 소진 — 사람 개입 필요 (더 이상 자동 재시도 안 함)` (L238, reason 필드)
//   - `재요청 ${attempts + 1}회차(N=${retryLimit}) — ...` (L272, reason 필드)
const dict: Record<string, string> = {
	'branch에 repo/name이 없어 PR을 특정할 수 없습니다.': 'The branch has no repo/name, so the PR cannot be identified.',
	'AI 리뷰 실행 실패: ': 'Failed to run AI review: ',
	'AI 응답 파싱 실패': 'Failed to parse AI response',
	'repo/prNumber/commentId 필수': 'repo/prNumber/commentId are required',
	'이 태스크의 오케스트레이션 세션 기록이 없습니다 (먼저 오케스트레이션 start).': 'There is no orchestration session record for this task (start orchestration first).',
	'새 세션 시작 실패: ': 'Failed to start a new session: ',
	'dispatch 실패: ': 'Failed to dispatch: ',
	'이 리뷰에 GitHub comment id(external_id)가 없어 답글을 달 수 없습니다.': 'This review has no GitHub comment id (external_id), so a reply cannot be posted.',
	'branch repo/name 없음 — PR을 특정할 수 없습니다.': 'Branch repo/name is missing — the PR cannot be identified.',
}

export default dict
