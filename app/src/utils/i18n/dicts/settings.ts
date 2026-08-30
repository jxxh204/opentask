// Batch 5 — SettingsModal, ModelPolicyPane, AddRepoModal, NewTaskModal, RepoTable, RepoSelect,
// QuickstartModal, common/FolderBrowserModal.
const dict: Record<string, string> = {
	// SettingsModal.tsx
	설정: 'Settings',
	테마: 'Theme',
	'라이트/다크 화면을 선택합니다. 시스템은 OS 설정을 따라갑니다.': 'Choose light or dark. System follows your OS setting.',
	라이트: 'Light',
	다크: 'Dark',
	시스템: 'System',
	'내부 용어 언어': 'Internal terminology language',
	'캘린더 공휴일 국가': 'Calendar holiday country',
	'캘린더에 표시할 공휴일 기준 국가입니다. 기본값은 이 컴퓨터의 언어 설정으로 추정됩니다.':
		"The country whose holidays are shown on the calendar. Defaults to a guess from this computer's language setting.",
	'앱 종료 시 백엔드': 'Backend on app quit',
	'기본은 앱을 꺼도 백엔드가 계속 떠서 세션이 이어집니다. "완전 종료"를 켜면 앱을 끌 때 백엔드도 같이 내려갑니다(포트도 반납됨).':
		'By default the backend keeps running when you quit the app, so sessions continue. Turn on "Full quit" to shut the backend down with the app too (frees the port).',
	유지: 'Keep running',
	'완전 종료': 'Full quit',
	'팀 규칙 →': 'Team rules →',
	'레포별 브랜치·문서 규칙을 탭에서 확인하고 바꿉니다.': 'View and edit per-repo branch/doc rules in a tab.',
	'모델 배정 →': 'Model assignment →',
	'작업 종류별로 어떤 모델을 쓸지 탭에서 확인하고 바꿉니다.': 'View and change which model each task type uses, in a tab.',
	'퀵스타트 다시 보기 →': 'Replay quickstart →',
	'처음 앱을 켰을 때 봤던 사용법 안내를 다시 엽니다.': 'Reopen the usage guide shown the first time you launched the app.',

	// ModelPolicyPane.tsx
	'모델 배정': 'Model assignment',
	'작업 종류별로 어떤 모델을 쓸지 확인하고 바꿉니다. 코드 재시작 없이 바로 적용됩니다.': 'View and change which model each task type uses. Applies immediately, no restart needed.',
	'불러오는 중…': 'Loading…',
	'설계·아키텍처': 'Design & architecture',
	'태스크 매니저(서브태스크 체인 조율)': 'Task Manager (subtask chain orchestration)',
	'비서(캘린더·크론잡·설정)': 'Assistant (calendar, cron jobs, settings)',
	'▶진행 제품 코딩': '▶ Active product coding',
	'PR 코드 리뷰': 'PR code review',
	'리뷰대로 코드 개선': 'Code fixes per review',
	'QA 테스트케이스 생성': 'QA test case generation',
	'TC 검증(playwright)': 'TC verification (Playwright)',
	'운영/PR 모니터 루프': 'Ops/PR monitor loop',
	'디버깅 명령': 'Debug command',
	'백로그 생성': 'Backlog generation',
	'스레드 정리': 'Thread cleanup',
	'업무 코드/비개발 판정': 'Code vs. non-dev task classification',
	'비개발 업무 자동수행': 'Automated non-dev task execution',
	'배포 백로그 연결': 'Deploy-backlog linking',
	'브랜치명 번역': 'Branch name translation',
	'PPT 제작': 'PPT creation',

	// QuickstartModal.tsx
	'OpenTask 퀵스타트': 'OpenTask Quickstart',
	'태스크 만들기': 'Create a task',
	'사이드바 검색창 위 "태스크 추가"를 누르면 메인 태스크 또는 서브태스크를 만들 수 있어요. Figma·슬랙·Notion·PR 링크를 그대로 붙여넣으면 종류가 자동으로 인식됩니다.':
		'Click "Add task" above the sidebar search box to create a main task or subtask. Paste a Figma, Slack, Notion, or PR link directly and its type is detected automatically.',
	'서브태스크 = 워크트리': 'Subtask = worktree',
	'서브태스크를 만드는 순간 격리된 git worktree와 실제 터미널 세션이 열립니다. 실제 코드 작업은 여기서만 일어나요.':
		'The moment you create a subtask, an isolated git worktree and a real terminal session open. All actual code work happens here.',
	'태스크 매니저가 자동으로 지휘': 'The Task Manager conducts automatically',
	'별도 시작 버튼이 없습니다 — 서브태스크가 생기면 곧바로 순차 웨이브로 지휘를 시작하고, 라이브 터미널과 계획·지시·보고 로그를 함께 보여줍니다.':
		"There's no separate start button — as soon as a subtask appears, it starts directing work in sequential waves, showing the live terminal alongside plan/instruction/report logs.",
	'PR 리뷰에 직접 적용·항의': 'Apply or dispute PR reviews directly',
	'리뷰 코멘트에 "적용"을 누르면 실제로 커밋·푸시까지 진행되고, "항의"를 누르면 GitHub에 공개 답글이 게시됩니다.':
		'Clicking "Apply" on a review comment actually commits and pushes the fix; clicking "Dispute" posts a public reply on GitHub.',
	'캘린더 · 크론잡 · 비서': 'Calendar · Cron jobs · Assistant',
	'캘린더로 일정을 잡고, 크론잡으로 반복 업무를 자동화하세요. "비서"는 태스크 하나가 아니라 앱 전체를 자연어로 조작하는 최상위 에이전트입니다.':
		'Schedule with the calendar, and automate recurring work with cron jobs. The "Assistant" is a top-level agent that controls the whole app in natural language, not just a single task.',
	'더 자세한 사용법 →': 'More detailed usage →',
	시작하기: 'Get started',

	// AddRepoModal.tsx
	'레포 추가': 'Add repo',
	'폴더 찾아보기': 'Browse folder',
	'로컬 프로젝트, git 레포, 또는 여러 레포가 있는 폴더': 'A local project, a git repo, or a folder containing several repos',
	'다른 방법': 'Other ways',
	'URL에서 클론': 'Clone from URL',
	'원격 git 레포를 클론': 'Clone a remote git repo',
	'새 프로젝트 만들기': 'Create a new project',
	'빈 폴더에서 시작(git init)': 'Start from an empty folder (git init)',
	'등록된 레포 관리': 'Manage registered repos',
	'대상 폴더': 'Target folder',
	'(선택 안 됨)': '(not selected)',
	찾아보기: 'Browse',
	뒤로: 'Back',
	'클론 중…': 'Cloning…',
	클론: 'Clone',
	'프로젝트 이름': 'Project name',
	위치: 'Location',
	'생성 중…': 'Creating…',
	만들기: 'Create',
	'clone 실패': 'Clone failed',
	'생성 실패': 'Creation failed',
	'폴더 선택': 'Choose folder',

	// NewTaskModal.tsx
	'메인 태스크를 먼저 골라주세요.': 'Choose a main task first.',
	'추가 실패': 'Failed to add',
	'일감 생성': 'Create item',
	'메인 태스크': 'Main task',
	서브태스크: 'Subtask',
	'메인 태스크: {name}': 'Main task: {name}',
	'메인 태스크 고르기…': 'Choose main task…',
	'서브태스크 이름': 'Subtask name',
	'제목을 쓰거나 Figma·스레드·Notion·PR 링크를 붙여넣으세요': 'Type a title, or paste a Figma, Thread, Notion, or PR link',
	예정일: 'Due date',
	지우기: 'Clear',
	'추가 중…': 'Adding…',
	'서브태스크로 추가': 'Add as subtask',
	'일감으로 추가': 'Add as task',
	'고른 메인 태스크 밑에 서브태스크로 바로 들어갑니다.': 'Goes straight in as a subtask under the main task you chose.',
	'새 일감은 미분류에 담깁니다 — 필요할 때 태스크로 드래그해 옮기세요.': 'New items land in Unsorted — drag them onto a task whenever you need to.',

	// RepoTable.tsx
	이름: 'Name',
	경로: 'Path',
	'기본 브랜치': 'Default branch',
	'설명 (자동배정 판단 근거)': 'Description (used for auto-assignment)',
	'등록된 레포 없음 — 이 프로젝트가 단일 레포면 안 채워도 됩니다.': 'No repos registered — leave this empty if this project is a single repo.',
	'+ 레포 추가': '+ Add repo',
	'1개뿐이면 자동배정 안 함 — 지금처럼 단일 레포로 동작': "With only one, auto-assignment is off — it behaves like a single repo, same as now",
	'{n}개 레포': '{n} repos',

	// RepoSelect.tsx
	'(선택 안 함)': '(none selected)',

	// common/FolderBrowserModal.tsx
	'읽기 실패': 'Failed to read',
	'.. (상위 폴더)': '.. (parent folder)',
	'하위 폴더 없음': 'No subfolders',
	'이 폴더 선택': 'Choose this folder',
}

export default dict
