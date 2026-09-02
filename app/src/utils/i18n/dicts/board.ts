// Batch 1 (Shell & Board): SessionShell, FolderCard, TaskRow, TaskManagerBoard, MainTaskPicker,
// TaskColorDot, NotesSection, NoteDetailPanel, RepoRow, BranchChain
const dict: Record<string, string> = {
	// SessionShell.tsx — 상태바 "동기화 중" 표시(§ cockpitSummary === null)
	'동기화 중…': 'Syncing…',
	'레포·워크트리 상태(PR·dirty 등)를 처음 불러오는 중입니다.': 'Loading repo/worktree status (PRs, dirty state, etc.) for the first time.',

	// SessionShell.tsx — 상태바 업데이트 알림(§ useUpdateCheck.ts)
	'버전 {version} 릴리스 노트/다운로드 열기': 'Open release notes/download for version {version}',
	'🔔 새 버전 v{version}': '🔔 New version v{version}',

	// SessionShell.tsx — 하이브마인드 침묵형 막힘 표시(§ control.cjs checkStalled)
	'하이브마인드가 한동안 응답이 없습니다 — 확인해보세요': "Hivemind hasn't responded for a while — please check",

	// FolderCard.tsx — 지휘자 침묵형 막힘 표시(§ orchestrator.cjs checkStalledSubtasks conductorStalled)
	'지휘자가 한동안 응답이 없습니다 — 확인해보세요': "The conductor hasn't responded for a while — please check",

	// BranchChain.tsx
	'스택 PR': 'Stacked PR',
	'병렬 분기': 'Parallel branch',
	단일: 'Single',
	'브랜치 체인': 'Branch chain',

	// TaskColorDot.tsx
	'태스크 색상': 'Task color',
	'기본 배경': 'Default background',

	// RepoRow.tsx
	백엔드: 'Backend',
	'예: JSP 관리자 페이지, 백엔드 API': 'e.g. JSP admin page, backend API',

	// NotesSection.tsx / NoteDetailPanel.tsx
	메모: 'Note',
	'메모 추가': 'Add note',
	'메모 제목': 'Note title',
	설명: 'Description',
	'메모 내용을 적어주세요': 'Write your note here',
	'메모 삭제': 'Delete note',

	// SessionShell.tsx
	'레포 색상': 'Repo color',
	'{name} 색상': '{name} color',
	방금: 'just now',
	'전체 레포': 'All repos',
	'레포 없음': 'No repos',
	'{n}개 레포': '{n} repos',
	'날짜 없음': 'No date',
	크론잡: 'Cron Jobs',
	캘린더: 'Calendar',
	하이브마인드: 'Hivemind',
	검색: 'Search',
	'레포 관리': 'Manage repos',
	'새 레포 추가': 'Add new repo',
	'메인 태스크 추가': 'Add main task',
	'제목 생성 중…': 'Generating title…',
	'레포 분류 중…': 'Classifying repo…',
	시작: 'Start',
	'검색 결과 없음': 'No search results',
	'진행 중인 작업 없음': 'No tasks in progress',
	'보관된 작업 없음': 'No archived tasks',
	복원: 'Restore',
	'{n} 작업': '{n} tasks',
	'AI 검토': 'AI Review',
	실패: 'Failed',
	'설명 필요': 'Needs description',
	'{days}일': '{days}d',
	보관함: 'Archive',
	설정: 'Settings',
	연결됨: 'Connected',
	'localhost:{port} — 지금 태스크의 "브라우저" 탭에서 엽니다': 'localhost:{port} — opens in the current task\'s "Browser" tab',
	스트림: 'streams',
	'클릭하면 브라우저에서 엽니다': 'Click to open in your browser',

	// FolderCard.tsx
	'태스크 매니저에 인증이 필요합니다': 'Task manager needs authentication',
	'태스크 매니저가 입력을 기다리고 있습니다': 'Task manager is waiting for input',
	'세션 재개 확인이 필요합니다 (요약으로 재개할지 메뉴에서 멈춤)': 'Session needs a resume confirmation (stuck at the "resume from summary" menu)',
	'클린 판정이면 사람 확인 없이 자동으로 merge됩니다(우클릭으로 끌 수 있음)':
		'If judged clean, merges automatically without human confirmation (right-click to turn off)',
	'다시 누르면 보관함으로 이동합니다': 'Click again to move to Archive',
	'완료된 태스크를 보관함으로 이동': 'Move completed task to Archive',
	'흐리게 표시해 눈에 덜 띄게 합니다 (다시 누르면 원래대로)': 'Dim it so it stands out less (click again to restore)',
	'다시 누르면 원래 밝기로 돌아옵니다': 'Click again to restore full brightness',
	'이름 변경': 'Rename',
	서브태스크: 'Subtask',
	'서브태스크 추가': 'Add subtask',
	'꺼짐(기본): AI 리뷰가 클린이어도 사람이 직접 merge를 눌러야 함. 켜짐: 클린 판정 시 실제 merge까지 자동(§12).':
		'Off (default): even if AI review is clean, a human must merge manually. On: merges automatically when judged clean.',
	끄기: 'Turn off',
	켜기: 'Turn on',
	'다시 누르면 되돌릴 수 없이 삭제됩니다(산하 태스크는 일감함으로 돌아감)': 'Click again to delete permanently (subtasks return to the inbox)',
	'이 메인 태스크를 삭제합니다': 'Delete this main task',
	'정말 삭제할까요? (다시 클릭)': 'Really delete? (click again)',
	'도움 요청: {reason}': 'Help requested: {reason}',
	'인증이 필요합니다': 'Authentication required',
	'세션 재개 확인이 필요합니다': 'Session needs a resume confirmation',
	'입력이 필요합니다': 'Input required',
	'한동안 응답이 없습니다 — 확인해보세요': 'No response for a while — please check',
	'여기로 서브태스크를 드래그': 'Drag a subtask here',

	// TaskRow.tsx
	'이슈 {n}': '{n} issues',
	'리뷰 완료': 'Review complete',
	'이 서브태스크가 속한 태스크 전체를 오케스트레이션합니다': 'Orchestrates the entire task this subtask belongs to',
	'태스크를 만들어 워크트리+세션을 바로 시작합니다': 'Creates a task and immediately starts its worktree + session',
	'태스크 매니저와 마지막으로 주고받은 대화 시각': 'Time of the last exchange with the task manager',
	'완료 처리': 'Mark as done',
	'"{name}" 연결을 해제할까요? 워크트리·브랜치는 그대로 남습니다.': '"{name}" will be disconnected. The worktree/branch will remain as-is. Continue?',
	'연결 해제 (워크트리 유지)': 'Disconnect (keep worktree)',

	// TaskManagerBoard.tsx
	대기: 'Idle',
	'진행 중': 'In progress',
	'세션 종료': 'Session ended',
	'아직 서브태스크 없음 — AI 검토가 끝나면 자동 생성되거나, 상세페이지에서 직접 추가할 수 있습니다.':
		'No subtasks yet — they will be auto-created once AI review finishes, or you can add one directly from the detail page.',
	'클릭하면 이 서브태스크의 세션 탭이 열립니다': 'Click to open this subtask\'s session tab',
	'worktree 없음': 'No worktree',
	'설명 없음': 'No description',
	'아직 없음': 'None yet',

	// MainTaskPicker.tsx
	'메인 태스크로 편입…': 'Merge into main task…',
	'고를 수 있는 태스크가 아직 없습니다': 'No tasks available to pick yet',
	'새 메인 태스크 이름': 'New main task name',
	추가: 'Add',
	'새 메인 태스크 만들기': 'Create new main task',
}

export default dict
