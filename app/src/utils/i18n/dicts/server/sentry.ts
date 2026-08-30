// app/server/sentry.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
const dict: Record<string, string> = {
	'식별자를 입력하세요.': 'Please enter an identifier.',
}

export default dict
