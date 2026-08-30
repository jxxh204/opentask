// app/server/repoAdd.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// 문자열로 도착해 t()로 번역 불가능하다. 아래는 이번 라운드 번역 대상에서 제외:
//   - `이미 존재하는 폴더: ${target}` (L28, L41)
//   - `대상 폴더가 없습니다: ${parentPath}` (L29)
const dict: Record<string, string> = {
	'URL이 필요합니다.': 'A URL is required.',
	'대상 폴더가 필요합니다.': 'A target folder is required.',
	'git clone 실패: ': 'git clone failed: ',
	'프로젝트 이름이 필요합니다.': 'A project name is required.',
	'폴더 생성 실패: ': 'Failed to create folder: ',
	'git init 실패: ': 'git init failed: ',
}

export default dict
