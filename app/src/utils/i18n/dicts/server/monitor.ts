// app/server/monitor.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
const dict: Record<string, string> = {
	'이미 읽는 중입니다.': 'Already reading.',
	'채널 읽기 실패: ': 'Failed to read channel: ',
	'AI 응답 파싱 실패': 'Failed to parse AI response',
	'질문 내용을 입력하세요.': 'Please enter your question.',
	'해당 항목을 찾을 수 없습니다(새로고침 후 재시도).': 'The item was not found (refresh and try again).',
	'PR 번호를 확인할 수 없습니다.': 'Cannot determine the PR number.',
	'답변 생성 실패: ': 'Failed to generate an answer: ',
	'지시 내용을 입력하세요.': 'Please enter an instruction.',
	'조사 실패: ': 'Investigation failed: ',
	'tmux 세션 생성 실패 (tmux 설치/권한 확인)': 'Failed to create tmux session (check tmux install/permissions)',
	'특이사항 감지 시 이렇게 알립니다': "This is how you'll be notified when something unusual is detected",
	'개발실 미분류에 추가됨': 'Added to Dev Room / Unclassified',
}

export default dict
