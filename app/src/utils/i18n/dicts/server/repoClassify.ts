// app/server/repoClassify.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
const dict: Record<string, string> = {
	'분류 실패: ': 'Classification failed: ',
	'AI 응답 파싱 실패': 'Failed to parse AI response',
	'알 수 없는 repoId: ': 'Unknown repoId: ',
}

export default dict
