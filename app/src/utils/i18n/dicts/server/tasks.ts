// app/server/tasks.cjs가 JSON 응답 error 필드로 클라이언트에 보내는 한국어 문자열 카탈로그.
// 서버 코드는 그대로 두고 프론트 표시 시점에 t()로 번역한다.
//
// 주의: 서버의 `${...}` 템플릿 리터럴은 클라이언트로 보내지기 전에 이미 실제 값으로 치환된
// "완성된 문자열"이 되어 도착한다 — 프론트에서 원래 템플릿을 재구성할 방법이 없으므로, 이런
// 동적 문자열은 t()로 번역 불가능하다(DICT[ko] ?? ko 폴백 덕분에 그냥 한국어로 남을 뿐, 깨지진
// 않음). 이번 라운드 방침(서버 코드 변경 없음)상 아래는 번역 대상에서 제외한다:
//   - `그룹 '${group}'에 노션 백로그가 연결된 업무가 없습니다.` (L857)
//   - `그룹 '${g}'에 업무가 없습니다.` (L1115)
//   - `${pr.state} PR은 개선할 수 없습니다(열린 PR만).` (L1515)
//   - `${pr.state} PR은 반영할 수 없습니다(열린 PR만).` (L1663)
//   - `리뷰를 불러오지 못했어요 — ${rev.error}. 잠시 후 다시 시도해주세요.` (L1666)
const dict: Record<string, string> = {
	'PR 조회 실패: ': 'Failed to fetch PR: ',
	'PR 응답 파싱 실패': 'Failed to parse PR response',
	'이슈 조회 실패: ': 'Failed to fetch issue: ',
	'이슈 응답 파싱 실패': 'Failed to parse issue response',
	'레지스트리 저장 실패': 'Failed to save registry',
	'링크나 내용을 입력해 주세요.': 'Please enter a link or some content.',
	'AI 응답에서 일감 정보를 추출하지 못했어요.': 'Failed to extract task info from the AI response.',
	'링크를 찾을 수 없습니다.': 'Link not found.',
	'링크 읽기 실패: ': 'Failed to read link: ',
	'AI 응답에서 제목을 추출하지 못했어요.': 'Failed to extract a title from the AI response.',
	'링크를 넣어주세요 (스레드·노션·피그마).': 'Please provide a link (Thread/Notion/Figma).',
	'claude 실행 실패: ': 'Failed to run claude: ',
	'실패 항목을 찾을 수 없습니다.': 'Failed item not found.',
	'재시도할 수 없는 종류: ': 'This kind cannot be retried: ',
	'AI 응답에서 분류 결과를 추출하지 못했어요.': 'Failed to extract classification result from the AI response.',
	'key 필수': 'key is required',
	'dev/ops 만 지정 가능': 'Only dev/ops can be specified',
	'저장 실패': 'Failed to save',
	'배포 노션 카드가 없습니다(배포 위젯에 노션 카드 등록 필요).': 'No deployment Notion card found (register one in the deploy widget).',
	'작업 그룹을 선택하세요.': 'Please select a task group.',
	'job 없음(만료됐을 수 있음)': 'No job (it may have expired)',
	'결과 없음': 'No result',
	'백로그 생성/티켓 확인 실패': 'Failed to create backlog / verify ticket',
	'제목/요약이 필요해요.': 'A title/summary is required.',
	'그룹 필수': 'Group is required',
	'이 그룹에 시작된 브랜치가 없습니다(먼저 ▶진행으로 개발을 시작하세요).': 'No branch has been started in this group (start development with ▶ Progress first).',
	'그룹 이름을 입력하세요.': 'Please enter a group name.',
	'from·to 필수': 'from/to are required',
	'keys 배열 필요': 'A keys array is required',
	'key/ticket 필수': 'key/ticket are required',
	'dev1~dev6 만 가능': 'Only dev1–dev6 are allowed',
	'빌드 실패': 'Build failed',
	'key·repo·number 필수': 'key/repo/number are required',
	'먼저 리뷰를 실행하세요.': 'Please run a review first.',
	'PR을 찾을 수 없습니다.': 'PR not found.',
	'내 PR이 아니라 개선(푸시)할 수 없습니다.': 'Not your PR — cannot improve (push) it.',
	'PR 브랜치를 알 수 없습니다.': 'Cannot determine the PR branch.',
	'워크트리 생성 실패: ': 'Failed to create worktree: ',
	'내 PR이 아니라 반영(푸시)할 수 없습니다.': 'Not your PR — cannot apply (push) it.',
	'PR에 반영할 리뷰가 없어요(내 코멘트·notion 봇 등 자동봇 제외). 리뷰/라인/대화 코멘트를 모두 확인했어요.':
		'There is no review to apply to the PR (excluding your own comments and bots like the Notion bot). All review/line/conversation comments were checked.',
	'질문 내용을 입력하세요.': 'Please enter your question.',
	'ticket·url 필수': 'ticket/url are required',
	'slack/notion/figma 링크만 추가할 수 있어요.': 'Only slack/notion/figma links can be added.',
	'ticket 필수': 'ticket is required',
}

export default dict
