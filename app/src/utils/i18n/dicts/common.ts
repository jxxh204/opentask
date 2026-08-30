// 여러 파일에서 겹치는 공통 단어/문장 전용 사전. 다른 dicts/*.ts에 새 항목을 추가하기 전에
// 먼저 이 파일에 이미 있는지 확인할 것 — 같은 한글 키를 다른 영어값으로 다른 파일에 또 정의하면
// index.ts의 mergeDicts()가 dev 콘솔에 충돌 경고를 낸다.
const dict: Record<string, string> = {
	// 원래 utils/i18n.ts에 있던 항목 — 그대로 이전
	'태스크를 열면 여기에 오케스트레이터 · 터미널 · 로컬 서버 · 브라우저 탭이 뜹니다':
		'Opening a task shows the Orchestrator, Terminal, Local Server, and Browser tabs here',
	워크트리: 'worktree',
	'워크트리가 아직 없습니다 — 오케스트레이션을 먼저 시작하세요.': 'No worktree yet — start orchestration first.',
	'아직 지휘자 세션이 없습니다': 'No orchestrator session yet',
	'아직 워크트리가 없습니다': 'No worktree yet',
	'오케스트레이터 탭에서 "대화 시작"을 눌러 지휘자 세션을 먼저 띄우세요.': 'Click "Start conversation" in the Orchestrator tab to launch the orchestrator session first.',
	'서브태스크가 이 태스크에 들어가는 순간 오케스트레이터가 자동으로 워크트리·세션을 만듭니다.':
		'The moment a subtask enters this task, the orchestrator automatically creates its worktree and session.',
	'새 워크트리': 'New worktree',
	'리뷰 적용 = 워크트리 Claude에게 수정 지시 · 리뷰 항의 = 리뷰어에게 회신':
		'Apply = instruct the worktree Claude to fix it · Dispute = reply publicly to the reviewer',
	'태스크 아래 서브태스크를 만들면, AI가 워크트리에서 웨이브로 작업을 지휘합니다.':
		'Create a subtask under a task and AI drives the work in waves inside its worktree.',
	'오케스트레이터·워크트리 같은 짧은 용어 라벨만 바뀝니다.': 'Sentences that mention terms like Orchestrator/worktree switch to English.',

	// 범용 동사/버튼 라벨 — 여러 파일에서 반복 등장하므로 여기 한 곳에서만 정의
	취소: 'Cancel',
	삭제: 'Delete',
	닫기: 'Close',
	확인: 'OK',
	저장: 'Save',
	편집: 'Edit',
	완료: 'Done',

	// LINK_LABEL(utils/linkDetect.ts) 값 — FolderCard/BranchChain/TaskDetailContent/useSessionsStore
	// 등 여러 배치가 공유해서 쓰는 라벨이라 공통 사전에 둔다.
	피그마: 'Figma',
	스레드: 'Thread',
	노션: 'Notion',

	// useSessionsStore.ts non-hook translate 대상
	'내용을 입력하세요.': 'Please enter some content.',
	'{label} 링크 태스크': '{label} link task',
	'브랜치 미지정': 'Branch unspecified',
	'새 폴더': 'New folder',
	'태스크 매니저 시작 실패': 'Failed to start task manager',
	'전송 실패': 'Failed to send',
	'AI 리뷰 실패': 'AI review failed',
}

export default dict
