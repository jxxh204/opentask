// Batch 6 — Assistant/Team/Server pane (ControlPane.tsx, TeamRulesPane.tsx, ServerPane.tsx)
const dict: Record<string, string> = {
	// ControlPane.tsx
	입력: 'Input',
	결과: 'Result',
	'세션 생성 실패': 'Failed to create session',
	'이미지 업로드 실패': 'Image upload failed',
	'[이미지 첨부: {path}]': '[Image attached: {path}]',
	하이브마인드: 'Hivemind',
	재시작: 'Restart',
	'하이브마인드에게 태스크 생성, 일정 조정, 크론잡 등을 자연어로 부탁해보세요.':
		'Ask the Hivemind in natural language to create tasks, adjust schedules, set up cron jobs, and more.',
	'이미지 업로드 중…': 'Uploading image…',
	'하이브마인드에게 메시지… (이미지 붙여넣기 가능)': 'Message the Hivemind… (you can paste images)',
	'보내기 (Enter)': 'Send (Enter)',
	'하이브마인드 세션 시작 중…': 'Starting Hivemind session…',
	// "처음쓰는사람이 쓰자마자 무한로딩이 걸렸어" — 세션 화면에서 잡아낸 사고 안내(§ ControlPane.tsx TROUBLE_TEXT).
	'이 모델의 사용 한도에 도달해 다른 모델로 자동 전환하는 중입니다 — 잠시 뒤 방금 보낸 말을 다시 보내주세요.':
		"This model's usage limit was reached, so the Hivemind is switching models — send your message again in a moment.",
	'claude 명령을 찾을 수 없습니다 — Claude Code CLI를 설치하고 터미널에서 한 번 로그인한 뒤 "재시작"을 누르세요.':
		'The claude command was not found — install the Claude Code CLI, log in once in a terminal, then press "Restart".',
	'Claude Code 로그인이 필요합니다 — 아래 터미널에서 로그인을 마친 뒤 "재시작"을 누르세요.':
		'Claude Code needs you to log in — finish logging in in the terminal below, then press "Restart".',
	'설정된 모델을 쓸 수 없습니다 — 설정에서 하이브마인드 모델을 다른 것으로 바꾸세요.':
		'The configured model is unavailable — pick a different Hivemind model in Settings.',
	'이전 대화를 이어받지 못했습니다 — "초기화"를 눌러 새 대화로 시작하세요.':
		'Could not resume the previous conversation — press "Reset" to start a fresh one.',
	'하이브마인드가 응답하지 않습니다 — 아래 터미널에서 실제 화면을 확인하거나 "재시작"을 눌러보세요.':
		"The Hivemind isn't responding — check the live screen in the terminal below, or press \"Restart\".",

	// ServerPane.tsx
	'✓ 저장 완료 · {target} 재시작됨': '✓ Saved · {target} restarted',
	세션: 'session',
	'저장됨 · {error}': 'Saved · {error}',
	'저장 실패: {msg}': 'Save failed: {msg}',
	'✓ 저장 완료': '✓ Saved',
	'불러오는 중…': 'Loading…',
	'환경변수 · {path}/.env.local': 'Environment variables · {path}/.env.local',
	'+ 추가': '+ Add',
	'아직 변수 없음 — "+ 추가"로 시작하세요.': 'No variables yet — start with "+ Add".',
	'재시작할 포트(선택)': 'Port to restart (optional)',
	'저장 중…': 'Saving…',
	'저장하고 재시작': 'Save and restart',

	// TeamRulesPane.tsx
	'팀 규칙': 'Team rules',
	'브랜치 네이밍, 사전 문서 작성 같은 팀마다 다른 개발 관행을 자연어로 적어둔다. 레포별로 따로 저장되고, 네 칸을 전부 비워두면 지금과 완전히 동일하게 동작한다.':
		'Write down team-specific conventions in natural language — branch naming, doc-first requirements, etc. Saved per repo; leaving all four fields blank keeps current behavior unchanged.',
	'이 태스크만의 규칙 — "{name}"': 'Rules unique to this task — "{name}"',
	'하이브마인드에게 물어보면서 채우기': 'Fill in by asking the Hivemind',
	'하이브마인드 여는 중…': 'Opening Hivemind…',
	'✦ 하이브마인드에게 물어보기': '✦ Ask the Hivemind',
	'같은 레포의 다른 태스크에는 안 쓰이는, 이 태스크만의 예외·특이사항. 아래 팀 규칙보다 먼저 적용된다.':
		"Exceptions/quirks unique to this task, not used by other tasks in the same repo. Applied before the team rules below.",
	'예: 이 작업은 A/B 테스트 플래그로 감싸서 배포한다.': 'e.g. Deploy this work behind an A/B test flag.',
	'연결된 레포가 없습니다 — 사이드바에서 레포를 먼저 추가하세요.': 'No repo connected — add a repo from the sidebar first.',
	'저장 필요': 'Needs saving',

	// RULE_SLOTS 라벨 (title/where/hint/placeholder) — askFor는 비서에게 보내는 프롬프트 본문에만
	// 쓰이는 자연어 지시문이라 번역 대상에서 제외.
	'일반 규칙': 'General rules',
	'모든 지점 · 항상 동반': 'All branches · always included',
	'아래 세 칸 중 어디에도 안 맞는 것 — 커밋 메시지 포맷, PR 템플릿 등. 모든 에이전트 지시문에 항상 함께 실린다.':
		"Anything that doesn't fit the three fields below — commit message format, PR template, etc. Always included in every agent instruction.",
	'예: 커밋 메시지는 한국어 한 줄 요약 + Conventional Commits 접두사(feat/fix/chore)를 붙인다.':
		'e.g. Commit messages get a one-line summary plus a Conventional Commits prefix (feat/fix/chore).',
	'태스크 작성 규칙': 'Task-writing rules',
	'적용: 일감 검토 · 서브태스크 생성': 'Applies to: reviewing work items · creating subtasks',
	'서브태스크를 쓰거나 다듬을 때 태스크 매니저가 참고할 문체·필수 항목.':
		'The style and required fields the task manager should follow when writing or refining subtasks.',
	'예: 서브태스크 설명엔 항상 완료 기준(Acceptance Criteria)을 포함한다.':
		'e.g. Always include Acceptance Criteria in the subtask description.',
	'워크트리 · 브랜치 생성 규칙': 'Worktree / branch creation rules',
	'적용: 서브태스크 워크트리 생성': 'Applies to: creating a subtask worktree',
	'채우면 브랜치명이 자동으로 영문 슬러그로 번역되고, 이 규칙 원문이 그 서브태스크 세션에 전달돼 필요하면 직접 git branch -m으로 다듬는다.':
		'If filled in, the branch name is auto-translated into an English slug, and this rule text is passed to the subtask session so it can fine-tune it with git branch -m if needed.',
	'예: 브랜치명은 영문 kebab-case. 항상 GBIZ- 접두사를 붙인다.': 'e.g. Branch names are English kebab-case, always prefixed with GBIZ-.',
	'개발 시작 전 필수 조건': 'Prerequisites before starting development',
	'적용: 서브태스크 개발 시작': 'Applies to: starting subtask development',
	'이 조건이 있으면 서브태스크 세션이 코드를 작성하기 전에 먼저 처리하도록 지시받는다(예: 노션 문서 작성).':
		'If set, the subtask session is instructed to handle this before writing code (e.g. writing a Notion doc).',
	'예: 브랜치를 만들기 전에 노션에 스펙 문서를 먼저 쓰고, 그 링크를 서브태스크 설명에 채워 넣는다.':
		'e.g. Before creating a branch, write a spec doc in Notion first and put its link in the subtask description.',
}

export default dict
