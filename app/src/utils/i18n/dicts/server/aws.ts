// app/server/aws.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// 문자열로 도착해 t()로 번역 불가능하다. 아래는 이번 라운드 번역 대상에서 제외:
//   - `자격증명 기록 실패 (${k}): ${friendlyError(w.err)}` (L89)
const dict: Record<string, string> = {
	'MFA 코드는 6자리 숫자여야 합니다.': 'The MFA code must be 6 digits.',
	'default 프로필에 mfa_serial이 없습니다 (~/.aws/config).': 'The default profile has no mfa_serial (~/.aws/config).',
	'STS 응답 파싱 실패': 'Failed to parse STS response',
	'STS 응답에 자격증명이 없습니다.': 'The STS response has no credentials.',
}

export default dict
