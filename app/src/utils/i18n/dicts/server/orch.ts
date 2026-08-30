// app/server/orch.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// 문자열로 도착해 t()로 번역 불가능하다. 아래는 이번 라운드 번역 대상에서 제외:
//   - `${to}의 서브에이전트 세션이 없습니다(먼저 투입 필요).` (L61)
//   - `그룹 '${group}'에 업무가 없습니다.` (L110)
const dict: Record<string, string> = {
	'group 필수': 'group is required',
	'group·to·text 필수': 'group/to/text are required',
	'group·text 필수': 'group/text are required',
}

export default dict
