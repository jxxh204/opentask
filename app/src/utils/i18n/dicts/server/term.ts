// app/server/term.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
const dict: Record<string, string> = {
	'cwd 필수': 'cwd is required',
	'cwd 디렉토리 아님': 'cwd is not a directory',
	'cwd 없음: ': 'cwd not found: ',
	'스냅샷에 없음': 'Not in the snapshot',
	'워크트리 없음: ': 'Worktree not found: ',
	'node_modules 준비 실패: ': 'Failed to prepare node_modules: ',
	'워크트리 준비 실패: ': 'Failed to prepare worktree: ',
	'빈 포트 없음 (3000-3099)': 'No free port available (3000–3099)',
	'OpenRM 세션만 종료 가능': 'Only OpenRM sessions can be terminated',
	'종료 실패 (세션을 못 찾음)': 'Failed to terminate (session not found)',
	'세션 지정 필요': 'A session must be specified',
	'세션 없음': 'Session not found',
	'name·message 필수': 'name/message are required',
}

export default dict
