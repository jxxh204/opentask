// app/server/apiui.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
const dict: Record<string, string> = {
	'src walk 실패: ': 'Failed to walk src: ',
}

export default dict
