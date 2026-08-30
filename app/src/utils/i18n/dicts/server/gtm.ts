// app/server/gtm.cjs가 JSON 응답 message 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
const dict: Record<string, string> = {
	'GTM 인벤토리는 OpenRM 코어에서 제외된 기능입니다.': 'GTM inventory is a feature excluded from OpenRM core.',
}

export default dict
