// app/server/deploy.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// 문자열로 도착해 t()로 번역 불가능하다. 아래는 이번 라운드 번역 대상에서 제외:
//   - `base 브랜치 없음: ${base}` (L103)
//   - `이미 있는 브랜치: ${branch}` (L105)
const dict: Record<string, string> = {
	'배포 번호를 못 찾았어요. 번호(예: 286)를 함께 적어주세요.': 'Could not find a deploy number. Please include one (e.g. 286).',
	'deploy- 브랜치만 삭제 가능': 'Only deploy- branches can be deleted',
	'deploy- 브랜치만 가능': 'Only deploy- branches are allowed',
	'노션 링크를 입력하세요.': 'Please enter a Notion link.',
}

export default dict
