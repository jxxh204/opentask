// app/server/router.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
const dict: Record<string, string> = {
	'업무 설명이 필요합니다': 'A task description is required',
}

export default dict
