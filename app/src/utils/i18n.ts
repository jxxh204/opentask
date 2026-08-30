import { useUiStore } from '../store/useUiStore'

// 설정 > "내부 용어 언어" 토글(§SettingsModal) — 전체 UI가 아니라 "오케스트레이터"·"워크트리" 같은
// 내부 용어가 들어간 문장만 영어로 바꾼다. 문자열 전체를 키로 쓰는 조회 테이블 방식이라, 새로 옮길
// 문장이 생기면 이 사전에 한 줄 추가하고 호출부에서 t('...')로 감싸면 된다.
const DICT: Record<string, string> = {
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
}

export function useT() {
	const lang = useUiStore((s) => s.lang)
	return (ko: string) => (lang === 'en' ? (DICT[ko] ?? ko) : ko)
}
