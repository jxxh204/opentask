// app/server/orchestrator.cjs가 JSON 응답 error/message 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// 문자열로 도착해 t()로 번역 불가능하다. 아래는 이번 라운드 번역 대상에서 제외:
//   - `taskId ${taskId}의 세션이 없습니다.` (L764)
//   - `알 수 없는 kind: ${kind}` (L817)
//   - `AI가 자동배정한 레포(${repo.name})와 태스크명 사이에 겹치는 키워드가 없어 재확인이 필요합니다.` (L477, reason 필드)
const dict: Record<string, string> = {
	'서브태스크가 없습니다 — AI 검토를 먼저 완료하거나 직접 추가해주세요.': 'There are no subtasks — finish the AI review first or add one manually.',
	'모든 서브태스크가 이미 시작됐습니다 — 다음으로 넘기려면 진행을 쓰세요.': 'All subtasks have already started — use Progress to move to the next one.',
	'진행 중인 서브태스크가 없습니다 — 먼저 시작하세요.': 'No subtask is in progress — start one first.',
	'메인 태스크에 아직 연결되지 않았습니다.': 'Not yet linked to a main task.',
	'진행 중인 서브태스크가 없습니다.': 'No subtask is in progress.',
	'진행 중인 세션이 없습니다.': 'No session is in progress.',
	'이미 시작 중입니다 — 잠시 후 다시 시도하세요.': 'Already starting — please try again shortly.',
	'폴더에 태스크가 없습니다.': 'There are no tasks in the folder.',
	'오케스트레이션이 실행 중이 아닙니다. 먼저 start 하세요.': 'Orchestration is not running. Start it first.',
	'진행할 세션이 없습니다.': 'There is no session to advance.',
	'계속 진행해줘.': 'Please continue.',
	'taskId·text 필수': 'taskId/text are required',
	'오케스트레이션 상태 없음': 'No orchestration state',
	'text 필수': 'text is required',
	'태스크 매니저 세션이 없습니다(먼저 시작).': 'There is no task manager session (start one first).',
	'태스크 매니저 세션이 죽었습니다.': 'The task manager session has died.',
	'태스크 매니저 세션이 없습니다.': 'There is no task manager session.',
	'taskId·kind 필수': 'taskId/kind are required',
}

export default dict
