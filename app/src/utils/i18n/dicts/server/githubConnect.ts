// app/server/githubConnect.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
// '요청 타임아웃'은 dicts/server/index.ts에 이미 같은 값으로 정의돼 있어 중복 정의하지 않음.
const dict: Record<string, string> = {
	'GitHub OAuth App Client ID가 설정되지 않았습니다.': 'The GitHub OAuth App Client ID is not configured.',
	'응답 파싱 실패': 'Failed to parse response',
	'먼저 연동을 시작하세요.': 'Please start the connection first.',
	'코드가 만료됐습니다 — 다시 시도하세요.': 'The code has expired — please try again.',
	'토큰 발급 실패': 'Failed to issue token',
}

export default dict
