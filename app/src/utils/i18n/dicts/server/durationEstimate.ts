// app/server/durationEstimate.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
// 'job 없음(만료됐을 수 있음)'/'결과 없음'은 tasks.ts에 이미 같은 값으로 정의돼 있어 중복 정의하지 않음.
const dict: Record<string, string> = {
	'경로가 저장소 밖을 가리켜 무시함': 'Ignored because the path points outside the repo',
	'파일을 찾을 수 없음(경로 확인 필요 — 모델이 잘못 지목했을 수 있음)': 'File not found (check the path — the model may have pointed to the wrong one)',
	'AI 응답 파싱 실패': 'Failed to parse AI response',
	'claude 실행 실패: ': 'Failed to run claude: ',
	'시간이 너무 오래 걸려 중단했습니다 — 다시 시도해 주세요.': 'It took too long and was stopped — please try again.',
	'설명이 비어 있어 추정할 근거가 없습니다': 'The description is empty, so there is nothing to estimate from',
}

export default dict
