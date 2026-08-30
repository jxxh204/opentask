// app/server/actuator.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 아래는 서버가 값을 미리 채워 보내는 동적 문자열이라 t()로 번역 불가능해 제외:
//   - `허용되지 않은 세션: ${session} (state.json 미등록)` (L22)
//   - `세션 미기동: ${session}` (L37)
const dict: Record<string, string> = {
	'session·message 필수': 'session/message are required',
}

export default dict
