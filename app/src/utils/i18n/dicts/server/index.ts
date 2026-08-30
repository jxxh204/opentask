// app/server/index.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// 문자열로 도착해 t()로 번역 불가능하다(폴백으로 한국어 그대로 표시됨, 깨지지는 않음).
// 아래는 이번 라운드 번역 대상에서 제외:
//   - `포트 ${port} 확보 실패 — 수동으로 종료 후 다시 시도하세요` (L240)
//   - `로그인 실패 (status ${r.status || '-'}): ${r.error || '세션 미발급'}` (L1093)
//   - `:${port}에서 재시작할 dev 세션을 찾지 못했습니다 — 파일은 저장됐습니다` (L1918)
const dict: Record<string, string> = {
	'요청 타임아웃': 'Request timed out',
	'잘못된 경로': 'Invalid path',
	'경로를 찾을 수 없습니다: ': 'Path not found: ',
	'디렉토리가 아닙니다: ': 'Not a directory: ',
	'읽기 실패: ': 'Failed to read: ',
	'브랜치 이름을 입력하세요.': 'Please enter a branch name.',
	'years 필수 (예: years=2025,2026)': 'years is required (e.g. years=2025,2026)',
	'알 수 없는 국가 코드: ': 'Unknown country code: ',
	'branch 필요': 'branch is required',
	'dev1~6 중 선택 필요': 'Please choose one of dev1–6',
	'유저를 찾을 수 없습니다.': 'User not found.',
	'세션 미발급': 'No session issued',
	'토큰을 찾을 수 없습니다.': 'Token not found.',
	'원격 서버는 MSW 토글 불가 — 로컬 dev 서버에서만': 'MSW cannot be toggled on the remote server — local dev server only',
	'브랜치를 지정하세요.': 'Please specify a branch.',
	'key 필수': 'key is required',
	'초기화할 워크트리가 없습니다 (▶진행으로 먼저 시작).': 'There is no worktree to initialize (start with ▶ Progress first).',
	'워크트리 제거 실패': 'Failed to remove worktree',
	'cwd가 프로젝트 루트 하위가 아닙니다': 'cwd is not under the project root',
	'이미지 dataUrl 아님': 'Not an image data URL',
	'이미지 12MB 초과': 'Image exceeds 12MB',
	'저장 실패: ': 'Failed to save: ',
}

export default dict
