// app/server/worktrees.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// 문자열로 도착해 t()로 번역 불가능하다. 아래는 이번 라운드 번역 대상에서 제외:
//   - `이미 존재하는 폴더: ${dir} (기존 워크트리에서 시작하세요)` (L102)
//   - `base 브랜치를 찾을 수 없음: ${baseRef} (git fetch 필요할 수 있음)` (L115)
//   - `base 브랜치를 찾을 수 없음: ${baseRef}` (L222, L251)
//   - `이미 있는 브랜치: ${branch}` (L224)
const dict: Record<string, string> = {
	'티켓/브랜치명을 입력하세요.': 'Please enter a ticket/branch name.',
	'불완전 node_modules 정리 실패: ': 'Failed to clean up incomplete node_modules: ',
	'메인 레포에 node_modules가 없음 — 먼저 메인에서 설치 필요': 'The main repo has no node_modules — install it in main first',
	'node_modules 심링크 실패: ': 'Failed to symlink node_modules: ',
	'배포 번호(숫자)를 입력하세요. 예: 286': 'Please enter a deploy number (digits). e.g. 286',
	'그룹 필수': 'Group is required',
	'브랜치 리셋 실패: ': 'Failed to reset branch: ',
	'브랜치를 찾을 수 없음(로컬/원격 모두 없음)': 'Branch not found (missing both locally and remotely)',
}

export default dict
